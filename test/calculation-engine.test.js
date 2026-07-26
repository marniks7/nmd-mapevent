const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../data/event-config.json');
const engine = require('../js/calculation-engine');

function defaultProjection(overrides = {}) {
  return engine.projectEvent({
    config,
    eventDays: 28,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 3,
    luckyElementalPerDay: 15,
    randomFragmentsPerDay: 19,
    randomStrategy: 'minimum',
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: true,
    includeMythicalMember: true,
    ...overrides,
  });
}

test('default projection produces stable final totals and conversion', () => {
  const result = defaultProjection();

  assert.deepEqual(result.rawRewards, { universal: 1762, elemental: 1604 });
  assert.deepEqual(result.conversion.rewards, { universal: 1939, elemental: 1250 });
  assert.equal(result.conversion.elementalSpent, 354);
  assert.equal(result.conversion.universalGain, 177);
  assert.equal(result.finalInventory.shards.universal, 1537);
});

test('Divine fragments craft one map and leave the correct remainder', () => {
  const inventory = engine.emptyInventory();
  inventory.fragments.divine = 19;

  const result = engine.runOwnMapsFromInventory(config, inventory, 'minimum');

  assert.equal(result.ownRuns.divine, 1);
  assert.equal(result.crafted.divine, 1);
  assert.equal(inventory.fragments.divine, 9);
  assert.equal(inventory.shards.universal, 40);
  assert.equal(inventory.shards.elemental, 30);
  assert.equal(config.fragmentRules.divine.ownRun, 0);
  assert.equal(config.fragmentRules.divine.memberRun, 0);
});

test('finish-fragment needs are calculated from Unused balances', () => {
  assert.deepEqual(engine.fragmentSetNeedsFromUnused(config, {
    common: 6,
    epic: 5,
    superior: 9,
    divine: 10,
    random: 17,
  }), {
    common: 4,
    epic: 0,
    superior: 1,
    divine: 0,
    random: 3,
  });
});

test('target fragment limits remove purchases that only remain Unused', () => {
  assert.deepEqual(engine.fragmentPurchaseLimitsFromUnused(
    { common: 0, epic: 0, superior: 15, divine: 0, random: 0 },
    { common: 1, epic: 1, superior: 7, divine: 0, random: 0 },
    { common: 0, epic: 0, superior: 1, divine: 0, random: 0 },
    config.fragmentRules,
  ), {
    common: 0,
    epic: 0,
    superior: 9,
    divine: 0,
    random: 0,
  });
});

test('configured fragment returns control repeated own runs and target purchase limits', () => {
  const customConfig = JSON.parse(JSON.stringify(config));
  customConfig.fragmentRules.superior.ownRun = 2;
  customConfig.fragmentRules.divine.ownRun = 2;
  const inventory = engine.emptyInventory();
  inventory.fragments.superior = 18;
  const divineInventory = engine.emptyInventory();
  divineInventory.fragments.divine = 10;

  const result = engine.runOwnMapsFromInventory(customConfig, inventory, 'minimum');
  engine.runOwnMapsFromInventory(customConfig, divineInventory, 'minimum');
  const purchaseLimits = engine.fragmentPurchaseLimitsFromUnused(
    { common: 0, epic: 0, superior: 15, divine: 0, random: 0 },
    { common: 0, epic: 0, superior: 7, divine: 0, random: 0 },
    { common: 0, epic: 0, superior: 1, divine: 0, random: 0 },
    customConfig.fragmentRules,
  );

  assert.equal(result.ownRuns.superior, 2);
  assert.equal(inventory.fragments.superior, 2);
  assert.equal(divineInventory.fragments.divine, 2);
  assert.equal(purchaseLimits.superior, 10);
});

test('weekly reset schedule creates five event buckets and four after day three', () => {
  const gameDayStart = '2026-07-07T19:00:00Z';
  assert.equal(engine.weekBuckets(gameDayStart, 1, 28), 5);
  assert.equal(engine.weekBuckets(gameDayStart, 4, 28), 4);
  assert.equal(engine.isWeeklyResetStart(gameDayStart, 4), false);
  assert.equal(engine.isWeeklyResetStart(gameDayStart, 5), true);
  assert.equal(engine.isWeekStartDay(gameDayStart, 5), true);
  assert.equal(engine.weeklyResetInstant(gameDayStart, 5, '19:00').toISOString(), '2026-07-11T19:00:00.000Z');
  assert.equal(engine.lastWeeklyResetDay(gameDayStart, 28), 26);
  assert.equal(engine.finalDaysAfterLastWeeklyReset(gameDayStart, 28), 2);

  const result = defaultProjection();
  assert.equal(result.totalDivineWeeklyFragments, 15);
  assert.equal(result.futureRuns.own.divine, 1);
  assert.equal(result.futureRuns.member.divine, 10);
  assert.equal(result.finalInventory.fragments.divine, 9);
});

