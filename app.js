'use strict';

(() => {
  const t = I18N.t;

  // Stored in the database as these English keys; shown via t(`meal_${key}`).
  const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  const DEFAULT_GOAL = 2000;
  const GOAL_MIN = 500;
  const GOAL_MAX = 10000;
  const BACKUP_REMINDER_DAYS = 7;
  const DAY_MS = 86400000;

  // ---- Suggested daily calories ----
  // Calories to keep the same weight = resting calories (BMR) × activity level.
  //  - BMR: 国立健康・栄養研究所の式 (Ganpule et al. 2007), made from Japanese adults:
  //    (0.1238 + 0.0481×kg + 0.0234×cm − 0.0138×age − 0.5473×sexIndex) × 1000 / 4.186 kcal/day,
  //    sexIndex: men 1, women 2 ("prefer not to say" uses 1.5, halfway).
  //  - Activity: 厚生労働省「日本人の食事摂取基準（2025年版）」身体活動レベル 低い/ふつう/高い.
  const SEXES = ['female', 'male', 'none'];
  const SEX_INDEX = { male: 1, female: 2, none: 1.5 };
  const ACTIVITY = { low: 1.5, normal: 1.75, high: 2.0 };
  // How much to eat below/above that. 300 kcal a day is roughly 1 kg a month.
  const GOAL_TYPES = { lose: { adjust: -300 }, keep: { adjust: 0 }, gain: { adjust: 300 } };
  const GOAL_FLOOR = 1200; // never suggest less than this, or less than the person's BMR
  const AGE_MIN = 18; // the formula and BMI targets are for adults
  const AGE_MAX = 110;
  const HEIGHT_MIN = 100;
  const HEIGHT_MAX = 250;
  const REVIEW_KG = 3; // offer to review the goal after this much weight change

  // ---- BMI (Japanese standards, not the US/WHO ones) ----
  // Categories: 日本肥満学会 (JASSO) 肥満度分類 — obese from BMI 25 (US/WHO: 30).
  const BMI_CATEGORIES = [[18.5, 'under'], [25, 'normal'], [30, 'obese1'], [35, 'obese2'], [40, 'obese3'], [Infinity, 'obese4']];
  // Target range by age: 日本人の食事摂取基準（2025年版）「目標とするBMI」.
  const targetBmi = (age) => (age < 50 ? [18.5, 24.9] : age < 65 ? [20.0, 24.9] : [21.5, 24.9]);
  const PORTIONS = [
    { key: 'small', factor: 0.7, size: 32 },
    { key: 'normal', factor: 1, size: 48 },
    { key: 'large', factor: 1.4, size: 66 },
  ];
  // Portions saved by the earlier English-only version.
  const LEGACY_PORTIONS = { 'a small amount': 'small', 'a normal amount': 'normal', 'a lot': 'large' };
  const FOOD_GROUPS = Object.keys(FOOD_GROUP_NAMES).filter((g) => FOODS.some((f) => f.g === g));

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    screen: 'today',
    prev: 'today',
    date: todayKey(),
    goal: DEFAULT_GOAL,
    goalType: 'keep',
    goalDraft: DEFAULT_GOAL,
    goalFrom: 'onboarding', // 'onboarding' | 'more'
    suggested: false, // goalSet shows a suggestion (true) or just the current goal (false)
    // About the person (saved in settings once the goal is saved)
    sex: null, // 'female' | 'male' | 'none'
    birthYear: null, // asked as age, stored as a year so the age stays right over time
    heightCm: null,
    activity: null, // 'low' | 'normal' | 'high'
    ageDraft: null, // age typed on the "about you" screen but not yet confirmed
    bodyKg: null, // weight entered on the height/weight screen
    latestKg: null, // most recent saved weigh-in
    meal: defaultMeal(),
    food: null, // built-in food picked for the portion step
    query: '',
    mine: [], // the user's own past foods, most used first
    customName: '',
    notice: null, // { text, kind?, undo? }
    daysShown: 7,
    advanced: false,
  };
  let lastSeenToday = state.date;

  // ---------- Dates: always local time (YYYY-MM-DD), never UTC ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function toKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function todayKey() { return toKey(new Date()); }
  function fromKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(k, n) { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); }
  function longDate(k) {
    const d = fromKey(k);
    const opts = { weekday: 'long', day: 'numeric', month: 'long' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(I18N.locale, opts);
  }
  function shortDate(k) { return fromKey(k).toLocaleDateString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'short' }); }
  function dayTitle(k) {
    const today = todayKey();
    if (k === today) return t('today');
    if (k === addDays(today, -1)) return t('yesterday');
    return fromKey(k).toLocaleDateString(I18N.locale, { weekday: 'long' });
  }
  function dayLabel(k) {
    const today = todayKey();
    if (k === today) return t('today');
    if (k === addDays(today, -1)) return t('yesterday');
    return shortDate(k);
  }
  function timeOf(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString(I18N.locale, { hour: 'numeric', minute: '2-digit' });
  }
  // Calendar days, so a copy saved at 23:00 yesterday says "yesterday" this morning.
  function ago(iso) {
    const days = Math.round((fromKey(todayKey()) - fromKey(toKey(new Date(iso)))) / DAY_MS);
    if (days <= 0) return t('agoToday');
    if (days === 1) return t('agoYesterday');
    return t('agoDays', days);
  }
  function defaultMeal() {
    const h = new Date().getHours();
    if (h < 11) return 'Breakfast';
    if (h < 15) return 'Lunch';
    if (h >= 17 && h < 22) return 'Dinner';
    return 'Snack';
  }

  // ---------- Helpers ----------
  const fmt = (n) => Math.round(n).toLocaleString(I18N.locale);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const mealName = (m) => t(`meal_${m}`);
  const foodName = (f) => f[I18N.lang] || f.ja;
  const groupName = (g) => FOOD_GROUP_NAMES[g][I18N.lang] || FOOD_GROUP_NAMES[g].ja;
  const round50 = (n) => Math.round(n / 50) * 50;

  const ageNow = () => (state.birthYear ? new Date().getFullYear() - state.birthYear : null);
  const bmiOf = (kg, cm) => kg / ((cm / 100) ** 2);
  const bmiCategory = (bmi) => BMI_CATEGORIES.find(([limit]) => bmi < limit)[1];
  const profileReady = () => SEXES.includes(state.sex) && ageNow() >= AGE_MIN && state.heightCm > 0
    && state.bodyKg > 0 && ACTIVITY[state.activity] !== undefined;

  // Everything the goal screens need: BMR, daily need, BMI, warnings and the suggested goal.
  function plan(type) {
    if (!profileReady()) return null;
    const age = ageNow();
    const kg = state.bodyKg;
    const bmr = (0.1238 + 0.0481 * kg + 0.0234 * state.heightCm - 0.0138 * age - 0.5473 * SEX_INDEX[state.sex]) * 1000 / 4.186;
    const need = bmr * ACTIVITY[state.activity];
    const bmi = bmiOf(kg, state.heightCm);
    const [lo, hi] = targetBmi(age);
    let adjust = GOAL_TYPES[type].adjust;
    let warning = null;
    if (type === 'lose' && bmi < lo) { adjust = 0; warning = 'loseLowBmi'; } // already below the healthy range
    else if (type === 'gain' && bmi >= 25) { adjust = 0; warning = 'gainHighBmi'; } // already obese (Japanese standard)
    else if (type === 'lose' && age >= 65) warning = 'loseSenior'; // weight loss raises frailty risk
    const floor = Math.max(GOAL_FLOOR, Math.ceil(bmr / 50) * 50);
    const goal = Math.min(GOAL_MAX, Math.max(floor, round50(need + adjust)));
    return { age, bmr, need, bmi, lo, hi, category: bmiCategory(bmi), adjust, warning, goal };
  }

  // Loads the saved answers and latest weight into state (used on start and before goal screens).
  async function loadProfile() {
    const [sex, birthYear, heightCm, activity, latest] = await Promise.all([
      DB.getSetting('sex', null),
      DB.getSetting('birthYear', null),
      DB.getSetting('heightCm', null),
      DB.getSetting('activity', null),
      DB.getWeightBefore(addDays(todayKey(), 1)), // latest weigh-in up to today
    ]);
    state.sex = SEXES.includes(sex) ? sex : null;
    state.birthYear = Number.isInteger(birthYear) ? birthYear : null;
    state.heightCm = Number.isFinite(heightCm) ? heightCm : null;
    state.activity = ACTIVITY[activity] !== undefined ? activity : null;
    state.latestKg = latest ? latest.kg : null;
    state.bodyKg = state.latestKg;
  }

  const portionKcal = (food, p) => (food.kcal === 0 ? 0 : Math.max(1, Math.round((food.kcal * p.factor) / 10) * 10));
  function portionText(portion) {
    if (!portion) return '';
    const key = LEGACY_PORTIONS[portion] || portion;
    return PORTIONS.some((p) => p.key === key) ? t(`portion_${key}`) : portion;
  }

  // For search: full-width → half-width, katakana → hiragana, no spaces or brackets,
  // so "ラーメン", "らーめん" and "ﾗｰﾒﾝ" all match.
  function norm(s) {
    return String(s).normalize('NFKC').toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s()・、。,.]/g, '');
  }
  FOODS.forEach((f) => { f.search = norm(`${f.ja}${f.kana}${f.en}`); });

  // Accepts "72.4", "72,4", full-width "７２．４" (Japanese keyboard) and "1,200" (thousands).
  function parseNum(raw) {
    let s = String(raw).normalize('NFKC').trim();
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ''); // "1,200" → 1200
    else s = s.replace(',', '.'); // "72,4" → 72.4
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  function showError(err) {
    console.error(err);
    $('#error-text').textContent = t('error', (err && err.message) || err);
    $('#error-box').hidden = false;
  }

  function fieldError(id, text) {
    const el = document.getElementById(`${id}-error`);
    el.textContent = text;
    el.hidden = false;
    document.getElementById(id).focus();
  }

  // ---------- Small HTML pieces ----------
  const ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 10a4.5 4.5 0 0 1 7 0L12 13"/>',
    bowl: '<path d="M3 12h18a9 8 0 0 1-18 0z"/><path d="M8 8c0-1.5 1-2 1-3.5M12 8c0-1.5 1-2 1-3.5M16 8c0-1.5 1-2 1-3.5"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
    shield: '<path d="M12 3l7.5 3v6c0 4.5-3.2 7.6-7.5 9-4.3-1.4-7.5-4.5-7.5-9V6z"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18h2"/>',
    share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
  };
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  const topbar = (back, step = '') => `<div class="topbar">
      <button type="button" class="btn-back" data-act="go" data-to="${back}">${icon('back')}${t('back')}</button>
      ${step ? `<span class="muted step">${step}</span>` : ''}
    </div>`;

  function noticeHtml() {
    const n = state.notice;
    if (!n) return '';
    return `<div class="notice${n.kind === 'error' ? ' error' : ''}" role="status">
        ${n.kind === 'error' ? '' : icon('check')}<span class="notice-text">${esc(n.text)}</span>
        ${n.undo ? `<button type="button" class="btn-small" data-act="undo">${t('undo')}</button>` : ''}
      </div>`;
  }

  // Big number with − / + buttons. The number itself can also be typed.
  function stepper({ id, value, unit, step, min, max, decimals, label, bigStep, bigUnit }) {
    const data = `data-target="${id}" data-min="${min}" data-max="${max}" data-dec="${decimals}"`;
    return `<div class="card">
        <div class="stepper">
          <button type="button" class="btn-round" data-act="step" data-delta="-${step}" ${data} aria-label="${t('less')}">${icon('minus')}</button>
          <div class="stepper-value">
            <input id="${id}" class="big-number" type="text" inputmode="${decimals ? 'decimal' : 'numeric'}"
              value="${value}" aria-label="${label}" autocomplete="off" enterkeyhint="done">
            <div class="muted">${unit}</div>
          </div>
          <button type="button" class="btn-round" data-act="step" data-delta="${step}" ${data} aria-label="${t('more')}">${icon('plus')}</button>
        </div>
        ${bigStep ? `<div class="stepper-big">
          <button type="button" class="btn-small" data-act="step" data-delta="-${bigStep}" ${data}>${t('bigLess', bigStep, bigUnit)}</button>
          <button type="button" class="btn-small" data-act="step" data-delta="${bigStep}" ${data}>${t('bigMore', bigStep, bigUnit)}</button>
        </div>` : ''}
      </div>
      <p class="field-error" id="${id}-error" hidden></p>`;
  }

  const navRow = (act, iconName, title, sub) => `<button type="button" class="choice" data-act="go" data-to="${act}">
      ${icon(iconName, 'lead-icon')}
      <span class="choice-text"><b>${title}</b><span class="choice-sub">${sub}</span></span>
      ${icon('next')}
    </button>`;

  // ---------- Screens ----------
  const SCREENS = {
    async welcome() {
      return `<section class="screen center">
          <div class="app-badge">${icon('bowl')}</div>
          <h1 class="xl" tabindex="-1">${t('welcomeTitle')}</h1>
          <p class="lead muted">${t('welcomeLead')}</p>
          <button type="button" class="btn-primary" data-act="go" data-to="about">${t('welcomeStart')}</button>
          <button type="button" class="btn-text" data-act="set-lang" data-lang="${I18N.lang === 'ja' ? 'en' : 'ja'}">${icon('globe')}${t('otherLangName')}</button>
        </section>`;
    },

    async about() {
      const onboarding = state.goalFrom === 'onboarding';
      const age = state.ageDraft ?? ageNow() ?? 40;
      return `${topbar(onboarding ? 'welcome' : 'goalSet', onboarding ? t('step', 1, 5) : '')}
        <section class="screen">
          <h1 tabindex="-1">${t('aboutTitle')}</h1>
          <p class="muted">${t('aboutSub')}</p>
          <h2>${t('sexLabel')}</h2>
          <div class="stack">${SEXES.map((s) => `<button type="button" class="choice${state.sex === s ? ' on' : ''}" data-act="pick-sex" data-sex="${s}" aria-pressed="${state.sex === s}">
              <span class="choice-text"><b>${t(`sex_${s}`)}</b></span>${state.sex === s ? icon('check', 'accent') : ''}
            </button>`).join('')}</div>
          <p class="field-error" id="sex-error" hidden></p>
          <h2>${t('ageLabel')}</h2>
          ${stepper({ id: 'age-input', value: age, unit: t('ageUnit'), step: 1, min: AGE_MIN, max: AGE_MAX, decimals: 0, label: t('ageLabel'), bigStep: 10, bigUnit: t('ageUnit') })}
          <p class="muted small">${t('ageNote')}</p>
          <button type="button" class="btn-primary" data-act="about-next">${t('next')}</button>
        </section>`;
    },

    async body() {
      const onboarding = state.goalFrom === 'onboarding';
      const defaults = { female: [155, 52], male: [170, 65], none: [162, 58] }[state.sex] || [162, 58];
      const cm = state.heightCm ?? defaults[0];
      const kg = state.bodyKg ?? defaults[1];
      return `${topbar('about', onboarding ? t('step', 2, 5) : '')}
        <section class="screen">
          <h1 tabindex="-1">${t('bodyTitle')}</h1>
          <p class="muted">${t('bodySub')}</p>
          <h2>${t('heightLabel')}</h2>
          ${stepper({ id: 'height-input', value: Math.round(cm), unit: 'cm', step: 1, min: HEIGHT_MIN, max: HEIGHT_MAX, decimals: 0, label: t('heightLabel'), bigStep: 10, bigUnit: 'cm' })}
          <h2>${t('bodyWeightLabel')}</h2>
          ${stepper({ id: 'body-weight-input', value: kg.toFixed(1), unit: t('weighUnit'), step: 0.1, min: 20, max: 400, decimals: 1, label: t('weighAria'), bigStep: 1, bigUnit: 'kg' })}
          <p class="muted small">${t('bodyWeightNote')}</p>
          <button type="button" class="btn-primary" data-act="body-next">${t('next')}</button>
        </section>`;
    },

    async activity() {
      const onboarding = state.goalFrom === 'onboarding';
      return `${topbar('body', onboarding ? t('step', 3, 5) : '')}
        <section class="screen">
          <h1 tabindex="-1">${t('activityTitle')}</h1>
          <p class="muted">${t('activitySub')}</p>
          <div class="stack">
            ${Object.keys(ACTIVITY).map((key) => `<button type="button" class="choice${state.activity === key ? ' on' : ''}" data-act="pick-activity" data-activity="${key}">
                <span class="choice-text"><b>${t(`activity_${key}_title`)}</b><span class="choice-sub">${t(`activity_${key}_sub`)}</span></span>${icon('next')}
              </button>`).join('')}
          </div>
        </section>`;
    },

    async goalType() {
      const onboarding = state.goalFrom === 'onboarding';
      const p = plan('keep');
      const bmiBox = p ? `<div class="card">
            <div class="eyebrow">${t('bmiTitle')}</div>
            <p class="big-sentence">${t('bmiLine', p.bmi.toFixed(1), t(`bmi_${p.category}`))}</p>
            <p class="muted small">${t('bmiTarget', p.age, p.lo.toFixed(1), p.hi.toFixed(1))}</p>
            <p class="muted small">${t('bmiStandard')}</p>
          </div>` : '';
      return `${topbar('activity', onboarding ? t('step', 4, 5) : '')}
        <section class="screen">
          <h1 tabindex="-1">${t('goalTypeTitle')}</h1>
          ${bmiBox}
          <p class="muted">${t('goalTypeSub')}</p>
          <div class="stack">
            ${Object.keys(GOAL_TYPES).map((key) => `<button type="button" class="choice${state.goalType === key ? ' on' : ''}" data-act="pick-goal-type" data-type="${key}">
                <span class="choice-text"><b>${t(`goal_${key}_title`)}</b><span class="choice-sub">${t(`goal_${key}_sub`)}</span></span>${icon('next')}
              </button>`).join('')}
          </div>
        </section>`;
    },

    async goalSet() {
      const onboarding = state.goalFrom === 'onboarding';
      const type = GOAL_TYPES[state.goalType] ? state.goalType : 'keep';
      const p = state.suggested ? plan(type) : null;
      let warning = '';
      let basis = '';
      if (p) {
        if (p.warning) {
          warning = `<div class="warnbox"><div class="box-title">${t(`warn_${p.warning}_title`)}</div><div>${t(`warn_${p.warning}_text`, p.lo.toFixed(1))}</div></div>`;
        }
        let how = t('goalBasis', fmt(p.bmr), t(`activity_${state.activity}_title`), ACTIVITY[state.activity].toFixed(2), fmt(p.need));
        if (p.adjust < 0) how += `${t('goalAdjustLose', Math.abs(p.adjust))}`;
        if (p.adjust > 0) how += `${t('goalAdjustGain', p.adjust)}`;
        basis = `<p class="muted small">${how}</p><p class="muted small">${t('goalSource')}</p>`;
      }
      // When a warning replaced the lose/gain plan, the lead says "keep" so it matches the number.
      const leadType = p && p.adjust === 0 ? 'keep' : type;
      return `${topbar(state.suggested ? 'goalType' : 'more', onboarding ? t('step', 5, 5) : '')}
        <section class="screen">
          <h1 tabindex="-1">${onboarding ? t('goalTitleOnboarding') : t('goalTitleChange')}</h1>
          ${warning}
          <p class="lead">${state.suggested ? t(`goal_${leadType}_suggest`) : t('goalLeadChange')}</p>
          ${stepper({ id: 'goal-input', value: state.goalDraft, unit: t('goalUnit'), step: 50, min: GOAL_MIN, max: GOAL_MAX, decimals: 0, label: t('goalAria') })}
          ${basis}
          <p class="muted">${t('goalHint')}</p>
          ${onboarding ? '' : `<button type="button" class="btn-text" data-act="goal-help">${t('goalHelp')}</button>`}
          <button type="button" class="btn-primary" data-act="save-goal">${onboarding ? t('goalSaveOnboarding') : t('goalSaveChange')}</button>
        </section>`;
    },

    async today() {
      const date = state.date;
      const isToday = date === todayKey();
      const [foods, weight, lastWeight, lastBackup, foodCount, weightCount, goalWeight] = await Promise.all([
        DB.getFoodsByDate(date),
        DB.getWeight(date),
        DB.getWeightBefore(date),
        DB.getSetting('lastBackup', null),
        DB.count('foods'),
        DB.count('weights'),
        DB.getSetting('goalWeight', null),
      ]);

      // Offer to review the goal once weight has moved a few kg from when it was set.
      const nowKg = (weight || lastWeight || {}).kg;
      const kgChange = isToday && goalWeight && nowKg ? Math.round((nowKg - goalWeight) * 10) / 10 : 0;
      const needsReview = Math.abs(kgChange) >= REVIEW_KG;

      const total = foods.reduce((s, f) => s + f.kcal, 0);
      const left = state.goal - total;
      const over = left < 0;
      const pct = Math.min(100, (total / state.goal) * 100);

      const backupAge = lastBackup ? (Date.now() - new Date(lastBackup).getTime()) / DAY_MS : Infinity;
      const needsBackup = foodCount + weightCount > 0 && backupAge > BACKUP_REMINDER_DAYS;

      let weightSub;
      if (weight) weightSub = t(isToday ? 'weightSubToday' : 'weightSubPast', weight.kg.toFixed(1));
      else if (lastWeight) weightSub = t('weightSubLast', lastWeight.kg.toFixed(1), shortDate(lastWeight.date));
      else weightSub = t('weightSubNone');

      let summaryLabel;
      let summaryUnit;
      if (over) {
        summaryLabel = t('summaryOver');
        summaryUnit = t(isToday ? 'summaryUnitOverToday' : 'summaryUnitOverPast');
      } else {
        summaryLabel = t(isToday ? 'summaryLeftToday' : 'summaryLeftPast');
        summaryUnit = t(isToday ? 'summaryUnitLeftToday' : 'summaryUnitLeftPast');
      }

      const meals = MEALS.map((meal) => {
        const items = foods.filter((f) => f.meal === meal);
        const sub = items.reduce((s, f) => s + f.kcal, 0);
        return `<div class="card meal-card">
            <div class="meal-head"><span class="meal-name">${mealName(meal)}</span><span class="muted small">${items.length ? t('kcal', fmt(sub)) : ''}</span></div>
            ${items.length === 0 ? `<div class="muted">${t('nothingYet')}</div>` : items.map((f) => `<div class="item">
                <div class="item-main">
                  <div class="item-name">${esc(f.name)}</div>
                  <div class="muted small">${t('kcal', fmt(f.kcal))} · ${esc(portionText(f.portion) || timeOf(f.createdAt))}</div>
                </div>
                <button type="button" class="btn-small" data-act="remove" data-id="${f.id}" aria-label="${esc(t('removeAria', f.name))}">${t('remove')}</button>
              </div>`).join('')}
          </div>`;
      }).join('');

      return `<section class="screen">
          ${isToday ? '' : `<div class="warnbox">
            <div class="box-title">${t('pastDayTitle')}</div>
            <div class="day-arrows">
              <button type="button" class="btn-small" data-act="day" data-delta="-1">${icon('back')}${t('dayBefore')}</button>
              <button type="button" class="btn-small" data-act="day" data-delta="1">${t('dayAfter')}${icon('next')}</button>
            </div>
            <button type="button" class="btn-primary" data-act="tab" data-to="today">${t('backToToday')}</button>
          </div>`}

          <div class="day-head">
            <div>
              <h1 class="xl" tabindex="-1">${dayTitle(date)}</h1>
              <div class="muted">${longDate(date)}</div>
            </div>
            ${isToday ? `<button type="button" class="btn-text" data-act="day" data-delta="-1">${t('seeYesterday')}</button>` : ''}
          </div>

          ${noticeHtml()}

          <div class="card summary">
            <div class="summary-label">${summaryLabel}</div>
            <div class="summary-number${over ? ' over' : ''}">${fmt(Math.abs(left))}</div>
            <div>${summaryUnit}</div>
            <div class="bar"><div class="bar-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>
            <div class="muted small">${t(isToday ? 'eatenToday' : 'eatenPast', fmt(total), fmt(state.goal))}</div>
          </div>

          <div class="stack">
            <button type="button" class="btn-primary btn-xl" data-act="start-add">${icon('plus')}${t(isToday ? 'addToday' : 'addPast')}</button>
            <button type="button" class="btn-secondary" data-act="go" data-to="weigh">
              ${icon('scale')}
              <span class="choice-text"><span class="d-block">${t(isToday ? 'weighToday' : 'weighPast')}</span><span class="choice-sub">${weightSub}</span></span>
            </button>
          </div>

          ${isStandalone() ? '' : `<div class="warnbox">
            <div class="box-title">${t('installTitle')}</div>
            <div>${t('installText')}</div>
            <button type="button" class="btn-small" data-act="go" data-to="help">${t('showHow')}</button>
          </div>`}

          ${needsReview ? `<div class="warnbox">
            <div class="box-title">${t('reviewTitle')}</div>
            <div>${t('reviewText', `${kgChange > 0 ? '+' : '−'}${Math.abs(kgChange).toFixed(1)}`)}</div>
            <button type="button" class="btn-small" data-act="review-goal">${t('reviewButton')}</button>
          </div>` : ''}

          ${needsBackup ? `<div class="warnbox">
            <div class="box-title">${t('backupTitle')}</div>
            <div>${lastBackup ? t('backupLast', ago(lastBackup)) : t('backupNone')}</div>
            <button type="button" class="btn-small" data-act="go" data-to="backup">${t('showHow')}</button>
          </div>` : ''}

          <h2>${t(isToday ? 'ateToday' : 'atePast')}</h2>
          ${meals}
        </section>`;
    },

    async food() {
      state.mine = summarizeFoods(await DB.getAllFoods());
      const isToday = state.date === todayKey();
      return `${topbar('today', t('step', 1, 2))}
        <section class="screen">
          <h1 tabindex="-1">${t('foodTitle')}</h1>
          <div class="card row-card">
            <span>${t('addingTo')} <b>${mealName(state.meal)}</b>${isToday ? '' : t('addingToDate', shortDate(state.date))}</span>
            <button type="button" class="btn-text" data-act="go" data-to="meal">${t('change')}</button>
          </div>
          <div class="field">
            <label class="label" for="food-search">${t('searchLabel')}</label>
            <input id="food-search" class="input" type="search" placeholder="${t('searchPlaceholder')}" value="${esc(state.query)}" autocomplete="off" enterkeyhint="search">
          </div>
          <div id="food-results">${foodResults()}</div>
          <button type="button" class="btn-secondary center" data-act="start-custom">${t('cantFind')}</button>
        </section>`;
    },

    async meal() {
      const suggested = defaultMeal();
      return `${topbar('food')}
        <section class="screen">
          <h1 tabindex="-1">${t('mealTitle')}</h1>
          <div class="stack">
            ${MEALS.map((m) => `<button type="button" class="choice${m === state.meal ? ' on' : ''}" data-act="pick-meal" data-meal="${m}">
                <span class="choice-text"><b>${mealName(m)}</b>${m === suggested ? `<span class="choice-sub">${t('mealSuggested')}</span>` : ''}</span>
                ${m === state.meal ? icon('check', 'accent') : ''}
              </button>`).join('')}
          </div>
        </section>`;
    },

    async portion() {
      const f = state.food;
      if (!f) return SCREENS.food();
      return `${topbar('food', t('step', 2, 2))}
        <section class="screen">
          <h1 tabindex="-1">${t('portionTitle')}</h1>
          <p class="food-name">${esc(foodName(f))}</p>
          <div class="stack">
            ${PORTIONS.map((p, i) => `<button type="button" class="choice portion" data-act="pick-portion" data-idx="${i}">
                <span class="portion-pic"><span class="portion-dot" style="width:${p.size}px;height:${p.size}px"></span></span>
                <span class="choice-text"><b>${t(`portion_${p.key}`)}</b><span class="choice-sub">${t('about', fmt(portionKcal(f, p)))}</span></span>
              </button>`).join('')}
          </div>
          <p class="muted">${t('portionHint')}</p>
        </section>`;
    },

    async custom() {
      return `${topbar('food')}
        <section class="screen">
          <h1 tabindex="-1">${t('customTitle')}</h1>
          <div class="field">
            <label class="label" for="custom-name">${t('customName')}</label>
            <input id="custom-name" class="input" type="text" maxlength="60" placeholder="${t('customPlaceholder')}" value="${esc(state.customName)}" autocomplete="off" enterkeyhint="next">
          </div>
          <div class="field">
            <div class="label">${t('customKcal')}</div>
            ${stepper({ id: 'custom-kcal', value: 300, unit: t('customUnit'), step: 50, min: 1, max: 10000, decimals: 0, label: t('customAria') })}
          </div>
          <p class="muted">${t('customHint')}</p>
          <button type="button" class="btn-primary" data-act="add-custom">${t('customAdd')}</button>
        </section>`;
    },

    async weigh() {
      const date = state.date;
      const isToday = date === todayKey();
      const [w, prev] = await Promise.all([DB.getWeight(date), DB.getWeightBefore(date)]);
      const start = w ? w.kg : prev ? prev.kg : 60;
      let note;
      if (w) note = t('weighNoteSaved', w.kg.toFixed(1));
      else if (prev) note = t('weighNoteLast', prev.kg.toFixed(1), shortDate(prev.date));
      else note = t('weighNoteFirst');
      return `${topbar('today')}
        <section class="screen">
          <h1 tabindex="-1">${isToday ? t('weighTitleToday') : t('weighTitlePast', shortDate(date))}</h1>
          <p class="muted">${t('weighHelp')}</p>
          ${stepper({ id: 'weight-input', value: start.toFixed(1), unit: t('weighUnit'), step: 0.1, min: 20, max: 400, decimals: 1, label: t('weighAria'), bigStep: 1, bigUnit: 'kg' })}
          <p class="muted">${note}</p>
          <button type="button" class="btn-primary" data-act="save-weight">${t('weighSave')}</button>
          ${w ? `<button type="button" class="btn-text danger" data-act="remove-weight">${t('weighRemove')}</button>` : ''}
        </section>`;
    },

    async progress() {
      const [foods, weights] = await Promise.all([DB.getAllFoods(), DB.getAllWeights()]);
      const today = todayKey();

      // Weight (weights come back sorted by date, their key)
      const monthAgo = addDays(today, -30);
      const recentW = weights.filter((w) => w.date >= monthAgo && w.date <= today);
      let wSentence;
      let wDetail;
      if (!weights.length) {
        wSentence = t('wNone');
        wDetail = t('wNoneDetail');
      } else if (recentW.length < 2) {
        const last = weights[weights.length - 1];
        wSentence = t('wLast', last.kg.toFixed(1));
        wDetail = t('wLastDetail', shortDate(last.date));
      } else {
        const first = recentW[0];
        const last = recentW[recentW.length - 1];
        const diff = Math.round((last.kg - first.kg) * 10) / 10;
        const since = shortDate(first.date);
        if (diff < 0) wSentence = t('wLost', Math.abs(diff).toFixed(1), since);
        else if (diff > 0) wSentence = t('wGained', diff.toFixed(1), since);
        else wSentence = t('wSame', since);
        wDetail = t('wFromTo', first.kg.toFixed(1), last.kg.toFixed(1));
      }
      const lastWeighIns = weights.slice(-5).reverse();
      let bmiLine = '';
      if (weights.length && state.heightCm) {
        const bmi = bmiOf(weights[weights.length - 1].kg, state.heightCm);
        const age = ageNow();
        const [lo, hi] = targetBmi(age ?? 18);
        bmiLine = `<p class="muted">${t('bmiLine', bmi.toFixed(1), t(`bmi_${bmiCategory(bmi)}`))}${age ? ` · ${t('bmiTargetShort', lo.toFixed(1), hi.toFixed(1))}` : ''}</p>`;
      }

      // Calories per day
      const kcalByDay = new Map();
      for (const f of foods) kcalByDay.set(f.date, (kcalByDay.get(f.date) || 0) + f.kcal);
      const days = [];
      for (let i = 0; i < state.daysShown; i++) {
        const d = addDays(today, -i);
        days.push({ date: d, kcal: kcalByDay.get(d) });
      }
      const week = days.slice(0, 7).filter((d) => d.kcal !== undefined);
      const within = week.filter((d) => d.kcal <= state.goal).length;
      const maxV = Math.max(2600, state.goal * 1.25, ...days.map((d) => d.kcal || 0));
      const goalPct = (state.goal / maxV) * 100;
      let weekSentence;
      if (!week.length) weekSentence = t('weekNone');
      else if (week.length === 1) weekSentence = t(within ? 'weekOneWithin' : 'weekOneOver');
      else weekSentence = t('weekSome', within, week.length);

      return `<section class="screen">
          <h1 class="xl" tabindex="-1">${t('progressTitle')}</h1>
          ${noticeHtml()}
          <div class="card">
            <div class="eyebrow">${t('yourWeight')}</div>
            <p class="big-sentence">${wSentence}</p>
            <p class="muted">${wDetail}</p>
            ${bmiLine}
            ${lastWeighIns.length ? `<ul class="kv">${lastWeighIns.map((w) => `<li><span>${dayLabel(w.date)}</span><span>${w.kg.toFixed(1)} kg</span></li>`).join('')}</ul>` : ''}
          </div>
          <div class="card">
            <div class="eyebrow">${t('yourDays')}</div>
            <p class="big-sentence">${weekSentence}</p>
            <p class="muted small">${t('tapDay')}</p>
            ${days.map((d) => {
              const has = d.kcal !== undefined;
              const pct = has ? Math.max(2, (d.kcal / maxV) * 100) : 0;
              return `<button type="button" class="day-bar" data-act="open-day" data-date="${d.date}"
                  aria-label="${esc(t('dayAria', dayLabel(d.date), has ? fmt(d.kcal) : null))}">
                  <span class="day-bar-label">${dayLabel(d.date)}</span>
                  <span class="track">
                    <span class="fill${has && d.kcal > state.goal ? ' over' : ''}" style="width:${pct}%"></span>
                    <span class="goal-mark" style="left:${goalPct}%"></span>
                  </span>
                  <span class="day-bar-value">${has ? fmt(d.kcal) : '—'}</span>
                </button>`;
            }).join('')}
            <div class="legend">
              <span><i class="swatch"></i>${t('legendWithin')}</span>
              <span><i class="swatch over"></i>${t('legendOver')}</span>
              <span><i class="swatch goal"></i>${t('legendGoal', fmt(state.goal))}</span>
            </div>
            ${state.daysShown < 90 ? `<button type="button" class="btn-text" data-act="more-days">${t('moreDays')}</button>` : ''}
          </div>
        </section>`;
    },

    async more() {
      const lastBackup = await DB.getSetting('lastBackup', null);
      let extra = '';
      if (state.advanced) {
        const storage = navigator.storage || {};
        const [foodCount, weightCount, persisted, estimate] = await Promise.all([
          DB.count('foods'),
          DB.count('weights'),
          storage.persisted ? storage.persisted().catch(() => null) : null,
          storage.estimate ? storage.estimate().catch(() => null) : null,
        ]);
        const rows = [
          [t('kvHome'), isStandalone() ? t('yes') : t('no')],
          [t('kvProtected'), persisted === true ? t('yes') : persisted === false ? t('no') : t('unknown')],
          [t('kvFoods'), fmt(foodCount)],
          [t('kvWeighIns'), fmt(weightCount)],
        ];
        if (estimate && estimate.usage !== undefined) rows.push([t('kvSpace'), `${(estimate.usage / 1024).toFixed(0)} KB`]);
        extra = `<div class="card">
            <p class="muted small">${t('extraIntro')}</p>
            <button type="button" class="btn-small wide" data-act="export-csv">${t('exportCsv')}</button>
            <button type="button" class="btn-small wide" data-act="import">${t('importCopy')}</button>
            <ul class="kv">${rows.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join('')}</ul>
          </div>`;
      }
      return `<section class="screen">
          <h1 class="xl" tabindex="-1">${t('moreTitle')}</h1>
          ${noticeHtml()}
          <div class="stack">
            <button type="button" class="choice" data-act="open-goal">
              ${icon('target', 'lead-icon')}
              <span class="choice-text"><b>${t('changeGoal')}</b><span class="choice-sub">${t('goalNow', fmt(state.goal))}</span></span>
              ${icon('next')}
            </button>
            ${navRow('backup', 'shield', t('keepSafe'), lastBackup ? t('lastCopy', ago(lastBackup)) : t('noCopy'))}
            ${navRow('help', 'phone', t('homeScreen'), isStandalone() ? t('alreadyDone') : t('stepByStep'))}
            <button type="button" class="choice" data-act="set-lang" data-lang="${I18N.lang === 'ja' ? 'en' : 'ja'}">
              ${icon('globe', 'lead-icon')}
              <span class="choice-text"><b>${t('language')}</b><span class="choice-sub">${t('langName')} → ${t('otherLangName')}</span></span>
              ${icon('next')}
            </button>
          </div>
          <button type="button" class="btn-text" data-act="toggle-advanced">${state.advanced ? t('hideExtra') : t('showExtra')}</button>
          ${extra}
        </section>`;
    },

    async backup() {
      const lastBackup = await DB.getSetting('lastBackup', null);
      const age = lastBackup ? (Date.now() - new Date(lastBackup).getTime()) / DAY_MS : Infinity;
      let status;
      if (!lastBackup) status = `<div class="warnbox"><div class="box-title">${t('backupNotYet')}</div><div>${t('backupWeekly')}</div></div>`;
      else if (age > BACKUP_REMINDER_DAYS) status = `<div class="warnbox"><div class="box-title">${t('backupLastTitle', ago(lastBackup))}</div><div>${t('backupWeekly')}</div></div>`;
      else status = `<div class="okbox"><div class="box-title">${t('backupLastTitle', ago(lastBackup))}</div></div>`;
      return `${topbar('@prev')}
        <section class="screen">
          <h1 tabindex="-1">${t('backupScreenTitle')}</h1>
          <p class="lead">${t('backupLead')}</p>
          ${status}
          ${noticeHtml()}
          <button type="button" class="btn-primary" data-act="export-json">${t('backupSaveNow')}</button>
          <div class="card">
            <div class="box-title">${t('backupNextTitle')}</div>
            <p class="muted">${t('backupNextText')}</p>
          </div>
          <div class="card">
            <div class="box-title">${t('backupRestoreTitle')}</div>
            <p class="muted">${t('backupRestoreText')}</p>
          </div>
        </section>`;
    },

    async help() {
      const step = (n, body) => `<div class="card step-card"><span class="stepnum">${n}</span>${body}</div>`;
      return `${topbar('@prev')}
        <section class="screen">
          <h1 tabindex="-1">${t('helpTitle')}</h1>
          ${isStandalone()
            ? `<div class="okbox"><div class="box-title">${t('helpDoneTitle')}</div><div>${t('helpDoneText')}</div></div>`
            : `<p class="muted">${t('helpIntro')}</p>`}
          <div class="stack">
            ${step(1, `<p>${t('help1')}</p>`)}
            ${step(2, `<div class="stack"><p>${t('help2')}</p><span class="share-pic">${icon('share')}</span></div>`)}
            ${step(3, `<p>${t('help3')}</p>`)}
            ${step(4, `<p>${t('help4')}</p>`)}
          </div>
        </section>`;
    },
  };

  const TABS = ['today', 'progress', 'more'];

  // The user's own past foods, one per name (latest version), most used first.
  function summarizeFoods(all) {
    const byName = new Map();
    for (const f of all) {
      const key = norm(f.name);
      const when = f.createdAt || f.date;
      const e = byName.get(key);
      if (!e) byName.set(key, { key, name: f.name, kcal: f.kcal, portion: f.portion, count: 1, last: when });
      else {
        e.count += 1;
        if (when >= e.last) Object.assign(e, { name: f.name, kcal: f.kcal, portion: f.portion, last: when });
      }
    }
    return [...byName.values()].sort((a, b) => b.count - a.count || (b.last > a.last ? 1 : -1));
  }

  function foodResults() {
    const q = norm(state.query);
    const mineRow = (m, i) => `<button type="button" class="choice" data-act="add-again" data-idx="${i}">
        <span class="choice-text"><b>${esc(m.name)}</b><span class="choice-sub">${t('sameAsLast', fmt(m.kcal))}</span></span>
        ${icon('plus', 'accent')}
      </button>`;
    const builtRow = (f) => `<button type="button" class="choice" data-act="pick-food" data-idx="${FOODS.indexOf(f)}">
        <span class="choice-text"><b>${esc(foodName(f))}</b><span class="choice-sub">${t('about', fmt(f.kcal))}</span></span>
        ${icon('next')}
      </button>`;

    if (!q) {
      const usual = state.mine.slice(0, 4);
      return (usual.length ? `<h2>${t('oftenHave')}</h2><div class="stack">${usual.map(mineRow).join('')}</div>` : '')
        + FOOD_GROUPS.map((g) => `<h2>${esc(groupName(g))}</h2><div class="stack">${FOODS.filter((f) => f.g === g).map(builtRow).join('')}</div>`).join('');
    }

    const mine = state.mine.map((m, i) => [m, i]).filter(([m]) => m.key.includes(q));
    const mineKeys = new Set(mine.map(([m]) => m.key));
    const built = FOODS.filter((f) => f.search.includes(q) && !mineKeys.has(norm(foodName(f))));
    if (!mine.length && !built.length) {
      return `<p class="muted">${t('notFound', esc(state.query.trim()))}</p>`;
    }
    return `<h2>${t('matches')}</h2><div class="stack">${mine.map(([m, i]) => mineRow(m, i)).join('')}${built.map(builtRow).join('')}</div>`;
  }

  // ---------- Rendering & navigation ----------
  async function render() {
    $('#app').innerHTML = await SCREENS[state.screen]();
    const onTab = TABS.includes(state.screen);
    $('.tabbar').hidden = !onTab;
    document.body.classList.toggle('has-tabs', onTab);
    $$('.tabbar button').forEach((b) => {
      const on = b.dataset.to === state.screen;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  async function go(screen, extra = {}) {
    Object.assign(state, { prev: state.screen, notice: null }, extra);
    state.screen = screen;
    await render();
    window.scrollTo(0, 0);
    const h = $('#app h1');
    if (h) h.focus({ preventScroll: true });
  }

  async function addEntry(name, kcal, portion) {
    const food = { date: state.date, name, kcal, meal: state.meal, createdAt: new Date().toISOString() };
    if (portion) food.portion = portion;
    const id = await DB.addFood(food);
    const date = state.date === todayKey() ? null : shortDate(state.date);
    await go('today', {
      query: '',
      notice: { text: t('added', mealName(state.meal), date, name, fmt(kcal)), undo: { type: 'add', id } },
    });
  }

  // ---------- Dialogs ----------
  function confirmDialog(title, text, yesLabel) {
    return new Promise((resolve) => {
      const dlg = $('#confirm-dialog');
      const yes = $('#confirm-yes');
      const no = $('#confirm-no');
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      yes.textContent = yesLabel;
      const done = (ok) => {
        yes.onclick = null; no.onclick = null; dlg.onclose = null;
        if (dlg.open) dlg.close();
        resolve(ok);
      };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
      dlg.onclose = () => done(false);
      dlg.showModal();
    });
  }

  // ---------- Export / import ----------
  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // iPhone: opens the share sheet (choose "Save to Files"). Elsewhere: downloads.
  // Resolves true if the file was handed off, false if the user cancelled.
  async function saveFile(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return true;
      } catch (err) {
        if (err.name === 'AbortError') return false;
        // Safari needs a fresh tap if preparing the file took too long.
        if (err.name === 'NotAllowedError') return shareViaDialog(file);
      }
    }
    download(file);
    return true;
  }

  function shareViaDialog(file) {
    return new Promise((resolve) => {
      const dlg = $('#share-dialog');
      const goBtn = $('#share-dialog-go');
      const cancel = $('#share-dialog-cancel');
      // Every way out (Save, Cancel, or the dialog being dismissed) must resolve,
      // otherwise the app keeps ignoring taps while it waits.
      const done = (ok) => {
        goBtn.onclick = null; cancel.onclick = null; dlg.onclose = null;
        if (dlg.open) dlg.close();
        resolve(ok);
      };
      goBtn.onclick = () => navigator.share({ files: [file] }).then(() => done(true), () => done(false));
      cancel.onclick = () => done(false);
      dlg.onclose = () => done(false);
      dlg.showModal();
    });
  }

  async function exportBackup() {
    const data = await DB.exportAll();
    const file = new File([JSON.stringify(data, null, 2)], `food-diary-copy-${todayKey()}.json`, { type: 'application/json' });
    if (!(await saveFile(file))) return;
    await DB.setSetting('lastBackup', new Date().toISOString());
    state.notice = { text: t('copySaved') };
    await render();
  }

  async function exportCSV() {
    const [foods, weights] = await Promise.all([DB.getAllFoods(), DB.getAllWeights()]);
    const days = new Map();
    const row = (d) => days.get(d) || days.set(d, { kcal: 0, n: 0, kg: '' }).get(d);
    for (const f of foods) { const r = row(f.date); r.kcal += f.kcal; r.n += 1; }
    for (const w of weights) row(w.date).kg = w.kg.toFixed(1);
    const lines = ['date,total_kcal,food_entries,weight_kg'];
    for (const d of [...days.keys()].sort()) {
      const r = days.get(d);
      lines.push(`${d},${r.kcal},${r.n},${r.kg}`);
    }
    const file = new File([lines.join('\n') + '\n'], `food-diary-${todayKey()}.csv`, { type: 'text/csv' });
    if (await saveFile(file)) {
      state.notice = { text: t('csvSaved') };
      await render();
    }
  }

  // Validates a backup file and returns clean records (unknown fields dropped).
  function cleanBackup(d) {
    if (!d || d.app !== 'calorie-tracker' || !Array.isArray(d.foods) || !Array.isArray(d.weights)) {
      throw new Error(t('importNotCopy'));
    }
    const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const foods = d.foods.map((f, i) => {
      if (!f || !isDate(f.date) || typeof f.name !== 'string' || !Number.isFinite(f.kcal) || f.kcal < 0) {
        throw new Error(t('importFoodDamaged', i + 1));
      }
      const clean = {
        date: f.date,
        name: f.name.slice(0, 60),
        kcal: Math.round(f.kcal),
        meal: MEALS.includes(f.meal) ? f.meal : 'Snack',
        createdAt: typeof f.createdAt === 'string' ? f.createdAt : `${f.date}T12:00:00`,
      };
      if (typeof f.portion === 'string' && f.portion) clean.portion = f.portion.slice(0, 40);
      if (Number.isInteger(f.id) && f.id > 0) clean.id = f.id;
      return clean;
    });
    const weights = d.weights.map((w, i) => {
      if (!w || !isDate(w.date) || !Number.isFinite(w.kg) || w.kg <= 0) throw new Error(t('importWeightDamaged', i + 1));
      return { date: w.date, kg: w.kg, updatedAt: typeof w.updatedAt === 'string' ? w.updatedAt : `${w.date}T12:00:00` };
    });
    const settings = [{ key: 'onboarded', value: true }];
    const find = (key) => (d.settings || []).find((s) => s && s.key === key);
    const goal = find('goal');
    if (goal && Number.isInteger(goal.value) && goal.value >= GOAL_MIN && goal.value <= GOAL_MAX) settings.push({ key: 'goal', value: goal.value });
    const goalType = find('goalType');
    if (goalType && GOAL_TYPES[goalType.value]) settings.push({ key: 'goalType', value: goalType.value });
    const lang = find('lang');
    if (lang && (lang.value === 'ja' || lang.value === 'en')) settings.push({ key: 'lang', value: lang.value });
    const sex = find('sex');
    if (sex && SEXES.includes(sex.value)) settings.push({ key: 'sex', value: sex.value });
    const birthYear = find('birthYear');
    const thisYear = new Date().getFullYear();
    if (birthYear && Number.isInteger(birthYear.value) && birthYear.value >= thisYear - AGE_MAX && birthYear.value <= thisYear - AGE_MIN) {
      settings.push({ key: 'birthYear', value: birthYear.value });
    }
    const heightCm = find('heightCm');
    if (heightCm && Number.isFinite(heightCm.value) && heightCm.value >= HEIGHT_MIN && heightCm.value <= HEIGHT_MAX) {
      settings.push({ key: 'heightCm', value: heightCm.value });
    }
    const activity = find('activity');
    if (activity && ACTIVITY[activity.value] !== undefined) settings.push({ key: 'activity', value: activity.value });
    const goalWeight = find('goalWeight');
    if (goalWeight && Number.isFinite(goalWeight.value) && goalWeight.value > 0) settings.push({ key: 'goalWeight', value: goalWeight.value });
    return { foods, weights, settings, exportedAt: d.exportedAt };
  }

  async function importBackup(file) {
    let data;
    try {
      data = cleanBackup(JSON.parse(await file.text()));
    } catch (err) {
      state.notice = { kind: 'error', text: t('importBad', err instanceof SyntaxError ? t('importNotCopy') : err.message) };
      await render();
      return;
    }
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString(I18N.locale) : t('unknownDate');
    const ok = await confirmDialog(
      t('restoreTitle'),
      t('restoreText', when, fmt(data.foods.length), fmt(data.weights.length)),
      t('restoreYes'),
    );
    if (!ok) return;
    await DB.replaceAll(data);
    state.goal = await DB.getSetting('goal', DEFAULT_GOAL);
    state.goalType = await DB.getSetting('goalType', 'keep');
    await loadProfile();
    I18N.setLang(await DB.getSetting('lang', I18N.lang));
    state.date = todayKey();
    await go('today', { notice: { text: t('restored') } });
  }

  async function ensurePersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
        await navigator.storage.persist();
      }
    } catch (_) { /* not supported: data is still saved, just evictable */ }
  }

  // ---------- Button actions (data-act="...") ----------
  const actions = {
    go: (el) => go(el.dataset.to === '@prev' ? (state.prev === 'today' ? 'today' : 'more') : el.dataset.to),

    tab: (el) => {
      if (el.dataset.to === 'today') state.date = todayKey();
      return go(el.dataset.to);
    },

    'set-lang': async (el) => {
      I18N.setLang(el.dataset.lang);
      await DB.setSetting('lang', I18N.lang);
      await render();
    },

    step: (el) => {
      const input = document.getElementById(el.dataset.target);
      const dec = Number(el.dataset.dec);
      let v = parseNum(input.value);
      if (!Number.isFinite(v)) v = parseNum(input.defaultValue);
      if (!Number.isFinite(v)) v = Number(el.dataset.min);
      v = Math.min(Number(el.dataset.max), Math.max(Number(el.dataset.min), v + Number(el.dataset.delta)));
      input.value = v.toFixed(dec);
      document.getElementById(`${input.id}-error`).hidden = true;
    },

    // Goal
    'pick-sex': (el) => {
      state.ageDraft = $('#age-input').value; // keep a typed age across the redraw
      state.sex = el.dataset.sex;
      return render();
    },
    'about-next': () => {
      if (!SEXES.includes(state.sex)) {
        const err = $('#sex-error');
        err.textContent = t('sexMissing');
        err.hidden = false;
        err.scrollIntoView({ block: 'center' });
        return;
      }
      const age = parseNum($('#age-input').value);
      if (!(Number.isInteger(age) && age >= AGE_MIN && age <= AGE_MAX)) {
        fieldError('age-input', t('rangeError', AGE_MIN, AGE_MAX));
        return;
      }
      state.birthYear = new Date().getFullYear() - age;
      state.ageDraft = null;
      return go('body');
    },
    'body-next': () => {
      const cm = parseNum($('#height-input').value);
      if (!(cm >= HEIGHT_MIN && cm <= HEIGHT_MAX)) {
        fieldError('height-input', t('rangeError', HEIGHT_MIN, HEIGHT_MAX));
        return;
      }
      const kg = parseNum($('#body-weight-input').value);
      if (!(kg >= 20 && kg <= 400)) {
        fieldError('body-weight-input', t('weightRange', 20, 400));
        return;
      }
      state.heightCm = Math.round(cm);
      state.bodyKg = Math.round(kg * 10) / 10;
      return go('activity');
    },
    'pick-activity': (el) => { state.activity = el.dataset.activity; return go('goalType'); },
    'pick-goal-type': (el) => {
      state.goalType = el.dataset.type;
      const p = plan(el.dataset.type);
      state.goalDraft = p ? p.goal : DEFAULT_GOAL + GOAL_TYPES[el.dataset.type].adjust;
      return go('goalSet', { suggested: true });
    },
    'goal-help': () => go('about'),
    'open-goal': async () => {
      // Start from the saved answers, not ones from an earlier visit that was never saved.
      await loadProfile();
      return go('goalSet', { goalDraft: state.goal, goalFrom: 'more', suggested: false });
    },
    // From the "your weight has changed" reminder on Today.
    'review-goal': async () => {
      await loadProfile();
      return go('about', { goalFrom: 'more', suggested: false, goalDraft: state.goal });
    },
    'save-goal': async () => {
      const goal = parseNum($('#goal-input').value);
      if (!(Number.isInteger(goal) && goal >= GOAL_MIN && goal <= GOAL_MAX)) {
        fieldError('goal-input', t('rangeError', fmt(GOAL_MIN), fmt(GOAL_MAX)));
        return;
      }
      await DB.setSetting('goal', goal);
      await DB.setSetting('goalType', state.goalType);
      if (state.suggested && profileReady()) {
        await DB.setSetting('sex', state.sex);
        await DB.setSetting('birthYear', state.birthYear);
        await DB.setSetting('heightCm', state.heightCm);
        await DB.setSetting('activity', state.activity);
        // The weight entered during setup is today's weigh-in, unless it matches the last one.
        if (state.bodyKg !== state.latestKg) await DB.setWeight(todayKey(), state.bodyKg);
        await DB.setSetting('goalWeight', state.bodyKg);
        state.latestKg = state.bodyKg;
      }
      state.goal = goal;
      if (state.goalFrom === 'onboarding') {
        await DB.setSetting('onboarded', true);
        await DB.setSetting('lang', I18N.lang);
        await go('today', { notice: { text: t('allSet') } });
      } else {
        await go('more', { notice: { text: t('goalSaved', fmt(goal)) } });
      }
    },

    // Today
    day: (el) => {
      const d = addDays(state.date, Number(el.dataset.delta));
      state.date = d > todayKey() ? todayKey() : d;
      return go('today');
    },
    'open-day': (el) => { state.date = el.dataset.date; return go('today'); },
    remove: async (el) => {
      const food = await DB.getFood(Number(el.dataset.id));
      if (!food) return;
      await DB.deleteFood(food.id);
      state.notice = { text: t('removed', food.name), undo: { type: 'remove', food } };
      await render();
    },
    undo: async () => {
      const u = state.notice && state.notice.undo;
      if (!u) return;
      if (u.type === 'add') await DB.deleteFood(u.id);
      else await DB.addFood(u.food);
      state.notice = { text: t('undone') };
      await render();
    },

    // Adding food
    'start-add': () => go('food', { query: '', meal: defaultMeal() }),
    'pick-meal': (el) => go('food', { meal: el.dataset.meal }),
    'pick-food': (el) => {
      const food = FOODS[Number(el.dataset.idx)];
      // Nothing to ask about portions for tea or water.
      return food.kcal === 0 ? addEntry(foodName(food), 0) : go('portion', { food });
    },
    'pick-portion': (el) => {
      const p = PORTIONS[Number(el.dataset.idx)];
      return addEntry(foodName(state.food), portionKcal(state.food, p), p.key);
    },
    'add-again': (el) => {
      const m = state.mine[Number(el.dataset.idx)];
      return addEntry(m.name, m.kcal, m.portion);
    },
    'start-custom': () => go('custom', { customName: state.query.trim() }),
    'add-custom': () => {
      const name = $('#custom-name').value.trim().slice(0, 60) || t('customDefaultName');
      const kcal = Math.round(parseNum($('#custom-kcal').value));
      if (!(kcal >= 1 && kcal <= 10000)) {
        fieldError('custom-kcal', t('rangeError', 1, fmt(10000)));
        return;
      }
      return addEntry(name, kcal);
    },

    // Weight
    'save-weight': async () => {
      const kg = parseNum($('#weight-input').value);
      if (!(kg >= 20 && kg <= 400)) {
        fieldError('weight-input', t('weightRange', 20, 400));
        return;
      }
      const value = Math.round(kg * 10) / 10;
      await DB.setWeight(state.date, value);
      await go('today', { notice: { text: t('weightSaved', value.toFixed(1)) } });
    },
    'remove-weight': async () => {
      const ok = await confirmDialog(t('removeWeightTitle'), t('removeWeightText', shortDate(state.date)), t('removeWeightYes'));
      if (!ok) return;
      await DB.deleteWeight(state.date);
      await go('today', { notice: { text: t('weightRemoved') } });
    },

    // Progress / More
    'more-days': () => { state.daysShown += 7; return render(); },
    'toggle-advanced': () => { state.advanced = !state.advanced; return render(); },
    'export-json': () => exportBackup(),
    'export-csv': () => exportCSV(),
    import: () => $('#import-file').click(),
  };

  // ---------- Events ----------
  let working = false; // ignore extra taps while a save is in progress
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || working) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    working = true;
    Promise.resolve()
      .then(() => fn(el))
      .catch(showError)
      .finally(() => { working = false; });
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'food-search') {
      state.query = e.target.value;
      $('#food-results').innerHTML = foodResults();
    } else if (e.target.id === 'custom-name') {
      state.customName = e.target.value;
    } else if (e.target.classList.contains('big-number')) {
      const err = document.getElementById(`${e.target.id}-error`);
      if (err) err.hidden = true;
    }
  });

  // "Done" on the keyboard closes it. While a Japanese IME is still converting,
  // Enter confirms the kana/kanji instead, so leave that alone.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || !e.target.matches('input')) return;
    e.preventDefault();
    if (e.target.id === 'custom-name') $('#custom-kcal').focus();
    else e.target.blur();
  });

  $('#error-close').addEventListener('click', () => { $('#error-box').hidden = true; });

  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file).catch(showError);
  });

  // If the app stays open past midnight, move "Today" forward when it comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const today = todayKey();
    if (today === lastSeenToday) return;
    if (state.date === lastSeenToday) state.date = today;
    lastSeenToday = today;
    if (TABS.includes(state.screen)) render().catch(showError);
  });

  window.addEventListener('unhandledrejection', (e) => showError(e.reason));

  // ---------- Start ----------
  async function init() {
    I18N.setLang(I18N.defaultLang);
    try {
      await DB.open();
      const [goal, goalType, onboarded, lang, foodCount, weightCount] = await Promise.all([
        DB.getSetting('goal', DEFAULT_GOAL),
        DB.getSetting('goalType', 'keep'),
        DB.getSetting('onboarded', false),
        DB.getSetting('lang', null),
        DB.count('foods'),
        DB.count('weights'),
      ]);
      if (lang) I18N.setLang(lang);
      state.goal = goal;
      state.goalType = GOAL_TYPES[goalType] ? goalType : 'keep';
      await loadProfile();
      if (!onboarded) {
        if (foodCount + weightCount > 0) {
          // Existing users of the earlier version skip the welcome screens.
          await DB.setSetting('onboarded', true);
        } else {
          state.screen = 'welcome';
          state.goalFrom = 'onboarding';
        }
      }
    } catch (err) {
      $('#app').innerHTML = `<section class="screen"><div class="card">
          <h1>${t('fatalTitle')}</h1>
          <p>${t('fatalText')}</p>
          <p class="muted small">${esc(err.message || err)}</p>
        </div></section>`;
      return;
    }
    await render();
    await ensurePersistentStorage();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline support unavailable:', err));
    });
  }

  init().catch(showError);
})();
