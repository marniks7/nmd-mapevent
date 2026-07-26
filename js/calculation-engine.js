const ShopEngine = require('./shop-engine');

const MAP_LEVELS = ['common', 'epic', 'superior', 'divine', 'mythical'];
const STANDARD_LEVELS = ['common', 'epic', 'superior', 'divine'];
const RETURNING_FRAGMENT_LEVELS = ['common', 'epic', 'superior', 'divine'];
const FRAGMENT_LEVELS = ['common', 'epic', 'superior', 'divine', 'random'];
const SPECIFIC_ELEMENTS = ['wind', 'lightning', 'water', 'fire'];

function emptyInventory() {
  return {
    shards: { universal: 0, elemental: 0, fire: 0, wind: 0, water: 0, lightning: 0 },
    maps: { common: 0, epic: 0, superior: 0, divine: 0, mythical: 0 },
    fragments: { common: 0, epic: 0, superior: 0, divine: 0, random: 0 },
    mythical: { ownerDone: false, memberDone: false },
    quests: { allClaimed: false },
    weekly: { divineFragmentsReceived: 0, divineMemberRunsFinished: 0 },
  };
}

function cloneInventory(inventory) {
  return {
    shards: { ...inventory.shards },
    maps: { ...inventory.maps },
    fragments: { ...inventory.fragments },
    mythical: { ...inventory.mythical },
    quests: { ...inventory.quests },
    weekly: { ...inventory.weekly },
  };
}

function emptyRuns() {
  return { common: 0, epic: 0, superior: 0, divine: 0, mythical: 0 };
}

function emptyFragmentTotals() {
  return { common: 0, epic: 0, superior: 0, divine: 0, random: 0 };
}

function fragmentSetNeedsFromUnused(config, unusedFragments = {}) {
  return Object.fromEntries(FRAGMENT_LEVELS.map((level) => {
    const fragmentsPerMap = level === 'random'
      ? Number(config.crafting.randomFragmentsPerMap) || 10
      : Number(config.crafting.fragmentsPerMap) || 10;
    const unused = Math.floor(Math.max(0, Number(unusedFragments[level]) || 0));
    const remainder = unused % fragmentsPerMap;
    return [level, remainder > 5 ? fragmentsPerMap - remainder : 0];
  }));
}

function fragmentPurchaseLimitsFromUnused(
  purchasedFragments = {},
  unusedFragments = {},
  addedOwnRuns = {},
  fragmentRules = {},
) {
  return Object.fromEntries(FRAGMENT_LEVELS.map((level) => {
    const purchased = Math.floor(Math.max(0, Number(purchasedFragments[level]) || 0));
    const defaultReturned = level === 'divine' ? 0 : 1;
    const minimumUnused = RETURNING_FRAGMENT_LEVELS.includes(level)
      && (Number(addedOwnRuns[level]) || 0) > 0
      ? Math.floor(Math.max(0, Number(fragmentRules[level]?.ownRun ?? defaultReturned) || 0))
      : 0;
    const removable = Math.min(
      purchased,
      Math.max(0, Math.floor(Number(unusedFragments[level]) || 0) - minimumUnused),
    );
    return [level, purchased - removable];
  }));
}

function elementalTotal(shards) {
  return shards.elemental + shards.fire + shards.wind + shards.water + shards.lightning;
}

function getReward(config, runKind, level, kind) {
  return Number(config.rewards?.[runKind]?.[level]?.[kind]) || 0;
}

function shopRewardValues(config, randomStrategy) {
  const maps = {};
  const fragments = {};
  STANDARD_LEVELS.forEach((level) => {
    maps[level] = {
      universal: getReward(config, 'own', level, 'universal'),
      elemental: getReward(config, 'own', level, 'elemental'),
    };
    fragments[level] = {
      universal: maps[level].universal / config.crafting.fragmentsPerMap,
      elemental: maps[level].elemental / config.crafting.fragmentsPerMap,
      fragmentsPerMap: config.crafting.fragmentsPerMap,
      returnedPerRun: Number(config.fragmentRules?.[level]?.ownRun) || 0,
    };
  });
  const randomLevel = STANDARD_LEVELS.includes(randomStrategy) ? randomStrategy : 'common';
  fragments.random = {
    universal: maps[randomLevel].universal / config.crafting.randomFragmentsPerMap,
    elemental: maps[randomLevel].elemental / config.crafting.randomFragmentsPerMap,
    fragmentsPerMap: config.crafting.randomFragmentsPerMap,
    returnedPerRun: 0,
  };
  return { maps, fragments };
}

function shopQuantizationState() {
  return {
    fragments: Object.fromEntries(FRAGMENT_LEVELS.map((level) => [level, 0.5])),
    maps: Object.fromEntries(STANDARD_LEVELS.map((level) => [level, 0.5])),
    jadePurchases: 0.5,
    randomFragmentsSpent: 0.5,
    purchasedOffers: 0.5,
    coinNonEventOffers: 0.5,
  };
}

