'use strict';

(() => {
  const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  const DEFAULT_GOAL = 2000;
  const BACKUP_REMINDER_DAYS = 7;
  const DAY_MS = 86400000;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = { date: todayKey(), goal: DEFAULT_GOAL, range: 30, tab: 'today' };
  let lastSeenToday = state.date;

  // ---------- Dates: always local time (YYYY-MM-DD), never UTC ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function toKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function todayKey() { return toKey(new Date()); }
  function fromKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(k, n) { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); }
  function shortDate(k) { return fromKey(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
  function longDate(k) { return fromKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); }
  function dayTitle(k) {
    const t = todayKey();
    if (k === t) return 'Today';
    if (k === addDays(t, -1)) return 'Yesterday';
    return fromKey(k).toLocaleDateString(undefined, { weekday: 'long' });
  }
  function timeOf(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

  // Accepts "72.4" or "72,4" (some iPhone regions show a comma on the decimal keypad).
  function parseNum(raw) {
    const s = String(raw).trim().replace(',', '.');
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  let toastTimer;
  function toast(msg, kind = 'ok') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 4000 : 2200);
  }

  function showError(err) {
    console.error(err);
    toast(`Something went wrong: ${(err && err.message) || err}`, 'error');
  }

  // Wraps an async event handler so failures are always shown to the user.
  const handle = (fn) => (e) => Promise.resolve(fn(e)).catch(showError);

  async function busy(button, fn) {
    button.disabled = true;
    try { return await fn(); } finally { button.disabled = false; }
  }

  // ---------- Rendering ----------
  function render() {
    const views = { today: renderToday, history: renderHistory, settings: renderSettings };
    return views[state.tab]().catch(showError);
  }

  async function renderToday() {
    const date = state.date;
    const today = todayKey();
    const [foods, weight, prev, allFoods, lastBackup, foodCount, weightCount] = await Promise.all([
      DB.getFoodsByDate(date),
      DB.getWeight(date),
      DB.getWeightBefore(date),
      DB.getAllFoods(),
      DB.getSetting('lastBackup', null),
      DB.count('foods'),
      DB.count('weights'),
    ]);

    // Day header
    $('#day-title').textContent = dayTitle(date);
    $('#day-sub').textContent = longDate(date);
    $('#day-picker').value = date;
    $('#day-picker').max = today;
    $('#next-day').disabled = date >= today;

    // Banners
    $('#install-banner').hidden = isStandalone();
    const backupAge = lastBackup ? (Date.now() - new Date(lastBackup).getTime()) / DAY_MS : Infinity;
    const needsBackup = foodCount + weightCount > 0 && backupAge > BACKUP_REMINDER_DAYS;
    $('#backup-banner').hidden = !needsBackup;
    $('#backup-banner-text').textContent = lastBackup
      ? `Last backup was ${Math.floor(backupAge)} days ago.`
      : "You haven't made a backup yet.";

    // Calorie summary
    const total = foods.reduce((s, f) => s + f.kcal, 0);
    const left = state.goal - total;
    $('#kcal-eaten').textContent = fmt(total);
    $('#kcal-left').textContent = fmt(Math.abs(left));
    $('#kcal-left-label').textContent = left >= 0 ? 'kcal left' : 'kcal over';
    $('.summary').classList.toggle('over', left < 0);
    $('#kcal-bar').style.width = `${Math.min(100, (total / state.goal) * 100)}%`;
    $('#kcal-goal').textContent = `Goal ${fmt(state.goal)} kcal`;

    // Weight
    const wi = $('#weight-input');
    if (document.activeElement !== wi) wi.value = weight ? weight.kg.toFixed(1) : '';
    wi.placeholder = prev ? prev.kg.toFixed(1) : 'e.g. 70.0';
    $('#weight-save').textContent = weight ? 'Update' : 'Save';
    let note;
    if (weight) {
      note = `Saved ${weight.kg.toFixed(1)} kg`;
      if (prev) note += ` · ${signed(weight.kg - prev.kg)} kg since ${shortDate(prev.date)}`;
    } else {
      note = prev ? `Not logged for this day. Last: ${prev.kg.toFixed(1)} kg on ${shortDate(prev.date)}.` : 'Not logged for this day.';
    }
    $('#weight-note').textContent = note;

    // Recent foods (most recent first, unique by name)
    const recent = [];
    const seen = new Set();
    for (let i = allFoods.length - 1; i >= 0 && recent.length < 8; i--) {
      const key = allFoods[i].name.toLowerCase();
      if (!seen.has(key)) { seen.add(key); recent.push(allFoods[i]); }
    }
    $('#recent-wrap').hidden = recent.length === 0;
    $('#recent').innerHTML = recent.map((f) =>
      `<button type="button" class="chip" data-name="${esc(f.name)}" data-kcal="${f.kcal}">${esc(f.name)}<b>${fmt(f.kcal)}</b></button>`).join('');

    // Food list grouped by meal
    $('#food-list').innerHTML = foods.length === 0
      ? '<p class="empty">Nothing logged for this day.</p>'
      : MEALS.map((meal) => {
        const items = foods.filter((f) => f.meal === meal);
        if (!items.length) return '';
        const sub = items.reduce((s, f) => s + f.kcal, 0);
        return `<div class="meal">
          <div class="meal-head"><span>${meal}</span><span>${fmt(sub)} kcal</span></div>
          ${items.map((f) => `<div class="item">
            <div class="item-main"><div class="item-name">${esc(f.name)}</div><div class="muted small">${timeOf(f.createdAt)}</div></div>
            <div class="item-kcal">${fmt(f.kcal)}</div>
            <button type="button" class="del" data-del="${f.id}" aria-label="Delete ${esc(f.name)}">&times;</button>
          </div>`).join('')}
        </div>`;
      }).join('');
  }

  async function renderHistory() {
    const [foods, weights] = await Promise.all([DB.getAllFoods(), DB.getAllWeights()]);
    const today = todayKey();
    const from = state.range ? addDays(today, -(state.range - 1)) : '0000-00-00';
    const inRange = (d) => d >= from && d <= today;

    $$('#range-seg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.range) === state.range));

    const pts = weights.filter((w) => inRange(w.date)); // already sorted by date (the key)
    $('#weight-chart').innerHTML = weightChart(pts);

    const days = new Map();
    for (const f of foods) {
      if (!inRange(f.date)) continue;
      const d = days.get(f.date) || { kcal: 0, n: 0 };
      d.kcal += f.kcal;
      d.n += 1;
      days.set(f.date, d);
    }
    const wmap = new Map(pts.map((w) => [w.date, w.kg]));

    const stats = [];
    if (pts.length) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      stats.push(['Latest weight', `${last.kg.toFixed(1)} kg`]);
      stats.push(['Change', pts.length > 1 ? `${signed(last.kg - first.kg)} kg` : '—']);
    }
    if (days.size) {
      const avg = [...days.values()].reduce((s, d) => s + d.kcal, 0) / days.size;
      stats.push(['Avg intake / day', `${fmt(avg)} kcal`]);
      stats.push(['Days with food logged', String(days.size)]);
    }
    $('#history-stats').innerHTML = stats.map(([l, v]) => `<div class="stat"><div class="stat-v">${v}</div><div class="stat-l">${l}</div></div>`).join('');

    const dates = [...new Set([...days.keys(), ...wmap.keys()])].sort().reverse();
    $('#day-list').innerHTML = dates.length === 0
      ? '<p class="empty">No entries in this period.</p>'
      : '<div class="day-row day-head"><span>Day</span><span class="r">Calories</span><span class="r">Weight</span></div>'
        + dates.map((d) => {
          const k = days.get(d);
          const kg = wmap.get(d);
          return `<button type="button" class="day-row" data-date="${d}">
            <span>${shortDate(d)}</span>
            <span class="r ${k && k.kcal > state.goal ? 'over' : ''}">${k ? fmt(k.kcal) : '—'}</span>
            <span class="r">${kg !== undefined ? kg.toFixed(1) : '—'}</span>
          </button>`;
        }).join('');
  }

  function weightChart(pts) {
    if (!pts.length) return '<p class="empty">No weight logged in this period.</p>';
    const W = 340, H = 190, L = 36, R = 10, T = 10, B = 24;
    const ts = pts.map((p) => fromKey(p.date).getTime());
    const kg = pts.map((p) => p.kg);
    let x0 = ts[0], x1 = ts[ts.length - 1];
    if (x1 - x0 < DAY_MS) { x0 -= DAY_MS; x1 += DAY_MS; }
    let y0 = Math.min(...kg), y1 = Math.max(...kg);
    const padY = Math.max(0.5, (y1 - y0) * 0.15);
    y0 -= padY; y1 += padY;
    const X = (t) => L + ((t - x0) / (x1 - x0)) * (W - L - R);
    const Y = (v) => T + ((y1 - v) / (y1 - y0)) * (H - T - B);

    // 7-day trailing average smooths out daily water-weight swings.
    const trend = pts.map((_, i) => {
      let sum = 0, n = 0;
      for (let j = i; j >= 0 && ts[i] - ts[j] < 7 * DAY_MS; j--) { sum += kg[j]; n++; }
      return sum / n;
    });

    let svg = '';
    for (let i = 0; i <= 3; i++) {
      const v = y0 + ((y1 - y0) * i) / 3;
      svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/>`;
      svg += `<text class="axis" x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${v.toFixed(1)}</text>`;
    }
    const label = (k) => fromKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    svg += `<text class="axis" x="${L}" y="${H - 6}" text-anchor="start">${label(pts[0].date)}</text>`;
    if (pts.length > 1) svg += `<text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${label(pts[pts.length - 1].date)}</text>`;
    svg += pts.map((p, i) => `<circle class="dot" cx="${X(ts[i])}" cy="${Y(p.kg)}" r="2.8"/>`).join('');
    if (pts.length > 1) {
      svg += `<polyline class="trend" points="${trend.map((v, i) => `${X(ts[i])},${Y(v)}`).join(' ')}"/>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight over time">${svg}</svg>
      <div class="legend"><span><i class="lg-dot"></i>Daily</span><span><i class="lg-line"></i>7-day average</span></div>`;
  }

  async function renderSettings() {
    const gi = $('#goal-input');
    if (document.activeElement !== gi) gi.value = state.goal;

    const storage = navigator.storage || {};
    const [foodCount, weightCount, lastBackup, persisted, estimate] = await Promise.all([
      DB.count('foods'),
      DB.count('weights'),
      DB.getSetting('lastBackup', null),
      storage.persisted ? storage.persisted().catch(() => null) : null,
      storage.estimate ? storage.estimate().catch(() => null) : null,
    ]);

    $('#backup-status').textContent = lastBackup
      ? `Last backup: ${new Date(lastBackup).toLocaleString()}`
      : 'No backup made yet.';

    const rows = [
      ['Installed to Home Screen', isStandalone() ? 'Yes' : 'No'],
      ['Persistent storage', persisted === true ? 'Granted' : persisted === false ? 'Not granted' : 'Unknown'],
      ['Food entries', fmt(foodCount)],
      ['Weight entries', fmt(weightCount)],
    ];
    if (estimate && estimate.usage !== undefined) rows.push(['Space used', `${(estimate.usage / 1024).toFixed(0)} KB`]);
    $('#storage-info').innerHTML = rows.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join('');
    $('#install-card').hidden = isStandalone();
  }

  // ---------- Navigation ----------
  function switchTab(tab) {
    state.tab = tab;
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== tab; });
    $$('.tabbar button').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    render();
  }

  function goToDate(date) {
    const today = todayKey();
    state.date = date > today ? today : date;
    renderToday().catch(showError);
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
      const go = $('#share-dialog-go');
      const cancel = $('#share-dialog-cancel');
      $('#share-dialog-name').textContent = file.name;
      const done = (ok) => { go.onclick = null; cancel.onclick = null; dlg.close(); resolve(ok); };
      go.onclick = () => navigator.share({ files: [file] }).then(() => done(true), () => done(false));
      cancel.onclick = () => done(false);
      dlg.showModal();
    });
  }

  async function exportBackup() {
    const data = await DB.exportAll();
    const file = new File([JSON.stringify(data, null, 2)], `calorie-backup-${todayKey()}.json`, { type: 'application/json' });
    if (!(await saveFile(file))) return;
    await DB.setSetting('lastBackup', new Date().toISOString());
    toast(`Backup exported (${data.foods.length} foods, ${data.weights.length} weights)`);
    render();
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
    const file = new File([lines.join('\n') + '\n'], `calorie-log-${todayKey()}.csv`, { type: 'text/csv' });
    if (await saveFile(file)) toast('Spreadsheet exported');
  }

  // Validates a backup file and returns clean records (unknown fields dropped).
  function cleanBackup(d) {
    if (!d || d.app !== 'calorie-tracker' || !Array.isArray(d.foods) || !Array.isArray(d.weights)) {
      throw new Error('this is not a Calorie Tracker backup');
    }
    const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const foods = d.foods.map((f, i) => {
      if (!f || !isDate(f.date) || typeof f.name !== 'string' || !Number.isFinite(f.kcal) || f.kcal < 0) {
        throw new Error(`food entry #${i + 1} is damaged`);
      }
      const clean = {
        date: f.date,
        name: f.name.slice(0, 60),
        kcal: Math.round(f.kcal),
        meal: MEALS.includes(f.meal) ? f.meal : 'Snack',
        createdAt: typeof f.createdAt === 'string' ? f.createdAt : `${f.date}T12:00:00`,
      };
      if (Number.isInteger(f.id) && f.id > 0) clean.id = f.id;
      return clean;
    });
    const weights = d.weights.map((w, i) => {
      if (!w || !isDate(w.date) || !Number.isFinite(w.kg) || w.kg <= 0) throw new Error(`weight entry #${i + 1} is damaged`);
      return { date: w.date, kg: w.kg, updatedAt: typeof w.updatedAt === 'string' ? w.updatedAt : `${w.date}T12:00:00` };
    });
    const settings = [];
    const goal = (d.settings || []).find((s) => s && s.key === 'goal');
    if (goal && Number.isInteger(goal.value) && goal.value >= 500 && goal.value <= 10000) settings.push({ key: 'goal', value: goal.value });
    return { foods, weights, settings, exportedAt: d.exportedAt };
  }

  async function importBackup(file) {
    let data;
    try {
      data = cleanBackup(JSON.parse(await file.text()));
    } catch (err) {
      toast(`Can't restore: ${err instanceof SyntaxError ? 'the file is not valid JSON' : err.message}`, 'error');
      return;
    }
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date';
    const ok = confirm(`Restore backup from ${when}?\n\nIt contains ${data.foods.length} food entries and ${data.weights.length} weight entries.\n\nThis REPLACES everything currently in the app.`);
    if (!ok) return;
    await DB.replaceAll(data);
    state.goal = await DB.getSetting('goal', DEFAULT_GOAL);
    toast('Backup restored');
    render();
  }

  async function ensurePersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
        await navigator.storage.persist();
      }
    } catch (_) { /* not supported: data is still saved, just evictable */ }
  }

  // ---------- Events ----------
  $('#prev-day').addEventListener('click', () => goToDate(addDays(state.date, -1)));
  $('#next-day').addEventListener('click', () => goToDate(addDays(state.date, 1)));
  $('#day-picker').addEventListener('change', (e) => { if (e.target.value) goToDate(e.target.value); });

  $('#food-form').addEventListener('submit', handle(async (e) => {
    e.preventDefault();
    const nameEl = $('#food-name');
    const kcalEl = $('#food-kcal');
    const name = nameEl.value.trim().slice(0, 60) || 'Food';
    const kcal = Math.round(parseNum(kcalEl.value));
    if (!(kcal >= 1 && kcal <= 10000)) {
      toast('Enter calories as a number between 1 and 10,000', 'error');
      kcalEl.focus();
      return;
    }
    const meal = $('#food-meal').value;
    await busy($('#food-save'), () => DB.addFood({ date: state.date, name, kcal, meal, createdAt: new Date().toISOString() }));
    nameEl.value = '';
    kcalEl.value = '';
    kcalEl.blur();
    toast(`Saved: ${name} · ${fmt(kcal)} kcal`);
    await renderToday();
  }));

  $('#recent').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $('#food-name').value = chip.dataset.name;
    $('#food-kcal').value = chip.dataset.kcal;
  });

  $('#food-list').addEventListener('click', handle(async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const id = Number(btn.dataset.del);
    const food = await DB.getFood(id);
    if (!food || !confirm(`Delete "${food.name}" (${fmt(food.kcal)} kcal)?`)) return;
    await DB.deleteFood(id);
    toast('Entry deleted');
    await renderToday();
  }));

  $('#weight-form').addEventListener('submit', handle(async (e) => {
    e.preventDefault();
    const input = $('#weight-input');
    const raw = input.value.trim();
    if (!raw) {
      const existing = await DB.getWeight(state.date);
      if (!existing) { toast('Enter your weight in kg', 'error'); return; }
      if (!confirm(`Remove the weight logged for ${shortDate(state.date)}?`)) return;
      await DB.deleteWeight(state.date);
      toast('Weight removed');
      await renderToday();
      return;
    }
    const kg = parseNum(raw);
    if (!(kg >= 20 && kg <= 400)) {
      toast('Enter a weight between 20 and 400 kg', 'error');
      input.focus();
      return;
    }
    const value = Math.round(kg * 10) / 10;
    await busy($('#weight-save'), () => DB.setWeight(state.date, value));
    input.blur();
    toast(`Weight saved: ${value.toFixed(1)} kg`);
    await renderToday();
  }));

  $('#goal-form').addEventListener('submit', handle(async (e) => {
    e.preventDefault();
    const input = $('#goal-input');
    const goal = parseNum(input.value);
    if (!(Number.isInteger(goal) && goal >= 500 && goal <= 10000)) {
      toast('Enter a whole number between 500 and 10,000', 'error');
      return;
    }
    await DB.setSetting('goal', goal);
    state.goal = goal;
    input.blur();
    toast(`Daily goal set to ${fmt(goal)} kcal`);
  }));

  $('#range-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.range = Number(b.dataset.range);
    render();
  });

  $('#day-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-date]');
    if (!row) return;
    state.date = row.dataset.date;
    switchTab('today');
  });

  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  document.addEventListener('click', handle(async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'export-json') await exportBackup();
    else if (action === 'export-csv') await exportCSV();
    else if (action === 'import') $('#import-file').click();
  }));

  $('#import-file').addEventListener('change', handle(async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importBackup(file);
  }));

  // If the app stays open past midnight, move "Today" forward when it comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const t = todayKey();
    if (t === lastSeenToday) return;
    if (state.date === lastSeenToday) state.date = t;
    lastSeenToday = t;
    $('#food-meal').value = defaultMeal();
    render();
  });

  window.addEventListener('unhandledrejection', (e) => showError(e.reason));

  // ---------- Start ----------
  async function init() {
    try {
      await DB.open();
      state.goal = await DB.getSetting('goal', DEFAULT_GOAL);
    } catch (err) {
      document.querySelector('main').innerHTML = `<div class="card fatal"><h2>Storage unavailable</h2>
        <p>This browser is blocking on-device storage, so entries cannot be saved. Make sure you are not in Private Browsing, then reopen the app.</p>
        <p class="muted small">${esc(err.message || err)}</p></div>`;
      return;
    }
    $('#food-meal').value = defaultMeal();
    await render();
    await ensurePersistentStorage();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline support unavailable:', err));
    });
  }

  init();
})();