test('Lucky Rewards cutoff removes elemental income from the final event days', () => {
  const withoutCutoff = defaultProjection({ luckyRewardCutoffDays: 0 });
  const withCutoff = defaultProjection({ luckyRewardCutoffDays: 2 });

  assert.equal(
    withoutCutoff.rawRewards.elemental - withCutoff.rawRewards.elemental,
    30,
  );
  assert.deepEqual(withCutoff.luckyRewards, {
    perDay: 15,
    cutoffDays: 2,
    lastRewardDay: 26,
    remainingDays: 23,
    remainingElemental: 345,
  });
});

test('configured weekly reset weekday and Divine cap control active buckets', () => {
  const customConfig = JSON.parse(JSON.stringify(config));
  customConfig.eventDates.weeklyReset.weekday = 'wednesday';
  customConfig.fragmentRules.divine.weeklyCap = 4;

  assert.equal(engine.isWeeklyResetStart('2026-07-07T19:00:00Z', 2, 'wednesday'), true);
  assert.equal(engine.isWeeklyResetStart('2026-07-07T19:00:00Z', 5, 'wednesday'), false);
  assert.equal(engine.weekBuckets('2026-07-07T19:00:00Z', 1, 8, 'wednesday'), 2);

  const result = defaultProjection({
    config: customConfig,
    eventDays: 8,
    currentDay: 1,
  });
  assert.equal(result.totalWeekBuckets, 2);
  assert.equal(result.totalDivineWeeklyFragments, 8);
});

test('configured weekly reset time moves the reset to its actual game day', () => {
  const customConfig = JSON.parse(JSON.stringify(config));
  customConfig.eventDates.weeklyReset.timeUtc = '04:00';
  customConfig.fragmentRules.divine.weeklyCap = 4;

  assert.equal(engine.isWeeklyResetStart(
    '2026-07-07T19:00:00Z',
    4,
    'saturday',
    '04:00',
  ), true);
  assert.equal(engine.isWeeklyResetStart(
    '2026-07-07T19:00:00Z',
    5,
    'saturday',
    '04:00',
  ), false);
  assert.equal(
    engine.weeklyResetInstant(
      '2026-07-07T19:00:00Z',
      4,
      '04:00',
      'saturday',
    ).toISOString(),
    '2026-07-11T04:00:00.000Z',
  );

  const result = defaultProjection({
    config: customConfig,
    eventDays: 6,
    currentDay: 1,
  });
  assert.equal(result.days[4].weeklyDivine.divineFragmentsGained, 4);
  assert.equal(result.days[5].weeklyDivine.divineFragmentsGained, 0);
});

test('event activation during an existing game day uses the previous 19:00 UTC boundary', () => {
  const start = engine.gameDayStartForActivation('2026-07-08T04:00:00Z', '19:00');

  assert.equal(start.toISOString(), '2026-07-07T19:00:00.000Z');
  assert.equal(engine.gameDayEndInstant(start, 1).toISOString(), '2026-07-08T19:00:00.000Z');
  assert.equal(engine.gameDayEndInstant(start, 4).toISOString(), '2026-07-11T19:00:00.000Z');
});

test('quest projection awards the configured fragment totals exactly once', () => {
  const result = defaultProjection();

  assert.deepEqual(result.questRewards.fragments, {
    common: 8,
    epic: 9,
    superior: 5,
    divine: 4,
    random: 20,
  });
  assert.equal(result.questRewards.completed.length, 20);
});

test('configured quest map rewards are run as maps rather than fragments', () => {
  const customConfig = JSON.parse(JSON.stringify(config));
  customConfig.joinLimits.daily = { common: 0, epic: 0, superior: 0 };
  customConfig.joinLimits.weekly.divine = 0;
  customConfig.fragmentRules.divine.weeklyCap = 0;
  customConfig.quests = [{
    name: 'First treasure hunt',
    counter: 'total',
    threshold: 0,
    reward: { count: 1, ticket: 'epic' },
  }];

  const result = defaultProjection({
    config: customConfig,
    eventDays: 1,
    currentDay: 1,
    luckyElementalPerDay: 0,
    randomFragmentsPerDay: 0,
    includeMythicalOwner: false,
    includeMythicalMember: false,
  });

  assert.equal(result.days[1].ownRuns.epic, 1);
  assert.equal(result.finalInventory.fragments.epic, 1);
  assert.equal(result.questRewards.tickets.epic, 1);
});

test('claiming all quests awards every remainder on that day and suppresses future awards', () => {
  const result = defaultProjection({
    manualEntries: { 2: { quests: { allClaimed: true } } },
  });

  assert.equal(result.allQuestsClaimedDay, 2);
  assert.equal(result.days[2].inventory.quests.allClaimed, true);
  assert.ok(result.days[2].questAwards.length > 0);
  for (let day = 3; day <= 28; day += 1) assert.deepEqual(result.days[day].questAwards, []);
  assert.deepEqual(result.questRewards.fragments, {
    common: 8,
    epic: 9,
    superior: 5,
    divine: 4,
    random: 20,
  });
});

