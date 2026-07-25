const CalculationEngine = require('./calculation-engine');
const { projectShopStrategy } = require('./shop-strategy');

const state = {
  config: null,
  projectedDailyInventory: [],
  mobileInventoryDay: null,
};

const mapLabels = {
  common: 'Common',
  epic: 'Epic',
  superior: 'Superior',
  divine: 'Divine',
  mythical: 'Mythical',
};

const shardKeys = ['elemental', 'wind', 'lightning', 'water', 'fire', 'universal'];
const specificElementKeys = ['wind', 'lightning', 'water', 'fire'];
const inventoryFields = [
  ...shardKeys.map((key) => ['shards', key]),
  ['maps', 'common'],
  ['maps', 'epic'],
  ['maps', 'superior'],
  ['maps', 'divine'],
  ['fragments', 'common'],
  ['fragments', 'epic'],
  ['fragments', 'superior'],
  ['fragments', 'divine'],
  ['fragments', 'random'],
];
const mythicalFields = [
  ['mythical', 'ownerDone'],
  ['mythical', 'memberDone'],
];
const questFields = [['quests', 'allClaimed']];
const weeklyFields = [
  ['weekly', 'divineFragmentsReceived'],
  ['weekly', 'divineMemberRunsFinished'],
];
const runLevels = ['common', 'epic', 'superior', 'divine', 'mythical'];
const dailyMemberRunLevels = ['common', 'epic', 'superior'];
const fragmentReturnLevels = ['common', 'epic', 'superior', 'divine'];
const rewardKinds = ['universal', 'elemental'];
const runKinds = ['own', 'member'];
const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const shopFragmentLevels = ['common', 'epic', 'superior', 'divine', 'random'];
const shopMapLevels = ['common', 'epic', 'superior', 'divine'];
const shopStrategySummaryLabels = {
  0: 'No shop',
  1: 'Coin items',
  2: 'Finish fragment sets',
  3: 'Best target value',
};
const shopSimpleProbabilityGroups = [
  ['jadeItemKinds', 'Items offered for jades: fragment or map', ['fragment', 'map']],
  ['jadeFragmentLevels', 'Pay with jades: fragment rarity', shopFragmentLevels],
  ['jadeMapLevels', 'Pay with jades: map rarity', shopMapLevels],
  ['jadeFragmentQuantities', 'Pay with jades: fragments received', ['1', '2', '3']],
  ['randomCurrencyLevels', 'Pay with random fragments: fragment rarity', shopMapLevels],
  ['coinItemKinds', 'Items offered for coins: item type', ['nonEvent', 'fragment', 'map']],
  ['coinFragmentLevels', 'Pay with coins: fragment rarity', ['common', 'random', 'epic', 'superior']],
  ['coinMapLevels', 'Pay with coins: map rarity', shopMapLevels],
];
const shopMatrixProbabilityGroups = [
  ['randomCurrencyQuantities', 'Pay with random fragments: fragments received', shopMapLevels],
  ['coinFragmentQuantities', 'Pay with coins: fragments received', ['common', 'random', 'epic', 'superior']],
];

const formatNumber = new Intl.NumberFormat('en-US');
const todayIso = new Date().toISOString().slice(0, 10);
const storageKey = 'treasure-map-event-state';
const deferredProjectionFields = new Set(['shopStrategy', 'shopResetsPerDay', 'shopJadeBudget']);
const nullableShopNumberFields = new Set(['shopResetsPerDay', 'shopJadeBudget']);
let isRestoring = false;
let projectionTimer = null;

