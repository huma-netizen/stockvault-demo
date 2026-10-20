/* =========================================================
   StockVault — Repositories
   Typed CRUD wrappers around the raw stores. All validation
   that guarantees data integrity lives here; UI-level validation
   lives in the feature modules.
   ========================================================= */

import {
  STORES, withRead, withTransaction, requestToPromise,
} from './database.js';

/* ---------- Small utilities ---------- */

const now = () => Date.now();

function clampMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function clampInt(value, { min = 0 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, n);
}

function normalizeSku(sku) {
  return String(sku || '').trim().toUpperCase();
}

function normalizeString(s) {
  return s == null ? '' : String(s).trim();
}

function uid(prefix) {
  const rand = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
  return `${prefix}_${rand}`;
}

function lowerIncludes(haystack, needle) {
  if (!needle) return true;
  return String(haystack || '').toLowerCase().includes(String(needle).toLowerCase());
}

/* =========================================================
   PRODUCTS
   ========================================================= */

export const productsRepo = {
  async create(input) {
    const ts = now();
    const product = {
      id:            uid('prod'),
      name:          normalizeString(input.name),
      sku:           normalizeSku(input.sku),
      barcode:       normalizeString(input.barcode),
      description:   normalizeString(input.description),
      categoryId:    input.categoryId || '',
      supplierId:    input.supplierId || '',
      brand:         normalizeString(input.brand),
      imageDataUrl:  input.imageDataUrl || '',   // small thumbnails only
      cost:          clampMoney(input.cost),
      price:         clampMoney(input.price),
      quantity:      clampInt(input.quantity, { min: 0 }),
      lowStockThreshold: clampInt(input.lowStockThreshold, { min: 0 }),
      unit:          normalizeString(input.unit) || 'unit',
      location:      normalizeString(input.location),
      archived:      Boolean(input.archived),
      createdAt:     ts,
      updatedAt:     ts,
    };

    if (!product.name) throw new Error('Product name is required.');
    if (!product.sku)  throw new Error('SKU is required.');

    return withTransaction(STORES.PRODUCTS, async ({ [STORES.PRODUCTS]: s }) => {
      await assertSkuUnique(s, product.sku, product.id);
      await requestToPromise(s.add(product));
      return product;
    });
  },

  async update(id, patch) {
    return withTransaction(STORES.PRODUCTS, async ({ [STORES.PRODUCTS]: s }) => {
      const current = await requestToPromise(s.get(id));
      if (!current) throw new Error('Product not found.');

      const next = { ...current };

      if ('name' in patch)        next.name = normalizeString(patch.name) || current.name;
      if ('sku' in patch)         next.sku  = normalizeSku(patch.sku) || current.sku;
      if ('barcode' in patch)     next.barcode = normalizeString(patch.barcode);
      if ('description' in patch) next.description = normalizeString(patch.description);
      if ('categoryId' in patch)  next.categoryId = patch.categoryId || '';
      if ('supplierId' in patch)  next.supplierId = patch.supplierId || '';
      if ('brand' in patch)       next.brand = normalizeString(patch.brand);
      if ('imageDataUrl' in patch) next.imageDataUrl = patch.imageDataUrl || '';
      if ('cost' in patch)        next.cost = clampMoney(patch.cost);
      if ('price' in patch)       next.price = clampMoney(patch.price);
      if ('lowStockThreshold' in patch) next.lowStockThreshold = clampInt(patch.lowStockThreshold, { min: 0 });
      if ('unit' in patch)        next.unit = normalizeString(patch.unit) || 'unit';
      if ('location' in patch)    next.location = normalizeString(patch.location);
      if ('archived' in patch)    next.archived = Boolean(patch.archived);

      // Quantity is intentionally NOT settable here — it changes only through
      // stock movements (Phase 3) which pass through stockRepo.applyMovement.

      if (!next.name) throw new Error('Product name is required.');
      if (!next.sku)  throw new Error('SKU is required.');

      if (next.sku !== current.sku) {
        await assertSkuUnique(s, next.sku, id);
      }

      next.updatedAt = now();
      await requestToPromise(s.put(next));
      return next;
    });
  },

  async get(id) {
    return withRead(STORES.PRODUCTS, ({ [STORES.PRODUCTS]: s }) => requestToPromise(s.get(id)));
  },

  async list({ includeArchived = false } = {}) {
    const all = await withRead(STORES.PRODUCTS, ({ [STORES.PRODUCTS]: s }) => requestToPromise(s.getAll()));
    return includeArchived ? all : all.filter((p) => !p.archived);
  },

  async search({ q = '', categoryId = '', supplierId = '', stockStatus = '', sort = 'name-asc', includeArchived = false } = {}) {
    const all = await this.list({ includeArchived });
    let rows = all.slice();

    if (q) {
      rows = rows.filter((p) =>
        lowerIncludes(p.name, q) ||
        lowerIncludes(p.sku, q) ||
        lowerIncludes(p.barcode, q)
      );
    }
    if (categoryId) rows = rows.filter((p) => p.categoryId === categoryId);
    if (supplierId) rows = rows.filter((p) => p.supplierId === supplierId);

    if (stockStatus) {
      rows = rows.filter((p) => statusOf(p) === stockStatus);
    }

    rows.sort(sorter(sort));
    return rows;
  },

  async setArchived(id, archived) {
    return this.update(id, { archived: Boolean(archived) });
  },

  /** Hard delete — caller must confirm UI-side. */
  async remove(id) {
    return withTransaction(STORES.PRODUCTS, async ({ [STORES.PRODUCTS]: s }) => {
      await requestToPromise(s.delete(id));
      return true;
    });
  },

  /** Bulk create for CSV import (Phase 3 wires UI). */
  async bulkCreate(records) {
    const ts = now();
    const prepared = [];
    const seen = new Set();

    for (const r of records) {
      const sku = normalizeSku(r.sku);
      if (!r.name) throw new Error(`Row ${r._row ?? '?'}: product name is required.`);
      if (!sku)    throw new Error(`Row ${r._row ?? '?'}: SKU is required.`);
      if (seen.has(sku)) throw new Error(`Duplicate SKU in import: ${sku}`);
      seen.add(sku);

      prepared.push({
        id:            uid('prod'),
        name:          normalizeString(r.name),
        sku,
        barcode:       normalizeString(r.barcode),
        description:   normalizeString(r.description),
        categoryId:    r.categoryId || '',
        supplierId:    r.supplierId || '',
        brand:         normalizeString(r.brand),
        imageDataUrl:  '',
        cost:          clampMoney(r.cost),
        price:         clampMoney(r.price),
        quantity:      clampInt(r.quantity, { min: 0 }),
        lowStockThreshold: clampInt(r.lowStockThreshold, { min: 0 }),
        unit:          normalizeString(r.unit) || 'unit',
        location:      normalizeString(r.location),
        archived:      Boolean(r.archived),
        createdAt:     ts,
        updatedAt:     ts,
      });
    }

    return withTransaction(STORES.PRODUCTS, async ({ [STORES.PRODUCTS]: s }) => {
      // Reject if any prepared SKU already exists in the store.
      for (const p of prepared) {
        await assertSkuUnique(s, p.sku, p.id);
      }
      for (const p of prepared) {
        await requestToPromise(s.add(p));
      }
      return prepared;
    });
  },
};

