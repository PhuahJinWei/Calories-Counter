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
  const KCAL_PER_KG_FAT = 7200; // widely used in Japan: about 7,200 kcal ≈ 1 kg of body fat
  const STEPS_MAX = 100000;
  // Daily step targets: 厚生労働省「健康づくりのための身体活動・運動ガイド2023」
  // (also 健康日本21 第三次): adults 8,000, aged 65 and over 6,000.
  const stepTarget = (age) => (age >= 65 ? 6000 : 8000);

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
  // Quick picks on the "type it in" screen, to help guess home-cooked dishes. Rough on purpose.
  const KCAL_PICKS = [
    { key: 'small', kcal: 100 },
    { key: 'medium', kcal: 300 },
    { key: 'large', kcal: 500 },
    { key: 'meal', kcal: 700 },
  ];

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
    group: 'all', // food type chip on the food screen
    mine: [], // the user's own past foods, most used first
    customName: '',
    entry: null, // logged food being edited
    dish: null, // own dish being edited
    notice: null, // { text, kind?, undo? }
    // My progress: one period for the whole screen
    balMode: 'week', // 'week' | 'month'
    balWeek: null, // Monday of the week shown (null = this week)
    calMonth: todayKey().slice(0, 7), // 'YYYY-MM' of the month shown
    calMode: 'kcal', // what the month calendar shows: 'kcal' | 'weight' | 'steps'
    advanced: false,
    helpOs: null, // install guide shown on the help screen (null = this phone's)
    theme: 'auto', // 'auto' (follow the iPhone) | 'light' | 'dark'
  };
  let lastSeenToday = state.date;

  // ---------- Light / dark ----------
  // The setting is saved in the database (so it is in backups) and copied to
  // localStorage, which the small script in index.html reads before the page is drawn.
  const THEMES = ['auto', 'light', 'dark'];
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  function applyTheme(pref) {
    state.theme = THEMES.includes(pref) ? pref : 'auto';
    const dark = state.theme === 'dark' || (state.theme === 'auto' && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    // The bar at the top of the screen takes the background colour.
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
    try { localStorage.setItem('theme', state.theme); } catch (_) { /* storage blocked: still works for this visit */ }
  }

  // "Automatic" follows the iPhone even if it switches while the app is open.
  darkQuery.addEventListener('change', () => { if (state.theme === 'auto') applyTheme('auto'); });

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
  // Which phone this is, so guides and wording fit (newer iPads report themselves as Macs with touch).
  const PLATFORM = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'other';
  // Android Chrome can install the app in one tap. It offers that through this event,
  // which is kept for the "install" button. iPhone has no such option, so it gets the steps.
  let installPrompt = null;
  const installScreens = ['welcome', 'help'];
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    if (installScreens.includes(state.screen)) render().catch(showError);
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    if (installScreens.includes(state.screen)) render().catch(showError);
  });
  const mealName = (m) => t(`meal_${m}`);
  const foodName = (f) => f[I18N.lang] || f.ja;
  const groupName = (g) => FOOD_GROUP_NAMES[g][I18N.lang] || FOOD_GROUP_NAMES[g].ja;
  const round50 = (n) => Math.round(n / 50) * 50;

  const ageNow = () => (state.birthYear ? new Date().getFullYear() - state.birthYear : null);
  const bmiOf = (kg, cm) => kg / ((cm / 100) ** 2);
  const bmiCategory = (bmi) => BMI_CATEGORIES.find(([limit]) => bmi < limit)[1];
  // Everything except weight is known (weight changes day to day, so it is passed in).
  const canEstimateNeed = () => SEXES.includes(state.sex) && ageNow() >= AGE_MIN && state.heightCm > 0
    && ACTIVITY[state.activity] !== undefined;
  const profileReady = () => canEstimateNeed() && state.bodyKg > 0;
  const bmrFor = (kg) => (0.1238 + 0.0481 * kg + 0.0234 * state.heightCm - 0.0138 * ageNow()
    - 0.5473 * SEX_INDEX[state.sex]) * 1000 / 4.186;
  // Calories a day to stay at this weight.
  const maintenanceFor = (kg) => bmrFor(kg) * ACTIVITY[state.activity];

  // Everything the goal screens need: BMR, daily need, BMI, warnings and the suggested goal.
  function plan(type) {
    if (!profileReady()) return null;
    const age = ageNow();
    const kg = state.bodyKg;
    const bmr = bmrFor(kg);
    const need = maintenanceFor(kg);
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
  // On the Today list only unusual portions are worth a word; "normal" says nothing.
  const portionNote = (portion) => ((LEGACY_PORTIONS[portion] || portion) === 'normal' ? '' : portionText(portion));

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
    scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M7.5 10a6 6 0 0 1 9 0"/><path d="M12 13.5l2-3"/>',
    bowl: '<path d="M3 12h18a9 8 0 0 1-18 0z"/><path d="M8 8c0-1.5 1-2 1-3.5M12 8c0-1.5 1-2 1-3.5M16 8c0-1.5 1-2 1-3.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    apple: '<path d="M12 7c-1.5-1.2-5-1.6-6.5 1.2C4 11 5.2 16.5 8 19c1.4 1.2 2.6.8 4 .2 1.4.6 2.6 1 4-.2 2.8-2.5 4-8 2.5-10.8C17 5.4 13.5 5.8 12 7z"/><path d="M12 7c0-2 1-3.5 2.5-4"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
    shield: '<path d="M12 3l7.5 3v6c0 4.5-3.2 7.6-7.5 9-4.3-1.4-7.5-4.5-7.5-9V6z"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18h2"/>',
    share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
    close: '<path d="M7 7l10 10M17 7L7 17"/>',
    dots: '<circle cx="12" cy="5" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>',
    steps: '<path d="M8 3c1.7 0 2.5 1.8 2.5 4S9.7 11.5 8 11.5 5.5 9.2 5.5 7 6.3 3 8 3z"/><path d="M6 14.5h4l-.4 2.5a1.6 1.6 0 0 1-3.2 0z"/><path d="M16 7.5c1.7 0 2.5 1.8 2.5 4S17.7 16 16 16s-2.5-2.3-2.5-4.5.8-4 2.5-4z"/><path d="M14 19h4l-.4 2a1.6 1.6 0 0 1-3.2 0z"/>',
    contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  };
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  // Each meal and theme has an icon on a neutral tile (colour is kept for things with meaning).
  const MEAL_STYLE = {
    Breakfast: { tile: 't-neutral', icon: 'sun' },
    Lunch: { tile: 't-neutral', icon: 'bowl' },
    Dinner: { tile: 't-neutral', icon: 'moon' },
    Snack: { tile: 't-neutral', icon: 'apple' },
  };
  const THEME_STYLE = {
    auto: { tile: 't-neutral', icon: 'contrast' },
    light: { tile: 't-neutral', icon: 'sun' },
    dark: { tile: 't-neutral', icon: 'moon' },
  };

  // One row in a grouped card: coloured icon tile, title, subtitle, chevron.
  const listRow = (attrs, tile, iconName, title, sub) => `<button type="button" class="list-row" ${attrs}>
      <span class="tile ${tile}">${icon(iconName)}</span>
      <span class="list-main"><span class="list-title">${title}</span><span class="list-sub">${sub}</span></span>
      ${icon('next')}
    </button>`;

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
  function stepper({ id, value, unit, step, min, max, decimals, label }) {
    const data = `data-target="${id}" data-min="${min}" data-max="${max}" data-dec="${decimals}"`;
    const shown = decimals ? value : fmt(Number(value)); // "1,650", like every other number in the app
    return `<div class="card">
        <div class="stepper">
          <button type="button" class="btn-round" data-act="step" data-delta="-${step}" ${data} aria-label="${t('less')}">${icon('minus')}</button>
          <div class="stepper-value">
            <input id="${id}" class="big-number" type="text" inputmode="${decimals ? 'decimal' : 'numeric'}"
              value="${shown}" aria-label="${label}" autocomplete="off" enterkeyhint="done">
            <div class="muted">${unit}</div>
          </div>
          <button type="button" class="btn-round" data-act="step" data-delta="${step}" ${data} aria-label="${t('more')}">${icon('plus')}</button>
        </div>
      </div>
      <p class="field-error" id="${id}-error" hidden></p>`;
  }

  // ---------- My progress ----------
  // One 週/月 switch and one ‹ › drive the whole screen. The week view shows a bar per day,
  // the month view shows the calendar; both share one summary, so each number appears once.
  // Explanations and sources sit behind one "how these numbers work" link.

  // Weeks run Monday to Sunday, the same as the week strip on the Today screen.
  const mondayOf = (k) => addDays(k, -((fromKey(k).getDay() + 6) % 7));

  // Charts are drawn in a 300-unit-wide SVG that fills the card (about 300–330px on a phone),
  // so 13–14 units of text ≈ 13–14px on screen.
  const CHART_W = 300;
  const CHART_PAD = 4;

  // The week or month being shown, kept between the first entry and today.
  function progressPeriod(foods, weights, steps) {
    const today = todayKey();
    let first = today;
    for (const f of foods) if (f.date < first) first = f.date;
    if (weights.length && weights[0].date < first) first = weights[0].date;
    for (const s of steps) if (s.date < first) first = s.date;

    if (state.balMode === 'week') {
      const thisWeek = mondayOf(today);
      let start = state.balWeek || thisWeek;
      if (start > thisWeek) start = thisWeek;
      if (start < mondayOf(first)) start = mondayOf(first);
      state.balWeek = start;
      const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      const md = (k) => fromKey(k).toLocaleDateString(I18N.locale, { month: 'numeric', day: 'numeric' });
      return { isWeek: true, dates, title: t('balRange', md(dates[0]), md(dates[6])), atStart: start <= mondayOf(first), atEnd: start >= thisWeek };
    }
    const thisMonth = today.slice(0, 7);
    const firstMonth = first.slice(0, 7);
    const month = state.calMonth < firstMonth ? firstMonth : state.calMonth > thisMonth ? thisMonth : state.calMonth;
    state.calMonth = month;
    const [y, m] = month.split('-').map(Number);
    const dates = Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${pad(i + 1)}`);
    const title = new Date(y, m - 1, 1).toLocaleDateString(I18N.locale, { year: 'numeric', month: 'long' });
    return { isWeek: false, month, dates, title, atStart: month <= firstMonth, atEnd: month >= thisMonth };
  }

  // Totals for a set of days, compared with the calories that keep the person's weight
  // (worked out from each day's own weight). Without height/age/activity the goal is used.
  function periodStats(dates, foods, weights) {
    const today = todayKey();
    const inPeriod = new Set(dates);
    const kcalByDay = new Map();
    for (const f of foods) if (inPeriod.has(f.date)) kcalByDay.set(f.date, (kcalByDay.get(f.date) || 0) + f.kcal);
    const kgOn = (d) => {
      let kg = weights.length ? weights[0].kg : state.latestKg;
      for (const w of weights) { if (w.date > d) break; kg = w.kg; }
      return kg;
    };
    const estimate = canEstimateNeed() && (weights.length > 0 || state.latestKg > 0);
    const days = dates.map((d) => ({
      d,
      kcal: d > today ? undefined : kcalByDay.get(d),
      keep: estimate ? maintenanceFor(kgOn(d)) : state.goal,
    }));
    // Days with nothing written down are left out, not counted as a full deficit.
    const logged = days.filter((x) => x.kcal !== undefined);
    const periodWeights = weights.filter((w) => inPeriod.has(w.date));
    return {
      estimate,
      days,
      logged,
      balance: Math.round(logged.reduce((s, x) => s + (x.keep - x.kcal), 0)), // + = ate less
      within: logged.filter((x) => x.kcal <= state.goal).length,
      avgKcal: logged.length ? logged.reduce((s, x) => s + x.kcal, 0) / logged.length : null,
      avgKeep: logged.length ? logged.reduce((s, x) => s + x.keep, 0) / logged.length
        : estimate ? maintenanceFor(kgOn(today)) : state.goal,
      kgChange: periodWeights.length >= 2
        ? Math.round((periodWeights[periodWeights.length - 1].kg - periodWeights[0].kg) * 10) / 10 : null,
    };
  }

  const signedKg = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)} kg`;

  // Headline, three numbers, then the week's bars or the month's calendar.
  function summaryCard(period, stats, foods, weights, steps) {
    let headline;
    if (!stats.logged.length) headline = `<p class="sum-empty">${t('balNone')}</p>`;
    else {
      const amount = Math.abs(stats.balance);
      const even = amount < 50;
      const less = stats.balance > 0;
      // Small label above, big number below: reads top-down and never wraps mid-phrase.
      headline = `<div class="bal-label">${t(stats.estimate ? 'balLabel' : 'balLabelGoal')}</div>
        <div class="bal-total${even ? '' : less ? ' under' : ' over'}">${even ? t('balEven') : t(less ? 'balLess' : 'balMore', fmt(amount))}</div>
        ${even || !stats.estimate ? '' : `<div class="bal-sub">${t(less ? 'balFatLoss' : 'balFatGain', (amount / KCAL_PER_KG_FAT).toFixed(1))}</div>`}`;
    }
    const tiles = [
      [stats.avgKcal === null ? '—' : fmt(stats.avgKcal), t('sumAvg')],
      [stats.logged.length ? t('calWithinValue', stats.within, stats.logged.length) : '—', t('sumWithin')],
      [stats.kgChange === null ? '—' : signedKg(stats.kgChange), t('sumWeight')],
    ];
    return `<div class="card sum-card">
        ${headline}
        <div class="sum-tiles">${tiles.map(([v, l]) => `<div class="sum-tile"><div class="sum-v">${v}</div><div class="sum-l">${l}</div></div>`).join('')}</div>
        ${period.isWeek ? weekChart(stats) : calendarGrid(period.month, foods, weights, steps)}
      </div>`;
  }

  // One bar per day for calories eaten, coloured like the calendar (rose = within goal,
  // amber = over), with the goal and "maintain" lines labelled right on the chart.
  // Each bar shows its number and opens that day when tapped.
  function weekChart(stats) {
    if (!stats.logged.length) return '';
    const today = todayKey();
    const W = CHART_W;
    const H = 200;
    const right = W - 42; // labels for the lines sit to the right of the bars
    const top = 24;
    const base = H - 30;
    const max = Math.max(state.goal, stats.avgKeep, ...stats.logged.map((x) => x.kcal)) * 1.08;
    const y = (v) => base - (v / max) * (base - top);
    const slot = (right - CHART_PAD) / 7;
    const barW = slot * 0.62;
    const cols = stats.days.map((x, i) => {
      const cx = CHART_PAD + slot * (i + 0.5);
      const label = `<text class="chart-label" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${fromKey(x.d).toLocaleDateString(I18N.locale, { weekday: 'narrow' })}</text>`;
      if (x.d > today) return label;
      if (x.kcal === undefined) return `${label}<text class="chart-empty" x="${cx.toFixed(1)}" y="${base - 6}" text-anchor="middle">—</text>`;
      const over = x.kcal > state.goal;
      const by = y(x.kcal);
      return `<g class="chart-col" data-act="open-day" data-date="${x.d}" role="button" aria-label="${esc(t('calAriaKcal', longDate(x.d), fmt(x.kcal), over))}">
          <rect class="chart-hit" x="${(cx - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}"/>
          <rect class="chart-bar ${over ? 'over' : 'ok'}" x="${(cx - barW / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, base - by).toFixed(1)}" rx="6"/>
          <text class="chart-value" x="${cx.toFixed(1)}" y="${(by - 7).toFixed(1)}" text-anchor="middle">${fmt(x.kcal)}</text>
          ${label}
        </g>`;
    }).join('');
    const goalY = y(state.goal);
    let keepY = stats.estimate ? y(stats.avgKeep) : null;
    // Keep the two line labels from overlapping when the values are close.
    let keepLabelY = keepY;
    if (keepY !== null && Math.abs(keepY - goalY) < 15) keepLabelY = keepY < goalY ? goalY - 15 : goalY + 15;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(t('balChartAria'))}">
        <line class="chart-base" x1="${CHART_PAD}" x2="${right}" y1="${base}" y2="${base}"/>
        ${keepY !== null ? `<line class="chart-keep" x1="${CHART_PAD}" x2="${right}" y1="${keepY.toFixed(1)}" y2="${keepY.toFixed(1)}"/>
          <text class="chart-line-label keep" x="${W - 2}" y="${(keepLabelY + 5).toFixed(1)}" text-anchor="end">${t('chartKeepLabel')}</text>` : ''}
        <line class="chart-goal" x1="${CHART_PAD}" x2="${right}" y1="${goalY.toFixed(1)}" y2="${goalY.toFixed(1)}"/>
        <text class="chart-line-label goal" x="${W - 2}" y="${(goalY + 5).toFixed(1)}" text-anchor="end">${t('chartGoalLabel')}</text>
        ${cols}
      </svg>`;
  }

  // Month calendar (weeks start on Sunday, like Japanese calendars). Calories mode marks
  // each day ○ (within goal) or △ (over); weight and steps modes show that day's number.
  function calendarGrid(month, foods, weights, steps) {
    const today = todayKey();
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const lead = new Date(y, m - 1, 1).getDay(); // 0 = Sunday
    const prefix = `${month}-`;
    const kcalByDay = new Map();
    for (const f of foods) if (f.date.startsWith(prefix)) kcalByDay.set(f.date, (kcalByDay.get(f.date) || 0) + f.kcal);
    const kgByDay = new Map(weights.filter((w) => w.date.startsWith(prefix)).map((w) => [w.date, w.kg]));
    const stepsByDay = new Map(steps.filter((s) => s.date.startsWith(prefix)).map((s) => [s.date, s.count]));

    // 2023-01-01 was a Sunday: use it to get localized weekday initials (日 月 … / S M …).
    const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(2023, 0, 1 + i).toLocaleDateString(I18N.locale, { weekday: 'narrow' }));
    let cells = '<span class="cal-blank"></span>'.repeat(lead);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${prefix}${pad(d)}`;
      const dow = (lead + d - 1) % 7;
      let cls = `cal-day${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}${key === today ? ' is-today' : ''}`;
      let mark = '';
      let val = '';
      let aria = t('calAriaEmpty', longDate(key));
      if (state.calMode === 'kcal' && kcalByDay.has(key)) {
        const kcal = kcalByDay.get(key);
        const over = kcal > state.goal;
        cls += over ? ' over' : ' ok';
        mark = over ? '△' : '○';
        val = fmt(kcal);
        aria = t('calAriaKcal', longDate(key), val, over);
      } else if (state.calMode === 'weight' && kgByDay.has(key)) {
        cls += ' weighed';
        val = kgByDay.get(key).toFixed(1);
        aria = t('calAriaWeight', longDate(key), val);
      } else if (state.calMode === 'steps' && stepsByDay.has(key)) {
        cls += ' stepped';
        val = fmt(stepsByDay.get(key));
        aria = t('calAriaSteps', longDate(key), val);
      }
      cells += `<button type="button" class="${cls}" data-act="open-day" data-date="${key}" ${key > today ? 'disabled' : ''} aria-label="${esc(aria)}">
          <span class="cal-num">${d}</span>${mark ? `<span class="cal-mark" aria-hidden="true">${mark}</span>` : ''}${val ? `<span class="cal-val">${val}</span>` : ''}
        </button>`;
    }
    const legend = state.calMode === 'kcal'
      ? `<span><b class="cal-key ok">○</b>${t('balLegendWithin')}</span><span><b class="cal-key over">△</b>${t('calLegendOver')}</span>`
      : `<span>${t(state.calMode === 'weight' ? 'calLegendWeight' : 'calLegendSteps')}</span>`;
    return `<div class="seg three" role="group" aria-label="${t('calModeAria')}">
          ${[['kcal', 'calModeKcal'], ['weight', 'calModeWeight'], ['steps', 'calModeSteps']].map(([mode, label]) => `<button type="button" data-act="cal-mode" data-mode="${mode}" class="${state.calMode === mode ? 'on' : ''}" aria-pressed="${state.calMode === mode}">${t(label)}</button>`).join('')}
        </div>
        <div class="cal-grid">
          ${weekdays.map((w, i) => `<span class="cal-dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}" aria-hidden="true">${w}</span>`).join('')}
          ${cells}
        </div>
        <div class="cal-legend">${legend}</div>`;
  }

  // Weight now, BMI (Japanese standard) and the last 30 days with a straight trend line.
  function weightCard(weights) {
    if (!weights.length) {
      return `<div class="card mini-card">
          <div class="mini-head"><span class="eyebrow">${t('sumWeight')}</span></div>
          <p class="sum-empty">${t('wNone')}</p>
          <p class="muted small">${t('wNoneDetail')}</p>
        </div>`;
    }
    const today = todayKey();
    const last = weights[weights.length - 1];
    const bmi = state.heightCm ? bmiOf(last.kg, state.heightCm) : null;
    const from = addDays(today, -29);
    const pts = weights.filter((w) => w.date >= from && w.date <= today);

    let chart;
    let trendText = '';
    if (pts.length < 3) chart = `<p class="muted small">${t('chartWeightNone30')}</p>`;
    else {
      const W = CHART_W;
      const H = 170;
      const left = 40; // room for the kg scale
      const right = W - 8;
      const top = 12;
      const base = H - 28;
      const dayIndex = (d) => Math.round((fromKey(d) - fromKey(from)) / DAY_MS); // 0..29
      const px = (i) => left + (i / 29) * (right - left);
      const kgs = pts.map((p) => p.kg);
      // Scale in 0.5 kg steps with at least 2 kg of range, so small changes are not blown up.
      let lo = Math.floor((Math.min(...kgs) - 0.3) * 2) / 2;
      let hi = Math.ceil((Math.max(...kgs) + 0.3) * 2) / 2;
      if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = Math.floor((mid - 1) * 2) / 2; hi = lo + 2; }
      if (Math.round((hi - lo) * 2) % 2) hi += 0.5; // whole-kg range, so the middle label lands on .0 or .5
      const y = (kg) => top + ((hi - kg) / (hi - lo)) * (base - top);
      // Least-squares trend line, only when the weigh-ins span at least a week.
      const xs = pts.map((p) => dayIndex(p.date));
      let trend = '';
      if (xs[xs.length - 1] - xs[0] >= 7) {
        const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
        const my = kgs.reduce((a, b) => a + b, 0) / kgs.length;
        const slope = xs.reduce((s, v, i) => s + (v - mx) * (kgs[i] - my), 0) / xs.reduce((s, v) => s + (v - mx) ** 2, 0);
        const at = (i) => my + slope * (i - mx);
        trend = `<line class="chart-trend" x1="${px(xs[0]).toFixed(1)}" y1="${y(at(xs[0])).toFixed(1)}" x2="${px(xs[xs.length - 1]).toFixed(1)}" y2="${y(at(xs[xs.length - 1])).toFixed(1)}"/>`;
        const perWeek = Math.round(slope * 7 * 10) / 10;
        trendText = perWeek === 0 ? t('chartTrendFlat') : t('chartTrend', `${perWeek > 0 ? '+' : '−'}${Math.abs(perWeek).toFixed(1)}`);
      }
      const md = (k) => fromKey(k).toLocaleDateString(I18N.locale, { month: 'numeric', day: 'numeric' });
      chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${t('chartWeight30')}: ${t('chartWeightChange', pts[0].kg.toFixed(1), last.kg.toFixed(1))}${trendText ? `. ${trendText}` : ''}`)}">
          ${[hi, (hi + lo) / 2, lo].map((v) => `<line class="chart-grid" x1="${left}" x2="${right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
            <text class="chart-label" x="${left - 6}" y="${(y(v) + 5).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`).join('')}
          ${trend}
          ${pts.map((p) => `<circle class="chart-dot" cx="${px(dayIndex(p.date)).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="4.5"/>`).join('')}
          <text class="chart-label" x="${left}" y="${H - 6}" text-anchor="start">${md(from)}</text>
          <text class="chart-label" x="${right}" y="${H - 6}" text-anchor="end">${md(today)}</text>
        </svg>`;
    }
    return `<div class="card mini-card">
        <div class="mini-head">
          <span class="eyebrow">${t('sumWeight')}</span>
          ${bmi ? `<span class="mini-side">${t('bmiShort', bmi.toFixed(1), t(`bmi_${bmiCategory(bmi)}`))}</span>` : ''}
        </div>
        <div class="mini-big">${last.kg.toFixed(1)}<small> kg</small></div>
        ${chart}
        ${trendText ? `<p class="mini-note">${trendText}</p>` : ''}
      </div>`;
  }

  // Steps for the period (only when some were saved): one line of numbers, plus bars for a week.
  function stepsCard(period, steps) {
    const inPeriod = new Set(period.dates);
    const byDay = new Map(steps.filter((s) => inPeriod.has(s.date)).map((s) => [s.date, s.count]));
    if (!byDay.size) return '';
    const target = stepTarget(ageNow() ?? 18);
    const counts = [...byDay.values()];
    const met = counts.filter((n) => n >= target).length;
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;

    let bars = '';
    if (period.isWeek) {
      const W = CHART_W;
      const H = 150;
      const right = W - 42;
      const top = 22;
      const base = H - 28;
      const max = Math.max(target, ...counts) * 1.1;
      const y = (v) => base - (v / max) * (base - top);
      const slot = (right - CHART_PAD) / 7;
      const barW = slot * 0.62;
      const cols = period.dates.map((d, i) => {
        const cx = CHART_PAD + slot * (i + 0.5);
        const label = `<text class="chart-label" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${fromKey(d).toLocaleDateString(I18N.locale, { weekday: 'narrow' })}</text>`;
        const n = byDay.get(d);
        if (n === undefined) return label;
        const by = y(n);
        return `<g role="img" aria-label="${esc(t('calAriaSteps', longDate(d), fmt(n)))}">
            <rect class="chart-bar steps${n >= target ? ' met' : ''}" x="${(cx - barW / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, base - by).toFixed(1)}" rx="6"/>
            <text class="chart-value small" x="${cx.toFixed(1)}" y="${(by - 7).toFixed(1)}" text-anchor="middle">${fmt(n)}</text>
            ${label}
          </g>`;
      }).join('');
      bars = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(t('stepsSummary', fmt(avg), met, counts.length))}">
          <line class="chart-base" x1="${CHART_PAD}" x2="${right}" y1="${base}" y2="${base}"/>
          <line class="chart-target" x1="${CHART_PAD}" x2="${right}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"/>
          <text class="chart-line-label keep" x="${W - 2}" y="${(y(target) + 5).toFixed(1)}" text-anchor="end">${fmt(target)}</text>
          ${cols}
        </svg>`;
    }
    return `<div class="card mini-card">
        <div class="mini-head">
          <span class="eyebrow">${t('chartSteps')}</span>
          <span class="mini-side">${t('stepsSummary', fmt(avg), met, counts.length)}</span>
        </div>
        ${bars}
      </div>`;
  }

  // Every explanation and source, behind one link that is closed by default.
  function infoBox(stats) {
    const lines = [
      t('infoTap'),
      stats.estimate ? t('infoKeep', fmt(round50(stats.avgKeep))) : t('infoKeepGoal', fmt(state.goal)),
      t('infoDays'),
      t('infoFat'),
      t('bmiStandard'),
      t('chartStepsSource'),
    ];
    return `<details class="info">
        <summary>${t('infoTitle')}</summary>
        <div class="info-body">${lines.map((l) => `<p>${l}</p>`).join('')}</div>
      </details>`;
  }

  // ---------- Screens ----------
  const SCREENS = {
    async welcome() {
      // The picture at the top is a preview of the Today screen (decoration only).
      const sample = FOODS.find((f) => f.ja === 'きつねうどん') || FOODS[0];
      const R = 84;
      const C = 2 * Math.PI * R;
      const floats = MEALS.map((m, i) => `<span class="float-tile f${i + 1}"><span class="tile ${MEAL_STYLE[m].tile}">${icon(MEAL_STYLE[m].icon)}</span></span>`).join('');
      return `<section class="welcome">
          <div class="welcome-top">
            <span class="brand"><span class="brand-badge">${icon('bowl')}</span>${t('appName')}</span>
            <button type="button" class="lang-pill" data-act="set-lang" data-lang="${I18N.lang === 'ja' ? 'en' : 'ja'}">${icon('globe')}${t('otherLangName')}</button>
          </div>

          <div class="hero-art" aria-hidden="true">
            <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
            <div class="hero-ring">
              <svg width="184" height="184" viewBox="0 0 184 184">
                <defs><linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1"><stop class="ring-grad-a" offset="0"/><stop class="ring-grad-b" offset="1"/></linearGradient></defs>
                <circle class="ring-track" cx="92" cy="92" r="${R}"/>
                <circle class="ring-fill" cx="92" cy="92" r="${R}" transform="rotate(-90 92 92)" stroke-dasharray="${(C * 0.62).toFixed(1)} ${C.toFixed(1)}"/>
              </svg>
              <div class="ring-center">
                <div class="ring-num">${fmt(1240)}</div>
                <div class="ring-label">${t('ringLeftToday')}</div>
              </div>
            </div>
            ${floats}
            <span class="float-chip"><span class="chip-check">${icon('check')}</span>${esc(t('welcomeSample', foodName(sample), fmt(sample.kcal)))}</span>
          </div>

          <div class="welcome-copy">
            <h1 tabindex="-1">${t('welcomeTitle')}</h1>
            <p class="lead muted">${t('welcomeLead')}</p>
          </div>

          <ul class="features">
            <li><span class="tile t-accent">${icon('plus')}</span><span>${t('welcomeF1')}</span></li>
            <li><span class="tile t-neutral">${icon('target')}</span><span>${t('welcomeF2')}</span></li>
            <li><span class="tile t-neutral">${icon('shield')}</span><span>${t('welcomeF3')}</span></li>
          </ul>

          <div class="welcome-cta">
            <button type="button" class="btn-primary" data-act="go" data-to="about">${t('welcomeStart')}${icon('next')}</button>
            <p class="welcome-note">${t('welcomeSetupTime')}</p>
            ${isStandalone() ? '' : installPrompt
              ? `<button type="button" class="btn-text center" data-act="install-app">${icon('download')}${t('installNow')}</button>`
              : `<button type="button" class="btn-text center" data-act="go" data-to="help">${icon('phone')}${t('installLink')}</button>`}
          </div>
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
          <div class="seg three" role="group" aria-label="${t('sexLabel')}">${SEXES.map((s) => `<button type="button" data-act="pick-sex" data-sex="${s}" class="${state.sex === s ? 'on' : ''}" aria-pressed="${state.sex === s}">${t(`sex_${s}`)}</button>`).join('')}</div>
          <p class="field-error" id="sex-error" hidden></p>
          <h2>${t('ageLabel')}</h2>
          ${stepper({ id: 'age-input', value: age, unit: t('ageUnit'), step: 1, min: AGE_MIN, max: AGE_MAX, decimals: 0, label: t('ageLabel') })}
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
          <h2>${t('heightLabel')}</h2>
          ${stepper({ id: 'height-input', value: Math.round(cm), unit: 'cm', step: 1, min: HEIGHT_MIN, max: HEIGHT_MAX, decimals: 0, label: t('heightLabel') })}
          <h2>${t('bodyWeightLabel')}</h2>
          ${stepper({ id: 'body-weight-input', value: kg.toFixed(1), unit: t('weighUnit'), step: 0.1, min: 20, max: 400, decimals: 1, label: t('weighAria') })}
          <p class="muted small">${t('bodyWeightNote')}</p>
          <button type="button" class="btn-primary" data-act="body-next">${t('next')}</button>
        </section>`;
    },

    async activity() {
      const onboarding = state.goalFrom === 'onboarding';
      return `${topbar('body', onboarding ? t('step', 3, 5) : '')}
        <section class="screen">
          <h1 tabindex="-1">${t('activityTitle')}</h1>
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
      const bmiBox = p ? `<p class="bmi-line">${t('bmiOneLine', p.bmi.toFixed(1), t(`bmi_${p.category}`), p.lo.toFixed(1), p.hi.toFixed(1))}</p>` : '';
      return `${topbar('activity', onboarding ? t('step', 4, 5) : '')}
        <section class="screen">
          <h1 tabindex="-1">${t('goalTypeTitle')}</h1>
          ${bmiBox}
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
        const keep = t('goalCalcKeep', fmt(round50(p.need)));
        const adj = p.adjust ? ` ${p.adjust < 0 ? '−' : '+'} ${Math.abs(p.adjust)} kcal` : '';
        basis = `<p class="goal-calc">${keep}${adj}</p>
          <details class="info"><summary>${t('infoTitle')}</summary>
            <div class="info-body"><p>${how}</p><p>${t('goalSource')}</p><p>${t('goalHint')}</p></div>
          </details>`;
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
          ${onboarding ? '' : `<button type="button" class="btn-text" data-act="goal-help">${t('goalHelp')}</button>`}
          <button type="button" class="btn-primary" data-act="save-goal">${onboarding ? t('goalSaveOnboarding') : t('goalSaveChange')}</button>
        </section>`;
    },

    async today() {
      const date = state.date;
      const today = todayKey();
      const isToday = date === today;
      // The week (Monday to Sunday) that contains the day being shown.
      const weekStart = addDays(date, -((fromKey(date).getDay() + 6) % 7));
      const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
      const [foods, weight, lastWeight, lastBackup, foodCount, weightCount, goalWeight, weekFoods, daySteps] = await Promise.all([
        DB.getFoodsByDate(date),
        DB.getWeight(date),
        DB.getWeightBefore(date),
        DB.getSetting('lastBackup', null),
        DB.count('foods'),
        DB.count('weights'),
        DB.getSetting('goalWeight', null),
        Promise.all(weekDates.map((d) => (d <= today ? DB.getFoodsByDate(d) : []))),
        DB.getSteps(date),
      ]);
      const stepsSub = daySteps ? t(isToday ? 'stepsSubToday' : 'stepsSubPast', fmt(daySteps.count)) : t('stepsSubNone');

      // Offer to review the goal once weight has moved a few kg from when it was set.
      const nowKg = (weight || lastWeight || {}).kg;
      const kgChange = isToday && goalWeight && nowKg ? Math.round((nowKg - goalWeight) * 10) / 10 : 0;
      const needsReview = Math.abs(kgChange) >= REVIEW_KG;

      const total = foods.reduce((s, f) => s + f.kcal, 0);
      const left = state.goal - total;
      const over = left < 0;

      const backupAge = lastBackup ? (Date.now() - new Date(lastBackup).getTime()) / DAY_MS : Infinity;
      const needsBackup = foodCount + weightCount > 0 && backupAge > BACKUP_REMINDER_DAYS;

      let weightSub;
      if (weight) weightSub = t(isToday ? 'weightSubToday' : 'weightSubPast', weight.kg.toFixed(1));
      else if (lastWeight) weightSub = t('weightSubLast', lastWeight.kg.toFixed(1), shortDate(lastWeight.date));
      else weightSub = t('weightSubNone');
      const shownKg = (weight || lastWeight || {}).kg;

      // Week strip: each day shows a small ring of how much of the goal was eaten.
      const week = weekDates.map((d, i) => {
        const kcal = weekFoods[i].reduce((s, f) => s + f.kcal, 0);
        const has = weekFoods[i].length > 0;
        const pct = Math.min(100, (kcal / state.goal) * 100);
        const ring = !has ? 'var(--ring-track)'
          : kcal > state.goal ? 'var(--over)'
          : `conic-gradient(var(--accent) 0 ${pct.toFixed(1)}%, var(--ring-track) 0)`;
        const cls = `week-day${d === today ? ' is-today' : ''}${d === date ? ' is-selected' : ''}`;
        return `<button type="button" class="${cls}" data-act="open-day" data-date="${d}" ${d > today ? 'disabled' : ''}
            aria-pressed="${d === date}" aria-label="${esc(t('dayAria', longDate(d), has ? fmt(kcal) : null))}">
            <span class="week-letter">${fromKey(d).toLocaleDateString(I18N.locale, { weekday: 'narrow' })}</span>
            <span class="week-ring" style="background:${ring}"><span class="week-num">${fromKey(d).getDate()}</span></span>
          </button>`;
      }).join('');

      // Ring: how much of today's goal has been eaten.
      const R = 84;
      const C = 2 * Math.PI * R;
      const filled = over ? C : (total / state.goal) * C;
      const ringLabel = over ? t('ringOver') : t(isToday ? 'ringLeftToday' : 'ringLeftPast');

      const meals = MEALS.map((meal) => {
        const items = foods.filter((f) => f.meal === meal);
        const sub = items.reduce((s, f) => s + f.kcal, 0);
        const st = MEAL_STYLE[meal];
        return `<div class="meal-block">
            <div class="list-row">
              <span class="tile ${st.tile}">${icon(st.icon)}</span>
              <span class="list-main">
                <span class="list-title">${mealName(meal)}</span>
                <span class="list-sub">${items.length ? t('kcal', fmt(sub)) : t('nothingYet')}</span>
              </span>
              <button type="button" class="mini-add" data-act="start-add" data-meal="${meal}" aria-label="${esc(t('addToMeal', mealName(meal)))}">${icon('plus')}</button>
            </div>
            ${items.length ? `<div class="meal-items">${items.map((f) => `<div class="food-item">
                <button type="button" class="food-item-main" data-act="edit-entry" data-id="${f.id}" aria-label="${esc(t('editAria', f.name))}">
                  <span class="food-item-name">${esc(f.name)}</span>
                  <span class="food-item-sub">${t('kcal', fmt(f.kcal))}${portionNote(f.portion) ? ` · ${esc(portionNote(f.portion))}` : ''}</span>
                </button>
                <button type="button" class="icon-remove" data-act="remove" data-id="${f.id}" aria-label="${esc(t('removeAria', f.name))}">${icon('close')}</button>
              </div>`).join('')}</div>` : ''}
          </div>`;
      }).join('');

      const reminders = [];
      if (!isStandalone()) reminders.push(listRow('data-act="go" data-to="help"', 't-neutral', 'phone', t('installTitle'), t('installText')));
      if (needsReview) {
        reminders.push(listRow('data-act="review-goal"', 't-neutral', 'target', t('reviewTitle'),
          t('reviewText', `${kgChange > 0 ? '+' : '−'}${Math.abs(kgChange).toFixed(1)}`)));
      }
      if (needsBackup) {
        reminders.push(listRow('data-act="go" data-to="backup"', 't-amber', 'shield', t('backupTitle'),
          lastBackup ? t('backupLast', ago(lastBackup)) : t('backupNone')));
      }

      return `<section class="screen">
          ${isToday ? '' : `<div class="warnbox past-day">
            <span class="box-title">${t('pastDayTitle')}</span>
            <button type="button" class="btn-small" data-act="tab" data-to="today">${t('backToToday')}</button>
          </div>`}

          <div class="page-head">
            <div>
              <div class="date-sub">${longDate(date)}</div>
              <h1 class="xl" tabindex="-1">${dayTitle(date)}</h1>
            </div>
            <div class="icon-btn">${icon('calendar')}<input type="date" id="day-picker" value="${date}" max="${today}" aria-label="${t('pickDay')}"></div>
          </div>

          <div class="week" role="group" aria-label="${t('weekAria')}">${week}</div>

          ${noticeHtml()}

          <div class="card hero">
            <div class="ring-wrap">
              <svg width="184" height="184" viewBox="0 0 184 184" aria-hidden="true">
                <defs><linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1"><stop class="ring-grad-a" offset="0"/><stop class="ring-grad-b" offset="1"/></linearGradient></defs>
                <circle class="ring-track" cx="92" cy="92" r="${R}"/>
                ${total > 0 ? `<circle class="ring-fill${over ? ' over' : ''}" cx="92" cy="92" r="${R}" transform="rotate(-90 92 92)" stroke-dasharray="${filled.toFixed(1)} ${C.toFixed(1)}"/>` : ''}
              </svg>
              <div class="ring-center">
                <div class="ring-num${over ? ' over' : ''}">${fmt(Math.abs(left))}</div>
                <div class="ring-label">${ringLabel}</div>
              </div>
            </div>
            ${over && isToday ? `<p class="over-note">${t('overNoteToday')}</p>` : ''}
            <div class="stats">
              <div class="stat"><div class="stat-v">${fmt(total)}</div><div class="stat-l">${t('statEaten')}</div></div>
              <div class="stat"><div class="stat-v">${fmt(state.goal)}</div><div class="stat-l">${t('statGoal')}</div></div>
              <div class="stat"><div class="stat-v">${shownKg ? `${shownKg.toFixed(1)}<small> kg</small>` : '—'}</div><div class="stat-l">${t('statWeight')}</div></div>
            </div>
          </div>

          <button type="button" class="btn-primary" data-act="start-add"><span class="plus-dot">${icon('plus')}</span>${t(isToday ? 'addToday' : 'addPast')}</button>

          <div class="card list">
            ${listRow('data-act="go" data-to="weigh"', 't-lavender', 'scale', t(isToday ? 'weighToday' : 'weighPast'), weightSub)}
            ${listRow('data-act="go" data-to="steps"', 't-mint', 'steps', t(isToday ? 'stepsToday' : 'stepsPast'), stepsSub)}
          </div>

          <div class="section-head">
            <h2>${t(isToday ? 'ateToday' : 'atePast')}</h2>
          </div>
          <div class="card list">${meals}</div>

          ${reminders.length ? `<div class="card list">${reminders.join('')}</div>` : ''}
        </section>`;
    },

    async food() {
      const [allFoods, dishPrefs] = await Promise.all([DB.getAllFoods(), loadDishPrefs()]);
      state.mine = summarizeFoods(allFoods, dishPrefs);
      const isToday = state.date === todayKey();
      const groups = ['all', ...FOOD_GROUPS];
      return `${topbar('today')}
        <section class="screen">
          <h1 tabindex="-1">${t('foodTitle')}</h1>
          ${isToday ? '' : `<p class="for-date">${t('forDate', shortDate(state.date))}</p>`}
          <div class="seg" role="group" aria-label="${t('mealPickerAria')}">
            ${MEALS.map((m) => `<button type="button" data-act="pick-meal" data-meal="${m}" class="${m === state.meal ? 'on' : ''}" aria-pressed="${m === state.meal}">${mealName(m)}</button>`).join('')}
          </div>
          <label class="search">${icon('search')}
            <input id="food-search" type="search" placeholder="${t('searchPlaceholder')}" aria-label="${t('searchLabel')}" value="${esc(state.query)}" autocomplete="off" enterkeyhint="search">
          </label>
          <div id="food-top">${foodTop()}</div>
          <div class="chips" role="group" aria-label="${t('categoriesAria')}">
            ${groups.map((g) => `<button type="button" class="chip${state.group === g ? ' on' : ''}" data-act="pick-group" data-group="${g}" aria-pressed="${state.group === g}">${g === 'all' ? t('allFoods') : esc(groupName(g))}</button>`).join('')}
          </div>
          <div id="food-results">${foodResults()}</div>
          <div class="sticky-foot">
            <button type="button" class="btn-primary" data-act="start-custom"><span class="plus-dot">${icon('plus')}</span>${t('typeItButton')}</button>
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

    // Edit one logged food: name, meal, calories; or delete it.
    async entry() {
      const f = state.entry;
      if (!f) return SCREENS.today();
      return `${topbar('today')}
        <section class="screen">
          <h1 tabindex="-1">${t('entryTitle')}</h1>
          ${f.date === todayKey() ? '' : `<p class="for-date">${longDate(f.date)}</p>`}
          <div class="field">
            <label class="label" for="entry-name">${t('entryName')}</label>
            <input id="entry-name" class="input" type="text" maxlength="60" value="${esc(f.name)}" autocomplete="off" enterkeyhint="done">
          </div>
          <div class="field">
            <div class="label">${t('entryMeal')}</div>
            <div class="seg" role="group" aria-label="${t('mealPickerAria')}">
              ${MEALS.map((m) => `<button type="button" data-act="pick-meal" data-meal="${m}" class="${m === state.meal ? 'on' : ''}" aria-pressed="${m === state.meal}">${mealName(m)}</button>`).join('')}
            </div>
          </div>
          <div class="field">
            <div class="label">${t('entryKcal')}</div>
            ${kcalPicks('entry-kcal')}
            ${stepper({ id: 'entry-kcal', value: f.kcal, unit: t('customUnit'), step: 50, min: 0, max: 10000, decimals: 0, label: t('customAria') })}
          </div>
          <button type="button" class="btn-primary" data-act="save-entry">${t('entrySave')}</button>
          <button type="button" class="btn-text danger center" data-act="delete-entry">${t('entryDelete')}</button>
        </section>`;
    },

    // All of the user's own dishes, to fix a name or the usual calories, or take one off the list.
    async dishes() {
      const [all, prefs] = await Promise.all([DB.getAllFoods(), loadDishPrefs()]);
      state.mine = summarizeFoods(all, prefs);
      return `${topbar('food')}
        <section class="screen">
          <h1 tabindex="-1">${t('oftenHave')}</h1>
          ${noticeHtml()}
          <p class="muted">${t('dishesSub')}</p>
          ${state.mine.length ? `<div class="card list plain">${state.mine.map((m, i) => `<button type="button" class="list-row" data-act="edit-dish" data-idx="${i}">
              <span class="list-main"><span class="list-title">${esc(m.name)}</span><span class="list-sub">${t('dishSub', fmt(m.kcal), m.count)}</span></span>
              ${icon('next')}
            </button>`).join('')}</div>` : `<p class="sum-empty">${t('dishesEmpty')}</p>`}
        </section>`;
    },

    async dish() {
      const m = state.dish;
      if (!m) return SCREENS.dishes();
      return `${topbar('dishes')}
        <section class="screen">
          <h1 tabindex="-1">${t('dishTitle')}</h1>
          <div class="field">
            <label class="label" for="dish-name">${t('entryName')}</label>
            <input id="dish-name" class="input" type="text" maxlength="60" value="${esc(m.name)}" autocomplete="off" enterkeyhint="done">
            <p class="muted small">${t('dishRenameNote')}</p>
          </div>
          <div class="field">
            <div class="label">${t('dishKcal')}</div>
            ${kcalPicks('dish-kcal')}
            ${stepper({ id: 'dish-kcal', value: m.kcal, unit: t('customUnit'), step: 50, min: 0, max: 10000, decimals: 0, label: t('dishKcal') })}
          </div>
          <button type="button" class="btn-primary" data-act="save-dish">${t('entrySave')}</button>
          <button type="button" class="btn-text danger center" data-act="remove-dish">${t('dishRemove')}</button>
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
            ${kcalPicks('custom-kcal')}
            ${stepper({ id: 'custom-kcal', value: 300, unit: t('customUnit'), step: 50, min: 1, max: 10000, decimals: 0, label: t('customAria') })}
          </div>
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
          ${stepper({ id: 'weight-input', value: start.toFixed(1), unit: t('weighUnit'), step: 0.1, min: 20, max: 400, decimals: 1, label: t('weighAria') })}
          <p class="muted small center">${note}</p>
          <button type="button" class="btn-primary" data-act="save-weight">${t('weighSave')}</button>
          ${w ? `<button type="button" class="btn-text danger" data-act="remove-weight">${t('weighRemove')}</button>` : ''}
        </section>`;
    },

    // Steps are typed in from the iPhone Health app: web apps cannot read Apple Health.
    async steps() {
      const date = state.date;
      const isToday = date === todayKey();
      const saved = await DB.getSteps(date);
      const target = stepTarget(ageNow() ?? 18);
      return `${topbar('today')}
        <section class="screen">
          <h1 tabindex="-1">${isToday ? t('stepsTitleToday') : t('stepsTitlePast', shortDate(date))}</h1>
          <p class="muted">${t(PLATFORM === 'android' ? 'stepsHelpAndroid' : 'stepsHelp')}</p>
          ${stepper({ id: 'steps-input', value: saved ? saved.count : 0, unit: t('stepsUnit'), step: 100, min: 0, max: STEPS_MAX, decimals: 0, label: t('stepsAria') })}
          <p class="muted small center">${saved ? t('stepsNoteSaved', fmt(saved.count)) : ''}${t('stepsTarget', fmt(target))}</p>
          <button type="button" class="btn-primary" data-act="save-steps">${t('stepsSave')}</button>
          ${saved ? `<button type="button" class="btn-text danger" data-act="remove-steps">${t('stepsRemove')}</button>` : ''}
        </section>`;
    },

    async progress() {
      const [foods, weights, steps] = await Promise.all([DB.getAllFoods(), DB.getAllWeights(), DB.getAllSteps()]);
      const period = progressPeriod(foods, weights, steps);
      const stats = periodStats(period.dates, foods, weights);
      return `<section class="screen">
          <h1 class="xl" tabindex="-1">${t('progressTitle')}</h1>
          ${noticeHtml()}
          <div class="seg two" role="group" aria-label="${t('balModeAria')}">
            ${['week', 'month'].map((mode) => `<button type="button" data-act="bal-mode" data-mode="${mode}" class="${state.balMode === mode ? 'on' : ''}" aria-pressed="${state.balMode === mode}">${t(mode === 'week' ? 'balWeek' : 'balMonth')}</button>`).join('')}
          </div>
          <div class="period-nav">
            <button type="button" class="icon-btn" data-act="bal-step" data-delta="-1" aria-label="${t('balPrev')}" ${period.atStart ? 'disabled' : ''}>${icon('back')}</button>
            <h2 class="period-title" aria-live="polite">${period.title}</h2>
            <button type="button" class="icon-btn" data-act="bal-step" data-delta="1" aria-label="${t('balNext')}" ${period.atEnd ? 'disabled' : ''}>${icon('next')}</button>
          </div>
          ${summaryCard(period, stats, foods, weights, steps)}
          ${weightCard(weights)}
          ${stepsCard(period, steps)}
          ${infoBox(stats)}
        </section>`;
    },

    async more() {
      const lastBackup = await DB.getSetting('lastBackup', null);
      let extra = '';
      if (state.advanced) {
        const storage = navigator.storage || {};
        const [foodCount, weightCount, stepsCount, persisted, estimate] = await Promise.all([
          DB.count('foods'),
          DB.count('weights'),
          DB.count('steps'),
          storage.persisted ? storage.persisted().catch(() => null) : null,
          storage.estimate ? storage.estimate().catch(() => null) : null,
        ]);
        const rows = [
          [t('kvHome'), isStandalone() ? t('yes') : t('no')],
          [t('kvProtected'), persisted === true ? t('yes') : persisted === false ? t('no') : t('unknown')],
          [t('kvFoods'), fmt(foodCount)],
          [t('kvWeighIns'), fmt(weightCount)],
          [t('kvSteps'), fmt(stepsCount)],
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
          <div class="card list">
            ${listRow('data-act="open-goal"', 't-neutral', 'target', t('changeGoal'), t('goalNow', fmt(state.goal)))}
            ${listRow('data-act="go" data-to="backup"', 't-neutral', 'shield', t('keepSafe'), lastBackup ? t('lastCopy', ago(lastBackup)) : t('noCopy'))}
            ${listRow('data-act="go" data-to="help"', 't-neutral', 'phone', t('homeScreen'), isStandalone() ? t('alreadyDone') : t('stepByStep'))}
            ${listRow('data-act="go" data-to="appearance"', 't-neutral', 'contrast', t('appearance'), t(`theme_${state.theme}_title`))}
            ${listRow(`data-act="set-lang" data-lang="${I18N.lang === 'ja' ? 'en' : 'ja'}"`, 't-neutral', 'globe', t('language'), `${t('langName')} → ${t('otherLangName')}`)}
          </div>
          <button type="button" class="btn-text" data-act="toggle-advanced">${state.advanced ? t('hideExtra') : t('showExtra')}</button>
          ${extra}
        </section>`;
    },

    async backup() {
      const lastBackup = await DB.getSetting('lastBackup', null);
      const age = lastBackup ? (Date.now() - new Date(lastBackup).getTime()) / DAY_MS : Infinity;
      let status;
      if (!lastBackup) status = `<div class="warnbox"><div class="box-title">${t('backupNotYet')}</div></div>`;
      else if (age > BACKUP_REMINDER_DAYS) status = `<div class="warnbox"><div class="box-title">${t('backupLastTitle', ago(lastBackup))}</div></div>`;
      else status = `<div class="okbox"><div class="box-title">${t('backupLastTitle', ago(lastBackup))}</div></div>`;
      return `${topbar('@prev')}
        <section class="screen">
          <h1 tabindex="-1">${t('backupScreenTitle')}</h1>
          <p class="muted">${t('backupLead')}</p>
          ${status}
          ${noticeHtml()}
          <button type="button" class="btn-primary" data-act="export-json">${t('backupSaveNow')}</button>
          <details class="info"><summary>${t('backupHowTitle')}</summary>
            <div class="info-body"><p>${t(PLATFORM === 'android' ? 'backupNextTextAndroid' : 'backupNextText')}</p><p>${t('backupRestoreText')}</p></div>
          </details>
        </section>`;
    },

    async appearance() {
      return `${topbar('more')}
        <section class="screen">
          <h1 tabindex="-1">${t('appearance')}</h1>
          <p class="muted">${t('appearanceSub')}</p>
          <div class="stack">
            ${THEMES.map((k) => `<button type="button" class="choice${state.theme === k ? ' on' : ''}" data-act="pick-theme" data-choice="${k}" aria-pressed="${state.theme === k}">
                <span class="tile ${THEME_STYLE[k].tile}">${icon(THEME_STYLE[k].icon)}</span>
                <span class="choice-text"><b>${t(`theme_${k}_title`)}</b><span class="choice-sub">${t(`theme_${k}_sub`)}</span></span>
                ${state.theme === k ? icon('check', 'accent') : ''}
              </button>`).join('')}
          </div>
        </section>`;
    },

    async help() {
      const os = state.helpOs || (PLATFORM === 'android' ? 'android' : 'ios');
      // Step 2 shows the button to look for: Safari's Share icon, or Chrome's ⋮ menu.
      const steps = os === 'ios'
        ? [[t('helpIos1')], [t('helpIos2'), `<span class="share-pic">${icon('share')}</span>`], [t('helpIos3')], [t('helpIos4')]]
        : [[t('helpAndroid1')], [t('helpAndroid2'), `<span class="share-pic android">${icon('dots')}</span>`], [t('helpAndroid3')], [t('helpAndroid4')]];
      const oneTap = os === 'android' && installPrompt && !isStandalone()
        ? `<button type="button" class="btn-primary" data-act="install-app">${icon('download')}${t('installNow')}</button>
          <p class="muted small center">${t('installOrSteps')}</p>`
        : '';
      return `${topbar('@prev')}
        <section class="screen">
          <h1 tabindex="-1">${t('helpTitle')}</h1>
          ${isStandalone()
            ? `<div class="okbox"><div class="box-title">${t('helpDoneTitle')}</div><div>${t('helpDoneText')}</div></div>`
            : `<p class="muted">${t('helpIntro')}</p>`}
          <div class="seg two" role="group" aria-label="${t('helpOsAria')}">
            ${[['ios', 'iPhone'], ['android', 'Android']].map(([k, label]) => `<button type="button" data-act="help-os" data-os="${k}" class="${os === k ? 'on' : ''}" aria-pressed="${os === k}">${label}</button>`).join('')}
          </div>
          ${oneTap}
          <div class="stack">
            ${steps.map(([text, pic], i) => `<div class="card step-card"><span class="stepnum">${i + 1}</span><div class="stack"><p>${text}</p>${pic || ''}</div></div>`).join('')}
          </div>
        </section>`;
    },
  };

  const TABS = ['today', 'progress', 'more'];

  // The user's choices about their own dishes, kept in settings (and in backups):
  //   hidden: { key: ISO time it was taken off the list }  — it comes back if logged again later
  //   kcal:   { key: usual calories }                        — used instead of "same as last time"
  async function loadDishPrefs() {
    const p = await DB.getSetting('dishes', null);
    return { hidden: (p && p.hidden) || {}, kcal: (p && p.kcal) || {} };
  }
  const saveDishPrefs = (prefs) => DB.setSetting('dishes', prefs);

  // The user's own past foods, one per name (latest version), most used first.
  function summarizeFoods(all, prefs = { hidden: {}, kcal: {} }) {
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
    for (const e of byName.values()) {
      if (prefs.kcal[e.key] !== undefined) { e.kcal = prefs.kcal[e.key]; e.portion = undefined; e.usual = true; }
    }
    return [...byName.values()]
      .filter((e) => !(prefs.hidden[e.key] && e.last <= prefs.hidden[e.key]))
      .sort((a, b) => b.count - a.count || (b.last > a.last ? 1 : -1));
  }

  // The rough-size buttons (小皿 / 中皿 / 大皿 / 定食1食分) that fill a calorie field.
  const kcalPicks = (target) => `<div class="kcal-picks" role="group" aria-label="${t('kcalPicksLabel')}">
      ${KCAL_PICKS.map((p) => `<button type="button" class="kcal-pick" data-act="kcal-pick" data-target="${target}" data-kcal="${p.kcal}" aria-pressed="false">
          <span class="kcal-pick-name">${t(`pick_${p.key}`)}</span><span class="kcal-pick-v">${t('pickKcal', fmt(p.kcal))}</span>
        </button>`).join('')}
    </div>`;

  // A built-in name like "ごはん（茶碗1杯）" shows as "ごはん" with "茶碗1杯・234 kcal" underneath.
  function splitFoodName(name) {
    const m = name.match(/^(.+?)\s*[（(](.+)[）)]\s*$/);
    return m ? { title: m[1], detail: m[2] } : { title: name, detail: '' };
  }

  // The user's own dishes (mostly home cooking): one tap adds them again, same as last time.
  const mineRow = (m, i) => `<button type="button" class="list-row" data-act="add-again" data-idx="${i}" aria-label="${esc(t('addAgainAria', m.name, fmt(m.kcal)))}">
      <span class="list-main"><span class="list-title">${esc(m.name)}</span><span class="list-sub">${t(m.usual ? 'usualKcal' : 'sameAsLast', fmt(m.kcal))}</span></span>
      <span class="add-dot" aria-hidden="true">${icon('plus')}</span>
    </button>`;

  // Above the categories. Without a search: the user's own dishes. While searching: a row that
  // types the searched name in straight away, then the user's own dishes that match.
  function foodTop() {
    const raw = state.query.trim();
    const q = norm(raw);
    if (!q) {
      const usual = state.mine.slice(0, 5);
      return usual.length ? `<div class="section-head"><h2>${t('oftenHave')}</h2><button type="button" class="btn-text link-sm" data-act="go" data-to="dishes">${t('edit')}</button></div>
        <div class="card list plain">${usual.map(mineRow).join('')}</div>` : '';
    }
    const mine = state.mine.map((m, i) => [m, i]).filter(([m]) => m.key.includes(q)).slice(0, 5);
    return `<div class="card list plain">
        <button type="button" class="list-row typed" data-act="start-custom">
          <span class="add-dot" aria-hidden="true">${icon('pencil')}</span>
          <span class="list-main"><span class="list-title">${t('typeItNamed', esc(raw))}</span></span>
          ${icon('next')}
        </button>
        ${mine.map(([m, i]) => mineRow(m, i)).join('')}
      </div>`;
  }

  // The built-in list (below the categories): short name, portion and calories underneath.
  function foodResults() {
    const q = norm(state.query);
    const group = state.group;
    const inGroup = (f) => group === 'all' || f.g === group;
    const builtRow = (f) => {
      const { title, detail } = splitFoodName(foodName(f));
      return `<button type="button" class="list-row" data-act="pick-food" data-idx="${FOODS.indexOf(f)}">
          <span class="list-main"><span class="list-title">${esc(title)}</span><span class="list-sub">${detail ? t('foodSub', esc(detail), fmt(f.kcal)) : t('kcal', fmt(f.kcal))}</span></span>
          ${icon('next')}
        </button>`;
    };
    if (!q) {
      const shown = group === 'all' ? FOOD_GROUPS : [group];
      return shown.map((g) => `<h2>${esc(groupName(g))}</h2><div class="card list plain">${FOODS.filter((f) => f.g === g).map(builtRow).join('')}</div>`).join('');
    }
    const mineKeys = new Set(state.mine.filter((m) => m.key.includes(q)).map((m) => m.key));
    const built = FOODS.filter((f) => inGroup(f) && f.search.includes(q) && !mineKeys.has(norm(foodName(f))));
    return built.length ? `<h2>${t('matches')}</h2><div class="card list plain">${built.map(builtRow).join('')}</div>` : '';
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
    // Backups made before steps existed have no "steps" list; that's fine.
    const steps = (Array.isArray(d.steps) ? d.steps : []).map((s, i) => {
      if (!s || !isDate(s.date) || !Number.isInteger(s.count) || s.count < 0 || s.count > STEPS_MAX) throw new Error(t('importStepsDamaged', i + 1));
      return { date: s.date, count: s.count, updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : `${s.date}T12:00:00` };
    });
    const settings = [{ key: 'onboarded', value: true }];
    const find = (key) => (d.settings || []).find((s) => s && s.key === key);
    const goal = find('goal');
    if (goal && Number.isInteger(goal.value) && goal.value >= GOAL_MIN && goal.value <= GOAL_MAX) settings.push({ key: 'goal', value: goal.value });
    const goalType = find('goalType');
    if (goalType && GOAL_TYPES[goalType.value]) settings.push({ key: 'goalType', value: goalType.value });
    const lang = find('lang');
    if (lang && (lang.value === 'ja' || lang.value === 'en')) settings.push({ key: 'lang', value: lang.value });
    const theme = find('theme');
    if (theme && THEMES.includes(theme.value)) settings.push({ key: 'theme', value: theme.value });
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
    const dishes = find('dishes');
    if (dishes && dishes.value && typeof dishes.value === 'object') {
      const hidden = {};
      const kcal = {};
      for (const [k, v] of Object.entries(dishes.value.hidden || {})) if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) hidden[String(k).slice(0, 80)] = v;
      for (const [k, v] of Object.entries(dishes.value.kcal || {})) if (Number.isInteger(v) && v >= 0 && v <= 10000) kcal[String(k).slice(0, 80)] = v;
      settings.push({ key: 'dishes', value: { hidden, kcal } });
    }
    return { foods, weights, steps, settings, exportedAt: d.exportedAt };
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
    applyTheme(await DB.getSetting('theme', state.theme));
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
    go: (el) => {
      if (el.dataset.to !== '@prev') return go(el.dataset.to);
      return go(['today', 'more', 'welcome'].includes(state.prev) ? state.prev : 'more');
    },
    'help-os': (el) => { state.helpOs = el.dataset.os; return render(); },
    // Android Chrome: show the browser's own install dialog. Elsewhere, open the guide.
    'install-app': async () => {
      if (!installPrompt) return go('help');
      const prompt = installPrompt;
      installPrompt = null; // it can only be used once
      prompt.prompt();
      await prompt.userChoice.catch(() => null);
      return render();
    },

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
      input.value = dec ? v.toFixed(dec) : fmt(v);
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
      else if (u.type === 'edit') await DB.updateFood(u.food);
      else if (u.type === 'unhide') {
        const prefs = await loadDishPrefs();
        delete prefs.hidden[u.key];
        await saveDishPrefs(prefs);
      } else await DB.addFood(u.food);
      state.notice = { text: t('undone') };
      await render();
    },

    // Adding food
    'start-add': (el) => go('food', { query: '', group: 'all', meal: el.dataset.meal || defaultMeal() }),
    // Meal and food-type buttons on the food screen update in place, so the search box keeps its text.
    'pick-meal': (el) => {
      state.meal = el.dataset.meal;
      $$('.seg button').forEach((b) => {
        const on = b.dataset.meal === state.meal;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on);
      });
    },
    'pick-group': (el) => {
      state.group = el.dataset.group;
      $$('.chips .chip').forEach((b) => {
        const on = b.dataset.group === state.group;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on);
      });
      $('#food-results').innerHTML = foodResults();
    },
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

    // Edit a logged food
    'edit-entry': async (el) => {
      const food = await DB.getFood(Number(el.dataset.id));
      if (!food) return;
      return go('entry', { entry: food, meal: food.meal });
    },
    'save-entry': async () => {
      const before = state.entry;
      const name = $('#entry-name').value.trim().slice(0, 60) || before.name;
      const kcal = Math.round(parseNum($('#entry-kcal').value));
      if (!(kcal >= 0 && kcal <= 10000)) {
        fieldError('entry-kcal', t('rangeError', 0, fmt(10000)));
        return;
      }
      const after = { ...before, name, kcal, meal: state.meal };
      // A portion word (少なめ／多め) no longer fits once the name or calories are changed by hand.
      if (name !== before.name || kcal !== before.kcal) delete after.portion;
      await DB.updateFood(after);
      return go('today', { entry: null, notice: { text: t('entrySaved', name), undo: { type: 'edit', food: before } } });
    },
    'delete-entry': async () => {
      const food = state.entry;
      await DB.deleteFood(food.id);
      return go('today', { entry: null, notice: { text: t('removed', food.name), undo: { type: 'remove', food } } });
    },

    // Manage the user's own dishes
    'edit-dish': (el) => go('dish', { dish: state.mine[Number(el.dataset.idx)] }),
    'save-dish': async () => {
      const m = state.dish;
      const name = $('#dish-name').value.trim().slice(0, 60) || m.name;
      const kcal = Math.round(parseNum($('#dish-kcal').value));
      if (!(kcal >= 0 && kcal <= 10000)) {
        fieldError('dish-kcal', t('rangeError', 0, fmt(10000)));
        return;
      }
      const prefs = await loadDishPrefs();
      const newKey = norm(name);
      if (newKey !== m.key || name !== m.name) {
        // Renaming fixes the name in past entries too (e.g. a typo), so it stays one dish.
        const renamed = (await DB.getAllFoods()).filter((f) => norm(f.name) === m.key).map((f) => ({ ...f, name }));
        await DB.putFoods(renamed);
        delete prefs.kcal[m.key];
        delete prefs.hidden[newKey];
      }
      prefs.kcal[newKey] = kcal;
      await saveDishPrefs(prefs);
      return go('dishes', { dish: null, notice: { text: t('dishSaved', name) } });
    },
    'remove-dish': async () => {
      const m = state.dish;
      const prefs = await loadDishPrefs();
      prefs.hidden[m.key] = new Date().toISOString();
      await saveDishPrefs(prefs);
      return go('dishes', { dish: null, notice: { text: t('dishRemoved', m.name), undo: { type: 'unhide', key: m.key } } });
    },
    'kcal-pick': (el) => {
      const id = el.dataset.target || 'custom-kcal';
      $(`#${id}`).value = fmt(Number(el.dataset.kcal));
      $(`#${id}-error`).hidden = true;
      $$('.kcal-pick').forEach((b) => {
        const on = b === el;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on);
      });
    },
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

    // Steps
    'save-steps': async () => {
      const n = parseNum($('#steps-input').value);
      if (!(Number.isInteger(n) && n >= 1 && n <= STEPS_MAX)) {
        fieldError('steps-input', t('rangeError', 1, fmt(STEPS_MAX)));
        return;
      }
      await DB.setSteps(state.date, n);
      await go('today', { notice: { text: t('stepsSaved', fmt(n)) } });
    },
    'remove-steps': async () => {
      const ok = await confirmDialog(t('removeStepsTitle'), t('removeStepsText', shortDate(state.date)), t('removeStepsYes'));
      if (!ok) return;
      await DB.deleteSteps(state.date);
      await go('today', { notice: { text: t('stepsRemoved') } });
    },

    // Progress / More
    'cal-mode': (el) => { state.calMode = el.dataset.mode; return render(); },
    // One 週/月 switch and one ‹ › for the whole progress screen.
    'bal-mode': (el) => { state.balMode = el.dataset.mode; return render(); },
    'bal-step': (el) => {
      const delta = Number(el.dataset.delta);
      if (state.balMode === 'week') {
        state.balWeek = addDays(state.balWeek || mondayOf(todayKey()), delta * 7);
      } else {
        const [y, m] = state.calMonth.split('-').map(Number);
        state.calMonth = toKey(new Date(y, m - 1 + delta, 1)).slice(0, 7);
      }
      return render();
    },
    'toggle-advanced': () => { state.advanced = !state.advanced; return render(); },
    // Changes straight away, so the person sees the new look while choosing.
    'pick-theme': async (el) => {
      applyTheme(el.dataset.choice);
      await DB.setSetting('theme', state.theme);
      await render();
    },
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
      $('#food-top').innerHTML = foodTop();
      $('#food-results').innerHTML = foodResults();
    } else if (e.target.id === 'custom-name') {
      state.customName = e.target.value;
    } else if (e.target.classList.contains('big-number')) {
      const err = document.getElementById(`${e.target.id}-error`);
      if (err) err.hidden = true;
    }
  });

  // ---------- Number fields: the first key replaces the number ----------
  // Tapping a number (weight, calories, steps…) marks it "ready to replace": it is
  // highlighted, and the first digit typed replaces the whole number, so nobody has to
  // delete it first. Backspace first clears it; tapping away without typing keeps it;
  // tapping the number again goes back to normal editing. (Not the browser's select-all:
  // on iPhone that is unreliable and brings up the Cut / Copy / Paste menu.)
  const isNumberField = (el) => el instanceof HTMLInputElement && el.classList.contains('big-number');
  const isReady = (el) => isNumberField(el) && el.classList.contains('replace-ready');

  document.addEventListener('focusin', (e) => {
    if (isNumberField(e.target)) e.target.classList.add('replace-ready');
  });
  document.addEventListener('focusout', (e) => {
    if (isNumberField(e.target)) e.target.classList.remove('replace-ready');
  });
  // A tap on the number while it is already being edited = normal editing at that spot.
  document.addEventListener('pointerdown', (e) => {
    if (isReady(e.target) && document.activeElement === e.target) e.target.classList.remove('replace-ready');
  });
  // A keyboard that composes text (e.g. Japanese input) replaces the selection instead.
  document.addEventListener('compositionstart', (e) => {
    if (!isReady(e.target)) return;
    e.target.classList.remove('replace-ready');
    e.target.setSelectionRange(0, e.target.value.length);
  });
  document.addEventListener('beforeinput', (e) => {
    const el = e.target;
    if (!isReady(el) || e.inputType === 'insertLineBreak') return;
    el.classList.remove('replace-ready');
    const inserting = e.inputType.startsWith('insert');
    if (!inserting && !e.inputType.startsWith('delete')) return; // e.g. undo: leave it to the browser
    const text = inserting ? (e.data ?? (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '') ?? '') : '';
    e.preventDefault();
    el.value = text;
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event('input', { bubbles: true })); // hides any error under the field
  });

  // "Done" on the keyboard closes it. While a Japanese IME is still converting,
  // Enter confirms the kana/kanji instead, so leave that alone.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || !e.target.matches('input')) return;
    e.preventDefault();
    if (e.target.id === 'custom-name') $('#custom-kcal').focus();
    else e.target.blur();
  });

  // Calendar button on Today: the native date picker.
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'day-picker' || !e.target.value) return;
    const today = todayKey();
    state.date = e.target.value > today ? today : e.target.value;
    go('today').catch(showError);
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
      const [savedGoal, goalType, onboarded, lang, theme, foodCount, weightCount] = await Promise.all([
        DB.getSetting('goal', null),
        DB.getSetting('goalType', 'keep'),
        DB.getSetting('onboarded', false),
        DB.getSetting('lang', null),
        DB.getSetting('theme', null),
        DB.count('foods'),
        DB.count('weights'),
      ]);
      if (lang) I18N.setLang(lang);
      // The database is the source of truth; with nothing saved, keep what index.html used.
      let quick = null;
      try { quick = localStorage.getItem('theme'); } catch (_) { /* storage blocked */ }
      applyTheme(theme ?? quick);
      state.goal = savedGoal ?? DEFAULT_GOAL;
      state.goalType = GOAL_TYPES[goalType] ? goalType : 'keep';
      await loadProfile();
      if (!onboarded) {
        if (foodCount + weightCount > 0 || savedGoal !== null) {
          // Existing users of an earlier version (any entries, or a goal they set) skip the welcome screens.
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