function numberValue(id, fallback = 0) {
  const element = document.getElementById(id);
  const value = Number(element?.value ?? fallback);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function plural(value, label) {
  return `${formatNumber.format(value)} ${label}${value === 1 ? '' : 's'}`;
}

function fieldId(day, bucket, key) {
  return `day-${day}-${bucket}-${key}`;
}

function isDailyFieldId(id) {
  return id.startsWith('day-');
}

function elementalTotal(shards) {
  return CalculationEngine.elementalTotal(shards);
}

function hideSpecificElements() {
  return Boolean(document.getElementById('hideSpecificElements')?.checked);
}

function showQuestColumn() {
  return Boolean(document.getElementById('showQuestColumn')?.checked);
}

function showRunColumns() {
  return Boolean(document.getElementById('showRunColumns')?.checked);
}

function levelClass(key) {
  return ['common', 'epic', 'superior', 'divine', 'random'].includes(key) ? `level-${key}` : '';
}

function fragmentIconSrc(level) {
  if (level === 'random') return 'img/random_fragment_icon/random_fragment.png';
  return `img/desire_treasure_icons/transparent/${level}_fragment.png`;
}

function shardIconSrc(key) {
  const icons = {
    wind: 'img/desire_treasure_icons/transparent/wind_shard.png',
    lightning: 'img/desire_treasure_icons/transparent/lightning_shard.png',
    water: 'img/desire_treasure_icons/transparent/water_shard.png',
    fire: 'img/desire_treasure_icons/transparent/fire_shard.png',
    universal: 'img/desire_treasure_icons/transparent/universal_shard.png',
  };
  return icons[key] || '';
}

function iconLabel(src, label) {
  return `<span class="header-icon-label"><img src="${src}" alt=""><span>${label}</span></span>`;
}

function fragmentLabel(level, label) {
  return iconLabel(fragmentIconSrc(level), label);
}

function shardLabel(key, label) {
  const src = shardIconSrc(key);
  return src ? iconLabel(src, label) : label;
}

function getReward(runKind, level, kind) {
  return numberValue(`reward-${runKind}-${level}-${kind}`, state.config.rewards[runKind]?.[level]?.[kind] ?? 0);
}

function divineFragmentWeeklyCap() {
  return Math.floor(numberValue(
    'fragment-weekly-divine',
    state.config.fragmentRules.divine.weeklyCap,
  ));
}

function divineMemberWeeklyCap() {
  return Math.floor(numberValue(
    'member-weekly-divine',
    state.config.joinLimits.weekly.divine,
  ));
}

function renderDailyInventoryTable() {
  const eventDays = Math.max(1, numberValue('eventDays', state.config.seasons.summer.defaultDays));
  const container = document.getElementById('dailyInventoryTable');
  const rows = [];

  rows.push(`
    <div class="daily-row daily-head">
      <span>End of Day</span>
      <span class="shard-cell group-start">Elemental</span>
      <span class="shard-cell specific-element-cell">${shardLabel('wind', 'Wind')}</span>
      <span class="shard-cell specific-element-cell">${shardLabel('lightning', 'Lightning')}</span>
      <span class="shard-cell specific-element-cell">${shardLabel('water', 'Water')}</span>
      <span class="shard-cell specific-element-cell">${shardLabel('fire', 'Fire')}</span>
      <span class="shard-cell">${shardLabel('universal', 'Universal')}</span>
      <span class="map-cell group-start level-common">Common maps</span>
      <span class="map-cell level-epic">Epic maps</span>
      <span class="map-cell level-superior">Superior maps</span>
      <span class="map-cell level-divine">Divine maps</span>
      <span class="fragment-cell group-start level-common">${fragmentLabel('common', 'Common frag')}</span>
      <span class="fragment-cell level-epic">${fragmentLabel('epic', 'Epic frag')}</span>
      <span class="fragment-cell level-superior">${fragmentLabel('superior', 'Superior frag')}</span>
      <span class="fragment-cell level-divine">${fragmentLabel('divine', 'Divine frag')}</span>
      <span class="fragment-cell level-random">${fragmentLabel('random', 'Random frag')}</span>
      <span class="weekly-cell group-start" title="Weekly Divine fragments received">Weekly Divine frags received</span>
      <span class="weekly-cell" title="Weekly Divine member runs finished">Weekly Divine member runs finished</span>
      <span class="myth-cell group-start">Myth owner</span>
      <span class="myth-cell">Myth member</span>
      <span class="quest-claim-cell group-start">All Quests</span>
      <span class="quest-cell group-start">Quest</span>
      ${runLevels.map((level, index) => `<span class="run-cell ${levelClass(level)}${index === 0 ? ' group-start' : ''}">${mapLabels[level]} runs</span>`).join('')}
    </div>
  `);

  for (let day = 1; day <= eventDays; day += 1) rows.push(renderDailyInventoryRow(day));

  rows.push(renderUnusedRow());

  container.innerHTML = rows.join('');
  updateSpecificElementVisibility();
  updateQuestColumnVisibility();
  updateRunColumnVisibility();
  updateDailyRowVisibility();
}

function inventoryFieldLabel(bucket, key) {
  if (bucket === 'shards') {
    if (key === 'elemental') return 'Elemental total';
    return key === 'universal' ? 'Universal' : key[0].toUpperCase() + key.slice(1);
  }
  if (bucket === 'maps') return `${mapLabels[key]} maps`;
  if (bucket === 'fragments') {
    const label = key === 'random' ? 'Random' : mapLabels[key];
    return `${label} fragments`;
  }
  if (key === 'divineFragmentsReceived') return 'Weekly Divine fragments';
  return 'Weekly Divine member runs';
}

function mobileNumberField(day, bucket, key, inputHtml) {
  const classes = ['mobile-inventory-field'];
  if (bucket === 'shards' && specificElementKeys.includes(key)) classes.push('specific-element-cell');
  return `
    <label class="${classes.join(' ')}">
      <span class="mobile-inventory-field-label">${inventoryFieldLabel(bucket, key)}</span>
      ${inputHtml}
    </label>
  `;
}

function mobileReadonlyField(label, content, classes = '') {
  return `
    <div class="mobile-inventory-readonly ${classes}">
      <span class="mobile-inventory-field-label">${label}</span>
      ${content}
    </div>
  `;
}

function renderDailyInventoryRow(day) {
  return `
    <div class="daily-row" data-day="${day}">
      <strong class="daily-day-label">End ${day}</strong>
      <section class="daily-field-group daily-shard-group">
        <h3>Shards</h3>
        ${shardKeys.map((key) => mobileNumberField(day, 'shards', key, numberInput(day, 'shards', key))).join('')}
      </section>
      <section class="daily-field-group daily-map-group">
        <h3>Maps</h3>
        ${['common', 'epic', 'superior', 'divine'].map((key) => mobileNumberField(day, 'maps', key, numberInput(day, 'maps', key))).join('')}
      </section>
      <section class="daily-field-group daily-fragment-group">
        <h3>Fragments</h3>
        ${['common', 'epic', 'superior', 'divine', 'random'].map((key) => mobileNumberField(day, 'fragments', key, numberInput(day, 'fragments', key))).join('')}
      </section>
      <section class="daily-field-group daily-progress-group">
        <h3>Progress</h3>
        ${weeklyFields.map(([bucket, key]) => mobileNumberField(day, bucket, key, weeklyNumberInput(day, bucket, key))).join('')}
        ${mythicalFields.map(([bucket, key]) => checkboxInput(day, bucket, key)).join('')}
        ${allQuestsInput(day)}
        ${mobileReadonlyField('Quest rewards', `<span id="quest-${day}" class="quest-cell readonly-cell group-start">-</span>`, 'quest-cell')}
        ${runLevels.map((level, index) => mobileReadonlyField(
    `${mapLabels[level]} runs`,
    `<span id="runs-${day}-${level}" class="run-cell readonly-cell ${levelClass(level)}${index === 0 ? ' group-start' : ''}">0</span>`,
    `run-cell ${levelClass(level)}`,
  )).join('')}
      </section>
    </div>
  `;
}

function renderUnusedRow() {
  const emptyShardCells = shardKeys.map((key) => '<span class="unused-cell shard-cell' + (key === 'elemental' ? ' group-start' : '') + (specificElementKeys.includes(key) ? ' specific-element-cell' : '') + '">-</span>').join('');
  const mapCells = ['common', 'epic', 'superior', 'divine'].map((level, index) => '<span class="unused-cell map-cell ' + levelClass(level) + (index === 0 ? ' group-start' : '') + '">-</span>').join('');
  const fragmentCells = ['common', 'epic', 'superior', 'divine', 'random'].map((level, index) => '<span id="unused-' + level + '" class="unused-cell fragment-cell ' + levelClass(level) + (index === 0 ? ' group-start' : '') + '">-</span>').join('');
  return `
    <div class="daily-row unused-row" data-unused-row="true">
      <strong>Unused</strong>
      ${emptyShardCells}
      ${mapCells}
      ${fragmentCells}
      <span id="unused-weekly-divine-fragments" class="unused-cell weekly-cell group-start">-</span>
      <span id="unused-weekly-divine-runs" class="unused-cell weekly-cell">-</span>
      <span id="unused-myth-owner" class="unused-cell myth-cell group-start">-</span>
      <span id="unused-myth-member" class="unused-cell myth-cell">-</span>
      <span id="unused-all-quests" class="unused-cell quest-claim-cell group-start">-</span>
      <span class="quest-cell readonly-cell group-start">-</span>
      ${runLevels.map((level, index) => `<span class="run-cell readonly-cell ${levelClass(level)}${index === 0 ? ' group-start' : ''}">-</span>`).join('')}
    </div>
  `;
}

function numberInput(day, bucket, key) {
  const classes = [];
  if (bucket === 'shards') classes.push('shard-cell');
  if (bucket === 'maps') classes.push('map-cell');
  if (bucket === 'fragments') classes.push('fragment-cell');
  if ((bucket === 'shards' && key === 'elemental') || (bucket === 'maps' && key === 'common') || (bucket === 'fragments' && key === 'common')) classes.push('group-start');
  if (bucket === 'shards' && key === 'elemental') classes.push('aggregate-element-cell');
  if (bucket === 'shards' && specificElementKeys.includes(key)) classes.push('specific-element-cell');
  if (bucket === 'maps' || bucket === 'fragments') classes.push(levelClass(key));
  return `<input id="${fieldId(day, bucket, key)}" class="${classes.join(' ')}" data-day="${day}" data-bucket="${bucket}" data-key="${key}" type="number" min="0" inputmode="numeric" aria-label="End of Day ${day} ${key} ${bucket}">`;
}

function weeklyNumberInput(day, bucket, key) {
  const max = key === 'divineFragmentsReceived'
    ? divineFragmentWeeklyCap()
    : divineMemberWeeklyCap();
  const label = key === 'divineFragmentsReceived' ? 'weekly Divine fragments received' : 'weekly Divine member runs finished';
  return `<input id="${fieldId(day, bucket, key)}" class="weekly-cell${key === 'divineFragmentsReceived' ? ' group-start' : ''}" data-day="${day}" data-bucket="${bucket}" data-key="${key}" type="number" min="0" max="${max}" inputmode="numeric" aria-label="End of Day ${day} ${label}">`;
}

function checkboxInput(day, bucket, key) {
  const groupClass = key === 'ownerDone' ? ' group-start' : '';
  const label = key === 'ownerDone' ? 'Mythical owner' : 'Mythical member';
  return `
    <label class="daily-check myth-cell${groupClass}" for="${fieldId(day, bucket, key)}">
      <b class="mobile-inventory-field-label">${label}</b>
      <input id="${fieldId(day, bucket, key)}" data-day="${day}" data-bucket="${bucket}" data-key="${key}" type="checkbox">
      <span>Claimed</span>
    </label>
  `;
}

function allQuestsInput(day) {
  return `
    <label class="daily-check quest-claim-cell group-start" for="${fieldId(day, 'quests', 'allClaimed')}">
      <b class="mobile-inventory-field-label">All quests</b>
      <input id="${fieldId(day, 'quests', 'allClaimed')}" data-day="${day}" data-bucket="quests" data-key="allClaimed" type="checkbox">
      <span>Claimed</span>
    </label>
  `;
}

function renderGeneralStaticConfig() {
  const container = document.getElementById('generalStaticConfig');
  if (!container || !state.config) return;
  const { crafting, joinLimits, ownLimits, fragmentRules, eventDates } = state.config;
  const fragmentsPerMap = Number(crafting.fragmentsPerMap) || 10;
  const returnInput = (runKind, level) => `
    <input
      id="fragment-return-${runKind}-${level}"
      aria-label="${mapLabels[level]} fragment returned after ${runKind} run"
      type="number"
      min="0"
      max="${Math.max(0, fragmentsPerMap - 1)}"
      value="${fragmentRules[level]?.[`${runKind}Run`] ?? 0}"
    >
  `;
  container.innerHTML = `
    <section class="static-config-block">
      <h3>Crafting</h3>
      <div class="field-grid static-rule-fields">
        <label>Standard fragments needed per map<input id="fragmentsPerMap" type="number" min="1" value="${crafting.fragmentsPerMap}"></label>
        <label>Random fragments needed per map<input id="randomFragmentsPerMap" type="number" min="1" value="${crafting.randomFragmentsPerMap}"></label>
      </div>
    </section>
    <section class="static-config-block">
      <h3>Daily fragment income</h3>
      <div class="field-grid static-rule-fields">
        <label>Random fragments received per day<input id="randomFragmentsPerDay" type="number" min="0" value="${crafting.randomFragmentsPerDay}"></label>
      </div>
    </section>
    <section class="static-config-block">
      <h3>Member run limits</h3>
      <div class="field-grid static-rule-fields">
        ${dailyMemberRunLevels.map((level) => `
          <label>${mapLabels[level]} runs per day<input id="member-daily-${level}" type="number" min="0" value="${joinLimits.daily[level]}"></label>
        `).join('')}
        <label>Divine runs per week<input id="member-weekly-divine" type="number" min="0" value="${joinLimits.weekly.divine}"></label>
      </div>
    </section>
    <section class="static-config-block">
      <h3>Divine and Mythical limits</h3>
      <div class="field-grid static-rule-fields">
        <label>Divine fragments per week<input id="fragment-weekly-divine" type="number" min="0" value="${fragmentRules.divine.weeklyCap}"></label>
        <label>Mythical own maps per event<input id="mythical-own-event" type="number" min="0" value="${ownLimits.event.mythical}"></label>
        <label>Mythical member maps per event<input id="mythical-member-event" type="number" min="0" value="${joinLimits.event.mythical}"></label>
      </div>
    </section>
    <section class="static-config-block">
      <h3>Fragments returned after a map</h3>
      <div class="fragment-return-table">
        <div class="fragment-return-row fragment-return-head"><span>Rarity</span><span>Own map</span><span>Member map</span></div>
        ${fragmentReturnLevels.map((level) => `
          <div class="fragment-return-row">
            <strong>${mapLabels[level]}</strong>
            ${returnInput('own', level)}
            ${returnInput('member', level)}
          </div>
        `).join('')}
      </div>
    </section>
    <section class="static-config-block">
      <h3>Weekly reset</h3>
      <div class="field-grid static-rule-fields">
        <label>
          Reset weekday
          <select id="weeklyResetWeekday">
            ${weekdayNames.map((weekday) => `<option value="${weekday}"${weekday === eventDates.weeklyReset.weekday ? ' selected' : ''}>${weekday[0].toUpperCase() + weekday.slice(1)}</option>`).join('')}
          </select>
        </label>
        <label>Reset time (UTC)<input id="weeklyResetTimeUtc" type="time" value="${eventDates.weeklyReset.timeUtc}"></label>
      </div>
    </section>
  `;
}

function updateStaticRuleInputLimits() {
  const fragmentsPerMap = Math.max(
    1,
    Math.floor(numberValue('fragmentsPerMap', state.config.crafting.fragmentsPerMap)),
  );
  document.querySelectorAll('[id^="fragment-return-"]').forEach((input) => {
    input.max = String(Math.max(0, fragmentsPerMap - 1));
    if (Number(input.value) > fragmentsPerMap - 1) {
      input.value = String(Math.max(0, fragmentsPerMap - 1));
    }
  });
  const divineFragmentCap = divineFragmentWeeklyCap();
  const divineMemberCap = divineMemberWeeklyCap();
  document.querySelectorAll('[data-bucket="weekly"]').forEach((input) => {
    input.max = String(input.dataset.key === 'divineFragmentsReceived'
      ? divineFragmentCap
      : divineMemberCap);
  });
}

function renderRewardInputs() {
  const container = document.getElementById('rewardInputs');
  const levels = ['common', 'epic', 'superior', 'divine', 'mythical'];
  container.innerHTML = `
    <div class="reward-row reward-head">
      <span>Reward</span>
      ${levels.map((level) => `<span>${mapLabels[level]}</span>`).join('')}
    </div>
    ${runKinds.flatMap((runKind) => rewardKinds.map((kind) => `
      <div class="reward-row">
        <strong>${kind[0].toUpperCase() + kind.slice(1)}${runKind === 'member' ? ', member' : ''}</strong>
        ${levels.map((level) => `
          <label class="visually-hidden" for="reward-${runKind}-${level}-${kind}">${runKind} ${level} ${kind}</label>
          <input id="reward-${runKind}-${level}-${kind}" type="number" min="0" value="${state.config.rewards[runKind][level][kind]}">
        `).join('')}
      </div>
    `)).join('')}
  `;
}

function questCounterLabel(quest) {
  if (quest.counter === 'member') return 'Treasure hunts with clan members';
  if (quest.counter === 'level') return `${mapLabels[quest.level] || quest.level} treasure hunts`;
  return 'All treasure hunts';
}

function renderQuestConfig() {
  const container = document.getElementById('questConfig');
  if (!container) return;
  container.innerHTML = [
    '<h3 class="static-table-heading">Quest rules</h3>',
    '<div class="quest-row quest-head"><span>Requirement</span><span>Count</span><span>Reward type</span><span>Rarity</span><span>Quantity</span></div>',
    ...(state.config.quests || []).map((quest, index) => {
      const rewardKind = quest.reward.fragment ? 'fragment' : 'ticket';
      const rewardLevel = quest.reward[rewardKind] || 'random';
      return `
        <div class="quest-row">
          <strong>${questCounterLabel(quest)}</strong>
          <input id="quest-${index}-threshold" aria-label="${questCounterLabel(quest)} required count" type="number" min="0" value="${quest.threshold}">
          <select id="quest-${index}-reward-kind" aria-label="${questCounterLabel(quest)} reward type">
            <option value="fragment"${rewardKind === 'fragment' ? ' selected' : ''}>Fragment</option>
            <option value="ticket"${rewardKind === 'ticket' ? ' selected' : ''}>Map</option>
          </select>
          <select id="quest-${index}-reward-level" aria-label="${questCounterLabel(quest)} reward rarity">
            ${shopFragmentLevels.map((level) => `<option value="${level}"${level === rewardLevel ? ' selected' : ''}>${shopConfigLabel(level)}</option>`).join('')}
          </select>
          <input id="quest-${index}-reward-count" aria-label="${questCounterLabel(quest)} reward quantity" type="number" min="0" value="${quest.reward.count}">
        </div>
      `;
    }),
  ].join('');
}

function generalStaticConfigDefaults() {
  const defaults = {
    fragmentsPerMap: state.config.crafting.fragmentsPerMap,
    randomFragmentsPerMap: state.config.crafting.randomFragmentsPerMap,
    randomFragmentsPerDay: state.config.crafting.randomFragmentsPerDay,
    'member-daily-common': state.config.joinLimits.daily.common,
    'member-daily-epic': state.config.joinLimits.daily.epic,
    'member-daily-superior': state.config.joinLimits.daily.superior,
    'member-weekly-divine': state.config.joinLimits.weekly.divine,
    'fragment-weekly-divine': state.config.fragmentRules.divine.weeklyCap,
    'mythical-own-event': state.config.ownLimits.event.mythical,
    'mythical-member-event': state.config.joinLimits.event.mythical,
    weeklyResetWeekday: state.config.eventDates.weeklyReset.weekday,
    weeklyResetTimeUtc: state.config.eventDates.weeklyReset.timeUtc,
  };
  fragmentReturnLevels.forEach((level) => {
    defaults[`fragment-return-own-${level}`] = state.config.fragmentRules[level].ownRun;
    defaults[`fragment-return-member-${level}`] = state.config.fragmentRules[level].memberRun;
  });
  runKinds.forEach((runKind) => {
    rewardKinds.forEach((kind) => {
      state.config.mapLevels.forEach((level) => {
        defaults[`reward-${runKind}-${level}-${kind}`] = state.config.rewards[runKind][level][kind];
      });
    });
  });
  (state.config.quests || []).forEach((quest, index) => {
    const rewardKind = quest.reward.fragment ? 'fragment' : 'ticket';
    defaults[`quest-${index}-threshold`] = quest.threshold;
    defaults[`quest-${index}-reward-kind`] = rewardKind;
    defaults[`quest-${index}-reward-level`] = quest.reward[rewardKind] || 'random';
    defaults[`quest-${index}-reward-count`] = quest.reward.count;
  });
  return defaults;
}

function shopStaticConfigDefaults() {
  const defaults = {};
  (state.config.shop.resetCosts || []).forEach((cost, index) => {
    defaults[`shop-reset-cost-${index + 1}`] = cost;
  });
  shopFragmentLevels.forEach((level) => {
    (state.config.shop.prices.jades.fragments[level] || []).forEach((offer) => {
      defaults[`shop-price-jade-fragment-${level}-${offer.quantity}`] = offer.cost;
    });
  });
  shopMapLevels.forEach((level) => {
    defaults[`shop-price-jade-map-${level}`] = state.config.shop.prices.jades.maps[level];
    defaults[`shop-price-random-fragment-${level}`] = state.config.shop.prices.randomFragments[level];
  });
  shopSimpleProbabilityGroups.forEach(([group, , keys]) => {
    keys.forEach((key) => {
      defaults[`shop-prob-${group}-${key}`] = state.config.shop.estimatedProbabilities[group]?.[key] ?? 0;
    });
  });
  shopMatrixProbabilityGroups.forEach(([group, , levels]) => {
    levels.forEach((level) => {
      ['1', '2', '3'].forEach((quantity) => {
        defaults[`shop-prob-${group}-${level}-${quantity}`] = state.config.shop.estimatedProbabilities[group]?.[level]?.[quantity] ?? 0;
      });
    });
  });
  return defaults;
}

function updateConfigStatus(elementId, defaults) {
  const status = document.getElementById(elementId);
  if (!status) return 0;
  const entries = Object.entries(defaults);
  const customCount = entries.reduce((count, [id, defaultValue]) => {
    const field = document.getElementById(id);
    if (!field) return count;
    const currentNumber = Number(field.value);
    const defaultNumber = Number(defaultValue);
    const matches = Number.isFinite(currentNumber) && Number.isFinite(defaultNumber)
      ? currentNumber === defaultNumber
      : String(field.value) === String(defaultValue);
    field.classList.toggle('custom-static-value', !matches);
    return count + (matches ? 0 : 1);
  }, 0);
  status.textContent = customCount === 0
    ? 'Using defaults'
    : `${customCount} custom value${customCount === 1 ? '' : 's'}`;
  status.title = customCount === 0
    ? 'All editable values match the current app defaults.'
    : `${customCount} of ${entries.length} editable values differ from the current app defaults.`;
  status.classList.toggle('is-custom', customCount > 0);
  return customCount;
}

function updateStaticConfigStatus() {
  if (!state.config) return;
  const customCount = updateConfigStatus('staticConfigStatus', generalStaticConfigDefaults())
    + updateConfigStatus('shopStaticConfigStatus', shopStaticConfigDefaults());
  const notice = document.getElementById('staticConfigNotice');
  if (notice) notice.hidden = customCount === 0;
}

function shopConfigLabel(value) {
  if (value === 'random') return 'Random';
  if (value === 'nonEvent') return 'Non-event';
  if (value === 'fragment') return 'Fragment';
  if (value === 'map') return 'Map';
  return mapLabels[value] || value;
}

function shopProbabilityInput(group, key, value) {
  return `
    <label>
      ${shopConfigLabel(key)} %
      <input id="shop-prob-${group}-${key}" type="number" min="0" step="0.1" value="${value}">
    </label>
  `;
}

function renderShopStaticConfig() {
  const container = document.getElementById('shopStaticConfig');
  if (!container || !state.config?.shop) return;
  const shop = state.config.shop;
  const probabilities = shop.estimatedProbabilities;
  const simpleGroups = shopSimpleProbabilityGroups.map(([group, label, keys]) => `
    <section class="shop-config-block">
      <h3>${label} <span class="estimate-badge">Estimated</span></h3>
      <div class="field-grid shop-probability-fields">
        ${keys.map((key) => shopProbabilityInput(group, key, probabilities[group]?.[key] ?? 0)).join('')}
      </div>
    </section>
  `).join('');
  const matrixGroups = shopMatrixProbabilityGroups.map(([group, label, levels]) => `
    <section class="shop-config-block">
      <h3>${label} <span class="estimate-badge">Estimated</span></h3>
      <div class="shop-probability-table">
        <div class="shop-probability-row shop-probability-head"><span>Rarity</span><span>1 fragment %</span><span>2 fragments %</span><span>3 fragments %</span></div>
        ${levels.map((level) => `
          <div class="shop-probability-row">
            <strong>${shopConfigLabel(level)}</strong>
            ${['1', '2', '3'].map((quantity) => `<input id="shop-prob-${group}-${level}-${quantity}" aria-label="${label} ${level} ${quantity}" type="number" min="0" step="0.1" value="${probabilities[group]?.[level]?.[quantity] ?? 0}">`).join('')}
          </div>
        `).join('')}
      </div>
    </section>
  `).join('');
  const jadeFragmentPrices = `
    <div class="shop-probability-table shop-price-input-table">
      <div class="shop-probability-row shop-probability-head"><span>Rarity</span><span>1 fragment</span><span>2 fragments</span><span>3 fragments</span></div>
      ${shopFragmentLevels.map((level) => `
        <div class="shop-probability-row">
          <strong>${shopConfigLabel(level)}</strong>
          ${['1', '2', '3'].map((quantity) => {
            const offer = (shop.prices.jades.fragments[level] || [])
              .find((candidate) => Number(candidate.quantity) === Number(quantity));
            return `<input id="shop-price-jade-fragment-${level}-${quantity}" aria-label="${shopConfigLabel(level)} ${quantity} fragment jade price" type="number" min="0" value="${offer?.cost ?? 0}">`;
          }).join('')}
        </div>
      `).join('')}
    </div>
  `;
  const mapPrices = `
    <div class="shop-map-price-table">
      <div class="shop-map-price-row shop-probability-head"><span>Rarity</span><span>Jades per map</span><span>Random fragments per fragment</span></div>
      ${shopMapLevels.map((level) => `
        <div class="shop-map-price-row">
          <strong>${mapLabels[level]}</strong>
          <input id="shop-price-jade-map-${level}" aria-label="${mapLabels[level]} map jade price" type="number" min="0" value="${shop.prices.jades.maps[level]}">
          <input id="shop-price-random-fragment-${level}" aria-label="${mapLabels[level]} fragment random-fragment price" type="number" min="0" value="${shop.prices.randomFragments[level]}">
        </div>
      `).join('')}
    </div>
  `;

  container.innerHTML = `
    <p class="static-config-note">Percentages are normalized automatically within each group.</p>
    <section class="shop-config-block">
      <h3>Daily reset jade costs</h3>
      <div class="field-grid shop-reset-fields">
        ${(shop.resetCosts || []).map((cost, index) => `
          <label>Reset ${index + 1}<input id="shop-reset-cost-${index + 1}" type="number" min="0" value="${cost}"></label>
        `).join('')}
      </div>
    </section>
    <section class="shop-config-block">
      <h3>Jade prices for fragment bundles</h3>
      ${jadeFragmentPrices}
    </section>
    <section class="shop-config-block">
      <h3>Map and random-fragment prices</h3>
      ${mapPrices}
    </section>
    ${simpleGroups}
    ${matrixGroups}
  `;
}

function initializeDates() {
  document.getElementById('startDate').value = state.config.eventDates?.start || todayIso;
  syncDatesFromInputs();
}

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysBetween(start, end) {
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function currentEventDay(eventDays) {
  return CalculationEngine.currentGameDay(firstGameDayStartUtc(), eventDays, new Date());
}

function firstGameDayStartUtc() {
  const activationDate = document.getElementById('startDate')?.value || state.config.eventDates.start;
  const configuredActivation = new Date(state.config.eventDates.activationUtc);
  const activationTime = Number.isNaN(configuredActivation.getTime())
    ? '04:00:00'
    : configuredActivation.toISOString().slice(11, 19);
  return CalculationEngine.gameDayStartForActivation(
    `${activationDate}T${activationTime}Z`,
    state.config.eventDates.gameDayRolloverUtc,
  );
}

function syncDatesFromInputs() {
  const start = parseLocalDate(document.getElementById('startDate').value);
  const eventDays = Math.max(1, numberValue('eventDays', state.config?.seasons?.summer?.defaultDays ?? 28));
  if (!start) return;

  const end = new Date(start);
  end.setDate(start.getDate() + eventDays - 1);
  document.getElementById('endDate').value = toIsoDate(end);
}

function cancelScheduledProjection() {
  if (projectionTimer === null) return;
  window.clearTimeout(projectionTimer);
  projectionTimer = null;
}

function scheduleProjection(fieldId) {
  cancelScheduledProjection();
  const delay = deferredProjectionFields.has(fieldId) ? 120 : 0;
  projectionTimer = window.setTimeout(() => {
    projectionTimer = null;
    calculateProjection();
    saveAppState();
  }, delay);
}

function bindEvents() {
  document.getElementById('trackerForm').addEventListener('input', (event) => {
    if (event.target.id === 'eventDays') return;
    if (nullableShopNumberFields.has(event.target.id) && event.target.value === '') {
      cancelScheduledProjection();
      return;
    }
    scheduleProjection(event.target.id);
  });
  document.getElementById('trackerForm').addEventListener('change', (event) => {
    if (event.target.id === 'season') {
      document.getElementById('eventDays').value = state.config.seasons[event.target.value].defaultDays;
      renderDailyInventoryTable();
    }
    if (event.target.id === 'eventDays') {
      renderDailyInventoryTable();
    }
    if (event.target.id === 'hideSpecificElements') {
      updateSpecificElementVisibility();
    }
    if (event.target.id === 'showQuestColumn') {
      updateQuestColumnVisibility();
    }
    if (event.target.id === 'showRunColumns') {
      updateRunColumnVisibility();
    }
    if (['showPreviousInventoryRows', 'showFutureInventoryRows'].includes(event.target.id)) {
      updateDailyRowVisibility();
    }
    if (['season', 'startDate', 'eventDays'].includes(event.target.id)) {
      syncDatesFromInputs();
    }
    scheduleProjection(event.target.id);
  });
  const updateGeneralStaticConfig = () => {
    updateStaticRuleInputLimits();
    calculateProjection();
    updateStaticConfigStatus();
    saveAppState();
  };
  document.getElementById('generalStaticConfig').addEventListener('input', updateGeneralStaticConfig);
  document.getElementById('rewardInputs').addEventListener('input', () => { updateStaticConfigStatus(); calculateProjection(); saveAppState(); });
  document.getElementById('questConfig').addEventListener('input', () => { calculateProjection(); updateStaticConfigStatus(); saveAppState(); });
  document.getElementById('shopStaticConfig').addEventListener('input', () => { calculateProjection(); updateStaticConfigStatus(); saveAppState(); });
  ['includeMythicalMember', 'includeMythicalOwner'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => { calculateProjection(); saveAppState(); });
  });
  document.getElementById('resetButton').addEventListener('click', resetEntries);
  document.getElementById('resetStaticConfigButton').addEventListener('click', resetStaticConfigToDefault);
  document.getElementById('resetStaticConfigNoticeButton').addEventListener('click', resetStaticConfigToDefault);
  document.getElementById('resetConfigButton').addEventListener('click', resetConfigToDefault);
  document.getElementById('downloadButton').addEventListener('click', downloadState);
  document.getElementById('uploadButton').addEventListener('click', () => document.getElementById('uploadInput').click());
  document.getElementById('uploadInput').addEventListener('change', uploadState);
  document.getElementById('mobileInventoryPreviousDay').addEventListener('click', () => {
    setMobileInventoryDay((state.mobileInventoryDay || 1) - 1);
  });
  document.getElementById('mobileInventoryNextDay').addEventListener('click', () => {
    setMobileInventoryDay((state.mobileInventoryDay || 1) + 1);
  });
}

