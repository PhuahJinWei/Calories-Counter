'use strict';

// On-device storage (IndexedDB). Every write runs in a transaction and only
// resolves once the browser reports the transaction as committed, so the UI
// never says "Saved" for data that is not actually on disk.
const DB = (() => {
  const NAME = 'calorie-tracker';
  // v1: foods, weights, settings. v2: adds steps. Upgrades only ever ADD stores,
  // so existing entries are kept when a phone moves to a newer version.
  const VERSION = 2;
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
          reject(new Error('IndexedDB is not available in this browser'));
          return;
        }
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('foods')) {
            const foods = db.createObjectStore('foods', { keyPath: 'id', autoIncrement: true });
            foods.createIndex('date', 'date');
          }
          if (!db.objectStoreNames.contains('weights')) {
            db.createObjectStore('weights', { keyPath: 'date' });
          }
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('steps')) {
            db.createObjectStore('steps', { keyPath: 'date' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          // A newer version of the app was opened elsewhere: let it upgrade.
          db.onversionchange = () => { db.close(); location.reload(); };
          resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Database is blocked by another open copy of the app'));
      }).catch((err) => { dbPromise = null; throw err; });
    }
    return dbPromise;
  }

  // Runs fn(transaction) and resolves with its result after the transaction
  // completes. fn may return an IDBRequest (resolved to request.result) or
  // any other value (resolved as-is).
  function run(stores, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = mode === 'readwrite'
        ? db.transaction(stores, mode, { durability: 'strict' })
        : db.transaction(stores, mode);
      let out;
      try {
        out = fn(t);
      } catch (err) {
        try { t.abort(); } catch (_) { /* already finished */ }
        reject(err);
        return;
      }
      t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('The save was cancelled'));
    }));
  }

  const getAll = (store) => run(store, 'readonly', (t) => t.objectStore(store).getAll());

  return {
    open,

    addFood: (food) => run('foods', 'readwrite', (t) => t.objectStore('foods').add(food)),
    deleteFood: (id) => run('foods', 'readwrite', (t) => { t.objectStore('foods').delete(id); }),
    // Save changes to one logged food (same id).
    updateFood: (food) => run('foods', 'readwrite', (t) => { t.objectStore('foods').put(food); }),
    // Save changes to several foods in one transaction (all or nothing), e.g. renaming a dish.
    putFoods: (foods) => run('foods', 'readwrite', (t) => {
      const store = t.objectStore('foods');
      foods.forEach((f) => store.put(f));
    }),
    getFood: (id) => run('foods', 'readonly', (t) => t.objectStore('foods').get(id)),
    getFoodsByDate: (date) => run('foods', 'readonly', (t) => t.objectStore('foods').index('date').getAll(date)),
    getAllFoods: () => getAll('foods'),

    setWeight: (date, kg) => run('weights', 'readwrite', (t) => {
      t.objectStore('weights').put({ date, kg, updatedAt: new Date().toISOString() });
    }),
    deleteWeight: (date) => run('weights', 'readwrite', (t) => { t.objectStore('weights').delete(date); }),
    getWeight: (date) => run('weights', 'readonly', (t) => t.objectStore('weights').get(date)),
    getAllWeights: () => getAll('weights'),
    // Most recent weight entry strictly before the given date.
    getWeightBefore: (date) => run('weights', 'readonly', (t) => {
      const holder = {};
      const req = t.objectStore('weights').openCursor(IDBKeyRange.upperBound(date, true), 'prev');
      req.onsuccess = () => { holder.value = req.result ? req.result.value : undefined; };
      return holder;
    }).then((holder) => holder.value),

    setSteps: (date, count) => run('steps', 'readwrite', (t) => {
      t.objectStore('steps').put({ date, count, updatedAt: new Date().toISOString() });
    }),
    deleteSteps: (date) => run('steps', 'readwrite', (t) => { t.objectStore('steps').delete(date); }),
    getSteps: (date) => run('steps', 'readonly', (t) => t.objectStore('steps').get(date)),
    getAllSteps: () => getAll('steps'),

    count: (store) => run(store, 'readonly', (t) => t.objectStore(store).count()),

    getSetting: (key, fallback) => run('settings', 'readonly', (t) => t.objectStore('settings').get(key))
      .then((row) => (row === undefined ? fallback : row.value)),
    setSetting: (key, value) => run('settings', 'readwrite', (t) => { t.objectStore('settings').put({ key, value }); }),

    // One read transaction so the backup is a consistent snapshot.
    exportAll: () => run(['foods', 'weights', 'steps', 'settings'], 'readonly', (t) => ({
      foods: t.objectStore('foods').getAll(),
      weights: t.objectStore('weights').getAll(),
      steps: t.objectStore('steps').getAll(),
      settings: t.objectStore('settings').getAll(),
    })).then((r) => ({
      app: 'calorie-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      foods: r.foods.result,
      weights: r.weights.result,
      steps: r.steps.result,
      settings: r.settings.result.filter((s) => s.key !== 'lastBackup'),
    })),

    // One write transaction: if any record fails, nothing is changed.
    // Backups made before steps existed simply have no steps.
    replaceAll: (data) => run(['foods', 'weights', 'steps', 'settings'], 'readwrite', (t) => {
      const foods = t.objectStore('foods');
      const weights = t.objectStore('weights');
      const steps = t.objectStore('steps');
      const settings = t.objectStore('settings');
      foods.clear();
      weights.clear();
      steps.clear();
      data.foods.forEach((f) => foods.put(f));
      data.weights.forEach((w) => weights.put(w));
      (data.steps || []).forEach((s) => steps.put(s));
      data.settings.forEach((s) => settings.put(s));
    }),
  };
})();
