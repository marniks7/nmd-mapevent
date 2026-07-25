const CalculationEngine = require('./calculation-engine');

const RUN_LEVELS = ['common', 'epic', 'superior', 'divine', 'mythical'];
const FRAGMENT_LEVELS = ['common', 'epic', 'superior', 'divine', 'random'];
const MAP_LEVELS = ['common', 'epic', 'superior', 'divine'];

function targetsCovered(result, targets) {
  return ['universal', 'elemental'].every(
    (kind) => result.conversion.rewards[kind] >= targets[kind],
  );
}

function targetExcess(result, targets) {
  const universal = Math.max(0, result.conversion.rewards.universal - targets.universal);
  const elemental = Math.max(0, result.conversion.rewards.elemental - targets.elemental);
  return universal * 2 + elemental;
}

function targetPlanObjective(result, targets) {
  return {
    jades: result.shop.all.jadeSpent.total,
    excess: targetExcess(result, targets),
    randomFragments: result.shop.all.randomFragmentsSpent,
  };
}

function objectiveIsBetter(left, right) {
  return left.jades < right.jades
    || (left.jades === right.jades && left.excess < right.excess)
    || (
      left.jades === right.jades
      && left.excess === right.excess
      && left.randomFragments < right.randomFragments
    );
}

function targetEstimateStillMissing(result, eventDays) {
  const remaining = result.days[eventDays]?.shop?.targetNeedsRemaining;
  return remaining
    && (remaining.universal > 0.01 || remaining.elemental > 0.01);
}

function purchaseLimitsExhausted(result, purchaseLimits) {
  if (!purchaseLimits.fragments || !purchaseLimits.maps) return false;
  const fragmentsExhausted = FRAGMENT_LEVELS.every(
    (level) => result.shop.all.targetFragments[level] >= purchaseLimits.fragments[level],
  );
  const mapsExhausted = MAP_LEVELS.every(
    (level) => result.shop.all.targetMaps[level] >= purchaseLimits.maps[level],
  );
  return fragmentsExhausted && mapsExhausted;
}