/* ---------- Product helpers ---------- */

function statusOf(product) {
  const q = product.quantity;
  const t = product.lowStockThreshold;
  if (q <= 0) return 'out';
  if (t > 0 && q <= t) return 'low';
  if (t === 0 && q === 0) return 'out';
  return 'in';
}

function sorter(key) {
  switch (key) {
    case 'name-asc':    return (a, b) => a.name.localeCompare(b.name);
    case 'name-desc':   return (a, b) => b.name.localeCompare(a.name);
    case 'qty-asc':     return (a, b) => a.quantity - b.quantity;
    case 'qty-desc':    return (a, b) => b.quantity - a.quantity;
    case 'value-desc':  return (a, b) => (b.quantity * b.cost) - (a.quantity * a.cost);
    case 'updated-desc':return (a, b) => b.updatedAt - a.updatedAt;
    default:            return (a, b) => a.name.localeCompare(b.name);
  }
}

async function assertSkuUnique(store, sku, selfId) {
  const target = normalizeSku(sku);
  const all = await requestToPromise(store.getAll());
  const clash = all.find((p) => p.id !== selfId && normalizeSku(p.sku) === target);
  if (clash) throw new Error(`SKU "${sku}" already exists on "${clash.name}".`);
}

export { statusOf as productStockStatus };