function updateSpecificElementVisibility() {
  document.getElementById('dailyInventoryTable')?.classList.toggle('hide-specific-elements', hideSpecificElements());
}

function updateQuestColumnVisibility() {
  document.getElementById('dailyInventoryTable')?.classList.toggle('show-quest-column', showQuestColumn());
}

function updateRunColumnVisibility() {
  document.getElementById('dailyInventoryTable')?.classList.toggle('show-run-columns', showRunColumns());
}

function updateDailyRowVisibility(currentDay) {
  const eventDays = Math.max(1, numberValue('eventDays', state.config.seasons.summer.defaultDays));
  const activeDay = currentDay ?? currentEventDay(eventDays);
  const showPrevious = Boolean(document.getElementById('showPreviousInventoryRows')?.checked);
  const showFuture = Boolean(document.getElementById('showFutureInventoryRows')?.checked);
  const mobileLayout = window.matchMedia('(max-width: 760px)').matches;
  if (!Number.isFinite(state.mobileInventoryDay)) state.mobileInventoryDay = activeDay;
  state.mobileInventoryDay = Math.round(clamp(state.mobileInventoryDay, 1, eventDays));
  document.querySelectorAll('#dailyInventoryTable .daily-row[data-day]').forEach((row) => {
    const day = Number(row.dataset.day);
    const mobileSelected = mobileLayout && day === state.mobileInventoryDay;
    row.classList.toggle('mobile-selected-day', mobileSelected);
    row.hidden = mobileLayout
      ? !mobileSelected
      : (day < activeDay && !showPrevious) || (day > activeDay && !showFuture);
  });
  updateMobileInventoryNavigation(activeDay, eventDays);
}

