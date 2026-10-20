/* =========================================================
   StockVault — IndexedDB core
   Opens StockVaultDB, defines schema v1, exposes transaction
   helpers used by every repository. No business logic here.
   ========================================================= */

export const DB_NAME = 'StockVaultDB';
export const DB_VERSION = 1;

/* Store names — import these instead of hardcoding strings */
export const STORES = Object.freeze({
  PRODUCTS:       'products',
  CATEGORIES:     'categories',
  SUPPLIERS:      'suppliers',
  STOCK_MOVEMENTS:'stockMovements',
  PURCHASE_ORDERS:'purchaseOrders',
  SETTINGS:       'settings',
});

/* ---------- Module state ---------- */
let dbPromise = null;
let openError = null;

/* =========================================================
   OPEN / UPGRADE
   ========================================================= */

export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      const err = new Error('IndexedDB is not available in this browser.');
      openError = err;
      reject(err);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      const oldVersion = event.oldVersion;
      try {
        upgrade(db, tx, oldVersion);
      } catch (err) {
        // Abort the upgrade transaction so the DB is not left half-created.
        try { tx.abort(); } catch {}
        console.error('[db] upgrade failed', err);
        openError = err;
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      // Handle schema changes requested by another tab while we hold the DB.
      db.onversionchange = () => {
        db.close();
        // A later phase may show a "please reload" toast here.
        console.warn('[db] version change — closing DB. Reload to continue.');
      };

      resolve(db);
    };

    request.onerror = () => {
      const err = request.error || new Error('Failed to open IndexedDB.');
      openError = err;
      reject(err);
    };

    request.onblocked = () => {
      console.warn('[db] open blocked — another tab may be using an older version.');
    };
  });

  return dbPromise;
}

/* ---------- Schema definition ---------- */

function upgrade(db, tx, oldVersion) {
  // v0 -> v1
  if (oldVersion < 1) {
    /* products */
    if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
      const products = db.createObjectStore(STORES.PRODUCTS, { keyPath: 'id' });
      products.createIndex('sku', 'sku', { unique: false }); // enforced in repo, case-insensitive
      products.createIndex('name', 'name', { unique: false });
      products.createIndex('categoryId', 'categoryId', { unique: false });
      products.createIndex('supplierId', 'supplierId', { unique: false });
      products.createIndex('archived', 'archived', { unique: false });
      products.createIndex('updatedAt', 'updatedAt', { unique: false });
    }

    /* categories */
    if (!db.objectStoreNames.contains(STORES.CATEGORIES)) {
      const categories = db.createObjectStore(STORES.CATEGORIES, { keyPath: 'id' });
      categories.createIndex('name', 'name', { unique: false });
      categories.createIndex('createdAt', 'createdAt', { unique: false });
    }

    /* suppliers */
    if (!db.objectStoreNames.contains(STORES.SUPPLIERS)) {
      const suppliers = db.createObjectStore(STORES.SUPPLIERS, { keyPath: 'id' });
      suppliers.createIndex('name', 'name', { unique: false });
      suppliers.createIndex('company', 'company', { unique: false });
      suppliers.createIndex('archived', 'archived', { unique: false });
      suppliers.createIndex('createdAt', 'createdAt', { unique: false });
    }

    /* stockMovements */
    if (!db.objectStoreNames.contains(STORES.STOCK_MOVEMENTS)) {
      const movements = db.createObjectStore(STORES.STOCK_MOVEMENTS, { keyPath: 'id' });
      movements.createIndex('productId', 'productId', { unique: false });
      movements.createIndex('timestamp', 'timestamp', { unique: false });
      movements.createIndex('type', 'type', { unique: false });
      // Compound index for "movements of a product, newest first"
      movements.createIndex('productId_timestamp', ['productId', 'timestamp'], { unique: false });
    }

    /* purchaseOrders */
    if (!db.objectStoreNames.contains(STORES.PURCHASE_ORDERS)) {
      const pos = db.createObjectStore(STORES.PURCHASE_ORDERS, { keyPath: 'id' });
      pos.createIndex('orderNumber', 'orderNumber', { unique: true });
      pos.createIndex('supplierId', 'supplierId', { unique: false });
      pos.createIndex('status', 'status', { unique: false });
      pos.createIndex('createdAt', 'createdAt', { unique: false });
      pos.createIndex('expectedDate', 'expectedDate', { unique: false });
    }

    /* settings — single-row style store, keyed by a known "key" */
    if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
      db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
    }
  }

  // Future migrations go here as `if (oldVersion < 2) { ... }` and so on.
}

