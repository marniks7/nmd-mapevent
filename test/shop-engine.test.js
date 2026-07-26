const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../data/event-config.json');
const engine = require('../js/calculation-engine');
const shopEngine = require('../js/shop-engine');
const shopStrategy = require('../js/shop-strategy');

function shopOptions(overrides = {}) {
  return {
    enabled: true,
    strategy: 1,
    resetsPerDay: 0,
    jadeBudget: 0,
    buyCoinItems: true,
    buyRandomFragmentOffers: false,
    buyJadeFragments: false,
    buyJadeMaps: false,
    ...overrides,
  };
}

function quietConfig() {
  const copy = JSON.parse(JSON.stringify(config));
  copy.joinLimits.daily = { common: 0, epic: 0, superior: 0 };
  copy.joinLimits.weekly.divine = 0;
  copy.fragmentRules.divine.weeklyCap = 0;
  copy.luckyRewards.elementalPerDay = 0;
  copy.crafting.randomFragmentsPerDay = 0;
  copy.quests = [];
  return copy;
}

function superiorFragmentShopConfig(source = config.shop) {
  const shop = JSON.parse(JSON.stringify(source));
  shop.estimatedProbabilities.jadeItemKinds = { fragment: 100, map: 0 };
  shop.estimatedProbabilities.jadeFragmentLevels = {
    common: 0,
    epic: 0,
    superior: 100,
    divine: 0,
    random: 0,
  };
  shop.estimatedProbabilities.jadeFragmentQuantities = { 1: 100, 2: 0, 3: 0 };
  return shop;
}

function returningSuperiorRewards() {
  return {
    fragments: {
      superior: {
        universal: 2,
        elemental: 1.6,
        fragmentsPerMap: 10,
        returnedPerRun: 1,
      },
      random: { universal: 0, elemental: 0 },
    },
    maps: {},
  };
}

test('shop catalog contains every confirmed jade bundle price', () => {
  const fragments = config.shop.prices.jades.fragments;
  const prices = Object.fromEntries(Object.entries(fragments).map(([level, offers]) => [
    level,
    Object.fromEntries(offers.map((offer) => [offer.quantity, offer.cost])),
  ]));

  assert.deepEqual(prices.common, { 1: 25, 2: 48, 3: 70 });
  assert.deepEqual(prices.epic, { 1: 50, 2: 95, 3: 135 });
  assert.deepEqual(prices.superior, { 1: 80, 2: 150, 3: 215 });
  assert.deepEqual(prices.divine, { 1: 150, 2: 285, 3: 405 });
  assert.deepEqual(prices.random, { 1: 30, 2: 55, 3: 80 });
});

test('every estimated probability group is valid and coin offers exclude Divine', () => {
  const probabilities = config.shop.estimatedProbabilities;
  const simpleGroups = [
    probabilities.jadeItemKinds,
    probabilities.jadeFragmentLevels,
    probabilities.jadeMapLevels,
    probabilities.jadeFragmentQuantities,
    probabilities.randomCurrencyLevels,
    probabilities.coinItemKinds,
    probabilities.coinFragmentLevels,
    probabilities.coinMapLevels,
  ];
  simpleGroups.forEach((group) => {
    assert.equal(Object.values(group).reduce((sum, value) => sum + value, 0), 100);
  });
  Object.values(probabilities.randomCurrencyQuantities).forEach((group) => {
    assert.equal(Object.values(group).reduce((sum, value) => sum + value, 0), 100);
  });
  Object.values(probabilities.coinFragmentQuantities).forEach((group) => {
    assert.equal(Object.values(group).reduce((sum, value) => sum + value, 0), 100);
  });
  assert.equal(Object.hasOwn(probabilities.coinFragmentLevels, 'divine'), false);
  assert.deepEqual(probabilities.jadeMapLevels, {
    common: 25,
    epic: 25,
    superior: 25,
    divine: 25,
  });
  assert.deepEqual(probabilities.coinItemKinds, { nonEvent: 20, fragment: 72, map: 8 });
  assert.deepEqual(probabilities.coinMapLevels, { common: 100, epic: 0, superior: 0, divine: 0 });
  assert.deepEqual(probabilities.randomCurrencyQuantities.divine, { 1: 100, 2: 0, 3: 0 });
});