function updateMobileInventoryNavigation(activeDay, eventDays) {
  const selectedDay = state.mobileInventoryDay;
  const dayData = state.projectedDailyInventory[selectedDay];
  const status = [
    selectedDay === activeDay ? 'Current day' : selectedDay < activeDay ? 'Previous day' : 'Future day',
    dayData?.isManual ? 'Entered balances' : 'Projected balances',
    isWeeklyResetStart(selectedDay) ? 'Weekly reset' : '',
  ].filter(Boolean);
  document.getElementById('mobileInventoryDayLabel').textContent =
    `End of day ${formatNumber.format(selectedDay)} / ${formatNumber.format(eventDays)}`;
  document.getElementById('mobileInventoryDayStatus').textContent = status.join(' · ');
  document.getElementById('mobileInventoryDayProgress').style.width =
    `${Math.min(100, (selectedDay / eventDays) * 100)}%`;
  document.getElementById('mobileInventoryPreviousDay').disabled = selectedDay <= 1;
  document.getElementById('mobileInventoryNextDay').disabled = selectedDay >= eventDays;
}

function setMobileInventoryDay(day) {
  const eventDays = Math.max(1, numberValue('eventDays', state.config.seasons.summer.defaultDays));
  state.mobileInventoryDay = Math.round(clamp(day, 1, eventDays));
  updateDailyRowVisibility();
}

function initializeMobileInventoryEditor() {
  const mobileQuery = window.matchMedia('(max-width: 760px)');
  mobileQuery.addEventListener('change', () => updateDailyRowVisibility());
}

function resetEntries() {
  if (!window.confirm('Clear all end-of-day inventory entries?')) return;
  document.querySelectorAll('#dailyInventoryTable input').forEach((input) => {
    if (input.type === 'checkbox') input.checked = false;
    input.value = '';
  });
  calculateProjection();
  saveAppState();
}

function resetStaticConfigToDefault() {
  if (!window.confirm('Reset only static configuration to the current defaults? Your plan, event setup, and end-of-day entries will stay.')) return;
  cancelScheduledProjection();
  renderGeneralStaticConfig();
  renderRewardInputs();
  renderQuestConfig();
  renderShopStaticConfig();
  updateStaticRuleInputLimits();
  updateStaticConfigStatus();
  calculateProjection();
  saveAppState();
}

function resetConfigToDefault() {
  if (!window.confirm('Reset plan, event setup, and static configuration to defaults? End-of-day entries will stay.')) return;
  const previousState = collectFormState();
  document.getElementById('targetUniversal').value = state.config.defaultTargets.universal;
  document.getElementById('targetElemental').value = state.config.defaultTargets.elemental;
  document.getElementById('season').value = 'summer';
  document.getElementById('eventDays').value = state.config.seasons.summer.defaultDays;
  document.getElementById('luckyElementalPerDay').value = state.config.luckyRewards?.elementalPerDay ?? 15;
  document.getElementById('randomStrategy').value = 'minimum';
  document.getElementById('includeMythicalOwner').checked = true;
  document.getElementById('includeMythicalMember').checked = true;
  document.getElementById('hideSpecificElements').checked = Boolean(state.config.ui?.hideSpecificElements);
  document.getElementById('showQuestColumn').checked = Boolean(state.config.ui?.showQuestColumn);
  document.getElementById('showRunColumns').checked = Boolean(state.config.ui?.showRunColumns);
  document.getElementById('showPreviousInventoryRows').checked = false;
  document.getElementById('showFutureInventoryRows').checked = true;
  document.getElementById('shopStrategy').value = '1';
  document.getElementById('shopResetsPerDay').value = 0;
  document.getElementById('shopJadeBudget').value = 0;
  document.getElementById('startDate').value = state.config.eventDates?.start || todayIso;
  syncDatesFromInputs();
  renderGeneralStaticConfig();
  renderDailyInventoryTable();
  renderRewardInputs();
  renderQuestConfig();
  renderShopStaticConfig();
  applyStoredState(previousState, { onlyDaily: true });
  updateStaticRuleInputLimits();
  updateStaticConfigStatus();
  updateSpecificElementVisibility();
  updateQuestColumnVisibility();
  updateRunColumnVisibility();
  calculateProjection();
  saveAppState();
}

function collectFormState() {
  const fields = {};
  document.querySelectorAll('input[id], select[id]').forEach((field) => {
    if (field.type === 'file') return;
    fields[field.id] = field.type === 'checkbox' ? field.checked : field.value;
  });
  return { version: 8, savedAt: new Date().toISOString(), fields };
}

function saveAppState() {
  if (isRestoring) return;
  localStorage.setItem(storageKey, JSON.stringify(collectFormState()));
}

function readStoredState() {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Could not read saved tracker state', error);
    return null;
  }
}

function applyStoredState(saved, { includeDaily = true, onlyDaily = false } = {}) {
  if (!saved?.fields) return;
  Object.entries(saved.fields).forEach(([id, value]) => {
    if ((saved.version || 0) < 4 && ['shopStrategy', 'shopResetsPerDay', 'shopJadeBudget'].includes(id)) return;
    if ((saved.version || 0) < 6 && id.startsWith('shop-prob-jadeMapLevels-')) return;
    if (onlyDaily && !isDailyFieldId(id)) return;
    if (!includeDaily && isDailyFieldId(id)) return;
    const field = document.getElementById(id);
    if (!field) return;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else if (id === 'shopStrategy' && Number(saved.version) === 4 && String(value) === '2') field.value = '3';
    else field.value = value;
  });
}

function migrateLegacyJadeBudget(saved) {
  const savedVersion = Number(saved?.version) || 0;
  if (savedVersion < 4 || savedVersion >= 7) return;
  const oldEventBudget = Math.floor(Math.max(0, Number(saved.fields?.shopJadeBudget) || 0));
  if (oldEventBudget <= 0) return;

  const eventDays = Math.floor(Math.max(
    1,
    numberValue('eventDays', state.config.seasons.summer.defaultDays),
  ));
  const planningStartDay = currentEventDay(eventDays) + 1;
  const dailyBudget = Math.floor(oldEventBudget / eventDays);
  const extraBudgetDays = oldEventBudget % eventDays;
  let oldRemainingAllocation = 0;
  for (let day = planningStartDay; day <= eventDays; day += 1) {
    oldRemainingAllocation += dailyBudget + (day <= extraBudgetDays ? 1 : 0);
  }
  document.getElementById('shopJadeBudget').value = String(oldRemainingAllocation);
}