function shopOfferAvailabilityQuantizer() {
  const groups = {};
  return (candidates) => {
    const groupKey = candidates[0]?.currency || 'unknown';
    groups[groupKey] ||= { expected: {}, assigned: {}, totalCarry: 0.5 };
    const group = groups[groupKey];
    const keys = candidates.map((candidate) => [
      candidate.currency,
      candidate.kind,
      candidate.level,
      candidate.quantity,
      candidate.cost,
    ].join(':'));
    let dailyExpected = 0;
    candidates.forEach((candidate, index) => {
      const expected = Math.max(0, Number(candidate.availableOffers) || 0);
      dailyExpected += expected;
      group.expected[keys[index]] = (group.expected[keys[index]] || 0) + expected;
      group.assigned[keys[index]] ||= 0;
    });
    group.totalCarry += dailyExpected;
    const dailyWhole = Math.floor(group.totalCarry + 1e-9);
    group.totalCarry -= dailyWhole;
    const counts = candidates.map(() => 0);
    for (let offer = 0; offer < dailyWhole; offer += 1) {
      let bestIndex = 0;
      let bestDeficit = -Infinity;
      keys.forEach((key, index) => {
        const deficit = group.expected[key] - group.assigned[key];
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          bestIndex = index;
        }
      });
      counts[bestIndex] += 1;
      group.assigned[keys[bestIndex]] += 1;
    }
    return counts;
  };
}

function cumulativeWhole(value, state, key, maximum = Infinity) {
  const expected = Math.max(0, Number(value) || 0) + state[key];
  const available = Number.isFinite(maximum) ? Math.max(0, Math.floor(maximum)) : Infinity;
  const whole = Math.min(Math.floor(expected + 1e-9), available);
  state[key] = expected - whole;
  return whole;
}

function quantizeProjectedShop(shop, state, availableJades, availableRandomFragments) {
  if (!shop?.estimated) return shop;
  FRAGMENT_LEVELS.forEach((level) => {
    shop.coinFragments[level] = cumulativeWhole(
      shop.coinFragments[level],
      state.fragments,
      level,
    );
    shop.fragments[level] = shop.targetFragments[level] + shop.coinFragments[level];
  });
  STANDARD_LEVELS.forEach((level) => {
    shop.coinMaps[level] = cumulativeWhole(shop.coinMaps[level], state.maps, level);
    shop.maps[level] = shop.targetMaps[level] + shop.coinMaps[level];
  });
  const jadePurchaseLimit = Number.isFinite(availableJades)
    ? Math.max(0, availableJades - shop.jadeSpent.resets)
    : Infinity;
  shop.jadeSpent.purchases = cumulativeWhole(
    shop.jadeSpent.purchases,
    state,
    'jadePurchases',
    jadePurchaseLimit,
  );
  shop.jadeSpent.total = shop.jadeSpent.resets + shop.jadeSpent.purchases;
  shop.randomFragmentsSpent = cumulativeWhole(
    shop.randomFragmentsSpent,
    state,
    'randomFragmentsSpent',
    availableRandomFragments + shop.fragments.random,
  );
  shop.purchasedOffers = cumulativeWhole(
    shop.purchasedOffers,
    state,
    'purchasedOffers',
    shop.offers.total,
  );
  shop.coinNonEventOffers = cumulativeWhole(
    shop.coinNonEventOffers,
    state,
    'coinNonEventOffers',
    shop.offers.coins,
  );
  if (Number.isFinite(availableJades)) {
    shop.jadeBudgetRemaining = Math.max(0, availableJades - shop.jadeSpent.total);
  }
  return shop;
}

function distributeRandomMaps(count, strategy = 'minimum') {
  const distribution = { common: 0, epic: 0, superior: 0, divine: 0 };
  if (count <= 0) return distribution;
  if (strategy === 'minimum') {
    distribution.common = count;
    return distribution;
  }
  if (strategy !== 'balanced' && Object.hasOwn(distribution, strategy)) {
    distribution[strategy] = count;
    return distribution;
  }
  const levels = Object.keys(distribution);
  for (let index = 0; index < count; index += 1) {
    distribution[levels[index % levels.length]] += 1;
  }
  return distribution;
}

function rewardForRuns(config, ownRuns, memberRuns) {
  const rewards = { universal: 0, elemental: 0 };
  MAP_LEVELS.forEach((level) => {
    rewards.universal += (ownRuns[level] || 0) * getReward(config, 'own', level, 'universal');
    rewards.universal += (memberRuns[level] || 0) * getReward(config, 'member', level, 'universal');
    rewards.elemental += (ownRuns[level] || 0) * getReward(config, 'own', level, 'elemental');
    rewards.elemental += (memberRuns[level] || 0) * getReward(config, 'member', level, 'elemental');
  });
  return rewards;
}