test('first day totals expose the exact member and own map runs', () => {
  const result = defaultProjection();
  const day = result.days[1];

  assert.deepEqual(day.memberRuns, { common: 3, epic: 2, superior: 1, divine: 0, mythical: 0 });
  assert.deepEqual(day.ownRuns, { common: 1, epic: 0, superior: 0, divine: 0, mythical: 0 });
  assert.equal(day.inventory.shards.universal, 34);
  assert.equal(day.inventory.shards.elemental, 41);
  assert.equal(result.days[4].memberRuns.divine, 2);
});

test('configured member run limits drive the daily projection', () => {
  const customConfig = JSON.parse(JSON.stringify(config));
  customConfig.joinLimits.daily = { common: 1, epic: 4, superior: 2 };
  customConfig.joinLimits.weekly.divine = 0;
  customConfig.fragmentRules.divine.weeklyCap = 0;
  customConfig.quests = [];

  const result = defaultProjection({
    config: customConfig,
    eventDays: 1,
    currentDay: 1,
    luckyElementalPerDay: 0,
    randomFragmentsPerDay: 0,
    includeMythicalOwner: false,
    includeMythicalMember: false,
  });

  assert.deepEqual(result.days[1].memberRuns, {
    common: 1,
    epic: 4,
    superior: 2,
    divine: 0,
    mythical: 0,
  });
  assert.equal(result.finalInventory.shards.universal, 43);
  assert.equal(result.finalInventory.shards.elemental, 34);
  assert.deepEqual(result.finalInventory.fragments, {
    common: 1,
    epic: 4,
    superior: 2,
    divine: 0,
    random: 0,
  });
});

test('manual weekly Divine progress controls remaining fragments and member runs', () => {
  const result = defaultProjection({
    manualEntries: {
      3: {
        weekly: {
          divineFragmentsReceived: 1,
          divineMemberRunsFinished: 1,
        },
      },
    },
  });

  assert.equal(result.days[1].weeklyDivine.divineFragmentsGained, 0);
  assert.equal(result.days[3].weeklyDivine.divineFragmentsGained, 1);
  assert.equal(result.days[4].weeklyDivine.divineFragmentsGained, 2);
  assert.equal(result.days[3].memberRuns.divine, 1);
  assert.equal(result.days[4].memberRuns.divine, 1);
  assert.equal(result.days[3].inventory.weekly.divineFragmentsReceived, 1);
  assert.equal(result.days[4].inventory.weekly.divineFragmentsReceived, 3);
});

test('Mythical projection is optional and adds owner and member rewards once', () => {
  const withoutMythical = defaultProjection({
    includeMythicalOwner: false,
    includeMythicalMember: false,
  });
  const withMythical = defaultProjection();

  assert.equal(withoutMythical.rawRewards.universal, 1537);
  assert.equal(withMythical.rawRewards.universal - withoutMythical.rawRewards.universal, 225);
  assert.deepEqual(withMythical.projectedMythical, { owner: 1, member: 1 });
});

test('claimed Mythical reward is added naturally and is not projected twice', () => {
  const result = engine.projectEvent({
    config,
    eventDays: 1,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 1,
    luckyElementalPerDay: 15,
    randomFragmentsPerDay: 19,
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: true,
    includeMythicalMember: false,
    manualEntries: { 1: { mythical: { ownerDone: true } } },
  });

  assert.equal(result.finalInventory.shards.universal, 224);
  assert.equal(result.rawRewards.universal, 224);
  assert.equal(result.projectedMythical.owner, 0);
  assert.equal(result.days[1].ownRuns.mythical, 1);
});

test('manual universal entry suppresses automatic Mythical reward for that day', () => {
  const result = engine.projectEvent({
    config,
    eventDays: 1,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 1,
    luckyElementalPerDay: 15,
    randomFragmentsPerDay: 19,
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: false,
    includeMythicalMember: false,
    manualEntries: {
      1: { shards: { universal: 10 }, mythical: { ownerDone: true } },
    },
  });

  assert.equal(result.finalInventory.shards.universal, 10);
  assert.equal(result.rawRewards.universal, 10);
});

test('conversion never spends resources reserved for the other target', () => {
  const toUniversal = engine.convertToUniversal(
    { universal: 1000, elemental: 1604 },
    { universal: 3000, elemental: 1250 },
  );
  const toElemental = engine.convertToElemental(
    { universal: 3200, elemental: 1000 },
    { universal: 3000, elemental: 1250 },
  );

  assert.deepEqual(toUniversal.rewards, { universal: 1177, elemental: 1250 });
  assert.deepEqual(toElemental.rewards, { universal: 3000, elemental: 1200 });
});

test('aggregate elemental entry takes precedence over specific elements', () => {
  const result = engine.projectEvent({
    config,
    eventDays: 1,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 1,
    luckyElementalPerDay: 15,
    randomFragmentsPerDay: 19,
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: false,
    includeMythicalMember: false,
    manualEntries: {
      1: { shards: { elemental: 99, wind: 40, water: 30 } },
    },
  });

  assert.equal(result.finalInventory.shards.elemental, 99);
  assert.equal(result.finalInventory.shards.wind, 0);
  assert.equal(result.finalInventory.shards.water, 0);
  assert.equal(result.rawRewards.elemental, 99);
});