test('reset requests above ten are clamped to 10, generating 77 offers for 820 jades', () => {
  const result = shopEngine.projectShopDay({
    config: config.shop,
    options: shopOptions({
      resetsPerDay: 28,
      buyCoinItems: false,
      buyRandomFragmentOffers: false,
      buyJadeFragments: false,
      buyJadeMaps: false,
    }),
    availableJades: Infinity,
    availableRandomFragments: 0,
  });

  assert.equal(result.requestedResets, 10);
  assert.equal(result.resets, 10);
  assert.equal(result.shopCount, 11);
  assert.deepEqual(result.offers, { coins: 11, jades: 44, randomFragments: 22, total: 77 });
  assert.equal(result.jadeSpent.resets, 820);
  assert.equal(result.jadeSpent.purchases, 0);
});

test('budget target strategy selects the best-value candidate instead of scaling every offer', () => {
  const shopConfig = JSON.parse(JSON.stringify(config.shop));
  shopConfig.estimatedProbabilities.jadeItemKinds = { fragment: 100, map: 0 };
  shopConfig.estimatedProbabilities.jadeFragmentLevels = {
    common: 50,
    epic: 0,
    superior: 0,
    divine: 50,
    random: 0,
  };
  shopConfig.estimatedProbabilities.jadeFragmentQuantities = { 1: 100, 2: 0, 3: 0 };
  const result = shopEngine.projectShopDay({
    config: shopConfig,
    options: shopOptions({
      strategy: 3,
      targetNeeds: { universal: 100, elemental: 100 },
      targetTotals: { universal: 3000, elemental: 1250 },
      rewardValues: {
        fragments: {
          common: { universal: 0.5, elemental: 0.4 },
          divine: { universal: 4, elemental: 3 },
          random: { universal: 0.5, elemental: 0.4 },
        },
        maps: {},
      },
      buyCoinItems: false,
      buyRandomFragmentOffers: false,
      buyJadeFragments: true,
      buyJadeMaps: false,
    }),
    availableJades: 150,
    availableRandomFragments: 0,
  });

  assert.equal(result.fragments.common, 0);
  assert.equal(result.fragments.divine, 1);
  assert.equal(result.jadeFragments.divine, 1);
  assert.equal(result.randomCurrencyFragments.divine, 0);
  assert.equal(result.jadeSpent.purchases, 150);
});

test('target strategy counts fragments returned by repeated own runs', () => {
  const shopConfig = superiorFragmentShopConfig();
  const options = shopOptions({
    strategy: 3,
    targetNeeds: { universal: 280, elemental: 0 },
    targetTotals: { universal: 280, elemental: 0 },
    rewardValues: returningSuperiorRewards(),
    buyCoinItems: false,
    buyRandomFragmentOffers: false,
    buyJadeFragments: true,
    buyJadeMaps: false,
  });
  let targetNeeds = options.targetNeeds;
  let targetFragmentProgress = {};
  let purchasedFragments = 0;
  let jadesSpent = 0;

  for (let day = 0; day < 25; day += 1) {
    const result = shopEngine.projectShopDay({
      config: shopConfig,
      options: {
        ...options,
        targetNeeds,
        targetFragmentProgress,
      },
      availableJades: Infinity,
      availableRandomFragments: 0,
    });
    targetNeeds = result.targetNeedsRemaining;
    targetFragmentProgress = result.targetFragmentProgressRemaining;
    purchasedFragments += result.targetFragments.superior;
    jadesSpent += result.jadeSpent.purchases;
  }

  assert.equal(purchasedFragments, 91);
  assert.equal(jadesSpent, 7280);
  assert.equal(targetNeeds.universal, 0);
  assert.equal(targetFragmentProgress.superior, 91);
});