function runOwnMapsFromInventory(config, inventory, randomStrategy = 'minimum') {
  const ownRuns = emptyRuns();
  const crafted = { common: 0, epic: 0, superior: 0, divine: 0, random: 0, total: 0 };
  const fragmentsPerMap = config.crafting.fragmentsPerMap;
  const randomFragmentsPerMap = config.crafting.randomFragmentsPerMap;

  for (let guard = 0; guard < 1000; guard += 1) {
    let changed = false;

    STANDARD_LEVELS.forEach((level) => {
      const count = Math.floor(inventory.fragments[level] / fragmentsPerMap);
      if (count === 0) return;
      inventory.maps[level] += count;
      inventory.fragments[level] %= fragmentsPerMap;
      crafted[level] += count;
      crafted.total += count;
      changed = true;
    });

    const randomCount = Math.floor(inventory.fragments.random / randomFragmentsPerMap);
    if (randomCount > 0) {
      const distribution = distributeRandomMaps(randomCount, randomStrategy);
      STANDARD_LEVELS.forEach((level) => {
        inventory.maps[level] += distribution[level];
      });
      inventory.fragments.random %= randomFragmentsPerMap;
      crafted.random += randomCount;
      crafted.total += randomCount;
      changed = true;
    }

    STANDARD_LEVELS.forEach((level) => {
      const runs = inventory.maps[level];
      if (runs <= 0) return;
      inventory.maps[level] = 0;
      ownRuns[level] += runs;
      inventory.shards.universal += runs * getReward(config, 'own', level, 'universal');
      inventory.shards.elemental += runs * getReward(config, 'own', level, 'elemental');
      if (RETURNING_FRAGMENT_LEVELS.includes(level)) {
        inventory.fragments[level] += runs * (Number(config.fragmentRules?.[level]?.ownRun) || 0);
      }
      changed = true;
    });

    if (!changed) break;
  }

  return { ownRuns, crafted };
}

function parseDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (String(value || '').includes('T')) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function dateForDay(startDate, day) {
  const date = parseDate(startDate);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + day - 1);
  return date;
}

function weeklyResetWeekday(value = 6) {
  if (Number.isInteger(Number(value))) return clamp(Number(value), 0, 6);
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const index = weekdays.indexOf(String(value).toLowerCase());
  return index >= 0 ? index : 6;
}

function weeklyResetInstant(startDate, day, timeUtc = '19:00', resetWeekday = 6) {
  const gameDayStart = dateForDay(startDate, day);
  const gameDayEnd = dateForDay(startDate, day + 1);
  if (!gameDayStart || !gameDayEnd) return null;
  const [hours, minutes] = String(timeUtc).split(':').map(Number);
  const reset = new Date(gameDayStart.getTime());
  reset.setUTCHours(hours || 0, minutes || 0, 0, 0);
  const daysUntilReset = (
    weeklyResetWeekday(resetWeekday) - reset.getUTCDay() + 7
  ) % 7;
  reset.setUTCDate(reset.getUTCDate() + daysUntilReset);
  if (reset < gameDayStart) reset.setUTCDate(reset.getUTCDate() + 7);
  return reset < gameDayEnd ? reset : null;
}

function isWeeklyResetStart(startDate, day, resetWeekday = 6, timeUtc = '19:00') {
  return Boolean(weeklyResetInstant(startDate, day, timeUtc, resetWeekday));
}

function isWeekStartDay(startDate, day, resetWeekday = 6, timeUtc = '19:00') {
  return day === 1 || isWeeklyResetStart(startDate, day, resetWeekday, timeUtc);
}

function gameDayStartForActivation(activationUtc, rolloverTimeUtc = '19:00') {
  const activation = parseDate(activationUtc);
  if (!activation) return null;
  const [hours, minutes] = String(rolloverTimeUtc).split(':').map(Number);
  const start = new Date(activation.getTime());
  start.setUTCHours(hours || 0, minutes || 0, 0, 0);
  if (activation < start) start.setUTCDate(start.getUTCDate() - 1);
  return start;
}