/* =========================================================
   LOW-LEVEL HELPERS
   ========================================================= */

/** Wrap a single IDBRequest in a Promise. */
export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

/** Resolve when an IDBTransaction completes; reject on error/abort. */
export function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort    = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/* =========================================================
   PUBLIC TRANSACTION APIS
   ========================================================= */

/**
 * Run a read-only operation across one or more stores.
 * The callback receives a map of { storeName: IDBObjectStore }.
 * Read-only transactions cannot partially commit, so it is safe
 * to resolve as soon as the callback's awaited operations finish.
 */
export async function withRead(stores, fn) {
  const db = await openDatabase();
  const list = Array.isArray(stores) ? stores : [stores];
  const tx = db.transaction(list, 'readonly');
  const handles = Object.fromEntries(list.map((s) => [s, tx.objectStore(s)]));
  const result = await fn(handles);
  // Wait for the tx to settle so callers can rely on it being finished.
  await transactionDone(tx);
  return result;
}

/**
 * Run a read-write operation across one or more stores atomically.
 * The callback's return value is passed through ONLY after
 * tx.oncomplete fires. If anything inside throws, the transaction
 * is aborted and no writes are persisted.
 */
export async function withTransaction(stores, fn) {
  const db = await openDatabase();
  const list = Array.isArray(stores) ? stores : [stores];
  const tx = db.transaction(list, 'readwrite');
  const handles = Object.fromEntries(list.map((s) => [s, tx.objectStore(s)]));

  const done = transactionDone(tx);

  try {
    const result = await fn(handles, tx);
    await done;             // do not resolve until commit
    return result;
  } catch (err) {
    try { tx.abort(); } catch {}
    // Ensure the tx promise is consumed to avoid unhandled rejections.
    done.catch(() => {});
    throw err;
  }
}

/* =========================================================
   CONVENIENCE WRAPPERS (single-store)
   ========================================================= */

export async function getOne(store, key) {
  return withRead(store, ({ [store]: s }) => requestToPromise(s.get(key)));
}

export async function getAll(store) {
  return withRead(store, ({ [store]: s }) => requestToPromise(s.getAll()));
}

export async function putOne(store, value) {
  return withTransaction(store, async ({ [store]: s }) => {
    await requestToPromise(s.put(value));
    return value;
  });
}

export async function deleteOne(store, key) {
  return withTransaction(store, async ({ [store]: s }) => {
    await requestToPromise(s.delete(key));
    return true;
  });
}

export async function clearStore(store) {
  return withTransaction(store, async ({ [store]: s }) => {
    await requestToPromise(s.clear());
    return true;
  });
}

/* =========================================================
   DIAGNOSTICS
   ========================================================= */

export async function getDatabaseInfo() {
  const db = await openDatabase();
  const storeNames = Array.from(db.objectStoreNames);
  const counts = {};
  for (const name of storeNames) {
    // Use a read transaction per store; counts may be stale by a record
    // or two under concurrent writes, which is acceptable for a status panel.
    counts[name] = await withRead(name, ({ [name]: s }) => requestToPromise(s.count()));
  }
  return {
    name: DB_NAME,
    version: db.version,
    stores: storeNames,
    counts,
  };
}

export async function estimateStorage() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/** Clear every application store. Used by Data Management (Phase 4). */
export async function destroyAllData() {
  const stores = Object.values(STORES);
  return withTransaction(stores, async (handles) => {
    for (const name of stores) {
      await requestToPromise(handles[name].clear());
    }
    return true;
  });
}

export function getOpenError() { return openError; }