test('return-aware target plan finishes conversion without elemental overbuy', () => {
  const calculationConfig = quietConfig();
  calculationConfig.shop = superiorFragmentShopConfig(calculationConfig.shop);
  const result = engine.projectEvent({
    config: calculationConfig,
    eventDays: 4,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 1,
    luckyElementalPerDay: 0,
    randomFragmentsPerDay: 0,
    targets: { universal: 56, elemental: 0 },
    includeMythicalOwner: false,
    includeMythicalMember: false,
    manualEntries: { 1: { fragments: { superior: 7 } } },
    shopOptions: shopOptions({
      strategy: 3,
      startDay: 2,
      targetNeeds: { universal: 56, elemental: 0 },
      targetTotals: { universal: 56, elemental: 0 },
      targetFragmentBase: { superior: 7 },
      buyCoinItems: false,
      buyRandomFragmentOffers: false,
      buyJadeFragments: true,
      buyJadeMaps: false,
    }),
  });

  assert.equal(result.shop.all.targetFragments.superior, 12);
  assert.equal(result.shop.all.jadeSpent.purchases, 960);
  assert.deepEqual(result.rawRewards, { universal: 40, elemental: 32 });
  assert.deepEqual(result.conversion.rewards, { universal: 56, elemental: 0 });
  assert.equal(result.finalInventory.fragments.superior, 1);
});

test('best-target strategy trims paid items until converted leftovers are minimal', () => {
  const targets = { universal: 3000, elemental: 1250 };
  const calculationOptions = {
    config,
    eventDays: 28,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 18,
    luckyElementalPerDay: 15,
    randomFragmentsPerDay: 19,
    randomStrategy: 'minimum',
    targets,
    includeMythicalOwner: true,
    includeMythicalMember: true,
    manualEntries: {
      18: { shards: { universal: 1800, elemental: 1250 } },
    },
    manualShopEntries: {},
  };
  const projectEvent = engine.projectEvent;
  let projectionCalls = 0;
  engine.projectEvent = (options) => {
    projectionCalls += 1;
    return projectEvent(options);
  };
  let result;
  try {
    result = shopStrategy.projectShopStrategy(
      calculationOptions,
      shopOptions({
        strategy: 3,
        startDay: 19,
        buyCoinItems: true,
        buyRandomFragmentOffers: true,
        buyJadeFragments: true,
        buyJadeMaps: true,
      }),
      targets,
    ).result;
  } finally {
    engine.projectEvent = projectEvent;
  }

  assert.equal(result.shop.all.resets, 0);
  assert.equal(result.shop.all.jadeSpent.total, 1578);
  assert.deepEqual(result.conversion.rewards, { universal: 3000, elemental: 1252 });
  assert.equal(result.conversion.rewards.elemental - targets.elemental, 2);
  assert.ok(projectionCalls <= 60);

  const fittingBudgetResult = shopStrategy.projectShopStrategy(
    calculationOptions,
    shopOptions({
      strategy: 3,
      startDay: 19,
      jadeBudget: result.shop.all.jadeSpent.total,
      buyCoinItems: true,
      buyRandomFragmentOffers: true,
      buyJadeFragments: true,
      buyJadeMaps: true,
    }),
    targets,
  ).result;
  assert.equal(fittingBudgetResult.shop.all.jadeSpent.total, result.shop.all.jadeSpent.total);
  assert.deepEqual(fittingBudgetResult.shop.all.targetFragments, result.shop.all.targetFragments);
  assert.deepEqual(fittingBudgetResult.shop.all.targetMaps, result.shop.all.targetMaps);
  assert.deepEqual(fittingBudgetResult.conversion.rewards, result.conversion.rewards);
});