function currentGameDay(firstGameDayStartUtc, eventDays, now = new Date()) {
  const start = parseDate(firstGameDayStartUtc);
  const current = parseDate(now);
  if (!start || !current) return 1;
  const elapsedDays = Math.floor((current.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return clamp(elapsedDays + 1, 1, eventDays);
}

function gameDayEndInstant(firstGameDayStartUtc, day) {
  return dateForDay(firstGameDayStartUtc, day + 1);
}

function weekBuckets(startDate, startDay, eventDays, resetWeekday = 6, timeUtc = '19:00') {
  let count = 0;
  for (let day = startDay; day <= eventDays; day += 1) {
    if (isWeekStartDay(startDate, day, resetWeekday, timeUtc)) count += 1;
  }
  return count;
}

function lastWeeklyResetDay(startDate, eventDays, resetWeekday = 6, timeUtc = '19:00') {
  let lastResetDay = null;
  for (let day = 1; day <= eventDays; day += 1) {
    if (isWeeklyResetStart(startDate, day, resetWeekday, timeUtc)) lastResetDay = day;
  }
  return lastResetDay;
}

function finalDaysAfterLastWeeklyReset(
  startDate,
  eventDays,
  resetWeekday = 6,
  timeUtc = '19:00',
) {
  const lastResetDay = lastWeeklyResetDay(
    startDate,
    eventDays,
    resetWeekday,
    timeUtc,
  );
  return lastResetDay === null ? 0 : Math.max(0, eventDays - lastResetDay);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function weeklyBuckets(startDate, eventDays, resetWeekday = 6, timeUtc = '19:00') {
  const buckets = [];
  let startDay = 1;
  for (let day = 2; day <= eventDays; day += 1) {
    if (!isWeekStartDay(startDate, day, resetWeekday, timeUtc)) continue;
    buckets.push({ startDay, endDay: day - 1 });
    startDay = day;
  }
  buckets.push({ startDay, endDay: eventDays });
  return buckets;
}

function cumulativeWeeklySchedule({ startDay, endDay, cap, manualEntries, key, defaultCompletionDay }) {
  const schedule = {};
  const manualDays = [];
  for (let day = startDay; day <= endDay; day += 1) {
    if (Object.hasOwn(manualEntries[day]?.weekly || {}, key)) manualDays.push(day);
  }

  let cumulative = 0;
  for (let day = startDay; day <= endDay; day += 1) {
    const manualValue = manualEntries[day]?.weekly?.[key];
    if (manualValue !== undefined) {
      cumulative = clamp(Number(manualValue) || 0, cumulative, cap);
    } else if (manualDays.length === 0 && day === defaultCompletionDay) {
      cumulative = cap;
    } else if (manualDays.length > 0 && day === endDay) {
      cumulative = cap;
    }
    schedule[day] = cumulative;
  }
  return schedule;
}

function buildWeeklyDivineSchedule(config, startDate, eventDays, manualEntries) {
  const schedule = Array.from({ length: eventDays + 1 }, () => ({
    divineFragmentsReceived: 0,
    divineFragmentsGained: 0,
    divineMemberRunsFinished: 0,
    divineMemberRuns: 0,
  }));

  weeklyBuckets(
    startDate,
    eventDays,
    config.eventDates?.weeklyReset?.weekday,
    config.eventDates?.weeklyReset?.timeUtc,
  ).forEach((bucket, index) => {
    const fragmentCumulative = cumulativeWeeklySchedule({
      ...bucket,
      cap: config.fragmentRules.divine.weeklyCap,
      manualEntries,
      key: 'divineFragmentsReceived',
      defaultCompletionDay: bucket.startDay,
    });
    const memberCumulative = cumulativeWeeklySchedule({
      ...bucket,
      cap: config.joinLimits.weekly.divine,
      manualEntries,
      key: 'divineMemberRunsFinished',
      defaultCompletionDay: index === 0 ? bucket.endDay : bucket.startDay,
    });
    let previousFragments = 0;
    let previousMemberRuns = 0;
    for (let day = bucket.startDay; day <= bucket.endDay; day += 1) {
      schedule[day] = {
        divineFragmentsReceived: fragmentCumulative[day],
        divineFragmentsGained: fragmentCumulative[day] - previousFragments,
        divineMemberRunsFinished: memberCumulative[day],
        divineMemberRuns: memberCumulative[day] - previousMemberRuns,
      };
      previousFragments = fragmentCumulative[day];
      previousMemberRuns = memberCumulative[day];
    }
  });
  return schedule;
}

function questCounterValue(quest, runCounts) {
  if (quest.counter === 'total') return runCounts.total;
  if (quest.counter === 'member') return runCounts.member;
  if (quest.counter === 'level') return runCounts[quest.level] || 0;
  return 0;
}

function addRunCounts(total, runs, isMember = false) {
  MAP_LEVELS.forEach((level) => {
    const count = runs[level] || 0;
    total[level] += count;
    total.total += count;
    if (isMember) total.member += count;
  });
}

function applyQuestReward(inventory, reward, randomStrategy = 'minimum') {
  const count = Math.floor(Math.max(0, Number(reward.count) || 0));
  if (reward.fragment && Object.hasOwn(inventory.fragments, reward.fragment)) {
    inventory.fragments[reward.fragment] += count;
    return;
  }
  if (reward.ticket === 'random') {
    const distribution = distributeRandomMaps(count, randomStrategy);
    STANDARD_LEVELS.forEach((level) => {
      inventory.maps[level] += distribution[level];
    });
    return;
  }
  if (reward.ticket && Object.hasOwn(inventory.maps, reward.ticket)) {
    inventory.maps[reward.ticket] += count;
  }
}

function questAwardsForDays(config, eventDays, randomFragmentsPerDay, randomStrategy) {
  const awardsByDay = Array.from({ length: eventDays + 1 }, () => []);
  const inventory = emptyInventory();
  const completed = new Set();
  const cumulative = { ...emptyRuns(), member: 0, total: 0 };

  for (let day = 1; day <= eventDays; day += 1) {
    const memberRuns = {
      common: config.joinLimits.daily.common,
      epic: config.joinLimits.daily.epic,
      superior: config.joinLimits.daily.superior,
      divine: 0,
      mythical: 0,
    };
    addRunCounts(cumulative, memberRuns, true);
    inventory.fragments.random += randomFragmentsPerDay;
    RETURNING_FRAGMENT_LEVELS.forEach((level) => {
      inventory.fragments[level] += memberRuns[level]
        * (Number(config.fragmentRules?.[level]?.memberRun) || 0);
    });
    addRunCounts(cumulative, runOwnMapsFromInventory(config, inventory, randomStrategy).ownRuns);

    let changed = true;
    while (changed) {
      changed = false;
      (config.quests || []).forEach((quest, index) => {
        if (completed.has(index) || questCounterValue(quest, cumulative) < quest.threshold) return;
        completed.add(index);
        awardsByDay[day].push(quest.reward);
        applyQuestReward(inventory, quest.reward, randomStrategy);
        changed = true;
      });
      if (changed) addRunCounts(cumulative, runOwnMapsFromInventory(config, inventory, randomStrategy).ownRuns);
    }
  }
  return awardsByDay;
}

function applyAllQuestsClaimOverride(config, awardsByDay, manualEntries, eventDays) {
  let claimDay = 0;
  for (let day = 1; day <= eventDays; day += 1) {
    if (manualEntries[day]?.quests?.allClaimed) {
      claimDay = day;
      break;
    }
  }
  if (claimDay === 0) return 0;

  const previouslyAwarded = new Set();
  for (let day = 1; day < claimDay; day += 1) {
    awardsByDay[day].forEach((reward) => previouslyAwarded.add(reward));
  }
  for (let day = claimDay; day <= eventDays; day += 1) awardsByDay[day] = [];
  awardsByDay[claimDay] = (config.quests || [])
    .map((quest) => quest.reward)
    .filter((reward) => !previouslyAwarded.has(reward));
  return claimDay;
}

function dailyMemberRuns(config, divineMemberRuns) {
  return {
    common: config.joinLimits.daily.common,
    epic: config.joinLimits.daily.epic,
    superior: config.joinLimits.daily.superior,
    divine: divineMemberRuns,
    mythical: 0,
  };
}

function applyMemberRuns(config, inventory, memberRuns) {
  const rewards = rewardForRuns(config, emptyRuns(), memberRuns);
  inventory.shards.universal += rewards.universal;
  inventory.shards.elemental += rewards.elemental;
  RETURNING_FRAGMENT_LEVELS.forEach((level) => {
    inventory.fragments[level] += memberRuns[level]
      * (Number(config.fragmentRules?.[level]?.memberRun) || 0);
  });
}

function applyManualEntry(projected, entry, previous, config) {
  if (!entry) return { inventory: projected, isManual: false };
  const inventory = cloneInventory(projected);
  ['shards', 'maps', 'fragments'].forEach((bucket) => {
    Object.entries(entry[bucket] || {}).forEach(([key, value]) => {
      const entered = Math.max(0, Number(value) || 0);
      inventory[bucket][key] = bucket === 'shards' ? entered : Math.floor(entered);
    });
  });
  Object.entries(entry.mythical || {}).forEach(([key, value]) => {
    inventory.mythical[key] = Boolean(value);
  });
  Object.entries(entry.quests || {}).forEach(([key, value]) => {
    inventory.quests[key] = Boolean(value);
  });
  Object.entries(entry.weekly || {}).forEach(([key, value]) => {
    const cap = key === 'divineFragmentsReceived'
      ? config.fragmentRules.divine.weeklyCap
      : config.joinLimits.weekly.divine;
    inventory.weekly[key] = clamp(Number(value) || 0, 0, cap);
  });

  const aggregateEntered = Object.hasOwn(entry.shards || {}, 'elemental');
  const specificEntered = SPECIFIC_ELEMENTS.some((key) => Object.hasOwn(entry.shards || {}, key));
  if (aggregateEntered) SPECIFIC_ELEMENTS.forEach((key) => { inventory.shards[key] = 0; });
  else if (specificEntered) inventory.shards.elemental = 0;

  if (!Object.hasOwn(entry.shards || {}, 'universal')) {
    if (inventory.mythical.ownerDone && !previous.mythical.ownerDone) {
      inventory.shards.universal += getReward(config, 'own', 'mythical', 'universal');
    }
    if (inventory.mythical.memberDone && !previous.mythical.memberDone) {
      inventory.shards.universal += getReward(config, 'member', 'mythical', 'universal');
    }
  }
  return { inventory, isManual: true };
}

function sumRuns(days, startDay, eventDays, kind) {
  const totals = emptyRuns();
  for (let day = startDay; day <= eventDays; day += 1) {
    MAP_LEVELS.forEach((level) => {
      totals[level] += days[day]?.[kind]?.[level] || 0;
    });
  }
  return totals;
}

function aggregateQuestRewards(awardsByDay) {
  const fragments = emptyFragmentTotals();
  const tickets = emptyFragmentTotals();
  const completed = [];
  awardsByDay.forEach((awards) => {
    awards.forEach((reward) => {
      if (reward.fragment) fragments[reward.fragment] += reward.count;
      if (reward.ticket) tickets[reward.ticket] += reward.count;
      completed.push(reward);
    });
  });
  return { fragments, tickets, completed };
}

function convertToUniversal(rewards, targets) {
  const converted = { ...rewards };
  const shortfall = Math.max(0, targets.universal - converted.universal);
  const elementalExtra = Math.max(0, converted.elemental - targets.elemental);
  const universalGain = Math.min(shortfall, Math.floor(elementalExtra / 2));
  converted.universal += universalGain;
  converted.elemental -= universalGain * 2;
  return { rewards: converted, elementalSpent: universalGain * 2, universalGain };
}

function convertToElemental(rewards, targets) {
  const converted = { ...rewards };
  const shortfall = Math.max(0, targets.elemental - converted.elemental);
  const universalExtra = Math.max(0, converted.universal - targets.universal);
  const elementalGain = Math.min(shortfall, universalExtra);
  converted.universal -= elementalGain;
  converted.elemental += elementalGain;
  return { rewards: converted, universalSpent: elementalGain, elementalGain };
}

function applyConversion(rewards, targets) {
  const toUniversal = convertToUniversal(rewards, targets);
  const toElemental = convertToElemental(toUniversal.rewards, targets);
  return {
    rewards: toElemental.rewards,
    elementalSpent: toUniversal.elementalSpent,
    universalGain: toUniversal.universalGain,
    universalSpent: toElemental.universalSpent,
    elementalGain: toElemental.elementalGain,
    status: toElemental.rewards.universal >= targets.universal && toElemental.rewards.elemental >= targets.elemental ? 'covered' : 'missing',
  };
}

function projectEvent(options) {
  const {
    config,
    eventDays = config.seasons.summer.defaultDays,
    startDate,
    gameDayStartUtc,
    currentDay = 1,
    luckyElementalPerDay = config.luckyRewards.elementalPerDay,
    luckyRewardCutoffDays = 0,
    randomFragmentsPerDay = config.crafting.randomFragmentsPerDay,
    randomStrategy = 'minimum',
    targets = config.defaultTargets,
    includeMythicalOwner = true,
    includeMythicalMember = true,
    manualEntries = {},
    shopOptions = {},
    manualShopEntries = {},
  } = options;
  const firstGameDayStartUtc = gameDayStartUtc
    || startDate
    || gameDayStartForActivation(config.eventDates.activationUtc, config.eventDates.gameDayRolloverUtc);
  const safeCurrentDay = Math.min(eventDays, Math.max(1, currentDay));
  const safeLuckyRewardCutoffDays = Math.floor(clamp(
    Number(luckyRewardCutoffDays) || 0,
    0,
    eventDays,
  ));
  const lastLuckyRewardDay = eventDays - safeLuckyRewardCutoffDays;
  const remainingLuckyRewardDays = Math.max(0, lastLuckyRewardDay - safeCurrentDay);
  const configuredShopStartDay = Math.floor(Number(shopOptions.startDay) || 1);
  const shopPlanningStartDay = clamp(configuredShopStartDay, 1, eventDays + 1);
  const awardsByDay = questAwardsForDays(config, eventDays, randomFragmentsPerDay, randomStrategy);
  const allQuestsClaimedDay = applyAllQuestsClaimOverride(config, awardsByDay, manualEntries, eventDays);
  const weeklyDivineSchedule = buildWeeklyDivineSchedule(config, firstGameDayStartUtc, eventDays, manualEntries);
  const days = [];
  let previous = emptyInventory();
  const remainingShopJadeBudget = Math.floor(Math.max(0, Number(shopOptions.jadeBudget) || 0));
  const shopJadeBudgetAllocated = remainingShopJadeBudget > 0
    ? remainingShopJadeBudget
    : 0;
  let shopJadesRemaining = remainingShopJadeBudget > 0
    ? remainingShopJadeBudget
    : Infinity;
  let remainingRemainderNeeds = { ...shopOptions.remainderNeeds };
  let remainingTargetNeeds = { ...shopOptions.targetNeeds };
  let remainingTargetFragmentPurchaseLimits = shopOptions.targetFragmentPurchaseLimits
    ? { ...shopOptions.targetFragmentPurchaseLimits }
    : null;
  let remainingTargetMapPurchaseLimits = shopOptions.targetMapPurchaseLimits
    ? { ...shopOptions.targetMapPurchaseLimits }
    : null;
  let remainingTargetFragmentProgress = { ...shopOptions.targetFragmentProgress };
  const rewardValues = shopRewardValues(config, randomStrategy);
  const shopRounding = shopQuantizationState();
  const quantizeOfferAvailabilities = shopOfferAvailabilityQuantizer();

  for (let day = 1; day <= eventDays; day += 1) {
    const inventory = cloneInventory(previous);
    const weeklyDivine = weeklyDivineSchedule[day];
    inventory.weekly.divineFragmentsReceived = weeklyDivine.divineFragmentsReceived;
    inventory.weekly.divineMemberRunsFinished = weeklyDivine.divineMemberRunsFinished;
    const memberRuns = dailyMemberRuns(config, weeklyDivine.divineMemberRuns);
    applyMemberRuns(config, inventory, memberRuns);
    if (day <= lastLuckyRewardDay) inventory.shards.elemental += luckyElementalPerDay;
    inventory.fragments.random += randomFragmentsPerDay;
    inventory.fragments.divine += weeklyDivine.divineFragmentsGained;
    awardsByDay[day].forEach((reward) => applyQuestReward(inventory, reward, randomStrategy));
    const manualShopEntry = manualShopEntries[day] || null;
    const availableShopJades = day >= shopPlanningStartDay
      ? shopJadesRemaining
      : (Number.isFinite(shopJadesRemaining) ? 0 : Infinity);
    const shop = quantizeProjectedShop(ShopEngine.projectShopDay({
      config: config.shop,
      options: {
        ...shopOptions,
        enabled: Boolean(shopOptions.enabled) && day >= shopPlanningStartDay,
        remainderNeeds: remainingRemainderNeeds,
        targetNeeds: remainingTargetNeeds,
        targetFragmentPurchaseLimits: remainingTargetFragmentPurchaseLimits,
        targetMapPurchaseLimits: remainingTargetMapPurchaseLimits,
        targetFragmentProgress: remainingTargetFragmentProgress,
        rewardValues,
        quantizeOfferAvailabilities,
      },
      availableJades: availableShopJades,
      availableRandomFragments: inventory.fragments.random,
      manual: manualShopEntry,
    }), shopRounding, availableShopJades, inventory.fragments.random);
    ShopEngine.applyShopResult(inventory, shop);
    if (shop.remainderNeedsRemaining) remainingRemainderNeeds = shop.remainderNeedsRemaining;
    if (shop.targetNeedsRemaining) remainingTargetNeeds = shop.targetNeedsRemaining;
    if (shop.targetFragmentPurchaseLimitsRemaining) {
      remainingTargetFragmentPurchaseLimits = shop.targetFragmentPurchaseLimitsRemaining;
    }
    if (shop.targetMapPurchaseLimitsRemaining) {
      remainingTargetMapPurchaseLimits = shop.targetMapPurchaseLimitsRemaining;
    }
    if (shop.targetFragmentProgressRemaining) {
      remainingTargetFragmentProgress = shop.targetFragmentProgressRemaining;
    }
    if (Number.isFinite(shopJadesRemaining)) {
      shopJadesRemaining = Math.max(0, shopJadesRemaining - shop.jadeSpent.total);
      shop.jadeBudgetRemaining = shopJadesRemaining;
    }
    const runResult = runOwnMapsFromInventory(config, inventory, randomStrategy);
    const manual = applyManualEntry(inventory, manualEntries[day], previous, config);
    if (manual.inventory.mythical.ownerDone && !previous.mythical.ownerDone) {
      runResult.ownRuns.mythical = config.ownLimits.event.mythical;
    }
    if (manual.inventory.mythical.memberDone && !previous.mythical.memberDone) {
      memberRuns.mythical = config.joinLimits.event.mythical;
    }
    days[day] = {
      inventory: manual.inventory,
      isManual: manual.isManual,
      ownRuns: runResult.ownRuns,
      memberRuns,
      crafted: runResult.crafted,
      questAwards: awardsByDay[day],
      weeklyDivine,
      shop,
    };
    previous = cloneInventory(manual.inventory);
  }

  const finalInventory = cloneInventory(days[eventDays].inventory);
  const currentInventory = cloneInventory(days[safeCurrentDay].inventory);
  const futureStartDay = safeCurrentDay + 1;
  const futureOwnRuns = sumRuns(days, futureStartDay, eventDays, 'ownRuns');
  const futureMemberRuns = sumRuns(days, futureStartDay, eventDays, 'memberRuns');
  const projectedMythical = {
    owner: includeMythicalOwner && !finalInventory.mythical.ownerDone ? config.ownLimits.event.mythical : 0,
    member: includeMythicalMember && !finalInventory.mythical.memberDone ? config.joinLimits.event.mythical : 0,
  };
  futureOwnRuns.mythical = projectedMythical.owner;
  futureMemberRuns.mythical = projectedMythical.member;

  const mythicalUniversal = projectedMythical.owner * getReward(config, 'own', 'mythical', 'universal')
    + projectedMythical.member * getReward(config, 'member', 'mythical', 'universal');
  const rawRewards = {
    universal: finalInventory.shards.universal + mythicalUniversal,
    elemental: elementalTotal(finalInventory.shards),
  };
  const conversion = applyConversion(rawRewards, targets);
  const questRewards = aggregateQuestRewards(awardsByDay);
  const unusedFragments = {};
  FRAGMENT_LEVELS.forEach((level) => { unusedFragments[level] = finalInventory.fragments[level]; });

  let craftedTotal = 0;
  for (let day = futureStartDay; day <= eventDays; day += 1) craftedTotal += days[day]?.crafted.total || 0;
  const allOwnRuns = sumRuns(days, 1, eventDays, 'ownRuns');
  const allMemberRuns = sumRuns(days, 1, eventDays, 'memberRuns');
  const allShop = ShopEngine.aggregateShopDays(days, 1, eventDays);
  const futureShop = ShopEngine.aggregateShopDays(days, futureStartDay, eventDays);

  return {
    days,
    currentDay: safeCurrentDay,
    currentInventory,
    finalInventory,
    rawRewards,
    conversion,
    conversionScenarios: {
      withoutConversion: { ...rawRewards },
      toUniversal: convertToUniversal(rawRewards, targets),
      toElemental: convertToElemental(rawRewards, targets),
    },
    targets,
    projectedMythical,
    futureRuns: { own: futureOwnRuns, member: futureMemberRuns },
    allRuns: { own: allOwnRuns, member: allMemberRuns },
    questRewards,
    questAwardsByDay: awardsByDay,
    allQuestsClaimedDay,
    unusedFragments,
    craftedTotal,
    daysRemaining: eventDays - safeCurrentDay,
    firstGameDayStartUtc: parseDate(firstGameDayStartUtc),
    currentGameDayEndUtc: gameDayEndInstant(firstGameDayStartUtc, safeCurrentDay),
    remainingWeekBuckets: weekBuckets(
      firstGameDayStartUtc,
      futureStartDay,
      eventDays,
      config.eventDates?.weeklyReset?.weekday,
      config.eventDates?.weeklyReset?.timeUtc,
    ),
    totalWeekBuckets: weekBuckets(
      firstGameDayStartUtc,
      1,
      eventDays,
      config.eventDates?.weeklyReset?.weekday,
      config.eventDates?.weeklyReset?.timeUtc,
    ),
    totalDivineWeeklyFragments: weekBuckets(
      firstGameDayStartUtc,
      1,
      eventDays,
      config.eventDates?.weeklyReset?.weekday,
      config.eventDates?.weeklyReset?.timeUtc,
    ) * config.fragmentRules.divine.weeklyCap,
    luckyRewards: {
      perDay: luckyElementalPerDay,
      cutoffDays: safeLuckyRewardCutoffDays,
      lastRewardDay: lastLuckyRewardDay,
      remainingDays: remainingLuckyRewardDays,
      remainingElemental: remainingLuckyRewardDays * luckyElementalPerDay,
    },
    shop: {
      enabled: Boolean(shopOptions.enabled && config.shop),
      estimated: Boolean(shopOptions.enabled && config.shop),
      strategy: Number(shopOptions.strategy) || 0,
      planningStartDay: shopPlanningStartDay,
      jadeBudget: remainingShopJadeBudget > 0
        ? remainingShopJadeBudget
        : null,
      jadeBudgetAllocated: remainingShopJadeBudget > 0
        ? shopJadeBudgetAllocated
        : null,
      jadeBudgetRemaining: Number.isFinite(shopJadesRemaining) ? shopJadesRemaining : null,
      all: allShop,
      future: futureShop,
    },
    futureRewards: {
      universal: rawRewards.universal - currentInventory.shards.universal,
      elemental: rawRewards.elemental - elementalTotal(currentInventory.shards),
    },
  };
}

module.exports = {
  applyConversion,
  cloneInventory,
  convertToElemental,
  convertToUniversal,
  distributeRandomMaps,
  elementalTotal,
  emptyInventory,
  fragmentPurchaseLimitsFromUnused,
  fragmentSetNeedsFromUnused,
  currentGameDay,
  finalDaysAfterLastWeeklyReset,
  gameDayEndInstant,
  gameDayStartForActivation,
  isWeekStartDay,
  isWeeklyResetStart,
  lastWeeklyResetDay,
  weeklyResetInstant,
  projectEvent,
  questAwardsForDays,
  rewardForRuns,
  runOwnMapsFromInventory,
  buildWeeklyDivineSchedule,
  weekBuckets,
};