/* =========================================================
   CATEGORIES
   ========================================================= */

export const categoriesRepo = {
  async create(input) {
    const ts = now();
    const cat = {
      id: uid('cat'),
      name: normalizeString(input.name),
      description: normalizeString(input.description),
      createdAt: ts,
      updatedAt: ts,
    };
    if (!cat.name) throw new Error('Category name is required.');

    return withTransaction(STORES.CATEGORIES, async ({ [STORES.CATEGORIES]: s }) => {
      await assertCategoryNameUnique(s, cat.name, cat.id);
      await requestToPromise(s.add(cat));
      return cat;
    });
  },

  async update(id, patch) {
    return withTransaction(STORES.CATEGORIES, async ({ [STORES.CATEGORIES]: s }) => {
      const current = await requestToPromise(s.get(id));
      if (!current) throw new Error('Category not found.');
      const next = { ...current };
      if ('name' in patch)        next.name = normalizeString(patch.name) || current.name;
      if ('description' in patch) next.description = normalizeString(patch.description);
      if (!next.name) throw new Error('Category name is required.');
      if (next.name !== current.name) await assertCategoryNameUnique(s, next.name, id);
      next.updatedAt = now();
      await requestToPromise(s.put(next));
      return next;
    });
  },

  async get(id) {
    return withRead(STORES.CATEGORIES, ({ [STORES.CATEGORIES]: s }) => requestToPromise(s.get(id)));
  },

  async list() {
    const all = await withRead(STORES.CATEGORIES, ({ [STORES.CATEGORIES]: s }) => requestToPromise(s.getAll()));
    all.sort((a, b) => a.name.localeCompare(b.name));
    return all;
  },

  /** Throws if any non-archived product references this category. */
  async remove(id) {
    const products = await productsRepo.list({ includeArchived: false });
    const inUse = products.filter((p) => p.categoryId === id).length;
    if (inUse > 0) {
      throw new Error(`Cannot delete: ${inUse} product${inUse === 1 ? '' : 's'} use this category.`);
    }
    return withTransaction(STORES.CATEGORIES, async ({ [STORES.CATEGORIES]: s }) => {
      await requestToPromise(s.delete(id));
      return true;
    });
  },

  async countProductsByCategory() {
    const products = await productsRepo.list({ includeArchived: true });
    const counts = {};
    for (const p of products) {
      if (!p.categoryId) continue;
      counts[p.categoryId] = (counts[p.categoryId] || 0) + 1;
    }
    return counts;
  },
};

async function assertCategoryNameUnique(store, name, selfId) {
  const target = name.toLowerCase();
  const all = await requestToPromise(store.getAll());
  const clash = all.find((c) => c.id !== selfId && c.name.toLowerCase() === target);
  if (clash) throw new Error(`Category "${name}" already exists.`);
}

/* =========================================================
   SUPPLIERS
   ========================================================= */