test('target fragment limit avoids paid leftovers without losing a map run', () => {
  const calculationConfig = quietConfig();
  calculationConfig.shop.estimatedProbabilities.jadeItemKinds = { fragment: 100, map: 0 };
  calculationConfig.shop.estimatedProbabilities.jadeFragmentLevels = {
    common: 0,
    epic: 0,
    superior: 100,
    divine: 0,
    random: 0,
  };
  calculationConfig.shop.estimatedProbabilities.jadeFragmentQuantities = { 1: 0, 2: 0, 3: 100 };
  const baseOptions = {
    config: calculationConfig,
    eventDays: 2,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 1,
    luckyElementalPerDay: 0,
    randomFragmentsPerDay: 0,
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: false,
    includeMythicalMember: false,
    manualEntries: { 1: { fragments: { superior: 1 } } },
  };
  const targetOptions = shopOptions({
    strategy: 3,
    startDay: 2,
    targetNeeds: { universal: 3000, elemental: 1250 },
    targetTotals: { universal: 3000, elemental: 1250 },
    buyCoinItems: false,
    buyRandomFragmentOffers: false,
    buyJadeFragments: true,
    buyJadeMaps: false,
  });
  const unlimited = engine.projectEvent({ ...baseOptions, shopOptions: targetOptions });
  const limited = engine.projectEvent({
    ...baseOptions,
    shopOptions: {
      ...targetOptions,
      targetFragmentPurchaseLimits: {
        common: 0,
        epic: 0,
        superior: 9,
        divine: 0,
        random: 0,
      },
    },
  });

  assert.equal(unlimited.shop.all.targetFragments.superior, 12);
  assert.equal(unlimited.finalInventory.fragments.superior, 4);
  assert.equal(limited.shop.all.targetFragments.superior, 9);
  assert.equal(limited.finalInventory.fragments.superior, 1);
  assert.equal(limited.allRuns.own.superior, unlimited.allRuns.own.superior);
  assert.equal(limited.shop.all.jadeSpent.purchases, 645);
  assert.equal(unlimited.shop.all.jadeSpent.purchases, 860);
});

test('finish fragment sets buys only the exact missing jade fragments', () => {
  const shopConfig = JSON.parse(JSON.stringify(config.shop));
  shopConfig.estimatedProbabilities.jadeItemKinds = { fragment: 100, map: 0 };
  shopConfig.estimatedProbabilities.jadeFragmentLevels = {
    common: 100,
    epic: 0,
    superior: 0,
    divine: 0,
    random: 0,
  };
  shopConfig.estimatedProbabilities.jadeFragmentQuantities = { 1: 100, 2: 0, 3: 0 };
  const result = shopEngine.projectShopDay({
    config: shopConfig,
    options: shopOptions({
      strategy: 2,
      remainderNeeds: { common: 3, epic: 0, superior: 0, divine: 0, random: 0 },
      buyCoinItems: false,
      buyJadeFragments: true,
    }),
    availableJades: 75,
    availableRandomFragments: 0,
  });

  assert.equal(result.fragments.common, 3);
  assert.equal(result.jadeSpent.purchases, 75);
  assert.equal(result.remainderNeedsRemaining.common, 0);
  assert.deepEqual(result.maps, { common: 0, epic: 0, superior: 0, divine: 0 });
});

test('coin slot applies non-event, Common map, fragment level, and quantity probabilities', () => {
  const result = shopEngine.projectShopDay({
    config: config.shop,
    options: shopOptions({
      strategy: 1,
      buyRandomFragmentOffers: false,
      buyJadeFragments: false,
      buyJadeMaps: false,
    }),
    availableJades: Infinity,
    availableRandomFragments: 0,
  });

  assert.equal(result.offers.coins, 1);
  assert.equal(result.coinNonEventOffers, 0.2);
  assert.ok(Math.abs(result.fragments.common - 1.1592) < 1e-9);
  assert.ok(Math.abs(result.fragments.random - 0.1656) < 1e-9);
  assert.ok(Math.abs(result.fragments.epic - 0.1656) < 1e-9);
  assert.ok(Math.abs(result.fragments.superior - 0.108) < 1e-9);
  assert.equal(result.fragments.divine, 0);
  assert.deepEqual(result.coinFragments, result.fragments);
  assert.deepEqual(result.targetFragments, {
    common: 0,
    epic: 0,
    superior: 0,
    divine: 0,
    random: 0,
  });
  assert.equal(result.maps.common, 0.08);
  assert.equal(result.maps.epic, 0);
  assert.equal(result.maps.superior, 0);
  assert.equal(result.maps.divine, 0);
  assert.deepEqual(result.coinMaps, result.maps);
  assert.deepEqual(result.targetMaps, {
    common: 0,
    epic: 0,
    superior: 0,
    divine: 0,
  });
});

