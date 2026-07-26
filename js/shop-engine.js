const FRAGMENT_LEVELS = ['common', 'epic', 'superior', 'divine', 'random'];
const MAP_LEVELS = ['common', 'epic', 'superior', 'divine'];
const QUANTITIES = ['1', '2', '3'];

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function emptyLevelTotals(levels) {
  return Object.fromEntries(levels.map((level) => [level, 0]));
}

function normalizedEntries(weights = {}) {
  const entries = Object.entries(weights).map(([key, value]) => [key, numeric(value)]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return [];
  return entries.map(([key, value]) => [key, value / total]);
}

function quantityEntries(probabilities = {}) {
  return normalizedEntries(probabilities)
    .filter(([quantity]) => QUANTITIES.includes(String(quantity)))
    .map(([quantity, probability]) => [Number(quantity), probability]);
}

function selected(options, key, level, defaults) {
  const configured = options[key];
  return !Array.isArray(configured) || configured.length === 0
    ? defaults.includes(level)
    : configured.includes(level);
}

function jadeFragmentPrice(config, level, quantity) {
  const offer = (config.prices?.jades?.fragments?.[level] || [])
    .find((candidate) => Number(candidate.quantity) === quantity);
  return numeric(offer?.cost);
}

function emptyPurchasePlan() {
  return {
    fragments: emptyLevelTotals(FRAGMENT_LEVELS),
    maps: emptyLevelTotals(MAP_LEVELS),
    cost: 0,
    purchasedOffers: 0,
  };
}

function apportionedOfferCounts(candidates) {
  const counts = candidates.map(() => 0);
  const total = Math.round(candidates.reduce((sum, candidate) => sum + numeric(candidate.availableOffers), 0));
  for (let offer = 0; offer < total; offer += 1) {
    let bestIndex = 0;
    let bestDeficit = -Infinity;
    candidates.forEach((candidate, index) => {
      const deficit = numeric(candidate.availableOffers) - counts[index];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestIndex = index;
      }
    });
    counts[bestIndex] += 1;
  }
  return counts;
}

function wholeCandidates(candidates, options) {
  const supplied = typeof options.quantizeOfferAvailabilities === 'function'
    ? options.quantizeOfferAvailabilities(candidates)
    : apportionedOfferCounts(candidates);
  return candidates.map((candidate, index) => ({
    ...candidate,
    availableOffers: Math.floor(numeric(supplied?.[index])),
  }));
}

function jadeCandidates(config, options, offerCount) {
  const probabilities = config.estimatedProbabilities || {};
  const candidates = [];
  normalizedEntries(probabilities.jadeItemKinds).forEach(([kind, kindChance]) => {
    if (kind === 'fragment' && options.buyJadeFragments !== false) {
      normalizedEntries(probabilities.jadeFragmentLevels).forEach(([level, levelChance]) => {
        if (!selected(options, 'jadeFragmentLevels', level, FRAGMENT_LEVELS)) return;
        quantityEntries(probabilities.jadeFragmentQuantities).forEach(([quantity, quantityChance]) => {
          const cost = jadeFragmentPrice(config, level, quantity);
          if (cost <= 0) return;
          candidates.push({
            currency: 'jades',
            kind,
            level,
            quantity,
            cost,
            availableOffers: offerCount * kindChance * levelChance * quantityChance,
          });
        });
      });
    }
    if (kind === 'map' && options.buyJadeMaps !== false) {
      normalizedEntries(probabilities.jadeMapLevels).forEach(([level, levelChance]) => {
        if (!selected(options, 'jadeMapLevels', level, MAP_LEVELS)) return;
        const cost = numeric(config.prices?.jades?.maps?.[level]);
        if (cost <= 0) return;
        candidates.push({
          currency: 'jades',
          kind,
          level,
          quantity: 1,
          cost,
          availableOffers: offerCount * kindChance * levelChance,
        });
      });
    }
  });
  return wholeCandidates(candidates, options);
}