function downloadState() {
  const data = JSON.stringify(collectFormState(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'treasure-map-event-' + todayIso + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function uploadState(event) {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try {
      const imported = JSON.parse(String(reader.result));
      localStorage.setItem(storageKey, JSON.stringify(imported));
      restoreAndRender(imported);
    } catch (error) {
      window.alert('Could not import this file.');
    } finally {
      event.target.value = '';
    }
  });
  reader.readAsText(file);
}

function restoreAndRender(saved) {
  isRestoring = true;
  renderGeneralStaticConfig();
  renderShopStaticConfig();
  applyStoredState(saved, { includeDaily: false });
  syncDatesFromInputs();
  renderDailyInventoryTable();
  renderRewardInputs();
  renderQuestConfig();
  applyStoredState(saved);
  migrateLegacyJadeBudget(saved);
  syncDatesFromInputs();
  updateStaticRuleInputLimits();
  updateSpecificElementVisibility();
  updateQuestColumnVisibility();
  updateRunColumnVisibility();
  updateStaticConfigStatus();
  isRestoring = false;
  calculateProjection();
  saveAppState();
}

function questRewardText(questRewards) {
  const ticketText = ['common', 'epic', 'superior', 'divine', 'random']
    .filter((key) => questRewards.tickets[key] > 0)
    .map((key) => `${mapLabels[key] || 'Random'} map x${formatNumber.format(questRewards.tickets[key])}`);
  const fragmentText = ['common', 'epic', 'superior', 'divine', 'random']
    .filter((key) => questRewards.fragments[key] > 0)
    .map((key) => `${mapLabels[key] || 'Random'} fragment x${formatNumber.format(questRewards.fragments[key])}`);
  return [...ticketText, ...fragmentText].join(', ') || 'None';
}

function updateDailyPlaceholders(days) {
  const currentDay = currentEventDay(days.length - 1);
  days.forEach((dayData, day) => {
    if (!dayData) return;
    const row = document.querySelector(`[data-day="${day}"]`);
    row?.classList.toggle('current-day-row', day === currentDay);
    const questCell = document.getElementById(`quest-${day}`);
    if (questCell) questCell.innerHTML = renderQuestAwards(dayData.questAwards || []);
    row?.classList.toggle('manual-day-row', dayData.isManual);
    const weeklyReset = isWeeklyResetStart(day);
    row?.classList.toggle('weekly-reset-row', weeklyReset);
    const dayLabel = row?.querySelector('strong');
    if (row && weeklyReset) {
      const resetTime = document.getElementById('weeklyResetTimeUtc')?.value
        || state.config.eventDates.weeklyReset.timeUtc;
      if (dayLabel) dayLabel.dataset.resetLabel = `week resets\n${resetTime} UTC`;
      row.title = `The weekly bucket resets at ${resetTime} UTC during this game day.`;
    } else if (row) {
      if (dayLabel) delete dayLabel.dataset.resetLabel;
      row.removeAttribute('title');
    }

    const aggregateInput = document.getElementById(fieldId(day, 'shards', 'elemental'));
    const aggregateTyped = Boolean(aggregateInput && aggregateInput.value !== '');
    const specificTyped = specificElementKeys.some((key) => {
      const input = document.getElementById(fieldId(day, 'shards', key));
      return input && input.value !== '';
    });

    [...inventoryFields, ...weeklyFields].forEach(([bucket, key]) => {
      const input = document.getElementById(fieldId(day, bucket, key));
      if (!input) return;
      input.placeholder = String(dayData.inventory[bucket][key]);
      input.classList.toggle('projected-input', input.value === '');
      const specificIgnored = bucket === 'shards' && specificElementKeys.includes(key) && aggregateTyped;
      const aggregateIgnored = bucket === 'shards' && key === 'elemental' && !aggregateTyped && specificTyped;
      input.classList.toggle('ignored-input', specificIgnored || aggregateIgnored);
      if (specificIgnored) {
        input.title = 'Ignored because Elemental is entered for this end of day.';
      } else if (aggregateIgnored) {
        input.title = 'Ignored because a specific element is entered for this end of day.';
      } else {
        input.removeAttribute('title');
      }
    });

    [...mythicalFields, ...questFields].forEach(([bucket, key]) => {
      const input = document.getElementById(fieldId(day, bucket, key));
      if (!input) return;
      const check = input.closest('.daily-check');
      check?.classList.toggle('claimed-check', input.checked || dayData.inventory[bucket][key]);
      check?.classList.toggle('projected-check', !input.checked && dayData.inventory[bucket][key]);
    });

    runLevels.forEach((level) => {
      const cell = document.getElementById(`runs-${day}-${level}`);
      if (!cell) return;
      const own = dayData.ownRuns[level] || 0;
      const member = dayData.memberRuns[level] || 0;
      cell.textContent = formatNumber.format(own + member);
      cell.title = `${formatNumber.format(own)} own + ${formatNumber.format(member)} member`;
    });
  });
  updateDailyRowVisibility(currentDay);
}

function shopItemSummary(totals, levels, noun) {
  const parts = levels
    .filter((level) => totals[level] > 0)
    .map((level) => `${shopConfigLabel(level)} ${formatNumber.format(totals[level])}`);
  return parts.length ? `${parts.join(', ')} ${noun}` : `No ${noun}`;
}

function hasShopItems(totals, levels) {
  return levels.some((level) => Number(totals?.[level]) > 0);
}

function updateShopPlanSummary(shop) {
  const strategy = Math.floor(numberValue('shopStrategy'));
  const resetsPerDay = Math.floor(numberValue('shopResetsPerDay'));
  document.getElementById('shopPlanStrategySummary').textContent =
    shopStrategySummaryLabels[strategy] || 'Custom strategy';
  document.getElementById('shopPlanResetsSummary').textContent = resetsPerDay > 0
    ? `${plural(resetsPerDay, 'reset')}/day`
    : 'No resets';
  document.getElementById('shopPlanJadesSummary').textContent =
    `Remaining estimate: ${formatNumber.format(shop.remaining.jadeSpent.total)} jades`;
}

function updateShopProjection(shop, contribution, targetStatus) {
  const remaining = shop.remaining;
  const entire = shop.entire;
  const enabled = shop.enabled;
  const targetMissing = enabled && !targetStatus.covered;
  updateShopPlanSummary(shop);
  document.querySelector('.remaining-cost-card')?.classList.toggle('shop-plan-missing', targetMissing);
  document.getElementById('shopRemainingJades').textContent = formatNumber.format(remaining.jadeSpent.total);
  document.getElementById('shopRemainingBreakdown').textContent = `${formatNumber.format(remaining.jadeSpent.purchases)} for purchases + ${formatNumber.format(remaining.jadeSpent.resets)} for resets`;
  document.getElementById('shopTotalJades').textContent = formatNumber.format(entire.jadeSpent.total);
  document.getElementById('shopEntireBreakdown').textContent = `${formatNumber.format(entire.jadeSpent.purchases)} for purchases + ${formatNumber.format(entire.jadeSpent.resets)} for resets`;
  document.getElementById('shopBudgetRemaining').textContent = shop.jadeBudget === null
    ? 'Unlimited'
    : formatNumber.format(shop.jadeBudgetRemaining);

  const details = document.getElementById('shopProjectionDetails');
  if (!enabled) {
    details.innerHTML = `
      <section class="shop-action-section">
        <div class="shop-action-heading">
          <h3>No shop purchases planned</h3>
          <p>Choose a shop strategy to see what to buy.</p>
        </div>
      </section>
    `;
    return;
  }
  const remainingContributionClass = contribution.remaining.universal >= 0
    && contribution.remaining.elemental >= 0 ? 'positive' : 'negative';
  const entireContributionClass = contribution.entire.universal >= 0
    && contribution.entire.elemental >= 0 ? 'positive' : 'negative';
  const actionCards = [];
  const coinActionCard = remaining.offers.coins > 0
    ? `
      <article class="shop-action-card coin-purchase-action">
        <span>Coin-priced items</span>
        <strong>Buy every one shown</strong>
        <small>${formatNumber.format(remaining.offers.coins)} expected for the rest of the event</small>
      </article>
    `
    : '';
  if (hasShopItems(remaining.targetFragments, shopFragmentLevels)) {
    actionCards.push(`
      <article class="shop-action-card">
        <span>Fragments to buy</span>
        <strong>${shopItemSummary(remaining.targetFragments, shopFragmentLevels, 'fragments')}</strong>
        <small>Buy these quantities when offered</small>
      </article>
    `);
  }
  if (hasShopItems(remaining.targetMaps, shopMapLevels)) {
    actionCards.push(`
      <article class="shop-action-card">
        <span>Maps to buy</span>
        <strong>${shopItemSummary(remaining.targetMaps, shopMapLevels, 'maps')}</strong>
        <small>Buy these quantities when offered</small>
      </article>
    `);
  }
  if (remaining.resets > 0) {
    actionCards.push(`
      <article class="shop-action-card">
        <span>Resets for the remaining days</span>
        <strong>Reset the shop ${plural(remaining.resets, 'time')} in total</strong>
        <small>Across ${plural(remaining.days, 'remaining day')} · ${formatNumber.format(remaining.jadeSpent.resets)} jades included above</small>
      </article>
    `);
  }
  if (coinActionCard) actionCards.push(coinActionCard);
  if (actionCards.length === 0) {
    actionCards.push(`
      <article class="shop-action-card">
        <span>Purchases remaining</span>
        <strong>Nothing left to buy</strong>
        <small>The projection has reached the end of the event</small>
      </article>
    `);
  }
  const itemCurrencies = [];
  if (remaining.jadeSpent.purchases > 0) {
    itemCurrencies.push(`${formatNumber.format(remaining.jadeSpent.purchases)} jades`);
  }
  if (remaining.randomFragmentsSpent > 0) {
    itemCurrencies.push(`${formatNumber.format(remaining.randomFragmentsSpent)} random fragments`);
  }
  const missingTargets = [
    targetStatus.missing.universal > 0
      ? `${formatNumber.format(targetStatus.missing.universal)} universal`
      : '',
    targetStatus.missing.elemental > 0
      ? `${formatNumber.format(targetStatus.missing.elemental)} elemental`
      : '',
  ].filter(Boolean).join(' and ');
  details.innerHTML = `
    <section class="shop-action-section${targetMissing ? ' shop-plan-missing' : ''}">
      <div class="shop-action-heading">
        <h3>What to buy for the rest of the event</h3>
      </div>
      ${targetMissing ? `
        <div class="shop-target-warning" role="alert">
          <strong>This shop plan does not reach your target</strong>
          <p>After all purchases below, the event projection is still missing ${missingTargets}.</p>
          <p>${targetStatus.reason}</p>
          <div class="shop-target-next-step">
            <span>What to do</span>
            <strong>${targetStatus.action}</strong>
          </div>
        </div>
      ` : ''}
      <div class="shop-action-grid">${actionCards.join('')}</div>
      ${itemCurrencies.length === 0 ? '' : `
        <div class="shop-action-cost">
          <span>Cost of the items above</span>
          <strong>${itemCurrencies.join(' + ')}</strong>
        </div>
      `}
      ${remaining.jadeBudgetExceeded > 0 ? `<div class="shop-action-warning"><strong>${formatNumber.format(remaining.jadeBudgetExceeded)} jades over the available budget</strong></div>` : ''}
    </section>
    <details class="shop-estimate-details">
      <summary>Estimate details</summary>
      <div class="shop-estimate-content">
        <section class="shop-results-section">
          <h3 class="shop-results-subheading">Rest of the event</h3>
          ${shop.jadeBudget === null ? '' : `<div class="result-line"><span>Remaining jade budget</span><strong>${formatNumber.format(shop.jadeBudgetAllocated)} available · ${formatNumber.format(shop.jadeBudgetRemaining)} left after planned spending</strong></div>`}
          <div class="result-line"><span>Days and resets remaining</span><strong>${formatNumber.format(remaining.days)} days + ${formatNumber.format(remaining.resets)} resets</strong></div>
          <div class="result-line"><span>Expected purchases, including items available for coins</span><strong>${shopItemSummary(remaining.fragments, shopFragmentLevels, 'fragments')} · ${shopItemSummary(remaining.maps, shopMapLevels, 'maps')}</strong></div>
          <div class="result-line"><span>Expected unrelated items available for coins</span><strong>${formatNumber.format(remaining.coinNonEventOffers)}</strong></div>
          <div class="result-line"><span>Value from remaining purchases</span><strong class="${remainingContributionClass}">${formatNumber.format(contribution.remaining.universal)} universal · ${formatNumber.format(contribution.remaining.elemental)} elemental · ${formatNumber.format(contribution.remaining.ownRuns)} own runs</strong></div>
        </section>
        <section class="shop-results-section entire-event-results">
          <h3 class="shop-results-subheading">Entire event</h3>
          <div class="result-line"><span>Days and resets</span><strong>${formatNumber.format(entire.days)} days + ${formatNumber.format(entire.resets)} resets</strong></div>
          <div class="result-line"><span>Fragments purchased</span><strong>${shopItemSummary(entire.fragments, shopFragmentLevels, 'fragments')}</strong></div>
          <div class="result-line"><span>Maps purchased</span><strong>${shopItemSummary(entire.maps, shopMapLevels, 'maps')}</strong></div>
          <div class="result-line"><span>Value from all shop purchases</span><strong class="${entireContributionClass}">${formatNumber.format(contribution.entire.universal)} universal · ${formatNumber.format(contribution.entire.elemental)} elemental · ${formatNumber.format(contribution.entire.ownRuns)} own runs</strong></div>
        </section>
      </div>
    </details>
  `;
}

function questRewardPieces(reward) {
  if (reward.fragment) return [{ kind: 'fragment', level: reward.fragment, amount: reward.count }];
  if (reward.ticket) return [{ kind: 'map', level: reward.ticket, amount: reward.count }];
  return [];
}

function renderQuestAwards(awards) {
  const totals = {};
  awards.flatMap(questRewardPieces).forEach(({ kind, level, amount }) => {
    const key = `${kind}:${level}`;
    totals[key] = (totals[key] || 0) + amount;
  });
  const entries = Object.entries(totals);
  if (!entries.length) return '-';
  return entries.map(([key, amount]) => {
    const [kind, level] = key.split(':');
    return kind === 'fragment'
      ? fragmentRewardHtml(level, amount)
      : mapRewardHtml(level, amount);
  }).join('');
}

function fragmentRewardHtml(level, amount) {
  return `<span class="quest-reward ${levelClass(level)}"><img src="${fragmentIconSrc(level)}" alt="${mapLabels[level] || 'Random'} fragment"><b>+${formatNumber.format(amount)}</b></span>`;
}

function mapRewardHtml(level, amount) {
  return `<span class="quest-reward map-reward ${levelClass(level)}"><b>${mapLabels[level] || 'Random'} map +${formatNumber.format(amount)}</b></span>`;
}

function isWeeklyResetStart(day) {
  const resetWeekday = document.getElementById('weeklyResetWeekday')?.value
    || state.config.eventDates.weeklyReset.weekday;
  const resetTime = document.getElementById('weeklyResetTimeUtc')?.value
    || state.config.eventDates.weeklyReset.timeUtc;
  return CalculationEngine.isWeeklyResetStart(
    firstGameDayStartUtc(),
    day,
    resetWeekday,
    resetTime,
  );
}

function collectShopStaticConfig() {
  const shop = JSON.parse(JSON.stringify(state.config.shop));
  shop.resetCosts = shop.resetCosts.map((cost, index) => {
    const wholeCost = Math.floor(numberValue(`shop-reset-cost-${index + 1}`, cost));
    document.getElementById(`shop-reset-cost-${index + 1}`).value = String(wholeCost);
    return wholeCost;
  });
  shopFragmentLevels.forEach((level) => {
    shop.prices.jades.fragments[level] = shop.prices.jades.fragments[level].map((offer) => {
      const cost = Math.floor(numberValue(
        `shop-price-jade-fragment-${level}-${offer.quantity}`,
        offer.cost,
      ));
      document.getElementById(`shop-price-jade-fragment-${level}-${offer.quantity}`).value = String(cost);
      return { ...offer, cost };
    });
  });
  shopMapLevels.forEach((level) => {
    const jadeMapCost = Math.floor(numberValue(
      `shop-price-jade-map-${level}`,
      shop.prices.jades.maps[level],
    ));
    const randomFragmentCost = Math.floor(numberValue(
      `shop-price-random-fragment-${level}`,
      shop.prices.randomFragments[level],
    ));
    document.getElementById(`shop-price-jade-map-${level}`).value = String(jadeMapCost);
    document.getElementById(`shop-price-random-fragment-${level}`).value = String(randomFragmentCost);
    shop.prices.jades.maps[level] = jadeMapCost;
    shop.prices.randomFragments[level] = randomFragmentCost;
  });
  shopSimpleProbabilityGroups.forEach(([group, , keys]) => {
    keys.forEach((key) => {
      shop.estimatedProbabilities[group][key] = numberValue(
        `shop-prob-${group}-${key}`,
        shop.estimatedProbabilities[group][key],
      );
    });
  });
  shopMatrixProbabilityGroups.forEach(([group, , levels]) => {
    levels.forEach((level) => {
      ['1', '2', '3'].forEach((quantity) => {
        shop.estimatedProbabilities[group][level][quantity] = numberValue(
          `shop-prob-${group}-${level}-${quantity}`,
          shop.estimatedProbabilities[group][level][quantity],
        );
      });
    });
  });
  return shop;
}

function collectShopOptions() {
  const strategy = clamp(numberValue('shopStrategy', 1), 0, 3);
  const resetsPerDay = Math.floor(clamp(
    numberValue('shopResetsPerDay'),
    0,
    state.config.shop.maxDailyResets,
  ));
  const jadeBudget = Math.floor(numberValue('shopJadeBudget'));
  document.getElementById('shopStrategy').value = String(strategy);
  document.getElementById('shopResetsPerDay').value = String(resetsPerDay);
  document.getElementById('shopJadeBudget').value = String(jadeBudget);
  return {
    enabled: strategy !== 0,
    strategy,
    resetsPerDay,
    jadeBudget,
    buyCoinItems: strategy !== 0,
    buyRandomFragmentOffers: strategy === 3,
    buyJadeFragments: strategy === 2 || strategy === 3,
    buyJadeMaps: strategy === 3,
  };
}

function collectCalculationConfig() {
  const config = JSON.parse(JSON.stringify(state.config));
  config.crafting.fragmentsPerMap = Math.max(
    1,
    Math.floor(numberValue('fragmentsPerMap', config.crafting.fragmentsPerMap)),
  );
  config.crafting.randomFragmentsPerMap = Math.max(
    1,
    Math.floor(numberValue('randomFragmentsPerMap', config.crafting.randomFragmentsPerMap)),
  );
  config.crafting.randomFragmentsPerDay = Math.floor(numberValue(
    'randomFragmentsPerDay',
    config.crafting.randomFragmentsPerDay,
  ));
  document.getElementById('fragmentsPerMap').value = String(config.crafting.fragmentsPerMap);
  document.getElementById('randomFragmentsPerMap').value = String(config.crafting.randomFragmentsPerMap);
  document.getElementById('randomFragmentsPerDay').value = String(config.crafting.randomFragmentsPerDay);

  dailyMemberRunLevels.forEach((level) => {
    config.joinLimits.daily[level] = Math.floor(numberValue(
      `member-daily-${level}`,
      config.joinLimits.daily[level],
    ));
    document.getElementById(`member-daily-${level}`).value = String(config.joinLimits.daily[level]);
  });
  fragmentReturnLevels.forEach((level) => {
    runKinds.forEach((runKind) => {
      const key = `${runKind}Run`;
      const returned = Math.min(
        config.crafting.fragmentsPerMap - 1,
        Math.floor(numberValue(
          `fragment-return-${runKind}-${level}`,
          config.fragmentRules[level][key],
        )),
      );
      config.fragmentRules[level][key] = returned;
      document.getElementById(`fragment-return-${runKind}-${level}`).value = String(returned);
    });
  });
  config.joinLimits.weekly.divine = Math.floor(numberValue(
    'member-weekly-divine',
    config.joinLimits.weekly.divine,
  ));
  config.fragmentRules.divine.weeklyCap = Math.floor(numberValue(
    'fragment-weekly-divine',
    config.fragmentRules.divine.weeklyCap,
  ));
  config.ownLimits.event.mythical = Math.floor(numberValue(
    'mythical-own-event',
    config.ownLimits.event.mythical,
  ));
  config.joinLimits.event.mythical = Math.floor(numberValue(
    'mythical-member-event',
    config.joinLimits.event.mythical,
  ));
  document.getElementById('member-weekly-divine').value = String(config.joinLimits.weekly.divine);
  document.getElementById('fragment-weekly-divine').value = String(config.fragmentRules.divine.weeklyCap);
  document.getElementById('mythical-own-event').value = String(config.ownLimits.event.mythical);
  document.getElementById('mythical-member-event').value = String(config.joinLimits.event.mythical);
  config.eventDates.weeklyReset.weekday = document.getElementById('weeklyResetWeekday').value;
  config.eventDates.weeklyReset.timeUtc = document.getElementById('weeklyResetTimeUtc').value
    || config.eventDates.weeklyReset.timeUtc;

  runKinds.forEach((runKind) => {
    rewardKinds.forEach((kind) => {
      config.mapLevels.forEach((level) => {
        config.rewards[runKind][level][kind] = getReward(runKind, level, kind);
      });
    });
  });
  config.quests = config.quests.map((quest, index) => {
    const rewardKind = document.getElementById(`quest-${index}-reward-kind`).value;
    const rewardLevel = document.getElementById(`quest-${index}-reward-level`).value;
    const threshold = Math.floor(numberValue(`quest-${index}-threshold`, quest.threshold));
    const count = Math.floor(numberValue(`quest-${index}-reward-count`, quest.reward.count));
    document.getElementById(`quest-${index}-threshold`).value = String(threshold);
    document.getElementById(`quest-${index}-reward-count`).value = String(count);
    return {
      ...quest,
      threshold,
      reward: {
        count,
        [rewardKind]: rewardLevel,
      },
    };
  });
  config.shop = collectShopStaticConfig();
  return config;
}

function collectManualEntries(eventDays) {
  const entries = {};
  for (let day = 1; day <= eventDays; day += 1) {
    const entry = {};
    [...inventoryFields, ...weeklyFields].forEach(([bucket, key]) => {
      const input = document.getElementById(fieldId(day, bucket, key));
      if (!input || input.value === '') return;
      entry[bucket] ||= {};
      const entered = Math.max(0, Number(input.value) || 0);
      entry[bucket][key] = bucket === 'shards' ? entered : Math.floor(entered);
    });
    [...mythicalFields, ...questFields].forEach(([bucket, key]) => {
      const input = document.getElementById(fieldId(day, bucket, key));
      if (!input?.checked) return;
      entry[bucket] ||= {};
      entry[bucket][key] = true;
    });
    if (Object.keys(entry).length > 0) entries[day] = entry;
  }
  return entries;
}

function conversionText(conversion) {
  const changes = [];
  if (conversion.universalGain > 0) {
    changes.push(`elemental -> universal: -${formatNumber.format(conversion.elementalSpent)} elemental, +${formatNumber.format(conversion.universalGain)} universal`);
  }
  if (conversion.elementalGain > 0) {
    changes.push(`universal -> elemental: -${formatNumber.format(conversion.universalSpent)} universal, +${formatNumber.format(conversion.elementalGain)} elemental`);
  }
  return changes.join('; ') || 'no conversion needed';
}

function engineConversionScenarios(result) {
  const scenarios = result.conversionScenarios;
  return [
    { label: 'Projected total without conversion', rewards: scenarios.withoutConversion, detail: 'Current inventory plus projected future gains' },
    { label: 'Convert elemental to universal', rewards: scenarios.toUniversal.rewards, detail: scenarios.toUniversal.universalGain > 0 ? `uses ${formatNumber.format(scenarios.toUniversal.elementalSpent)} elemental for ${formatNumber.format(scenarios.toUniversal.universalGain)} universal` : 'no useful conversion available' },
    { label: 'Convert universal to elemental', rewards: scenarios.toElemental.rewards, detail: scenarios.toElemental.elementalGain > 0 ? `uses ${formatNumber.format(scenarios.toElemental.universalSpent)} universal for ${formatNumber.format(scenarios.toElemental.elementalGain)} elemental` : 'no useful conversion available' },
  ];
}

function projectionShopContribution(result, withoutShop) {
  return {
    universal: result.rawRewards.universal - withoutShop.rawRewards.universal,
    elemental: result.rawRewards.elemental - withoutShop.rawRewards.elemental,
    ownRuns: runLevels.reduce(
      (sum, level) => sum + result.allRuns.own[level] - withoutShop.allRuns.own[level],
      0,
    ),
  };
}

function shopTargetShortfall(result, targets) {
  return {
    universal: Math.max(0, targets.universal - result.conversion.rewards.universal),
    elemental: Math.max(0, targets.elemental - result.conversion.rewards.elemental),
  };
}

function targetShortfallCovered(shortfall) {
  return shortfall.universal <= 0 && shortfall.elemental <= 0;
}

function targetShortfallImproved(candidate, current) {
  return candidate.universal < current.universal || candidate.elemental < current.elemental;
}

function analyzeShopTarget({
  result,
  calculationOptions,
  shopOptions,
  targets,
  currentDay,
  maxDailyResets,
}) {
  const missing = shopTargetShortfall(result, targets);
  if (targetShortfallCovered(missing)) {
    return { covered: true, missing, reason: '', action: '' };
  }

  const daysRemaining = result.daysRemaining;
  if (daysRemaining <= 0) {
    return {
      covered: false,
      missing,
      reason: 'There are no shop days remaining.',
      action: 'The missing shards must come from progress outside the shop, or the target must be changed.',
    };
  }

  if (shopOptions.strategy !== 3) {
    return {
      covered: false,
      missing,
      reason: 'The selected shop strategy is not designed to complete the shard targets.',
      action: 'Select “Best target value + all previous” to make purchases target the missing shards.',
    };
  }

  const hasJadeLimit = shopOptions.jadeBudget > 0;
  const canIncreaseResets = shopOptions.resetsPerDay < maxDailyResets;
  const simulate = (overrides) => {
    const projection = projectShopStrategy(
      calculationOptions,
      {
        ...shopOptions,
        ...overrides,
        startDay: currentDay + 1,
      },
      targets,
    );
    return shopTargetShortfall(projection.result, targets);
  };
  const withoutJadeLimit = hasJadeLimit
    ? simulate({ jadeBudget: 0 })
    : missing;
  const withMaximumResets = canIncreaseResets
    ? simulate({ resetsPerDay: maxDailyResets })
    : missing;
  const withBothLimitsRemoved = hasJadeLimit && canIncreaseResets
    ? simulate({ jadeBudget: 0, resetsPerDay: maxDailyResets })
    : (hasJadeLimit ? withoutJadeLimit : withMaximumResets);
  const budgetFixes = hasJadeLimit && targetShortfallCovered(withoutJadeLimit);
  const resetsFix = canIncreaseResets && targetShortfallCovered(withMaximumResets);
  const bothFix = targetShortfallCovered(withBothLimitsRemoved);
  const budgetHelps = hasJadeLimit && targetShortfallImproved(withoutJadeLimit, missing);
  const resetsHelp = canIncreaseResets && targetShortfallImproved(withMaximumResets, missing);

  if (budgetFixes && resetsFix) {
    return {
      covered: false,
      missing,
      reason: 'The current budget and reset setting leave too few useful purchases before the event ends.',
      action: 'Increase either Remaining jade budget or Resets per day until the warning clears.',
    };
  }
  if (budgetFixes) {
    return {
      covered: false,
      missing,
      reason: 'The remaining jade budget is too low for the required purchases.',
      action: 'Increase Remaining jade budget. The current number of resets is sufficient in the estimate.',
    };
  }
  if (resetsFix) {
    return {
      covered: false,
      missing,
      reason: `At ${formatNumber.format(shopOptions.resetsPerDay)} resets per day, too few useful offers are expected in the ${formatNumber.format(daysRemaining)} remaining days.`,
      action: hasJadeLimit
        ? 'Increase Resets per day. The current jade budget is sufficient in the estimate.'
        : 'Increase Resets per day.',
    };
  }
  if (bothFix) {
    return {
      covered: false,
      missing,
      reason: 'Both the remaining jade budget and the number of resets limit purchases before the event ends.',
      action: 'Increase both Remaining jade budget and Resets per day.',
    };
  }
  if (budgetHelps || resetsHelp) {
    return {
      covered: false,
      missing,
      reason: 'More budget or resets reduces the gap, but the shop estimate still cannot close it before the event ends.',
      action: 'Increase the useful limits, then plan to gain the remaining shards outside the shop.',
    };
  }
  return {
    covered: false,
    missing,
    reason: `Even unlimited jades and ${formatNumber.format(maxDailyResets)} resets per day do not provide enough expected shop value in the ${formatNumber.format(daysRemaining)} remaining days.`,
    action: 'Gain the missing shards outside the shop, lower the target, or update the End of Day inventory.',
  };
}

function calculateProjection() {
  if (!state.config) return;

  const eventDays = Math.floor(Math.max(1, numberValue('eventDays', state.config.seasons.summer.defaultDays)));
  const currentDay = currentEventDay(eventDays);
  const luckyElementalPerDay = numberValue('luckyElementalPerDay', state.config.luckyRewards?.elementalPerDay ?? 15);
  const targets = {
    universal: numberValue('targetUniversal', state.config.defaultTargets.universal),
    elemental: numberValue('targetElemental', state.config.defaultTargets.elemental),
  };
  const calculationConfig = collectCalculationConfig();
  const shopOptions = collectShopOptions();
  const calculationOptions = {
    config: calculationConfig,
    eventDays,
    gameDayStartUtc: firstGameDayStartUtc(),
    currentDay,
    luckyElementalPerDay,
    randomFragmentsPerDay: calculationConfig.crafting.randomFragmentsPerDay,
    randomStrategy: document.getElementById('randomStrategy').value,
    targets,
    includeMythicalOwner: document.getElementById('includeMythicalOwner').checked,
    includeMythicalMember: document.getElementById('includeMythicalMember').checked,
    manualEntries: collectManualEntries(eventDays),
    shopOptions,
    manualShopEntries: {},
  };
  const remainingProjection = projectShopStrategy(
    calculationOptions,
    { ...shopOptions, startDay: currentDay + 1 },
    targets,
  );
  const result = remainingProjection.result;
  const entireEventProjection = shopOptions.enabled
    ? projectShopStrategy(
      { ...calculationOptions, currentDay: 1, manualEntries: {} },
      { ...shopOptions, jadeBudget: 0, startDay: 1 },
      targets,
    )
    : remainingProjection;
  const shopContribution = {
    remaining: projectionShopContribution(result, remainingProjection.withoutShop),
    entire: projectionShopContribution(
      entireEventProjection.result,
      entireEventProjection.withoutShop,
    ),
  };
  const shopProjection = {
    ...result.shop,
    remaining: result.shop.all,
    entire: entireEventProjection.result.shop.all,
  };
  const shopTargetStatus = analyzeShopTarget({
    result,
    calculationOptions,
    shopOptions,
    targets,
    currentDay,
    maxDailyResets: calculationConfig.shop.maxDailyResets,
  });
  state.projectedDailyInventory = result.days;
  updateDailyPlaceholders(result.days);
  updateShopProjection(shopProjection, shopContribution, shopTargetStatus);
  syncMythicalIncludeControls(result.finalInventory);

  const conversion = { ...result.conversion, text: conversionText(result.conversion) };
  const totalRuns = state.config.mapLevels.reduce((sum, level) => sum + result.futureRuns.own[level] + result.futureRuns.member[level], 0);
  const randomMaps = result.days.slice(currentDay + 1).reduce((sum, day) => sum + (day?.crafted.random || 0), 0);
  const expectedLuckyElemental = result.daysRemaining * luckyElementalPerDay;
  const divineFragments = {
    projected: result.totalDivineWeeklyFragments,
    weeklyCap: calculationConfig.fragmentRules.divine.weeklyCap,
    weekBuckets: result.totalWeekBuckets,
  };

  updateSummary(result.conversion.rewards, result.rawRewards, targets, result.daysRemaining, eventDays, result.remainingWeekBuckets, conversion);
  updateUnusedRow(eventDays, result.finalInventory);
  updateProjectionList({
    rawProjectedRewards: result.rawRewards,
    projectedRewards: result.conversion.rewards,
    conversion,
    conversionScenarios: engineConversionScenarios(result),
    targets,
    random: { randomMaps },
    questRewards: result.questRewards,
    divineFragments,
    expectedLuckyElemental,
    daysRemaining: result.daysRemaining,
    currentDay,
    dayIsManual: result.days[currentDay]?.isManual,
    inventory: result.currentInventory,
    futureRewards: result.futureRewards,
    totalRuns,
    craftedTotal: result.craftedTotal,
  });
  updateBreakdown(result.futureRuns.own, result.futureRuns.member);
  updateStatus(currentDay, eventDays, result.currentGameDayEndUtc);
}

function syncMythicalIncludeControls(inventory) {
  const controls = [
    ['ownerDone', 'includeMythicalOwner'],
    ['memberDone', 'includeMythicalMember'],
  ];
  controls.forEach(([key, id]) => {
    const input = document.getElementById(id);
    const claimed = inventory.mythical[key];
    if (claimed) input.checked = true;
    input.disabled = claimed;
    input.closest('label')?.classList.toggle('forced-included', claimed);
  });
}

function updateUnusedRow(eventDays, currentInventory) {
  const finalInventory = state.projectedDailyInventory[eventDays]?.inventory;
  if (!finalInventory) return;
  const standardFragmentsPerMap = Math.max(
    1,
    Math.floor(numberValue('fragmentsPerMap', state.config.crafting.fragmentsPerMap)),
  );
  const randomFragmentsPerMap = Math.max(
    1,
    Math.floor(numberValue('randomFragmentsPerMap', state.config.crafting.randomFragmentsPerMap)),
  );
  ['common', 'epic', 'superior', 'divine', 'random'].forEach((level) => {
    const cell = document.getElementById(`unused-${level}`);
    if (!cell) return;
    const leftover = finalInventory.fragments[level] ?? 0;
    const perMap = level === 'random' ? randomFragmentsPerMap : standardFragmentsPerMap;
    const needed = leftover === 0 ? perMap : perMap - leftover;
    cell.textContent = `${formatNumber.format(leftover)} left / ${formatNumber.format(needed)} needed`;
  });

  const ownerCell = document.getElementById('unused-myth-owner');
  const memberCell = document.getElementById('unused-myth-member');
  const questsCell = document.getElementById('unused-all-quests');
  const weeklyFragmentsCell = document.getElementById('unused-weekly-divine-fragments');
  const weeklyRunsCell = document.getElementById('unused-weekly-divine-runs');
  if (ownerCell) ownerCell.textContent = currentInventory.mythical.ownerDone ? 'Claimed' : 'Unclaimed';
  if (memberCell) memberCell.textContent = currentInventory.mythical.memberDone ? 'Claimed' : 'Unclaimed';
  if (questsCell) questsCell.textContent = currentInventory.quests.allClaimed ? 'Claimed' : 'Projected';
  if (weeklyFragmentsCell) weeklyFragmentsCell.textContent = `${currentInventory.weekly.divineFragmentsReceived}/${divineFragmentWeeklyCap()}`;
  if (weeklyRunsCell) weeklyRunsCell.textContent = `${currentInventory.weekly.divineMemberRunsFinished}/${divineMemberWeeklyCap()}`;
}
function updateSummary(rewards, rawRewards, targets, days, totalDays, weeks, conversion) {
  document.getElementById('universalProjected').textContent = `${formatNumber.format(rewards.universal)}/${formatNumber.format(targets.universal)}`;
  document.getElementById('elementalProjected').textContent = `${formatNumber.format(rewards.elemental)}/${formatNumber.format(targets.elemental)}`;
  document.getElementById('daysRemaining').textContent = `${formatNumber.format(days)}/${formatNumber.format(totalDays)}`;
  document.getElementById('weeksRemaining').textContent = `${plural(weeks, 'week')} remaining after current week`;
  document.getElementById('universalRaw').textContent = `${formatNumber.format(rawRewards.universal)}/${formatNumber.format(targets.universal)} without conversion`;
  document.getElementById('elementalRaw').textContent = `${formatNumber.format(rawRewards.elemental)}/${formatNumber.format(targets.elemental)} without conversion`;

  const universalPercent = targets.universal ? clamp((rewards.universal / targets.universal) * 100, 0, 100) : 100;
  const elementalPercent = targets.elemental ? clamp((rewards.elemental / targets.elemental) * 100, 0, 100) : 100;
  document.getElementById('universalBar').style.width = `${universalPercent}%`;
  document.getElementById('elementalBar').style.width = `${elementalPercent}%`;
  document.getElementById('universalNeed').textContent = targetText(rewards.universal, targets.universal, rawRewards.universal, 'universal');
  document.getElementById('elementalNeed').textContent = targetText(rewards.elemental, targets.elemental, rawRewards.elemental, 'elemental');

  setTargetCardState(document.getElementById('universalProjected').closest('.metric-card'), rewards.universal, targets.universal);
  setTargetCardState(document.getElementById('elementalProjected').closest('.metric-card'), rewards.elemental, targets.elemental);
}
function targetText(projected, target, rawProjected, label) {
  const convertedDelta = projected - target;
  const rawDelta = rawProjected - target;
  const rawText = rawDelta >= 0 ? `${formatNumber.format(rawDelta)} extra without conversion` : `${formatNumber.format(Math.abs(rawDelta))} missing without conversion`;
  const convertedText = convertedDelta >= 0 ? `${formatNumber.format(convertedDelta)} extra with conversion` : `${formatNumber.format(Math.abs(convertedDelta))} missing with conversion`;
  return `${convertedText}; ${rawText}`;
}

function setTargetCardState(card, projected, target) {
  if (!card) return;
  card.classList.remove('target-missing', 'target-met', 'target-surplus');
  const delta = projected - target;
  if (delta < 0) card.classList.add('target-missing');
  else if (delta > target * 0.2) card.classList.add('target-surplus');
  else card.classList.add('target-met');
}
function updateProjectionList(details) {
  const universalGap = details.projectedRewards.universal - details.targets.universal;
  const elementalGap = details.projectedRewards.elemental - details.targets.elemental;

  document.getElementById('projectionList').innerHTML = `
    <section class="projection-section">
      <h3>Current inventory</h3>
      <div class="projection-section-lines">
        <div class="result-line"><span>Based on</span><strong>${details.dayIsManual ? `End ${details.currentDay} entry` : `End ${details.currentDay} projection`}</strong></div>
        <div class="result-line"><span>Universal now</span><strong>${formatNumber.format(details.inventory.shards.universal)}</strong></div>
        <div class="result-line"><span>Elemental now</span><strong>${formatNumber.format(elementalTotal(details.inventory.shards))}</strong></div>
      </div>
    </section>
    <section class="projection-section">
      <h3>Still to gain</h3>
      <div class="projection-section-lines">
        <div class="result-line"><span>Universal</span><strong>${formatNumber.format(details.futureRewards.universal)}</strong></div>
        <div class="result-line"><span>Elemental</span><strong>${formatNumber.format(details.futureRewards.elemental)}</strong></div>
        <div class="result-line">
          <span>Lucky elemental</span>
          <strong>${formatNumber.format(details.expectedLuckyElemental)} projected<small>Over the ${plural(details.daysRemaining, 'day')} left</small></strong>
        </div>
      </div>
    </section>
    <section class="projection-section">
      <h3>Projected event activity</h3>
      <div class="projection-section-lines">
        <div class="result-line"><span>Map runs remaining</span><strong>${formatNumber.format(details.totalRuns)}</strong></div>
        <div class="result-line">
          <span>Maps crafted from fragments</span>
          <strong>${formatNumber.format(details.craftedTotal)}<small>${formatNumber.format(details.random.randomMaps)} from random fragments</small></strong>
        </div>
        <div class="result-line">
          <span>Quest rewards for the event</span>
          <strong>${questRewardText(details.questRewards)}<small>${plural(details.questRewards.completed.length, 'quest milestone')} projected</small></strong>
        </div>
        <div class="result-line">
          <span>Divine fragments for the event</span>
          <strong>${formatNumber.format(details.divineFragments.projected)} projected<small>${formatNumber.format(details.divineFragments.weeklyCap)} per week × ${formatNumber.format(details.divineFragments.weekBuckets)} active weekly periods</small></strong>
        </div>
      </div>
    </section>
    <section class="projection-section">
      <h3>Target outcome</h3>
      <div class="projection-section-lines">
        <div class="result-line"><span>Conversion used</span><strong>${details.conversion.text}</strong></div>
        <div class="result-line"><span>Universal target</span><strong class="${universalGap >= 0 ? 'positive' : 'negative'}">${targetText(details.projectedRewards.universal, details.targets.universal, details.rawProjectedRewards.universal, 'universal')}</strong></div>
        <div class="result-line"><span>Elemental target</span><strong class="${elementalGap >= 0 ? 'positive' : 'negative'}">${targetText(details.projectedRewards.elemental, details.targets.elemental, details.rawProjectedRewards.elemental, 'elemental')}</strong></div>
      </div>
    </section>
    <details class="projection-details">
      <summary>Compare conversion options</summary>
      <div class="projection-details-content">
        ${details.conversionScenarios.map((scenario) => `
          <div class="result-line conversion-line">
            <span>${scenario.label}</span>
            <strong>${formatNumber.format(scenario.rewards.universal)} universal / ${formatNumber.format(scenario.rewards.elemental)} elemental<small>${scenario.detail}</small></strong>
          </div>
        `).join('')}
      </div>
    </details>
  `;
}

function updateBreakdown(ownRuns, memberRuns) {
  document.getElementById('breakdownTable').innerHTML = `
    <div class="table-row table-head">
      <span>Level</span>
      <span>Own runs</span>
      <span>Member runs</span>
    </div>
    ${state.config.mapLevels.map((level) => `
      <div class="table-row">
        <strong>${mapLabels[level]}</strong>
        <span>${formatNumber.format(ownRuns[level])}</span>
        <span>${formatNumber.format(memberRuns[level])}</span>
      </div>
    `).join('')}
  `;
}

function updateStatus(currentDay, eventDays, gameDayEndUtc) {
  const endLabel = gameDayEndUtc.toLocaleString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  document.getElementById('eventStatus').textContent = `Game day ${currentDay}/${eventDays} · ends ${endLabel} UTC`;
}

function initializeResponsiveDetails() {
  const collapseResults = window.matchMedia('(max-width: 760px)').matches;
  document.querySelectorAll('[data-mobile-collapsed]').forEach((details) => {
    details.open = !collapseResults;
  });
}

async function loadConfig() {
  const response = await fetch('data/event-config.json');
  if (!response.ok) {
    throw new Error('Could not load event-config.json');
  }
  state.config = await response.json();
}

async function boot() {
  initializeResponsiveDetails();
  try {
    await loadConfig();
    const savedState = readStoredState();
    document.getElementById('targetUniversal').value = state.config.defaultTargets.universal;
    document.getElementById('targetElemental').value = state.config.defaultTargets.elemental;
    document.getElementById('eventDays').value = state.config.seasons.summer.defaultDays;
    document.getElementById('luckyElementalPerDay').value = state.config.luckyRewards?.elementalPerDay ?? 15;
    document.getElementById('includeMythicalOwner').checked = true;
    document.getElementById('includeMythicalMember').checked = true;
    document.getElementById('hideSpecificElements').checked = Boolean(state.config.ui?.hideSpecificElements);
    document.getElementById('showQuestColumn').checked = Boolean(state.config.ui?.showQuestColumn);
    document.getElementById('showRunColumns').checked = Boolean(state.config.ui?.showRunColumns);
    document.getElementById('showPreviousInventoryRows').checked = false;
    document.getElementById('showFutureInventoryRows').checked = true;
    initializeDates();
    renderGeneralStaticConfig();
    renderShopStaticConfig();
    applyStoredState(savedState, { includeDaily: false });
    syncDatesFromInputs();
    renderDailyInventoryTable();
    renderRewardInputs();
    renderQuestConfig();
    applyStoredState(savedState);
    migrateLegacyJadeBudget(savedState);
    updateStaticRuleInputLimits();
    updateSpecificElementVisibility();
    updateQuestColumnVisibility();
    updateRunColumnVisibility();
    updateStaticConfigStatus();
    bindEvents();
    initializeMobileInventoryEditor();
    calculateProjection();
    saveAppState();
  } catch (error) {
    document.getElementById('eventStatus').textContent = 'Config error';
    document.body.insertAdjacentHTML('afterbegin', `<div class="error-banner">${error.message}</div>`);
  }
}

boot();