test('remaining coin purchase estimates stay separate from targeted purchases', () => {
  const baseOptions = {
    config,
    eventDays: 28,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 19,
    shopOptions: shopOptions({
      strategy: 1,
      startDay: 20,
      buyCoinItems: true,
    }),
  };
  const withoutResets = engine.projectEvent(baseOptions);
  const withFiveDailyResets = engine.projectEvent({
    ...baseOptions,
    shopOptions: {
      ...baseOptions.shopOptions,
      resetsPerDay: 5,
    },
  });

  assert.deepEqual(withoutResets.shop.all.coinFragments, {
    common: 10,
    epic: 1,
    superior: 1,
    divine: 0,
    random: 1,
  });
  assert.deepEqual(withoutResets.shop.all.coinMaps, {
    common: 1,
    epic: 0,
    superior: 0,
    divine: 0,
  });
  assert.deepEqual(withFiveDailyResets.shop.all.coinFragments, {
    common: 63,
    epic: 9,
    superior: 6,
    divine: 0,
    random: 9,
  });
  assert.deepEqual(withFiveDailyResets.shop.all.coinMaps, {
    common: 4,
    epic: 0,
    superior: 0,
    divine: 0,
  });
  assert.deepEqual(withFiveDailyResets.shop.all.fragments, withFiveDailyResets.shop.all.coinFragments);
  assert.deepEqual(withFiveDailyResets.shop.all.maps, withFiveDailyResets.shop.all.coinMaps);
});

test('jade budget pays sequential reset costs before item purchases', () => {
  const result = shopEngine.projectShopDay({
    config: config.shop,
    options: shopOptions({
      resetsPerDay: 10,
      buyCoinItems: false,
      buyRandomFragmentOffers: false,
      buyJadeFragments: false,
      buyJadeMaps: false,
    }),
    availableJades: 60,
    availableRandomFragments: 0,
  });

  assert.equal(result.requestedResets, 10);
  assert.equal(result.resets, 2);
  assert.equal(result.shopCount, 3);
  assert.equal(result.jadeSpent.resets, 60);
  assert.equal(result.jadeBudgetRemaining, 0);
});

test('random-fragment purchases cannot spend more fragments than available', () => {
  const result = shopEngine.projectShopDay({
    config: config.shop,
    options: shopOptions({
      strategy: 3,
      resetsPerDay: 1,
      buyCoinItems: false,
      buyRandomFragmentOffers: true,
      targetNeeds: { universal: 100, elemental: 100 },
      targetTotals: { universal: 100, elemental: 100 },
      rewardValues: {
        fragments: {
          common: { universal: 1, elemental: 1 },
          epic: { universal: 0, elemental: 0 },
          superior: { universal: 0, elemental: 0 },
          divine: { universal: 0, elemental: 0 },
          random: { universal: 0, elemental: 0 },
        },
        maps: {},
      },
    }),
    availableJades: Infinity,
    availableRandomFragments: 2,
  });

  assert.ok(result.randomFragmentsSpent > 0);
  assert.ok(result.randomFragmentsSpent <= 2);
  assert.ok(result.fragments.common > 0);
  assert.equal(result.randomCurrencyFragments.common, result.fragments.common);
  assert.equal(result.jadeFragments.common, 0);
  assert.equal(result.fragments.random, 0);
});

test('manual shop fragments are applied before crafting and running maps', () => {
  const calculationConfig = quietConfig();
  const result = engine.projectEvent({
    config: calculationConfig,
    eventDays: 1,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 1,
    luckyElementalPerDay: 0,
    randomFragmentsPerDay: 0,
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: false,
    includeMythicalMember: false,
    shopOptions: shopOptions(),
    manualShopEntries: {
      1: {
        resets: 1,
        jadePurchaseCost: 25,
        fragments: { common: 10 },
      },
    },
  });

  assert.equal(result.days[1].shop.isManual, true);
  assert.equal(result.days[1].ownRuns.common, 1);
  assert.equal(result.finalInventory.shards.universal, 5);
  assert.equal(result.finalInventory.shards.elemental, 4);
  assert.equal(result.finalInventory.fragments.common, 1);
  assert.equal(result.shop.all.jadeSpent.resets, 30);
  assert.equal(result.shop.all.jadeSpent.purchases, 25);
  assert.equal(result.shop.all.jadeSpent.total, 55);
  assert.equal(
    result.shop.all.jadeSpent.total,
    result.shop.all.jadeSpent.resets + result.shop.all.jadeSpent.purchases,
  );
});

