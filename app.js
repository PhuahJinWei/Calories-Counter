'use strict';

(() => {
  const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  const DEFAULT_GOAL = 2000;
  const GOAL_MIN = 500;
  const GOAL_MAX = 10000;
  const BACKUP_REMINDER_DAYS = 7;
  const DAY_MS = 86400000;

  const GOAL_TYPES = {
    lose: { title: 'Lose weight', sub: 'Eat a little less each day', phrase: 'lose weight', kcal: 1600 },
    keep: { title: 'Stay the same weight', sub: 'Eat about what your body needs', phrase: 'stay the same weight', kcal: 2000 },
    gain: { title: 'Gain weight', sub: 'Eat a little more each day', phrase: 'gain weight', kcal: 2400 },
  };
  const PORTIONS = [
    { label: 'A small amount', factor: 0.7, size: 32 },
    { label: 'A normal amount', factor: 1, size: 48 },
    { label: 'A lot', factor: 1.4, size: 66 },
  ];
  const FOOD_GROUPS = [...new Set(FOODS.map((f) => f.group))];

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
    return d.toLocaleDateString(undefined, opts);
  }
  function shortDate(k) { return fromKey(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
  function dayTitle(k) {
    const t = todayKey();
    if (k === t) return 'Today';
    if (k === addDays(t, -1)) return 'Yesterday';
    return fromKey(k).toLocaleDateString(undefined, { weekday: 'long' });
  }
  function dayLabel(k) {
    const t = todayKey();
    if (k === t) return 'Today';
    if (k === addDays(t, -1)) return 'Yesterday';
    return shortDate(k);
  }
  function timeOf(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function ago(iso) {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }
  function defaultMeal() {
    const h = new Date().getHours();
    if (h < 11) return 'Breakfast';
    if (h < 15) return 'Lunch';
    if (h >= 17 && h < 22) return 'Dinner';
    return 'Snack';
  }

  // ---------- Helpers ----------
  const fmt = (n) => Math.round(n).toLocaleString();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const portionKcal = (food, p) => Math.max(1, Math.round((food.kcal * p.factor) / 10) * 10);

  // Accepts "72.4" or "72,4" (some iPhone regions show a comma on the decimal keypad).
  function parseNum(raw) {
    const s = String(raw).trim().replace(',', '.');
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  function showError(err) {
    console.error(err);
    $('#error-text').textContent = `Something went wrong: ${(err && err.message) || err}`;
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
  };
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  const topbar = (back, step = '') => `<div class="topbar">
      <button type="button" class="btn-back" data-act="go" data-to="${back}">${icon('back')}Back</button>
      ${step ? `<span class="muted step">${step}</span>` : ''}
    </div>`;

  function noticeHtml() {
    const n = state.notice;
    if (!n) return '';
    return `<div class="notice${n.kind === 'error' ? ' error' : ''}" role="status">
        ${n.kind === 'error' ? '' : icon('check')}<span class="notice-text">${esc(n.text)}</span>
        ${n.undo ? '<button type="button" class="btn-small" data-act="undo">Undo</button>' : ''}
      </div>`;
  }

  // Big number with − / + buttons. The number itself can also be typed.
  function stepper({ id, value, unit, step, min, max, decimals, label, bigStep, bigUnit }) {
    const data = `data-target="${id}" data-min="${min}" data-max="${max}" data-dec="${decimals}"`;
    return `<div class="card">
        <div class="stepper">
          <button type="button" class="btn-round" data-act="step" data-delta="-${step}" ${data} aria-label="Less">${icon('minus')}</button>
          <div class="stepper-value">
            <input id="${id}" class="big-number" type="text" inputmode="${decimals ? 'decimal' : 'numeric'}"
              value="${value}" aria-label="${label}" autocomplete="off" enterkeyhint="done">
            <div class="muted">${unit}</div>
          </div>
          <button type="button" class="btn-round" data-act="step" data-delta="${step}" ${data} aria-label="More">${icon('plus')}</button>
        </div>
        ${bigStep ? `<div class="stepper-big">
          <button type="button" class="btn-small" data-act="step" data-delta="-${bigStep}" ${data}>${bigStep} ${bigUnit} less</button>
          <button type="button" class="btn-small" data-act="step" data-delta="${bigStep}" ${data}>${bigStep} ${bigUnit} more</button>
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
          <h1 class="xl" tabindex="-1">Welcome to your food diary</h1>
          <p class="lead muted">Write down what you eat each day and see how you are doing. It only takes a few taps.</p>
          <button type="button" class="btn-primary" data-act="go" data-to="goalType">Let's start</button>
        </section>`;
    },

    async goalType() {
      const onboarding = state.goalFrom === 'onboarding';
      return `${topbar(onboarding ? 'welcome' : 'goalSet', onboarding ? 'Step 1 of 2' : '')}
        <section class="screen">
          <h1 tabindex="-1">What would you like to do?</h1>
          <p class="muted">Pick one. You can change it later.</p>
          <div class="stack">
            ${Object.entries(GOAL_TYPES).map(([key, g]) => `<button type="button" class="choice${state.goalType === key ? ' on' : ''}" data-act="pick-goal-type" data-type="${key}">
                <span class="choice-text"><b>${g.title}</b><span class="choice-sub">${g.sub}</span></span>${icon('next')}
              </button>`).join('')}
          </div>
        </section>`;
    },

    async goalSet() {
      const onboarding = state.goalFrom === 'onboarding';
      const g = GOAL_TYPES[state.goalType] || GOAL_TYPES.keep;
      return `${topbar(onboarding ? 'goalType' : 'more', onboarding ? 'Step 2 of 2' : '')}
        <section class="screen">
          <h1 tabindex="-1">${onboarding ? 'Your daily goal' : 'Change my daily goal'}</h1>
          <p class="lead">${onboarding
            ? `To ${g.phrase}, we suggest eating about this many calories each day:`
            : 'How many calories would you like to eat each day?'}</p>
          ${stepper({ id: 'goal-input', value: state.goalDraft, unit: 'calories a day', step: 50, min: GOAL_MIN, max: GOAL_MAX, decimals: 0, label: 'Daily calorie goal' })}
          <p class="muted">Calories are the energy in food. Not sure? Just keep this number. You can change it any time under More.</p>
          ${onboarding ? '' : '<button type="button" class="btn-text" data-act="goal-help">Help me choose a number</button>'}
          <button type="button" class="btn-primary" data-act="save-goal">${onboarding ? "Looks good, let's go" : 'Save my goal'}</button>
        </section>`;
    },

    async today() {
      const date = state.date;
      const isToday = date === todayKey();
      const [foods, weight, lastWeight, lastBackup, foodCount, weightCount] = await Promise.all([
        DB.getFoodsByDate(date),
        DB.getWeight(date),
        DB.getWeightBefore(date),
        DB.getSetting('lastBackup', null),
        DB.count('foods'),
        DB.count('weights'),
      ]);

      const total = foods.reduce((s, f) => s + f.kcal, 0);
      const left = state.goal - total;
      const over = left < 0;
      const pct = Math.min(100, (total / state.goal) * 100);

      const backupAge = lastBackup ? (Date.now() - new Date(lastBackup).getTime()) / DAY_MS : Infinity;
      const needsBackup = foodCount + weightCount > 0 && backupAge > BACKUP_REMINDER_DAYS;

      let weightSub;
      if (weight) weightSub = `${isToday ? 'Today' : 'This day'}: ${weight.kg.toFixed(1)} kg`;
      else if (lastWeight) weightSub = `Last time: ${lastWeight.kg.toFixed(1)} kg, on ${shortDate(lastWeight.date)}`;
      else weightSub = 'You have not weighed yourself yet';

      const meals = MEALS.map((meal) => {
        const items = foods.filter((f) => f.meal === meal);
        const sub = items.reduce((s, f) => s + f.kcal, 0);
        return `<div class="card meal-card">
            <div class="meal-head"><span class="meal-name">${meal}</span><span class="muted small">${items.length ? `${fmt(sub)} calories` : ''}</span></div>
            ${items.length === 0 ? '<div class="muted">Nothing yet</div>' : items.map((f) => `<div class="item">
                <div class="item-main">
                  <div class="item-name">${esc(f.name)}</div>
                  <div class="muted small">${fmt(f.kcal)} calories · ${esc(f.portion || timeOf(f.createdAt))}</div>
                </div>
                <button type="button" class="btn-small" data-act="remove" data-id="${f.id}" aria-label="Remove ${esc(f.name)}">Remove</button>
              </div>`).join('')}
          </div>`;
      }).join('');

      return `<section class="screen">
          ${isToday ? '' : `<div class="warnbox">
            <div class="box-title">You are looking at a past day</div>
            <div class="day-arrows">
              <button type="button" class="btn-small" data-act="day" data-delta="-1">${icon('back')}Day before</button>
              <button type="button" class="btn-small" data-act="day" data-delta="1">Day after${icon('next')}</button>
            </div>
            <button type="button" class="btn-primary" data-act="tab" data-to="today">Go back to today</button>
          </div>`}

          <div class="day-head">
            <div>
              <h1 class="xl" tabindex="-1">${dayTitle(date)}</h1>
              <div class="muted">${longDate(date)}</div>
            </div>
            ${isToday ? '<button type="button" class="btn-text" data-act="day" data-delta="-1">See yesterday</button>' : ''}
          </div>

          ${noticeHtml()}

          <div class="card summary">
            <div class="summary-label">${over ? 'You have gone over by' : isToday ? 'You can still eat' : 'You had left'}</div>
            <div class="summary-number${over ? ' over' : ''}">${fmt(Math.abs(left))}</div>
            <div>${over
              ? (isToday ? 'calories. That is okay, tomorrow is a new day.' : 'calories that day.')
              : (isToday ? 'more calories today' : 'calories that day')}</div>
            <div class="bar"><div class="bar-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>
            <div class="muted small">${isToday ? 'You have eaten' : 'You ate'} ${fmt(total)} of your ${fmt(state.goal)} calories.</div>
          </div>

          <div class="stack">
            <button type="button" class="btn-primary btn-xl" data-act="start-add">${icon('plus')}${isToday ? 'Add what I ate' : 'Add food to this day'}</button>
            <button type="button" class="btn-secondary" data-act="go" data-to="weigh">
              ${icon('scale')}
              <span class="choice-text"><span class="d-block">${isToday ? 'Weigh myself' : 'Weight on this day'}</span><span class="choice-sub">${weightSub}</span></span>
            </button>
          </div>

          ${isStandalone() ? '' : `<div class="warnbox">
            <div class="box-title">Put this diary on your home screen</div>
            <div>It keeps your diary safe, and you can open it like any other app.</div>
            <button type="button" class="btn-small" data-act="go" data-to="help">Show me how</button>
          </div>`}

          ${needsBackup ? `<div class="warnbox">
            <div class="box-title">Keep your diary safe</div>
            <div>${lastBackup ? `You last saved a copy of your diary ${ago(lastBackup)}.` : 'You have not saved a copy of your diary yet.'}</div>
            <button type="button" class="btn-small" data-act="go" data-to="backup">Show me how</button>
          </div>` : ''}

          <h2>${isToday ? 'What I ate today' : 'What I ate that day'}</h2>
          ${meals}
        </section>`;
    },

    async food() {
      state.mine = summarizeFoods(await DB.getAllFoods());
      const isToday = state.date === todayKey();
      return `${topbar('today', 'Step 1 of 2')}
        <section class="screen">
          <h1 tabindex="-1">What did you eat?</h1>
          <div class="card row-card">
            <span>Adding to: <b>${state.meal}</b>${isToday ? '' : `, ${shortDate(state.date)}`}</span>
            <button type="button" class="btn-text" data-act="go" data-to="meal">Change</button>
          </div>
          <div class="field">
            <label class="label" for="food-search">Search for a food</label>
            <input id="food-search" class="input" type="search" placeholder="For example: rice" value="${esc(state.query)}" autocomplete="off" enterkeyhint="search">
          </div>
          <div id="food-results">${foodResults()}</div>
          <button type="button" class="btn-secondary center" data-act="start-custom">I can't find it. Let me type it in.</button>
        </section>`;
    },

    async meal() {
      const suggested = defaultMeal();
      return `${topbar('food')}
        <section class="screen">
          <h1 tabindex="-1">Which meal is this?</h1>
          <div class="stack">
            ${MEALS.map((m) => `<button type="button" class="choice${m === state.meal ? ' on' : ''}" data-act="pick-meal" data-meal="${m}">
                <span class="choice-text"><b>${m}</b>${m === suggested ? '<span class="choice-sub">Suggested for this time of day</span>' : ''}</span>
                ${m === state.meal ? icon('check', 'accent') : ''}
              </button>`).join('')}
          </div>
        </section>`;
    },

    async portion() {
      const f = state.food;
      if (!f) return SCREENS.food();
      return `${topbar('food', 'Step 2 of 2')}
        <section class="screen">
          <h1 tabindex="-1">How much did you have?</h1>
          <p class="food-name">${esc(f.name)}</p>
          <div class="stack">
            ${PORTIONS.map((p, i) => `<button type="button" class="choice portion" data-act="pick-portion" data-idx="${i}">
                <span class="portion-pic"><span class="portion-dot" style="width:${p.size}px;height:${p.size}px"></span></span>
                <span class="choice-text"><b>${p.label}</b><span class="choice-sub">About ${fmt(portionKcal(f, p))} calories</span></span>
              </button>`).join('')}
          </div>
          <p class="muted">Not sure? Choose "A normal amount". A rough guess is good enough.</p>
        </section>`;
    },

    async custom() {
      return `${topbar('food')}
        <section class="screen">
          <h1 tabindex="-1">Type it in yourself</h1>
          <div class="field">
            <label class="label" for="custom-name">What did you eat?</label>
            <input id="custom-name" class="input" type="text" maxlength="60" placeholder="For example: soup" value="${esc(state.customName)}" autocomplete="off" enterkeyhint="next">
          </div>
          <div class="field">
            <div class="label">About how many calories?</div>
            ${stepper({ id: 'custom-kcal', value: 300, unit: 'calories', step: 50, min: 1, max: 10000, decimals: 0, label: 'Calories' })}
          </div>
          <p class="muted">Not sure? A normal meal is about 500 calories. A snack is about 150.</p>
          <button type="button" class="btn-primary" data-act="add-custom">Add it</button>
        </section>`;
    },

    async weigh() {
      const date = state.date;
      const isToday = date === todayKey();
      const [w, prev] = await Promise.all([DB.getWeight(date), DB.getWeightBefore(date)]);
      const start = w ? w.kg : prev ? prev.kg : 70;
      let note;
      if (w) note = `Already saved for this day: ${w.kg.toFixed(1)} kg. Saving again will replace it.`;
      else if (prev) note = `Last time you weighed ${prev.kg.toFixed(1)} kg, on ${shortDate(prev.date)}.`;
      else note = 'This is your first weigh-in. Well done for starting!';
      return `${topbar('today')}
        <section class="screen">
          <h1 tabindex="-1">${isToday ? 'How much do you weigh today?' : `How much did you weigh on ${shortDate(date)}?`}</h1>
          <p class="muted">Step on your scale. Then press the buttons until the number matches. You can also tap the number to type it.</p>
          ${stepper({ id: 'weight-input', value: start.toFixed(1), unit: 'kilograms', step: 0.1, min: 20, max: 400, decimals: 1, label: 'Weight in kilograms', bigStep: 1, bigUnit: 'kg' })}
          <p class="muted">${note}</p>
          <button type="button" class="btn-primary" data-act="save-weight">Save my weight</button>
          ${w ? '<button type="button" class="btn-text danger" data-act="remove-weight">Remove this weight</button>' : ''}
        </section>`;
    },

    async progress() {
      const [foods, weights] = await Promise.all([DB.getAllFoods(), DB.getAllWeights()]);
      const t = todayKey();

      // Weight (weights come back sorted by date, their key)
      const monthAgo = addDays(t, -30);
      const recentW = weights.filter((w) => w.date >= monthAgo && w.date <= t);
      let wSentence;
      let wDetail;
      if (!weights.length) {
        wSentence = 'You have not weighed yourself yet.';
        wDetail = 'Tap "Weigh myself" on the Today screen to start.';
      } else if (recentW.length < 2) {
        const last = weights[weights.length - 1];
        wSentence = `Your last weight was ${last.kg.toFixed(1)} kg.`;
        wDetail = `That was on ${shortDate(last.date)}. Weigh yourself again to see how you are doing.`;
      } else {
        const first = recentW[0];
        const last = recentW[recentW.length - 1];
        const diff = Math.round((last.kg - first.kg) * 10) / 10;
        const since = shortDate(first.date);
        if (diff < 0) wSentence = `You have lost ${Math.abs(diff).toFixed(1)} kg since ${since}.`;
        else if (diff > 0) wSentence = `You have gained ${diff.toFixed(1)} kg since ${since}.`;
        else wSentence = `Your weight has stayed the same since ${since}.`;
        wDetail = `From ${first.kg.toFixed(1)} kg to ${last.kg.toFixed(1)} kg.`;
      }
      const lastWeighIns = weights.slice(-5).reverse();

      // Calories per day
      const kcalByDay = new Map();
      for (const f of foods) kcalByDay.set(f.date, (kcalByDay.get(f.date) || 0) + f.kcal);
      const days = [];
      for (let i = 0; i < state.daysShown; i++) {
        const d = addDays(t, -i);
        days.push({ date: d, kcal: kcalByDay.get(d) });
      }
      const week = days.slice(0, 7).filter((d) => d.kcal !== undefined);
      const within = week.filter((d) => d.kcal <= state.goal).length;
      const maxV = Math.max(2600, state.goal * 1.25, ...days.map((d) => d.kcal || 0));
      const goalPct = (state.goal / maxV) * 100;
      const weekSentence = week.length
        ? `You kept to your goal on ${within} of the ${week.length} ${week.length === 1 ? 'day' : 'days'} you wrote down this week.`
        : 'Write down what you eat, and your days will show up here.';

      return `<section class="screen">
          <h1 class="xl" tabindex="-1">My progress</h1>
          ${noticeHtml()}
          <div class="card">
            <div class="eyebrow">Your weight</div>
            <p class="big-sentence">${wSentence}</p>
            <p class="muted">${wDetail}</p>
            ${lastWeighIns.length ? `<ul class="kv">${lastWeighIns.map((w) => `<li><span>${dayLabel(w.date)}</span><span>${w.kg.toFixed(1)} kg</span></li>`).join('')}</ul>` : ''}
          </div>
          <div class="card">
            <div class="eyebrow">Your days</div>
            <p class="big-sentence">${weekSentence}</p>
            <p class="muted small">Tap a day to see what you ate.</p>
            ${days.map((d) => {
              const has = d.kcal !== undefined;
              const pct = has ? Math.max(2, (d.kcal / maxV) * 100) : 0;
              return `<button type="button" class="day-bar" data-act="open-day" data-date="${d.date}"
                  aria-label="${dayLabel(d.date)}: ${has ? `${fmt(d.kcal)} calories` : 'nothing written down'}">
                  <span class="day-bar-label">${dayLabel(d.date)}</span>
                  <span class="track">
                    <span class="fill${has && d.kcal > state.goal ? ' over' : ''}" style="width:${pct}%"></span>
                    <span class="goal-mark" style="left:${goalPct}%"></span>
                  </span>
                  <span class="day-bar-value">${has ? fmt(d.kcal) : '—'}</span>
                </button>`;
            }).join('')}
            <div class="legend">
              <span><i class="swatch"></i>Kept to my goal</span>
              <span><i class="swatch over"></i>Ate more than my goal</span>
              <span><i class="swatch goal"></i>My goal: ${fmt(state.goal)} calories</span>
            </div>
            ${state.daysShown < 90 ? '<button type="button" class="btn-text" data-act="more-days">Show more days</button>' : ''}
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
          ['Opened from home screen', isStandalone() ? 'Yes' : 'No'],
          ['Protected storage', persisted === true ? 'Yes' : persisted === false ? 'No' : 'Unknown'],
          ['Foods written down', fmt(foodCount)],
          ['Weigh-ins', fmt(weightCount)],
        ];
        if (estimate && estimate.usage !== undefined) rows.push(['Space used', `${(estimate.usage / 1024).toFixed(0)} KB`]);
        extra = `<div class="card">
            <p class="muted small">For people who are comfortable with files.</p>
            <button type="button" class="btn-small wide" data-act="export-csv">Download a spreadsheet (CSV)</button>
            <button type="button" class="btn-small wide" data-act="import">Bring back a saved copy</button>
            <ul class="kv">${rows.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join('')}</ul>
          </div>`;
      }
      return `<section class="screen">
          <h1 class="xl" tabindex="-1">More</h1>
          ${noticeHtml()}
          <div class="stack">
            <button type="button" class="choice" data-act="open-goal">
              ${icon('target', 'lead-icon')}
              <span class="choice-text"><b>Change my daily goal</b><span class="choice-sub">Now: ${fmt(state.goal)} calories a day</span></span>
              ${icon('next')}
            </button>
            ${navRow('backup', 'shield', 'Keep my diary safe', lastBackup ? `Last copy saved: ${ago(lastBackup)}` : 'No copy saved yet')}
            ${navRow('help', 'phone', 'Put this app on my home screen', isStandalone() ? 'Already done' : 'Step-by-step help')}
          </div>
          <button type="button" class="btn-text" data-act="toggle-advanced">${state.advanced ? 'Hide extra options' : 'Show extra options'}</button>
          ${extra}
        </section>`;
    },

    async backup() {
      const lastBackup = await DB.getSetting('lastBackup', null);
      const age = lastBackup ? (Date.now() - new Date(lastBackup).getTime()) / DAY_MS : Infinity;
      let status;
      if (!lastBackup) status = '<div class="warnbox"><div class="box-title">You have not saved a copy yet</div><div>We suggest saving a copy once a week.</div></div>';
      else if (age > BACKUP_REMINDER_DAYS) status = `<div class="warnbox"><div class="box-title">Last copy saved: ${ago(lastBackup)}</div><div>We suggest saving a copy once a week.</div></div>`;
      else status = `<div class="okbox"><div class="box-title">Last copy saved: ${ago(lastBackup)}</div></div>`;
      return `${topbar('@prev')}
        <section class="screen">
          <h1 tabindex="-1">Keep your diary safe</h1>
          <p class="lead">Your diary is kept only on this phone. If the app is deleted, or you get a new phone, your diary is lost unless you have saved a copy.</p>
          ${status}
          ${noticeHtml()}
          <button type="button" class="btn-primary" data-act="export-json">Save a copy now</button>
          <div class="card">
            <div class="box-title">What happens next</div>
            <p class="muted">Your phone will ask where to keep the copy. Tap <b>Save to Files</b>, then <b>iCloud Drive</b>, then <b>Save</b>.</p>
          </div>
          <div class="card">
            <div class="box-title">Getting your diary back</div>
            <p class="muted">On a new phone, open this app, go to <b>More</b>, tap <b>Show extra options</b>, then <b>Bring back a saved copy</b>.</p>
          </div>
        </section>`;
    },

    async help() {
      const step = (n, body) => `<div class="card step-card"><span class="stepnum">${n}</span>${body}</div>`;
      return `${topbar('@prev')}
        <section class="screen">
          <h1 tabindex="-1">Put this app on your home screen</h1>
          ${isStandalone()
            ? '<div class="okbox"><div class="box-title">You have already done this</div><div>You are using the diary from your home screen. Well done!</div></div>'
            : '<p class="muted">Then you can open it like any other app, and your diary stays safe.</p>'}
          <div class="stack">
            ${step(1, '<p>Open this page in <b>Safari</b>, the compass app.</p>')}
            ${step(2, `<div class="stack"><p>Tap the <b>Share</b> button at the bottom of the screen. It looks like this:</p><span class="share-pic">${icon('share')}</span></div>`)}
            ${step(3, '<p>Scroll down and tap <b>Add to Home Screen</b>.</p>')}
            ${step(4, '<p>Tap <b>Add</b>. From now on, always open the diary from its new icon. The copy in Safari keeps a separate diary.</p>')}
          </div>
        </section>`;
    },
  };

  const TABS = ['today', 'progress', 'more'];

  // The user's own past foods, one per name (latest version), most used first.
  function summarizeFoods(all) {
    const byName = new Map();
    for (const f of all) {
      const key = f.name.trim().toLowerCase();
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
    const q = state.query.trim().toLowerCase();
    const mineRow = (m, i) => `<button type="button" class="choice" data-act="add-again" data-idx="${i}">
        <span class="choice-text"><b>${esc(m.name)}</b><span class="choice-sub">Same as last time: ${fmt(m.kcal)} calories</span></span>
        ${icon('plus', 'accent')}
      </button>`;
    const builtRow = (f) => `<button type="button" class="choice" data-act="pick-food" data-idx="${FOODS.indexOf(f)}">
        <span class="choice-text"><b>${esc(f.name)}</b><span class="choice-sub">About ${fmt(f.kcal)} calories</span></span>
        ${icon('next')}
      </button>`;

    if (!q) {
      const usual = state.mine.slice(0, 4);
      return (usual.length ? `<h2>You often have</h2><div class="stack">${usual.map(mineRow).join('')}</div>` : '')
        + FOOD_GROUPS.map((g) => `<h2>${esc(g)}</h2><div class="stack">${FOODS.filter((f) => f.group === g).map(builtRow).join('')}</div>`).join('');
    }

    const mine = state.mine.map((m, i) => [m, i]).filter(([m]) => m.key.includes(q));
    const mineKeys = new Set(mine.map(([m]) => m.key));
    const built = FOODS.filter((f) => f.name.toLowerCase().includes(q) && !mineKeys.has(f.name.toLowerCase()));
    if (!mine.length && !built.length) {
      return `<p class="muted">We could not find "${esc(state.query.trim())}". You can type it in yourself below.</p>`;
    }
    return `<h2>Foods that match</h2><div class="stack">${mine.map(([m, i]) => mineRow(m, i)).join('')}${built.map(builtRow).join('')}</div>`;
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
    const where = state.date === todayKey() ? state.meal : `${state.meal} on ${shortDate(state.date)}`;
    await go('today', {
      query: '',
      notice: { text: `Added to ${where}: ${name}, ${fmt(kcal)} calories.`, undo: { type: 'add', id } },
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
      const done = (ok) => { goBtn.onclick = null; cancel.onclick = null; dlg.close(); resolve(ok); };
      goBtn.onclick = () => navigator.share({ files: [file] }).then(() => done(true), () => done(false));
      cancel.onclick = () => done(false);
      dlg.showModal();
    });
  }

  async function exportBackup() {
    const data = await DB.exportAll();
    const file = new File([JSON.stringify(data, null, 2)], `food-diary-copy-${todayKey()}.json`, { type: 'application/json' });
    if (!(await saveFile(file))) return;
    await DB.setSetting('lastBackup', new Date().toISOString());
    state.notice = { text: 'A copy of your diary has been saved. Well done!' };
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
      state.notice = { text: 'Spreadsheet saved.' };
      await render();
    }
  }

  // Validates a backup file and returns clean records (unknown fields dropped).
  function cleanBackup(d) {
    if (!d || d.app !== 'calorie-tracker' || !Array.isArray(d.foods) || !Array.isArray(d.weights)) {
      throw new Error('this is not a copy of this diary');
    }
    const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const foods = d.foods.map((f, i) => {
      if (!f || !isDate(f.date) || typeof f.name !== 'string' || !Number.isFinite(f.kcal) || f.kcal < 0) {
        throw new Error(`food number ${i + 1} is damaged`);
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
      if (!w || !isDate(w.date) || !Number.isFinite(w.kg) || w.kg <= 0) throw new Error(`weight number ${i + 1} is damaged`);
      return { date: w.date, kg: w.kg, updatedAt: typeof w.updatedAt === 'string' ? w.updatedAt : `${w.date}T12:00:00` };
    });
    const settings = [{ key: 'onboarded', value: true }];
    const find = (key) => (d.settings || []).find((s) => s && s.key === key);
    const goal = find('goal');
    if (goal && Number.isInteger(goal.value) && goal.value >= GOAL_MIN && goal.value <= GOAL_MAX) settings.push({ key: 'goal', value: goal.value });
    const goalType = find('goalType');
    if (goalType && GOAL_TYPES[goalType.value]) settings.push({ key: 'goalType', value: goalType.value });
    return { foods, weights, settings, exportedAt: d.exportedAt };
  }

  async function importBackup(file) {
    let data;
    try {
      data = cleanBackup(JSON.parse(await file.text()));
    } catch (err) {
      state.notice = { kind: 'error', text: `This file cannot be used: ${err instanceof SyntaxError ? 'it is not a saved copy of the diary' : err.message}.` };
      await render();
      return;
    }
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'an unknown date';
    const ok = await confirmDialog(
      'Replace your diary with this copy?',
      `This copy was saved on ${when}. It has ${fmt(data.foods.length)} foods and ${fmt(data.weights.length)} weigh-ins.\n\nEverything in the diary now will be replaced by this copy.`,
      'Yes, replace it',
    );
    if (!ok) return;
    await DB.replaceAll(data);
    state.goal = await DB.getSetting('goal', DEFAULT_GOAL);
    state.goalType = await DB.getSetting('goalType', 'keep');
    state.date = todayKey();
    await go('today', { notice: { text: 'Your diary has been brought back.' } });
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
    'pick-goal-type': (el) => {
      state.goalType = el.dataset.type;
      state.goalDraft = GOAL_TYPES[el.dataset.type].kcal;
      return go('goalSet');
    },
    'goal-help': () => go('goalType'),
    'open-goal': () => go('goalSet', { goalDraft: state.goal, goalFrom: 'more' }),
    'save-goal': async () => {
      const goal = parseNum($('#goal-input').value);
      if (!(Number.isInteger(goal) && goal >= GOAL_MIN && goal <= GOAL_MAX)) {
        fieldError('goal-input', `Please choose a number between ${fmt(GOAL_MIN)} and ${fmt(GOAL_MAX)}.`);
        return;
      }
      await DB.setSetting('goal', goal);
      await DB.setSetting('goalType', state.goalType);
      state.goal = goal;
      if (state.goalFrom === 'onboarding') {
        await DB.setSetting('onboarded', true);
        await go('today', { notice: { text: 'You are all set! Tap "Add what I ate" each time you eat something.' } });
      } else {
        await go('more', { notice: { text: `Your daily goal is now ${fmt(goal)} calories.` } });
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
      state.notice = { text: `Removed ${food.name}.`, undo: { type: 'remove', food } };
      await render();
    },
    undo: async () => {
      const u = state.notice && state.notice.undo;
      if (!u) return;
      if (u.type === 'add') await DB.deleteFood(u.id);
      else await DB.addFood(u.food);
      state.notice = { text: 'Okay, that has been undone.' };
      await render();
    },

    // Adding food
    'start-add': () => go('food', { query: '', meal: defaultMeal() }),
    'pick-meal': (el) => go('food', { meal: el.dataset.meal }),
    'pick-food': (el) => go('portion', { food: FOODS[Number(el.dataset.idx)] }),
    'pick-portion': (el) => {
      const p = PORTIONS[Number(el.dataset.idx)];
      return addEntry(state.food.name, portionKcal(state.food, p), p.label.toLowerCase());
    },
    'add-again': (el) => {
      const m = state.mine[Number(el.dataset.idx)];
      return addEntry(m.name, m.kcal, m.portion);
    },
    'start-custom': () => go('custom', { customName: state.query.trim() }),
    'add-custom': () => {
      const name = $('#custom-name').value.trim().slice(0, 60) || 'Something else';
      const kcal = Math.round(parseNum($('#custom-kcal').value));
      if (!(kcal >= 1 && kcal <= 10000)) {
        fieldError('custom-kcal', 'Please choose a number between 1 and 10,000.');
        return;
      }
      return addEntry(name, kcal);
    },

    // Weight
    'save-weight': async () => {
      const kg = parseNum($('#weight-input').value);
      if (!(kg >= 20 && kg <= 400)) {
        fieldError('weight-input', 'Please choose a weight between 20 and 400 kg.');
        return;
      }
      const value = Math.round(kg * 10) / 10;
      await DB.setWeight(state.date, value);
      await go('today', { notice: { text: `Weight saved: ${value.toFixed(1)} kg.` } });
    },
    'remove-weight': async () => {
      const ok = await confirmDialog('Remove this weight?', `The weight saved for ${shortDate(state.date)} will be removed.`, 'Yes, remove it');
      if (!ok) return;
      await DB.deleteWeight(state.date);
      await go('today', { notice: { text: 'Weight removed.' } });
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

  // "Done" on the keyboard closes it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input')) return;
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
    const t = todayKey();
    if (t === lastSeenToday) return;
    if (state.date === lastSeenToday) state.date = t;
    lastSeenToday = t;
    if (TABS.includes(state.screen)) render().catch(showError);
  });

  window.addEventListener('unhandledrejection', (e) => showError(e.reason));

  // ---------- Start ----------
  async function init() {
    try {
      await DB.open();
      const [goal, goalType, onboarded, foodCount, weightCount] = await Promise.all([
        DB.getSetting('goal', DEFAULT_GOAL),
        DB.getSetting('goalType', 'keep'),
        DB.getSetting('onboarded', false),
        DB.count('foods'),
        DB.count('weights'),
      ]);
      state.goal = goal;
      state.goalType = GOAL_TYPES[goalType] ? goalType : 'keep';
      if (!onboarded) {
        if (foodCount + weightCount > 0) {
          // Existing users of the earlier version skip the welcome screens.
          await DB.setSetting('onboarded', true);
        } else {
          state.screen = 'welcome';
          state.goalFrom = 'onboarding';
          state.goalDraft = GOAL_TYPES[state.goalType].kcal;
        }
      }
    } catch (err) {
      $('#app').innerHTML = `<section class="screen"><div class="card">
          <h1>Your diary cannot be opened</h1>
          <p>This browser is blocking storage on the phone, so nothing can be saved. Make sure you are not using Private Browsing, then open the app again.</p>
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