function projectShopStrategyOnce(calculationOptions, shopOptions, targets) {
  const withoutShop = CalculationEngine.projectEvent({
    ...calculationOptions,
    shopOptions: { ...shopOptions, enabled: false, strategy: 0 },
  });
  if (!shopOptions.enabled) return { result: withoutShop, withoutShop };

  const coinOnlyOptions = {
    ...shopOptions,
    strategy: 1,
    buyCoinItems: true,
    buyRandomFragmentOffers: false,
    buyJadeFragments: false,
    buyJadeMaps: false,
  };
  const coinProjection = CalculationEngine.projectEvent({
    ...calculationOptions,
    shopOptions: coinOnlyOptions,
  });
  if (shopOptions.strategy === 1) return { result: coinProjection, withoutShop };

  if (shopOptions.strategy === 2) {
    const result = CalculationEngine.projectEvent({
      ...calculationOptions,
      shopOptions: {
        ...shopOptions,
        remainderNeeds: CalculationEngine.fragmentSetNeedsFromUnused(
          calculationOptions.config,
          coinProjection.unusedFragments,
        ),
      },
    });
    return { result, withoutShop };
  }

  const initialTargetNeeds = {
    universal: Math.max(0, targets.universal - coinProjection.conversion.rewards.universal),
    elemental: Math.max(0, targets.elemental - coinProjection.conversion.rewards.elemental),
  };
  const runTargetProjection = (purchaseLimits = {}) => {
    const optimizedOptions = {
      ...shopOptions,
      targetTotals: targets,
      targetNeeds: { ...initialTargetNeeds },
      targetFragmentBase: { ...coinProjection.unusedFragments },
      ...(purchaseLimits.fragments
        ? { targetFragmentPurchaseLimits: { ...purchaseLimits.fragments } }
        : {}),
      ...(purchaseLimits.maps
        ? { targetMapPurchaseLimits: { ...purchaseLimits.maps } }
        : {}),
    };
    let projected = withoutShop;
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      projected = CalculationEngine.projectEvent({
        ...calculationOptions,
        shopOptions: optimizedOptions,
      });
      const remaining = {
        universal: Math.max(0, targets.universal - projected.conversion.rewards.universal),
        elemental: Math.max(0, targets.elemental - projected.conversion.rewards.elemental),
      };
      if (remaining.universal < 0.01 && remaining.elemental < 0.01) break;
      if (
        targetEstimateStillMissing(projected, calculationOptions.eventDays)
        || purchaseLimitsExhausted(projected, purchaseLimits)
      ) break;
      optimizedOptions.targetNeeds = {
        universal: optimizedOptions.targetNeeds.universal + remaining.universal,
        elemental: optimizedOptions.targetNeeds.elemental + remaining.elemental,
      };
    }
    return projected;
  };

  let result = runTargetProjection();
  let fragmentPurchaseLimits = null;
  let mapPurchaseLimits = null;
  const cleanupPasses = 3;
  for (let pass = 0; pass < cleanupPasses; pass += 1) {
    const addedOwnRuns = Object.fromEntries(RUN_LEVELS.map((level) => [
      level,
      Math.max(0, result.allRuns.own[level] - coinProjection.allRuns.own[level]),
    ]));
    const proposedLimits = CalculationEngine.fragmentPurchaseLimitsFromUnused(
      result.shop.all.targetFragments,
      result.unusedFragments,
      addedOwnRuns,
      calculationOptions.config.fragmentRules,
    );
    const removesUnusedPurchase = FRAGMENT_LEVELS.some(
      (level) => proposedLimits[level] < result.shop.all.targetFragments[level],
    );
    if (!removesUnusedPurchase) break;
    fragmentPurchaseLimits = Object.fromEntries(FRAGMENT_LEVELS.map((level) => [
      level,
      Math.min(fragmentPurchaseLimits?.[level] ?? Infinity, proposedLimits[level]),
    ]));
    const cleaned = runTargetProjection({
      fragments: fragmentPurchaseLimits,
      maps: mapPurchaseLimits,
    });
    const preservesCoveredTargets = ['universal', 'elemental'].every((kind) => (
      result.conversion.rewards[kind] < targets[kind]
      || cleaned.conversion.rewards[kind] >= targets[kind]
    ));
    if (!preservesCoveredTargets) break;
    result = cleaned;
  }

  const trimPasses = [
    ...Object.values(result.shop.all.targetFragments),
    ...Object.values(result.shop.all.targetMaps),
  ].reduce((sum, value) => sum + value, 0);
  for (let pass = 0; pass < trimPasses && targetsCovered(result, targets); pass += 1) {
    const currentFragmentLimits = Object.fromEntries(FRAGMENT_LEVELS.map((level) => [
      level,
      Math.min(
        fragmentPurchaseLimits?.[level] ?? Infinity,
        result.shop.all.targetFragments[level],
      ),
    ]));
    const currentMapLimits = Object.fromEntries(MAP_LEVELS.map((level) => [
      level,
      Math.min(
        mapPurchaseLimits?.[level] ?? Infinity,
        result.shop.all.targetMaps[level],
      ),
    ]));
    const currentObjective = targetPlanObjective(result, targets);
    let best = null;
    const evaluateCandidate = (fragmentLimits, mapLimits) => {
      const candidate = runTargetProjection({
        fragments: fragmentLimits,
        maps: mapLimits,
      });
      if (!targetsCovered(candidate, targets)) return null;
      const objective = targetPlanObjective(candidate, targets);
      if (objective.excess > currentObjective.excess) return null;
      if (!objectiveIsBetter(objective, currentObjective)) return null;
      return {
        result: candidate,
        fragmentLimits,
        mapLimits,
        objective,
      };
    };

    FRAGMENT_LEVELS.forEach((level) => {
      if (result.shop.all.targetFragments[level] <= 0) return;
      const limits = {
        ...currentFragmentLimits,
        [level]: result.shop.all.targetFragments[level] - 1,
      };
      const candidate = evaluateCandidate(limits, currentMapLimits);
      if (candidate && (!best || objectiveIsBetter(candidate.objective, best.objective))) {
        best = candidate;
      }
    });

    MAP_LEVELS.forEach((level) => {
      if (result.shop.all.targetMaps[level] <= 0) return;
      const limits = {
        ...currentMapLimits,
        [level]: result.shop.all.targetMaps[level] - 1,
      };
      const candidate = evaluateCandidate(currentFragmentLimits, limits);
      if (candidate && (!best || objectiveIsBetter(candidate.objective, best.objective))) {
        best = candidate;
      }
    });

    if (!best) break;
    result = best.result;
    fragmentPurchaseLimits = best.fragmentLimits;
    mapPurchaseLimits = best.mapLimits;
  }

  return { result, withoutShop };
}

function applySharedJadeBudget(result, jadeBudget) {
  let remaining = jadeBudget;
  const planningStartDay = result.shop.planningStartDay;
  for (let day = 1; day < result.days.length; day += 1) {
    const shop = result.days[day]?.shop;
    if (!shop) continue;
    shop.jadeBudgetAllocated = day >= planningStartDay ? remaining : 0;
    remaining = Math.max(0, remaining - shop.jadeSpent.total);
    shop.jadeBudgetRemaining = remaining;
    shop.jadeBudgetExceeded = 0;
  }
  result.shop.jadeBudget = jadeBudget;
  result.shop.jadeBudgetAllocated = jadeBudget;
  result.shop.jadeBudgetRemaining = remaining;
  return result;
}

function projectShopStrategy(calculationOptions, shopOptions, targets) {
  const jadeBudget = Math.floor(Math.max(0, Number(shopOptions.jadeBudget) || 0));
  if (shopOptions.enabled && jadeBudget > 0) {
    const unlimited = projectShopStrategyOnce(
      calculationOptions,
      { ...shopOptions, jadeBudget: 0 },
      targets,
    );
    if (unlimited.result.shop.all.jadeSpent.total <= jadeBudget) {
      applySharedJadeBudget(unlimited.result, jadeBudget);
      applySharedJadeBudget(unlimited.withoutShop, jadeBudget);
      return unlimited;
    }
  }
  return projectShopStrategyOnce(calculationOptions, shopOptions, targets);
}

module.exports = {
  projectShopStrategy,
};