function randomCurrencyCandidates(config, options, offerCount) {
  if (options.buyRandomFragmentOffers === false) return [];
  const probabilities = config.estimatedProbabilities || {};
  const candidates = [];
  normalizedEntries(probabilities.randomCurrencyLevels).forEach(([level, levelChance]) => {
    if (!selected(options, 'randomCurrencyLevels', level, MAP_LEVELS)) return;
    const pricePerFragment = numeric(config.prices?.randomFragments?.[level]);
    if (pricePerFragment <= 0) return;
    quantityEntries(probabilities.randomCurrencyQuantities?.[level]).forEach(([quantity, quantityChance]) => {
      candidates.push({
        currency: 'randomFragments',
        kind: 'fragment',
        level,
        quantity,
        cost: quantity * pricePerFragment,
        availableOffers: offerCount * levelChance * quantityChance,
      });
    });
  });
  return wholeCandidates(candidates, options);
}

function addCandidatePurchase(plan, candidate, offers) {
  if (offers <= 0) return;
  plan[candidate.kind === 'map' ? 'maps' : 'fragments'][candidate.level] += offers * candidate.quantity;
  plan.cost += offers * candidate.cost;
  plan.purchasedOffers += offers;
}

function remainderPurchasePlan(candidates, availableJades, needsInput) {
  const plan = emptyPurchasePlan();
  const remaining = Object.fromEntries(FRAGMENT_LEVELS.map((level) => [
    level,
    Math.floor(numeric(needsInput?.[level])),
  ]));
  let budget = availableJades;
  candidates
    .filter((candidate) => candidate.kind === 'fragment' && remaining[candidate.level] > 0)
    .sort((left, right) => {
      const completionOrder = remaining[left.level] - remaining[right.level];
      if (completionOrder !== 0) return completionOrder;
      const valueOrder = (left.cost / left.quantity) - (right.cost / right.quantity);
      if (valueOrder !== 0) return valueOrder;
      return right.quantity - left.quantity;
    })
    .forEach((candidate) => {
      const usefulOffers = Math.floor(remaining[candidate.level] / candidate.quantity);
      const affordable = Number.isFinite(budget) ? Math.floor(budget / candidate.cost) : Infinity;
      const offers = Math.min(candidate.availableOffers, usefulOffers, affordable);
      addCandidatePurchase(plan, candidate, offers);
      remaining[candidate.level] -= offers * candidate.quantity;
      if (Number.isFinite(budget)) budget = Math.max(0, budget - candidate.cost * offers);
    });
  return { plan, remaining };
}

function productiveFragmentUnits(purchased, startingFragments, fragmentsPerMap, returnedPerRun) {
  const targetFragments = Math.floor(numeric(purchased));
  const existingFragments = Math.floor(numeric(startingFragments));
  const required = Math.floor(numeric(fragmentsPerMap));
  const returned = Math.min(Math.max(0, required - 1), Math.floor(numeric(returnedPerRun)));
  if (required <= 0) return targetFragments;
  const fragments = existingFragments + targetFragments;
  if (fragments < required) return targetFragments;
  const repeatCost = required - returned;
  const repeatedRuns = Math.floor((fragments - required) / repeatCost);
  return targetFragments + existingFragments + repeatedRuns * returned;
}

function candidateReward(candidate, options, needs = options.targetNeeds || {}, fragmentProgress = {}) {
  const source = candidate.kind === 'map'
    ? options.rewardValues?.maps?.[candidate.level]
    : options.rewardValues?.fragments?.[candidate.level];
  let rewardedQuantity = candidate.quantity;
  if (candidate.kind === 'fragment') {
    const purchased = Math.floor(numeric(fragmentProgress[candidate.level]));
    const startingFragments = options.targetFragmentBase?.[candidate.level];
    rewardedQuantity = productiveFragmentUnits(
      purchased + candidate.quantity,
      startingFragments,
      source?.fragmentsPerMap,
      source?.returnedPerRun,
    ) - productiveFragmentUnits(
      purchased,
      startingFragments,
      source?.fragmentsPerMap,
      source?.returnedPerRun,
    );
  }
  const reward = {
    universal: numeric(source?.universal) * rewardedQuantity,
    elemental: numeric(source?.elemental) * rewardedQuantity,
  };
  if (candidate.currency === 'randomFragments') {
    const randomValue = options.rewardValues?.fragments?.random || {};
    reward.universal = Math.max(0, reward.universal - numeric(randomValue.universal) * candidate.cost);
    reward.elemental = Math.max(0, reward.elemental - numeric(randomValue.elemental) * candidate.cost);
  }
  if (numeric(needs.universal) > 0 && numeric(needs.elemental) <= 0) {
    reward.universal += reward.elemental / 2;
    reward.elemental = 0;
  } else if (numeric(needs.elemental) > 0 && numeric(needs.universal) <= 0) {
    reward.elemental += reward.universal;
    reward.universal = 0;
  }
  return reward;
}