export const suppliersRepo = {
  async create(input) {
    const ts = now();
    const supplier = {
      id: uid('sup'),
      name:       normalizeString(input.name),
      company:    normalizeString(input.company),
      email:      normalizeString(input.email),
      phone:      normalizeString(input.phone),
      address:    normalizeString(input.address),
      taxId:      normalizeString(input.taxId),
      notes:      normalizeString(input.notes),
      archived:   Boolean(input.archived),
      createdAt:  ts,
      updatedAt:  ts,
    };
    if (!supplier.name) throw new Error('Supplier name is required.');

    return withTransaction(STORES.SUPPLIERS, async ({ [STORES.SUPPLIERS]: s }) => {
      await requestToPromise(s.add(supplier));
      return supplier;
    });
  },

  async update(id, patch) {
    return withTransaction(STORES.SUPPLIERS, async ({ [STORES.SUPPLIERS]: s }) => {
      const current = await requestToPromise(s.get(id));
      if (!current) throw new Error('Supplier not found.');
      const next = { ...current };
      for (const key of ['name','company','email','phone','address','taxId','notes']) {
        if (key in patch) next[key] = normalizeString(patch[key]);
      }
      if ('archived' in patch) next.archived = Boolean(patch.archived);
      if (!next.name) throw new Error('Supplier name is required.');
      next.updatedAt = now();
      await requestToPromise(s.put(next));
      return next;
    });
  },

  async get(id) {
    return withRead(STORES.SUPPLIERS, ({ [STORES.SUPPLIERS]: s }) => requestToPromise(s.get(id)));
  },

  async list({ includeArchived = false, q = '' } = {}) {
    const all = await withRead(STORES.SUPPLIERS, ({ [STORES.SUPPLIERS]: s }) => requestToPromise(s.getAll()));
    let rows = includeArchived ? all.slice() : all.filter((s) => !s.archived);
    if (q) {
      rows = rows.filter((s) =>
        lowerIncludes(s.name, q) ||
        lowerIncludes(s.company, q) ||
        lowerIncludes(s.email, q) ||
        lowerIncludes(s.phone, q)
      );
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  },

  async setArchived(id, archived) {
    return this.update(id, { archived: Boolean(archived) });
  },

  /** Hard delete — caller should prefer archive when POs exist. */
  async remove(id) {
    return withTransaction(STORES.SUPPLIERS, async ({ [STORES.SUPPLIERS]: s }) => {
      await requestToPromise(s.delete(id));
      return true;
    });
  },
};

/* =========================================================
   STOCK MOVEMENTS
   Movement types are canonical. Signed quantity convention:
     +qty for stock-increasing types
     -qty for stock-decreasing types
   The caller passes an absolute quantity; this repo applies the sign.
   ========================================================= */

export const MOVEMENT_TYPES = Object.freeze({
  OPENING:          'opening',
  STOCK_IN:         'stock_in',
  STOCK_OUT:        'stock_out',
  SALE:             'sale',
  CUSTOMER_RETURN:  'customer_return',
  SUPPLIER_RETURN:  'supplier_return',
  ADJUSTMENT:       'adjustment',
  PURCHASE_RECEIVED:'purchase_received',
  DAMAGED:          'damaged',
});

const DECREASING_TYPES = new Set([
  MOVEMENT_TYPES.STOCK_OUT,
  MOVEMENT_TYPES.SALE,
  MOVEMENT_TYPES.SUPPLIER_RETURN,
  MOVEMENT_TYPES.DAMAGED,
]);

export function isDecreasingType(type) {
  return DECREASING_TYPES.has(type);
}

export const stockRepo = {
  /**
   * Record a stock movement and update the product quantity atomically.
   * Inputs:
   *   productId   — required
   *   type        — one of MOVEMENT_TYPES
   *   quantity    — absolute, positive integer
   *   reference   — optional string (PO number, invoice, etc.)
   *   reason      — optional string
   *   notes       — optional string
   *   allowNegative — override; default false
   *   timestamp   — optional, defaults to now
   */
  async applyMovement(input) {
    const {
      productId, type, quantity,
      reference = '', reason = '', notes = '',
      allowNegative = false,
      timestamp = now(),
    } = input;

    if (!productId) throw new Error('productId is required.');
    if (!Object.values(MOVEMENT_TYPES).includes(type)) throw new Error(`Unknown movement type "${type}".`);
    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be a positive whole number.');

    return withTransaction([STORES.PRODUCTS, STORES.STOCK_MOVEMENTS], async (handles) => {
      const pStore = handles[STORES.PRODUCTS];
      const mStore = handles[STORES.STOCK_MOVEMENTS];

      const product = await requestToPromise(pStore.get(productId));
      if (!product) throw new Error('Product not found.');

      const signed = isDecreasingType(type) ? -qty : qty;
      const prev = product.quantity;
      const next = prev + signed;

      if (next < 0 && !allowNegative) {
        throw new Error(`Operation would take "${product.name}" to ${next}. Enable negative stock in Settings to allow this.`);
      }

      const movement = {
        id: uid('mv'),
        productId,
        type,
        quantity: signed,          // signed, for ledger integrity
        absQuantity: Math.abs(signed),
        previousQuantity: prev,
        newQuantity: next,
        reference: normalizeString(reference),
        reason: normalizeString(reason),
        notes: normalizeString(notes),
        timestamp,
      };

      product.quantity = next;
      product.updatedAt = now();

      await requestToPromise(pStore.put(product));
      await requestToPromise(mStore.add(movement));

      return { product, movement };
    });
  },

  async get(id) {
    return withRead(STORES.STOCK_MOVEMENTS, ({ [STORES.STOCK_MOVEMENTS]: s }) => requestToPromise(s.get(id)));
  },

  /** Recent movements across all products, newest first. */
  async recent(limit = 20) {
    const all = await withRead(STORES.STOCK_MOVEMENTS, ({ [STORES.STOCK_MOVEMENTS]: s }) => requestToPromise(s.getAll()));
    all.sort((a, b) => b.timestamp - a.timestamp);
    return all.slice(0, limit);
  },

  /** Movements for a single product, newest first. */
  async forProduct(productId, { limit = 100 } = {}) {
    return withRead(STORES.STOCK_MOVEMENTS, async ({ [STORES.STOCK_MOVEMENTS]: s }) => {
      const idx = s.index('productId_timestamp');
      const range = IDBKeyRange.bound([productId, -Infinity], [productId, Infinity]);
      const all = await requestToPromise(idx.getAll(range));
      all.sort((a, b) => b.timestamp - a.timestamp);
      return all.slice(0, limit);
    });
  },

  /** Movements within [fromTs, toTs] inclusive, newest first. */
  async inRange(fromTs, toTs, { limit = 500 } = {}) {
    return withRead(STORES.STOCK_MOVEMENTS, async ({ [STORES.STOCK_MOVEMENTS]: s }) => {
      const idx = s.index('timestamp');
      const range = IDBKeyRange.bound(fromTs, toTs);
      const all = await requestToPromise(idx.getAll(range));
      all.sort((a, b) => b.timestamp - a.timestamp);
      return all.slice(0, limit);
    });
  },

  async count() {
    return withRead(STORES.STOCK_MOVEMENTS, ({ [STORES.STOCK_MOVEMENTS]: s }) => requestToPromise(s.count()));
  },
};

/* =========================================================
   PURCHASE ORDERS
   Line items: { productId, name, sku, orderedQty, receivedQty, unitCost }
   Totals are recomputed on every save for consistency.
   ========================================================= */

export const PO_STATUS = Object.freeze({
  DRAFT:              'draft',
  ORDERED:            'ordered',
  PARTIALLY_RECEIVED: 'partially_received',
  RECEIVED:           'received',
  CANCELLED:          'cancelled',
});

export const purchasesRepo = {
  async create(input) {
    const ts = now();
    const po = {
      id: uid('po'),
      orderNumber: normalizeString(input.orderNumber) || await nextOrderNumber(),
      supplierId: input.supplierId || '',
      status: input.status || PO_STATUS.DRAFT,
      expectedDate: input.expectedDate || null,
      items: normalizeItems(input.items || []),
      taxRate: clampMoney(input.taxRate || 0),
      discount: clampMoney(input.discount || 0),
      notes: normalizeString(input.notes),
      createdAt: ts,
      updatedAt: ts,
    };
    if (!po.supplierId) throw new Error('Supplier is required.');

    recomputeTotals(po);

    return withTransaction(STORES.PURCHASE_ORDERS, async ({ [STORES.PURCHASE_ORDERS]: s }) => {
      await assertOrderNumberUnique(s, po.orderNumber, po.id);
      await requestToPromise(s.add(po));
      return po;
    });
  },

  async update(id, patch) {
    return withTransaction(STORES.PURCHASE_ORDERS, async ({ [STORES.PURCHASE_ORDERS]: s }) => {
      const current = await requestToPromise(s.get(id));
      if (!current) throw new Error('Purchase order not found.');
      if (current.status === PO_STATUS.CANCELLED || current.status === PO_STATUS.RECEIVED) {
        // No edits after terminal states.
        throw new Error(`Cannot edit a ${current.status} order.`);
      }
      const next = { ...current };

      if ('supplierId' in patch) next.supplierId = patch.supplierId || next.supplierId;
      if ('expectedDate' in patch) next.expectedDate = patch.expectedDate || null;
      if ('items' in patch) next.items = normalizeItems(patch.items);
      if ('taxRate' in patch) next.taxRate = clampMoney(patch.taxRate);
      if ('discount' in patch) next.discount = clampMoney(patch.discount);
      if ('notes' in patch) next.notes = normalizeString(patch.notes);
      if ('status' in patch) next.status = patch.status;

      if (!next.supplierId) throw new Error('Supplier is required.');
      recomputeTotals(next);
      next.updatedAt = now();
      await requestToPromise(s.put(next));
      return next;
    });
  },

  async get(id) {
    return withRead(STORES.PURCHASE_ORDERS, ({ [STORES.PURCHASE_ORDERS]: s }) => requestToPromise(s.get(id)));
  },

  async list({ status = '', supplierId = '', q = '' } = {}) {
    const all = await withRead(STORES.PURCHASE_ORDERS, ({ [STORES.PURCHASE_ORDERS]: s }) => requestToPromise(s.getAll()));
    let rows = all.slice();
    if (status) rows = rows.filter((po) => po.status === status);
    if (supplierId) rows = rows.filter((po) => po.supplierId === supplierId);
    if (q) rows = rows.filter((po) => lowerIncludes(po.orderNumber, q) || lowerIncludes(po.notes, q));
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows;
  },

  async setStatus(id, status) {
    return withTransaction(STORES.PURCHASE_ORDERS, async ({ [STORES.PURCHASE_ORDERS]: s }) => {
      const po = await requestToPromise(s.get(id));
      if (!po) throw new Error('Purchase order not found.');
      po.status = status;
      po.updatedAt = now();
      await requestToPromise(s.put(po));
      return po;
    });
  },

  /**
   * Receive stock for a PO. Atomically:
   *   - validates receive quantities vs. outstanding
   *   - updates each product's quantity
   *   - writes one purchase_received movement per line
   *   - updates line receivedQty and PO status
   * Input: { poId, receipts: [{ productId, quantity }] }
   */
  async receive(poId, receipts) {
    if (!Array.isArray(receipts) || receipts.length === 0) {
      throw new Error('No receipts provided.');
    }

    const ts = now();

    return withTransaction(
      [STORES.PURCHASE_ORDERS, STORES.PRODUCTS, STORES.STOCK_MOVEMENTS],
      async (handles) => {
        const poStore = handles[STORES.PURCHASE_ORDERS];
        const pStore  = handles[STORES.PRODUCTS];
        const mStore  = handles[STORES.STOCK_MOVEMENTS];

        const po = await requestToPromise(poStore.get(poId));
        if (!po) throw new Error('Purchase order not found.');
        if (po.status === PO_STATUS.CANCELLED) throw new Error('Cannot receive a cancelled order.');

        // Merge duplicate receipts for the same product into one line change.
        const merged = new Map();
        for (const r of receipts) {
          const qty = Math.floor(Number(r.quantity));
          if (!Number.isFinite(qty) || qty <= 0) throw new Error('Receipt quantity must be positive.');
          merged.set(r.productId, (merged.get(r.productId) || 0) + qty);
        }

        const updatedItems = po.items.map((it) => ({ ...it }));
        const movements = [];

        for (const [productId, qty] of merged) {
          const line = updatedItems.find((it) => it.productId === productId);
          if (!line) throw new Error(`Product ${productId} is not on this order.`);

          const outstanding = line.orderedQty - line.receivedQty;
          if (qty > outstanding) {
            throw new Error(`Cannot receive ${qty} for "${line.name}": only ${outstanding} outstanding.`);
          }

          const product = await requestToPromise(pStore.get(productId));
          if (!product) throw new Error(`Product ${line.name} no longer exists.`);

          const prev = product.quantity;
          const next = prev + qty;

          product.quantity = next;
          product.updatedAt = ts;

          line.receivedQty += qty;

          const movement = {
            id: uid('mv'),
            productId,
            type: MOVEMENT_TYPES.PURCHASE_RECEIVED,
            quantity: qty,
            absQuantity: qty,
            previousQuantity: prev,
            newQuantity: next,
            reference: po.orderNumber,
            reason: `Received against ${po.orderNumber}`,
            notes: '',
            timestamp: ts,
          };
          movements.push(movement);

          await requestToPromise(pStore.put(product));
          await requestToPromise(mStore.add(movement));
        }

        po.items = updatedItems;
        po.status = computePoStatus(updatedItems);
        po.updatedAt = ts;
        recomputeTotals(po);

        await requestToPromise(poStore.put(po));

        return { po, movements };
      }
    );
  },

  async cancel(id) {
    return withTransaction(STORES.PURCHASE_ORDERS, async ({ [STORES.PURCHASE_ORDERS]: s }) => {
      const po = await requestToPromise(s.get(id));
      if (!po) throw new Error('Purchase order not found.');
      if (po.status === PO_STATUS.RECEIVED) throw new Error('Cannot cancel a fully received order.');
      if (po.items.some((it) => it.receivedQty > 0)) {
        throw new Error('Cannot cancel: some items have already been received.');
      }
      po.status = PO_STATUS.CANCELLED;
      po.updatedAt = now();
      await requestToPromise(s.put(po));
      return po;
    });
  },
};

/* ---------- Purchase helpers ---------- */

function normalizeItems(items) {
  return items.map((it) => ({
    productId:   it.productId,
    name:        normalizeString(it.name),
    sku:         normalizeSku(it.sku),
    orderedQty:  clampInt(it.orderedQty, { min: 0 }),
    receivedQty: clampInt(it.receivedQty, { min: 0 }),
    unitCost:    clampMoney(it.unitCost),
  })).filter((it) => it.productId && it.orderedQty > 0);
}

function recomputeTotals(po) {
  const subtotal = po.items.reduce((sum, it) => sum + it.orderedQty * it.unitCost, 0);
  const discount = clampMoney(po.discount);
  const taxable = Math.max(0, subtotal - discount);
  const taxAmount = clampMoney(taxable * (po.taxRate / 100));
  const total = clampMoney(taxable + taxAmount);
  po.subtotal = clampMoney(subtotal);
  po.taxAmount = taxAmount;
  po.total = total;
}

function computePoStatus(items) {
  if (items.every((it) => it.receivedQty >= it.orderedQty && it.orderedQty > 0)) {
    return PO_STATUS.RECEIVED;
  }
  if (items.some((it) => it.receivedQty > 0)) {
    return PO_STATUS.PARTIALLY_RECEIVED;
  }
  return PO_STATUS.ORDERED;
}

async function assertOrderNumberUnique(store, orderNumber, selfId) {
  const idx = store.index('orderNumber');
  const clash = await requestToPromise(idx.get(orderNumber));
  if (clash && clash.id !== selfId) throw new Error(`Order number "${orderNumber}" already exists.`);
}

/** Generate the next PO number: PO-YYYY-NNNN (per year). */
async function nextOrderNumber() {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const all = await withRead(STORES.PURCHASE_ORDERS, ({ [STORES.PURCHASE_ORDERS]: s }) => requestToPromise(s.getAll()));
  const seq = all
    .map((po) => po.orderNumber)
    .filter((n) => typeof n === 'string' && n.startsWith(prefix))
    .map((n) => parseInt(n.slice(prefix.length), 10))
    .filter(Number.isFinite);
  const next = (seq.length ? Math.max(...seq) : 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

/* =========================================================
   SETTINGS (indexedDB store — small structured values only)
   Tiny preferences like theme live in localStorage (Phase 1);
   this store holds the canonical business configuration.
   ========================================================= */

export const settingsRepo = {
  async get(key) {
    const row = await withRead(STORES.SETTINGS, ({ [STORES.SETTINGS]: s }) => requestToPromise(s.get(key)));
    return row?.value;
  },

  async set(key, value) {
    return withTransaction(STORES.SETTINGS, async ({ [STORES.SETTINGS]: s }) => {
      await requestToPromise(s.put({ key, value, updatedAt: now() }));
      return value;
    });
  },

  async all() {
    const rows = await withRead(STORES.SETTINGS, ({ [STORES.SETTINGS]: s }) => requestToPromise(s.getAll()));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
};