test('remaining shop plan starts after entered End of Day inventory', () => {
  const calculationConfig = quietConfig();
  calculationConfig.shop.estimatedProbabilities.jadeItemKinds = { fragment: 100, map: 0 };
  calculationConfig.shop.estimatedProbabilities.jadeFragmentLevels = {
    common: 100,
    epic: 0,
    superior: 0,
    divine: 0,
    random: 0,
  };
  calculationConfig.shop.estimatedProbabilities.jadeFragmentQuantities = { 1: 100, 2: 0, 3: 0 };
  const result = engine.projectEvent({
    config: calculationConfig,
    eventDays: 2,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 1,
    luckyElementalPerDay: 0,
    randomFragmentsPerDay: 0,
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: false,
    includeMythicalMember: false,
    manualEntries: { 1: { fragments: { common: 6 } } },
    shopOptions: shopOptions({
      strategy: 2,
      startDay: 2,
      jadeBudget: 200,
      remainderNeeds: { common: 4, epic: 0, superior: 0, divine: 0, random: 0 },
      buyCoinItems: false,
      buyJadeFragments: true,
    }),
  });

  assert.equal(result.days[1].shop.enabled, false);
  assert.equal(result.days[2].shop.enabled, true);
  assert.equal(result.days[2].shop.fragments.common, 4);
  assert.equal(result.shop.all.jadeSpent.total, 100);
  assert.deepEqual(result.shop.future.jadeSpent, { resets: 0, purchases: 100, total: 100 });
  assert.equal(result.shop.jadeBudgetAllocated, 200);
  assert.equal(result.shop.jadeBudgetRemaining, 100);
  assert.equal(result.finalInventory.fragments.common, 1);
});

test('manual shop maps run immediately and shop-disabled projections stay empty', () => {
  const calculationConfig = quietConfig();
  const baseOptions = {
    config: calculationConfig,
    eventDays: 1,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 1,
    luckyElementalPerDay: 0,
    randomFragmentsPerDay: 0,
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: false,
    includeMythicalMember: false,
    manualShopEntries: { 1: { maps: { epic: 1 } } },
  };
  const enabled = engine.projectEvent({ ...baseOptions, shopOptions: shopOptions() });
  const disabled = engine.projectEvent({ ...baseOptions, shopOptions: shopOptions({ enabled: false }) });

  assert.equal(enabled.days[1].ownRuns.epic, 1);
  assert.equal(enabled.rawRewards.universal, 10);
  assert.equal(disabled.days[1].ownRuns.epic, 0);
  assert.equal(disabled.rawRewards.universal, 0);
  assert.equal(disabled.shop.all.shopCount, 0);
});

test('shop projection covers every event day', () => {
  const calculationConfig = quietConfig();
  const result = engine.projectEvent({
    config: calculationConfig,
    eventDays: 3,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 2,
    luckyElementalPerDay: 0,
    randomFragmentsPerDay: 0,
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: false,
    includeMythicalMember: false,
    shopOptions: shopOptions({
      buyRandomFragmentOffers: false,
      buyJadeFragments: false,
      buyJadeMaps: false,
    }),
  });

  assert.equal(result.days[1].shop.enabled, true);
  assert.equal(result.days[2].shop.enabled, true);
  assert.equal(result.days[3].shop.enabled, true);
  assert.equal(result.shop.all.shopCount, 3);
});

test('remaining budget is one shared pool across remaining shop days', () => {
  const calculationConfig = quietConfig();
  const result = engine.projectEvent({
    config: calculationConfig,
    eventDays: 3,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 1,
    luckyElementalPerDay: 0,
    randomFragmentsPerDay: 0,
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: false,
    includeMythicalMember: false,
    shopOptions: shopOptions({
      strategy: 3,
      startDay: 2,
      resetsPerDay: 2,
      jadeBudget: 90,
      targetNeeds: { universal: 3000, elemental: 1250 },
      targetTotals: { universal: 3000, elemental: 1250 },
      buyCoinItems: false,
      buyRandomFragmentOffers: false,
      buyJadeFragments: false,
      buyJadeMaps: false,
    }),
  });

  assert.equal(result.days[1].shop.enabled, false);
  assert.equal(result.shop.all.resets, 3);
  assert.equal(result.shop.all.jadeSpent.resets, 90);
  assert.equal(result.shop.all.jadeSpent.purchases, 0);
  assert.deepEqual(result.days.slice(1).map((day) => day.shop.jadeBudgetAllocated), [0, 90, 30]);
  assert.deepEqual(result.days.slice(1).map((day) => day.shop.jadeSpent.total), [0, 60, 30]);
  assert.equal(result.shop.jadeBudgetRemaining, 0);
});