function targetCandidateScore(candidate, needs, options, fragmentProgress) {
  const reward = candidateReward(candidate, options, needs, fragmentProgress);
  const targets = options.targetTotals || {};
  const coverage = (needs.universal > 0 ? Math.min(needs.universal, reward.universal) / Math.max(1, numeric(targets.universal, 1)) : 0)
    + (needs.elemental > 0 ? Math.min(needs.elemental, reward.elemental) / Math.max(1, numeric(targets.elemental, 1)) : 0);
  return coverage / Math.max(1, candidate.cost);
}

function remainingTargetNeed(need, reward) {
  const remaining = numeric(need) - numeric(reward);
  return remaining > 1e-9 ? remaining : 0;
}

function targetPurchasePlan(candidates, options, availableCurrency, needsInput) {
  const plan = emptyPurchasePlan();
  const needs = {
    universal: numeric(needsInput?.universal),
    elemental: numeric(needsInput?.elemental),
  };
  const fragmentPurchaseLimits = options.targetFragmentPurchaseLimits
    ? Object.fromEntries(FRAGMENT_LEVELS.map((level) => [
      level,
      Math.floor(numeric(options.targetFragmentPurchaseLimits[level])),
    ]))
    : null;
  const mapPurchaseLimits = options.targetMapPurchaseLimits
    ? Object.fromEntries(MAP_LEVELS.map((level) => [
      level,
      Math.floor(numeric(options.targetMapPurchaseLimits[level])),
    ]))
    : null;
  const fragmentProgress = Object.fromEntries(FRAGMENT_LEVELS.map((level) => [
    level,
    Math.floor(numeric(options.targetFragmentProgress?.[level])),
  ]));
  let budget = availableCurrency;
  const available = candidates.map((candidate, index) => ({
    candidate,
    index,
    offers: Math.floor(numeric(candidate.availableOffers)),
  }));

  while (needs.universal > 0 || needs.elemental > 0) {
    const next = available
      .filter(({ candidate, offers }) => {
        if (offers <= 0 || candidate.cost > budget) return false;
        if (candidate.kind === 'fragment') {
          return !fragmentPurchaseLimits
            || fragmentPurchaseLimits[candidate.level] >= candidate.quantity;
        }
        return !mapPurchaseLimits || mapPurchaseLimits[candidate.level] >= 1;
      })
      .map((entry) => ({
        ...entry,
        score: targetCandidateScore(entry.candidate, needs, options, fragmentProgress),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => (
        right.score - left.score
        || left.candidate.cost - right.candidate.cost
        || left.index - right.index
      ))[0];
    if (!next) break;

    const { candidate } = next;
    const reward = candidateReward(candidate, options, needs, fragmentProgress);
    addCandidatePurchase(plan, candidate, 1);
    needs.universal = remainingTargetNeed(needs.universal, reward.universal);
    needs.elemental = remainingTargetNeed(needs.elemental, reward.elemental);
    available[next.index].offers -= 1;
    if (candidate.kind === 'fragment') {
      fragmentProgress[candidate.level] += candidate.quantity;
      if (fragmentPurchaseLimits) {
        fragmentPurchaseLimits[candidate.level] -= candidate.quantity;
      }
    } else if (mapPurchaseLimits) {
      mapPurchaseLimits[candidate.level] -= 1;
    }
    if (Number.isFinite(budget)) budget = Math.max(0, budget - candidate.cost);
  }
  return {
    plan,
    remaining: needs,
    fragmentPurchaseLimitsRemaining: fragmentPurchaseLimits,
    mapPurchaseLimitsRemaining: mapPurchaseLimits,
    fragmentProgressRemaining: fragmentProgress,
  };
}

function expectedCoinPlan(config, options, offerCount) {
  const probabilities = config.estimatedProbabilities || {};
  const itemKinds = Object.fromEntries(normalizedEntries(probabilities.coinItemKinds));
  const plan = {
    fragments: emptyLevelTotals(FRAGMENT_LEVELS),
    maps: emptyLevelTotals(MAP_LEVELS),
    nonEventOffers: offerCount * (itemKinds.nonEvent || 0),
    purchasedOffers: 0,
  };
  if (options.buyCoinItems === false) return plan;
  plan.purchasedOffers += plan.nonEventOffers;

  const fragmentChance = itemKinds.fragment || 0;
  normalizedEntries(probabilities.coinFragmentLevels).forEach(([level, levelChance]) => {
    quantityEntries(probabilities.coinFragmentQuantities?.[level]).forEach(([quantity, quantityChance]) => {
      const expectedOffers = offerCount * fragmentChance * levelChance * quantityChance;
      plan.fragments[level] += expectedOffers * quantity;
      plan.purchasedOffers += expectedOffers;
    });
  });
  const mapChance = itemKinds.map || 0;
  normalizedEntries(probabilities.coinMapLevels).forEach(([level, levelChance]) => {
    const expectedOffers = offerCount * mapChance * levelChance;
    plan.maps[level] += expectedOffers;
    plan.purchasedOffers += expectedOffers;
  });
  return plan;
}

function resetCost(config, resets) {
  return (config.resetCosts || [])
    .slice(0, resets)
    .reduce((sum, cost) => sum + numeric(cost), 0);
}

function affordableResets(config, requested, availableJades) {
  if (!Number.isFinite(availableJades)) return requested;
  let spent = 0;
  let resets = 0;
  for (let index = 0; index < requested; index += 1) {
    const cost = numeric(config.resetCosts?.[index]);
    if (spent + cost > availableJades) break;
    spent += cost;
    resets += 1;
  }
  return resets;
}

function emptyShopDay(availableJades = Infinity) {
  return {
    enabled: false,
    estimated: false,
    isManual: false,
    requestedResets: 0,
    resets: 0,
    shopCount: 0,
    offers: { total: 0, coins: 0, jades: 0, randomFragments: 0 },
    purchasedOffers: 0,
    coinNonEventOffers: 0,
    jadeSpent: { resets: 0, purchases: 0, total: 0 },
    randomFragmentsSpent: 0,
    fragments: emptyLevelTotals(FRAGMENT_LEVELS),
    targetFragments: emptyLevelTotals(FRAGMENT_LEVELS),
    jadeFragments: emptyLevelTotals(FRAGMENT_LEVELS),
    randomCurrencyFragments: emptyLevelTotals(FRAGMENT_LEVELS),
    coinFragments: emptyLevelTotals(FRAGMENT_LEVELS),
    maps: emptyLevelTotals(MAP_LEVELS),
    targetMaps: emptyLevelTotals(MAP_LEVELS),
    jadeMaps: emptyLevelTotals(MAP_LEVELS),
    coinMaps: emptyLevelTotals(MAP_LEVELS),
    jadeBudgetAllocated: availableJades,
    jadeBudgetRemaining: availableJades,
    jadeBudgetExceeded: 0,
    remainderNeedsRemaining: null,
    targetNeedsRemaining: null,
    targetFragmentPurchaseLimitsRemaining: null,
    targetMapPurchaseLimitsRemaining: null,
    targetFragmentProgressRemaining: null,
  };
}

function offerCounts(config, shopCount) {
  const slots = config.slotsPerShop || {};
  const offers = {
    coins: shopCount * numeric(slots.coins),
    jades: shopCount * numeric(slots.jades),
    randomFragments: shopCount * numeric(slots.randomFragments),
  };
  offers.total = offers.coins + offers.jades + offers.randomFragments;
  return offers;
}

function manualShopDay(config, manual, availableJades, availableRandomFragments) {
  const result = emptyShopDay(availableJades);
  const maxResets = Math.min(10, numeric(config.maxDailyResets, 10));
  const resets = Math.min(maxResets, Math.floor(numeric(manual.resets)));
  const shopCount = 1 + resets;
  result.enabled = true;
  result.isManual = true;
  result.requestedResets = resets;
  result.resets = resets;
  result.shopCount = shopCount;
  result.offers = offerCounts(config, shopCount);
  result.jadeSpent.resets = resetCost(config, resets);
  result.jadeSpent.purchases = Math.floor(numeric(manual.jadePurchaseCost));
  result.jadeSpent.total = result.jadeSpent.resets + result.jadeSpent.purchases;
  FRAGMENT_LEVELS.forEach((level) => {
    result.fragments[level] = Math.floor(numeric(manual.fragments?.[level]));
  });
  result.randomFragmentsSpent = Math.min(
    Math.floor(numeric(manual.randomFragmentsSpent)),
    numeric(availableRandomFragments) + result.fragments.random,
  );
  MAP_LEVELS.forEach((level) => {
    result.maps[level] = Math.floor(numeric(manual.maps?.[level]));
  });
  result.purchasedOffers = Object.values(result.fragments).reduce((sum, value) => sum + value, 0)
    + Object.values(result.maps).reduce((sum, value) => sum + value, 0);
  if (Number.isFinite(availableJades)) {
    result.jadeBudgetExceeded = Math.max(0, result.jadeSpent.total - availableJades);
    result.jadeBudgetRemaining = Math.max(0, availableJades - result.jadeSpent.total);
  }
  return result;
}

function projectShopDay({ config, options = {}, availableJades = Infinity, availableRandomFragments = 0, manual = null }) {
  if (!options.enabled || !config) return emptyShopDay(availableJades);
  if (manual) return manualShopDay(config, manual, availableJades, availableRandomFragments);

  const result = emptyShopDay(availableJades);
  const maxResets = Math.min(10, Math.floor(numeric(config.maxDailyResets, 10)));
  const requestedStrategy = Number(options.strategy);
  const strategy = requestedStrategy === 2 || requestedStrategy === 3 ? requestedStrategy : 1;
  const requestedResets = Math.min(maxResets, Math.floor(numeric(options.resetsPerDay)));
  const resets = affordableResets(config, requestedResets, availableJades);
  const shopCount = 1 + resets;
  result.enabled = true;
  result.estimated = true;
  result.requestedResets = requestedResets;
  result.resets = resets;
  result.shopCount = shopCount;
  result.offers = offerCounts(config, shopCount);
  result.jadeSpent.resets = resetCost(config, resets);

  const jadeAvailableForPurchases = Number.isFinite(availableJades)
    ? Math.max(0, availableJades - result.jadeSpent.resets)
    : Infinity;
  const coinPlan = expectedCoinPlan(config, options, result.offers.coins);
  const randomAvailable = numeric(availableRandomFragments)
    + coinPlan.fragments.random;
  let jadePlan;
  let randomPlan;

  if (strategy === 2) {
    const remainder = remainderPurchasePlan(
      jadeCandidates(config, options, result.offers.jades),
      jadeAvailableForPurchases,
      options.remainderNeeds,
    );
    jadePlan = remainder.plan;
    randomPlan = emptyPurchasePlan();
    result.remainderNeedsRemaining = remainder.remaining;
  } else if (strategy === 3) {
    const randomTarget = targetPurchasePlan(
      randomCurrencyCandidates(config, options, result.offers.randomFragments),
      options,
      randomAvailable,
      options.targetNeeds,
    );
    randomPlan = randomTarget.plan;
    const jadeTarget = targetPurchasePlan(
      jadeCandidates(config, options, result.offers.jades),
      {
        ...options,
        targetFragmentPurchaseLimits: randomTarget.fragmentPurchaseLimitsRemaining,
        targetMapPurchaseLimits: randomTarget.mapPurchaseLimitsRemaining,
        targetFragmentProgress: randomTarget.fragmentProgressRemaining,
      },
      jadeAvailableForPurchases,
      randomTarget.remaining,
    );
    jadePlan = jadeTarget.plan;
    result.targetNeedsRemaining = jadeTarget.remaining;
    result.targetFragmentPurchaseLimitsRemaining = jadeTarget.fragmentPurchaseLimitsRemaining;
    result.targetMapPurchaseLimitsRemaining = jadeTarget.mapPurchaseLimitsRemaining;
    result.targetFragmentProgressRemaining = jadeTarget.fragmentProgressRemaining;
  } else {
    jadePlan = emptyPurchasePlan();
    randomPlan = emptyPurchasePlan();
  }

  FRAGMENT_LEVELS.forEach((level) => {
    result.jadeFragments[level] = jadePlan.fragments[level];
    result.randomCurrencyFragments[level] = randomPlan.fragments[level];
    result.targetFragments[level] = result.jadeFragments[level]
      + result.randomCurrencyFragments[level];
    result.coinFragments[level] = coinPlan.fragments[level];
    result.fragments[level] = result.targetFragments[level] + result.coinFragments[level];
  });
  MAP_LEVELS.forEach((level) => {
    result.jadeMaps[level] = jadePlan.maps[level];
    result.targetMaps[level] = result.jadeMaps[level];
    result.coinMaps[level] = coinPlan.maps[level];
    result.maps[level] = result.targetMaps[level] + result.coinMaps[level];
  });
  result.coinNonEventOffers = coinPlan.nonEventOffers;
  result.purchasedOffers = jadePlan.purchasedOffers + randomPlan.purchasedOffers + coinPlan.purchasedOffers;
  result.jadeSpent.purchases = jadePlan.cost;
  result.jadeSpent.total = result.jadeSpent.resets + result.jadeSpent.purchases;
  result.randomFragmentsSpent = randomPlan.cost;
  if (Number.isFinite(availableJades)) {
    result.jadeBudgetRemaining = Math.max(0, availableJades - result.jadeSpent.total);
  }
  return result;
}

function applyShopResult(inventory, result) {
  if (!result?.enabled) return inventory;
  inventory.fragments.random = Math.max(0, inventory.fragments.random - result.randomFragmentsSpent);
  FRAGMENT_LEVELS.forEach((level) => { inventory.fragments[level] += result.fragments[level] || 0; });
  MAP_LEVELS.forEach((level) => { inventory.maps[level] += result.maps[level] || 0; });
  return inventory;
}

function emptyShopTotals() {
  return {
    days: 0,
    shopCount: 0,
    resets: 0,
    offers: { total: 0, coins: 0, jades: 0, randomFragments: 0 },
    purchasedOffers: 0,
    coinNonEventOffers: 0,
    jadeSpent: { resets: 0, purchases: 0, total: 0 },
    randomFragmentsSpent: 0,
    fragments: emptyLevelTotals(FRAGMENT_LEVELS),
    targetFragments: emptyLevelTotals(FRAGMENT_LEVELS),
    jadeFragments: emptyLevelTotals(FRAGMENT_LEVELS),
    randomCurrencyFragments: emptyLevelTotals(FRAGMENT_LEVELS),
    coinFragments: emptyLevelTotals(FRAGMENT_LEVELS),
    maps: emptyLevelTotals(MAP_LEVELS),
    targetMaps: emptyLevelTotals(MAP_LEVELS),
    jadeMaps: emptyLevelTotals(MAP_LEVELS),
    coinMaps: emptyLevelTotals(MAP_LEVELS),
    jadeBudgetExceeded: 0,
  };
}

function aggregateShopDays(days, startDay, endDay) {
  const totals = emptyShopTotals();
  for (let day = startDay; day <= endDay; day += 1) {
    const result = days[day]?.shop;
    if (!result?.enabled) continue;
    totals.days += 1;
    totals.shopCount += result.shopCount;
    totals.resets += result.resets;
    totals.purchasedOffers += result.purchasedOffers;
    totals.coinNonEventOffers += result.coinNonEventOffers;
    totals.jadeBudgetExceeded += result.jadeBudgetExceeded;
    Object.keys(totals.offers).forEach((key) => { totals.offers[key] += result.offers[key]; });
    Object.keys(totals.jadeSpent).forEach((key) => { totals.jadeSpent[key] += result.jadeSpent[key]; });
    totals.randomFragmentsSpent += result.randomFragmentsSpent;
    FRAGMENT_LEVELS.forEach((level) => { totals.fragments[level] += result.fragments[level]; });
    FRAGMENT_LEVELS.forEach((level) => { totals.targetFragments[level] += result.targetFragments[level]; });
    FRAGMENT_LEVELS.forEach((level) => { totals.jadeFragments[level] += result.jadeFragments[level]; });
    FRAGMENT_LEVELS.forEach((level) => {
      totals.randomCurrencyFragments[level] += result.randomCurrencyFragments[level];
    });
    FRAGMENT_LEVELS.forEach((level) => { totals.coinFragments[level] += result.coinFragments[level]; });
    MAP_LEVELS.forEach((level) => { totals.maps[level] += result.maps[level]; });
    MAP_LEVELS.forEach((level) => { totals.targetMaps[level] += result.targetMaps[level]; });
    MAP_LEVELS.forEach((level) => { totals.jadeMaps[level] += result.jadeMaps[level]; });
    MAP_LEVELS.forEach((level) => { totals.coinMaps[level] += result.coinMaps[level]; });
  }
  return totals;
}

module.exports = {
  FRAGMENT_LEVELS,
  MAP_LEVELS,
  aggregateShopDays,
  applyShopResult,
  emptyShopDay,
  emptyShopTotals,
  normalizedEntries,
  projectShopDay,
  resetCost,
};