test('projected shop inventory, maps, costs, and runs are always whole numbers', () => {
  const calculationConfig = quietConfig();
  const baseOptions = {
    config: calculationConfig,
    eventDays: 18,
    gameDayStartUtc: '2026-07-07T19:00:00Z',
    currentDay: 18,
    luckyElementalPerDay: 0,
    randomFragmentsPerDay: 0,
    targets: { universal: 3000, elemental: 1250 },
    includeMythicalOwner: false,
    includeMythicalMember: false,
  };
  const projections = [
    engine.projectEvent({ ...baseOptions, shopOptions: shopOptions() }),
    engine.projectEvent({
      ...baseOptions,
      shopOptions: shopOptions({
        strategy: 3,
        resetsPerDay: 1,
        jadeBudget: 9000,
        buyRandomFragmentOffers: true,
        buyJadeFragments: true,
        buyJadeMaps: true,
        targetNeeds: { universal: 3000, elemental: 1250 },
        targetTotals: { universal: 3000, elemental: 1250 },
      }),
    }),
  ];

  projections.forEach((result) => {
    result.days.slice(1).forEach((day) => {
      Object.values(day.shop.fragments).forEach((value) => assert.equal(Number.isInteger(value), true));
      Object.values(day.shop.jadeFragments).forEach((value) => assert.equal(Number.isInteger(value), true));
      Object.values(day.shop.randomCurrencyFragments).forEach((value) => assert.equal(Number.isInteger(value), true));
      Object.values(day.shop.coinFragments).forEach((value) => assert.equal(Number.isInteger(value), true));
      Object.values(day.shop.maps).forEach((value) => assert.equal(Number.isInteger(value), true));
      Object.values(day.shop.jadeMaps).forEach((value) => assert.equal(Number.isInteger(value), true));
      Object.values(day.shop.coinMaps).forEach((value) => assert.equal(Number.isInteger(value), true));
      Object.keys(day.shop.fragments).forEach((level) => {
        assert.equal(
          day.shop.fragments[level],
          day.shop.targetFragments[level] + day.shop.coinFragments[level],
        );
        assert.equal(
          day.shop.targetFragments[level],
          day.shop.jadeFragments[level] + day.shop.randomCurrencyFragments[level],
        );
      });
      Object.keys(day.shop.maps).forEach((level) => {
        assert.equal(
          day.shop.maps[level],
          day.shop.targetMaps[level] + day.shop.coinMaps[level],
        );
        assert.equal(day.shop.targetMaps[level], day.shop.jadeMaps[level]);
      });
      Object.values(day.ownRuns).forEach((value) => assert.equal(Number.isInteger(value), true));
      assert.equal(Number.isInteger(day.shop.jadeSpent.purchases), true);
      assert.ok(day.shop.jadeSpent.total <= day.shop.jadeBudgetAllocated);
    });
    Object.values(result.shop.all.fragments).forEach((value) => assert.equal(Number.isInteger(value), true));
    Object.values(result.shop.all.jadeFragments).forEach((value) => assert.equal(Number.isInteger(value), true));
    Object.values(result.shop.all.randomCurrencyFragments).forEach((value) => assert.equal(Number.isInteger(value), true));
    Object.values(result.shop.all.coinFragments).forEach((value) => assert.equal(Number.isInteger(value), true));
    Object.values(result.shop.all.maps).forEach((value) => assert.equal(Number.isInteger(value), true));
    Object.values(result.shop.all.jadeMaps).forEach((value) => assert.equal(Number.isInteger(value), true));
    Object.values(result.shop.all.coinMaps).forEach((value) => assert.equal(Number.isInteger(value), true));
    Object.values(result.finalInventory.fragments).forEach((value) => assert.equal(Number.isInteger(value), true));
    Object.values(result.finalInventory.maps).forEach((value) => assert.equal(Number.isInteger(value), true));
  });
});
