/* =========================================================
   StockVault — Reports & printing
   Eight reports, all filterable, all exportable to CSV,
   all printable via the print stylesheet.
   All user-visible strings translated via t().
   ========================================================= */

import {
  el, formatCurrency, formatNumber, formatDateTime, formatDate, toast,
} from '../ui.js';
import {
  productsRepo, categoriesRepo, suppliersRepo, stockRepo,
  purchasesRepo, productStockStatus, PO_STATUS,
} from '../repositories.js';
import { loadSettings } from '../settings.js';
import { serializeCsv, downloadCsv } from '../csv.js';
import { pageHeader, card } from './_helpers.js';
import { t } from '../i18n.js';

const REPORT_KEYS = [
  { key: 'valuation',  labelKey: 'reports.reportValuation' },
  { key: 'products',   labelKey: 'reports.reportProducts' },
  { key: 'low-stock',  labelKey: 'reports.reportLowStock' },
  { key: 'out-stock',  labelKey: 'reports.reportOutStock' },
  { key: 'movements',  labelKey: 'reports.reportMovements' },
  { key: 'supplier',   labelKey: 'reports.reportSupplier' },
  { key: 'po-summary', labelKey: 'reports.reportPoSummary' },
  { key: 'category',   labelKey: 'reports.reportCategory' },
];

export async function renderReports(container) {
  const settings = await loadSettings();

  const state = {
    report: 'valuation',
    from: null,
    to: null,
    categoryId: '',
    supplierId: '',
    search: '',
  };

  const [categories, suppliers] = await Promise.all([
    categoriesRepo.list(),
    suppliersRepo.list({ includeArchived: true }),
  ]);

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  root.appendChild(pageHeader({
    title: t('reports.title'),
    subtitle: t('reports.subtitle'),
  }));

  /* Control panel (not printed) */
  const controls = el('section', { class: 'card no-print' }, [
    el('div', {
      style: {
        display: 'grid',
        gap: 'var(--s-3)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      },
    }, [
      buildReportPicker(state.report, (v) => { state.report = v; renderReport(); }),
      dateField(t('reports.from'), (v) => { state.from = v; renderReport(); }),
      dateField(t('reports.to'), (v) => { state.to = v; renderReport(); }),
      selectField(t('reports.category'),
        [{ value: '', label: t('reports.allCategories') },
         ...categories.map((c) => ({ value: c.id, label: c.name }))],
        state.categoryId,
        (v) => { state.categoryId = v; renderReport(); }),
      selectField(t('reports.supplier'),
        [{ value: '', label: t('reports.allSuppliers') },
         ...suppliers.map((s) => ({ value: s.id, label: s.name }))],
        state.supplierId,
        (v) => { state.supplierId = v; renderReport(); }),
      textField(t('common.search'), '', (v) => { state.search = v; renderReport(); }),
    ]),
    el('div', { class: 'row row--wrap', style: { marginTop: 'var(--s-4)' } }, [
      el('button', { class: 'btn', onclick: () => window.print() }, t('reports.printReport')),
      el('button', { class: 'btn', onclick: () => exportCurrentReport(state, settings) }, t('reports.exportCsv')),
    ]),
  ]);
  root.appendChild(controls);

  const host = el('div', { id: 'reportHost' });
  root.appendChild(host);

  async function renderReport() {
    host.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'skeleton', style: { height: '260px' } })));

    const [products, cats, sups] = await Promise.all([
      productsRepo.list({ includeArchived: false }),
      categoriesRepo.list(),
      suppliersRepo.list({ includeArchived: true }),
    ]);
    const catById = new Map(cats.map((c) => [c.id, c.name]));
    const supById = new Map(sups.map((s) => [s.id, s.name]));

    let filtered = products;
    if (state.categoryId) filtered = filtered.filter((p) => p.categoryId === state.categoryId);
    if (state.supplierId) filtered = filtered.filter((p) => p.supplierId === state.supplierId);
    if (state.search) {
      const q = state.search.toLowerCase();
      filtered = filtered.filter((p) =>
        p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }

    const meta = {
      businessName: settings.businessName,
      currency: settings.currency,
      generated: Date.now(),
      filters: describeFilters(state, catById, supById),
    };

    switch (state.report) {
      case 'valuation':  return renderValuation(host, filtered, catById, supById, meta);
      case 'products':   return renderProductList(host, filtered, catById, supById, meta);
      case 'low-stock':  return renderLowStockReport(host, filtered, catById, supById, meta);
      case 'out-stock':  return renderOutOfStock(host, filtered, catById, supById, meta);
      case 'movements':  return renderMovements(host, state, meta);
      case 'supplier':   return renderSupplierPurchases(host, state, supById, meta);
      case 'po-summary': return renderPoSummary(host, state, supById, meta);
      case 'category':   return renderCategorySummary(host, filtered, catById, meta);
      default:           return renderValuation(host, filtered, catById, supById, meta);
    }
  }

  await renderReport();
}

/* =========================================================
   CSV EXPORT
   ========================================================= */

async function exportCurrentReport(state, settings) {
  try {
    const { rows, columns, filename } = await buildExport(state, settings);
    if (!rows.length) { toast(t('reports.noFilters'), { type: 'info' }); return; }
    const csv = serializeCsv(rows, { columns });
    downloadCsv(filename, csv);
    toast(t('reports.exportToast'), { type: 'success' });
  } catch (err) {
    toast(err.message || t('errors.generic'), { type: 'danger' });
  }
}

/* =========================================================
   REPORT RENDERERS
   ========================================================= */

function renderValuation(host, products, catById, supById, meta) {
  const totalUnits = products.reduce((s, p) => s + p.quantity, 0);
  const totalCostValue = products.reduce((s, p) => s + p.quantity * p.cost, 0);
  const totalRetailValue = products.reduce((s, p) => s + p.quantity * p.price, 0);
  const potentialProfit = totalRetailValue - totalCostValue;

  host.replaceChildren(
    reportHeader(t('reports.reportValuation'), meta),
    el('div', { class: 'kpi-grid' }, [
      kpi(t('dashboard.totalProducts'), formatNumber(products.length)),
      kpi(t('products.colQty'), formatNumber(totalUnits)),
      kpi(t('products.colCost'), formatCurrency(totalCostValue, meta.currency)),
      kpi(t('products.colPrice'), formatCurrency(totalRetailValue, meta.currency)),
    ]),
    el('div', { class: 'kpi-grid' }, [
      kpi(t('products.profitPerUnit'), formatCurrency(potentialProfit, meta.currency)),
      kpi(t('products.profitMargin'),
        `${totalRetailValue > 0 ? ((potentialProfit / totalRetailValue) * 100).toFixed(1) : '0.0'}%`),
    ]),
    table([
      [t('products.colProduct'), t('products.colSku'), t('products.colCategory'),
       t('products.colQty'), t('products.colCost'), t('dashboard.inventoryValue')],
      ...products.map((p) => [
        p.name, p.sku,
        catById.get(p.categoryId) || '—',
        formatNumber(p.quantity),
        formatCurrency(p.cost, meta.currency),
        formatCurrency(p.quantity * p.cost, meta.currency),
      ]),
    ], { numericCols: [3, 4, 5] }),
  );
}

function renderProductList(host, products, catById, supById, meta) {
  host.replaceChildren(
    reportHeader(t('reports.reportProducts'), meta),
    table([
      [t('products.colProduct'), t('products.colSku'), t('products.colCategory'),
       t('purchases.colSupplier'), t('products.colCost'), t('products.colPrice'),
       t('products.colQty'), t('products.colStatus')],
      ...products.map((p) => [
        p.name, p.sku,
        catById.get(p.categoryId) || '—',
        supById.get(p.supplierId) || '—',
        formatCurrency(p.cost, meta.currency),
        formatCurrency(p.price, meta.currency),
        formatNumber(p.quantity),
        productStatusLabel(p),
      ]),
    ], { numericCols: [4, 5, 6] }),
  );
}

function renderLowStockReport(host, products, catById, supById, meta) {
  const rows = products
    .filter((p) => productStockStatus(p) === 'low')
    .sort((a, b) => a.quantity - b.quantity);

  host.replaceChildren(
    reportHeader(t('reports.reportLowStock'), meta),
    el('div', { class: 'kpi-grid' }, [
      kpi(t('lowStock.kpiLow'), formatNumber(rows.length)),
      kpi(t('lowStock.colSuggested'),
        formatNumber(rows.reduce((s, p) => s + suggestedQty(p), 0))),
      kpi(t('lowStock.kpiEstimatedCost'),
        formatCurrency(rows.reduce((s, p) => s + suggestedQty(p) * p.cost, 0), meta.currency)),
    ]),
    table([
      [t('products.colProduct'), t('products.colSku'), t('products.colCategory'),
       t('lowStock.colOnHand'), t('lowStock.colThreshold'),
       t('lowStock.colSuggested'), t('lowStock.colEstimatedCost')],
      ...rows.map((p) => [
        p.name, p.sku,
        catById.get(p.categoryId) || '—',
        formatNumber(p.quantity),
        formatNumber(p.lowStockThreshold),
        formatNumber(suggestedQty(p)),
        formatCurrency(suggestedQty(p) * p.cost, meta.currency),
      ]),
    ], { numericCols: [3, 4, 5, 6] }),
  );
}

function renderOutOfStock(host, products, catById, supById, meta) {
  const rows = products.filter((p) => productStockStatus(p) === 'out');
  host.replaceChildren(
    reportHeader(t('reports.reportOutStock'), meta),
    el('div', { class: 'kpi-grid' }, [
      kpi(t('dashboard.outOfStock'), formatNumber(rows.length)),
      kpi(t('lowStock.kpiSuppliers'),
        formatNumber(new Set(rows.map((p) => p.supplierId).filter(Boolean)).size)),
    ]),
    table([
      [t('products.colProduct'), t('products.colSku'), t('products.colCategory'),
       t('purchases.colSupplier'), t('products.colCost'), t('lowStock.colSuggested')],
      ...rows.map((p) => [
        p.name, p.sku,
        catById.get(p.categoryId) || '—',
        supById.get(p.supplierId) || '—',
        formatCurrency(p.cost, meta.currency),
        formatNumber(suggestedQty(p)),
      ]),
    ], { numericCols: [4, 5] }),
  );
}

async function renderMovements(host, state, meta) {
  const to = state.to ?? Date.now();
  const from = state.from ?? (to - 30 * 86400_000);
  const movements = await stockRepo.inRange(from, to, { limit: 1000 });
  const products = await productsRepo.list({ includeArchived: true });
  const pById = new Map(products.map((p) => [p.id, p]));

  host.replaceChildren(
    reportHeader(t('reports.reportMovements'), meta, {
      [t('stock.filterFrom')]: formatDate(from),
      [t('stock.filterTo')]: formatDate(to),
    }),
    el('div', { class: 'kpi-grid' }, [
      kpi(t('stock.title'), formatNumber(movements.length)),
      kpi(t('stock.typeStockIn'),
        formatNumber(movements.filter((m) => m.quantity > 0).reduce((s, m) => s + m.quantity, 0))),
      kpi(t('stock.typeStockOut'),
        formatNumber(movements.filter((m) => m.quantity < 0).reduce((s, m) => s + Math.abs(m.quantity), 0))),
    ]),
    table([
      [t('stock.colWhen'), t('products.colProduct'), t('products.colSku'),
       t('stock.colType'), t('stock.colChange'), t('stock.colBalance'), t('stock.colReference')],
      ...movements.map((m) => {
        const p = pById.get(m.productId);
        return [
          formatDateTime(m.timestamp),
          p ? p.name : '—',
          p ? p.sku : '—',
          movementLabel(m.type),
          `${m.quantity > 0 ? '+' : ''}${formatNumber(m.quantity)}`,
          formatNumber(m.newQuantity),
          m.reference || '—',
        ];
      }),
    ], { numericCols: [4, 5] }),
  );
}

async function renderSupplierPurchases(host, state, supById, meta) {
  const pos = await purchasesRepo.list({ supplierId: state.supplierId });
  const grouped = new Map();
  for (const po of pos) {
    const key = po.supplierId;
    if (!grouped.has(key)) grouped.set(key, { supplierId: key, count: 0, total: 0, received: 0 });
    const g = grouped.get(key);
    g.count++;
    g.total += po.total || 0;
    g.received += po.status === PO_STATUS.RECEIVED ? 1 : 0;
  }
  const rows = [...grouped.values()].sort((a, b) => b.total - a.total);

  host.replaceChildren(
    reportHeader(t('reports.reportSupplier'), meta),
    table([
      [t('purchases.colSupplier'), t('purchases.colOrderNumber'),
       t('purchases.statusReceived'), t('purchases.colTotal')],
      ...rows.map((r) => [
        supById.get(r.supplierId) || '—',
        formatNumber(r.count),
        formatNumber(r.received),
        formatCurrency(r.total, meta.currency),
      ]),
    ], { numericCols: [1, 2, 3] }),
  );
}

async function renderPoSummary(host, state, supById, meta) {
  const pos = await purchasesRepo.list({ supplierId: state.supplierId });
  const byStatus = new Map();
  for (const po of pos) {
    const s = po.status || 'unknown';
    if (!byStatus.has(s)) byStatus.set(s, { count: 0, total: 0 });
    const g = byStatus.get(s);
    g.count++;
    g.total += po.total || 0;
  }

  host.replaceChildren(
    reportHeader(t('reports.reportPoSummary'), meta),
    el('div', { class: 'kpi-grid' }, [
      kpi(t('purchases.title'), formatNumber(pos.length)),
      kpi(t('purchases.colTotal'),
        formatCurrency(pos.reduce((s, po) => s + (po.total || 0), 0), meta.currency)),
      kpi(t('purchases.statusReceived'),
        formatNumber(pos.filter((po) => po.status === PO_STATUS.RECEIVED).length)),
      kpi(t('purchases.statusOrdered'),
        formatNumber(pos.filter((po) =>
          po.status === PO_STATUS.ORDERED || po.status === PO_STATUS.PARTIALLY_RECEIVED).length)),
    ]),
    table([
      [t('purchases.colStatus'), t('purchases.colOrderNumber'), t('purchases.colTotal')],
      ...[...byStatus.entries()].map(([status, g]) => [
        poStatusLabel(status),
        formatNumber(g.count),
        formatCurrency(g.total, meta.currency),
      ]),
    ], { numericCols: [1, 2] }),
    el('h3', { style: { marginTop: 'var(--s-6)' } }, t('purchases.title')),
    table([
      [t('purchases.colOrderNumber'), t('purchases.colSupplier'), t('purchases.colStatus'),
       t('purchases.colCreated'), t('purchases.colExpected'), t('purchases.colTotal')],
      ...pos.map((po) => [
        po.orderNumber,
        supById.get(po.supplierId) || '—',
        poStatusLabel(po.status),
        formatDate(po.createdAt),
        po.expectedDate ? formatDate(po.expectedDate) : '—',
        formatCurrency(po.total || 0, meta.currency),
      ]),
    ], { numericCols: [5] }),
  );
}

function renderCategorySummary(host, products, catById, meta) {
  const map = new Map();
  for (const p of products) {
    const key = p.categoryId || '__none__';
    if (!map.has(key)) map.set(key, { count: 0, units: 0, costValue: 0, retailValue: 0 });
    const g = map.get(key);
    g.count++;
    g.units += p.quantity;
    g.costValue += p.quantity * p.cost;
    g.retailValue += p.quantity * p.price;
  }
  const rows = [...map.entries()]
    .map(([id, g]) => [
      id === '__none__' ? t('common.none') : (catById.get(id) || '—'),
      g,
    ])
    .sort((a, b) => b[1].costValue - a[1].costValue);

  host.replaceChildren(
    reportHeader(t('reports.reportCategory'), meta),
    table([
      [t('products.colCategory'), t('dashboard.totalProducts'), t('products.colQty'),
       t('dashboard.inventoryValue'), t('products.colPrice'), t('products.profitMargin')],
      ...rows.map(([name, g]) => [
        name,
        formatNumber(g.count),
        formatNumber(g.units),
        formatCurrency(g.costValue, meta.currency),
        formatCurrency(g.retailValue, meta.currency),
        g.retailValue > 0
          ? `${(((g.retailValue - g.costValue) / g.retailValue) * 100).toFixed(1)}%`
          : '—',
      ]),
    ], { numericCols: [1, 2, 3, 4, 5] }),
  );
}

/* =========================================================
   BUILD EXPORT DATA
   ========================================================= */

async function buildExport(state, settings) {
  const products = await productsRepo.list({ includeArchived: false });
  const cats = await categoriesRepo.list();
  const sups = await suppliersRepo.list({ includeArchived: true });
  const catById = new Map(cats.map((c) => [c.id, c.name]));
  const supById = new Map(sups.map((s) => [s.id, s.name]));

  let filtered = products;
  if (state.categoryId) filtered = filtered.filter((p) => p.categoryId === state.categoryId);
  if (state.supplierId) filtered = filtered.filter((p) => p.supplierId === state.supplierId);
  if (state.search) {
    const q = state.search.toLowerCase();
    filtered = filtered.filter((p) =>
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }

  const dateSuffix = new Date().toISOString().slice(0, 10);
  switch (state.report) {
    case 'valuation':
      return {
        columns: ['name', 'sku', 'category', 'supplier', 'quantity', 'cost', 'price', 'cost_value', 'retail_value'],
        rows: filtered.map((p) => [
          p.name, p.sku, catById.get(p.categoryId) || '', supById.get(p.supplierId) || '',
          p.quantity, p.cost, p.price, p.quantity * p.cost, p.quantity * p.price,
        ]),
        filename: `stockvault-valuation-${dateSuffix}.csv`,
      };
    case 'products':
      return {
        columns: ['name', 'sku', 'barcode', 'description', 'category', 'supplier', 'brand', 'unit', 'location', 'cost', 'price', 'quantity', 'lowStockThreshold'],
        rows: filtered.map((p) => [
          p.name, p.sku, p.barcode || '', p.description || '',
          catById.get(p.categoryId) || '', supById.get(p.supplierId) || '',
          p.brand || '', p.unit || '', p.location || '',
          p.cost, p.price, p.quantity, p.lowStockThreshold,
        ]),
        filename: `stockvault-products-${dateSuffix}.csv`,
      };
    case 'low-stock':
      return {
        columns: ['name', 'sku', 'category', 'supplier', 'quantity', 'threshold', 'suggested_order', 'unit_cost', 'estimated_cost'],
        rows: filtered.filter((p) => productStockStatus(p) === 'low').map((p) => [
          p.name, p.sku, catById.get(p.categoryId) || '', supById.get(p.supplierId) || '',
          p.quantity, p.lowStockThreshold, suggestedQty(p), p.cost, suggestedQty(p) * p.cost,
        ]),
        filename: `stockvault-low-stock-${dateSuffix}.csv`,
      };
    case 'out-stock':
      return {
        columns: ['name', 'sku', 'category', 'supplier', 'cost', 'suggested_order'],
        rows: filtered.filter((p) => productStockStatus(p) === 'out').map((p) => [
          p.name, p.sku, catById.get(p.categoryId) || '', supById.get(p.supplierId) || '',
          p.cost, suggestedQty(p),
        ]),
        filename: `stockvault-out-of-stock-${dateSuffix}.csv`,
      };
    case 'movements': {
      const to = state.to ?? Date.now();
      const from = state.from ?? (to - 30 * 86400_000);
      const movements = await stockRepo.inRange(from, to, { limit: 5000 });
      const pById = new Map(products.map((p) => [p.id, p]));
      return {
        columns: ['timestamp', 'product', 'sku', 'type', 'change', 'balance', 'reference', 'reason'],
        rows: movements.map((m) => {
          const p = pById.get(m.productId);
          return [
            new Date(m.timestamp).toISOString(),
            p ? p.name : '',
            p ? p.sku : '',
            m.type, m.quantity, m.newQuantity, m.reference || '', m.reason || '',
          ];
        }),
        filename: `stockvault-movements-${dateSuffix}.csv`,
      };
    }
    case 'supplier': {
      const pos = await purchasesRepo.list({ supplierId: state.supplierId });
      const grouped = new Map();
      for (const po of pos) {
        const key = po.supplierId;
        if (!grouped.has(key)) grouped.set(key, { count: 0, received: 0, total: 0 });
        const g = grouped.get(key);
        g.count++;
        if (po.status === PO_STATUS.RECEIVED) g.received++;
        g.total += po.total || 0;
      }
      return {
        columns: ['supplier', 'orders', 'received', 'total_value'],
        rows: [...grouped.entries()].map(([id, g]) => [
          supById.get(id) || '', g.count, g.received, g.total,
        ]),
        filename: `stockvault-supplier-purchases-${dateSuffix}.csv`,
      };
    }
    case 'po-summary': {
      const pos = await purchasesRepo.list({ supplierId: state.supplierId });
      return {
        columns: ['order_number', 'supplier', 'status', 'created', 'expected', 'subtotal', 'discount', 'tax_rate', 'tax_amount', 'total'],
        rows: pos.map((po) => [
          po.orderNumber,
          supById.get(po.supplierId) || '',
          po.status,
          new Date(po.createdAt).toISOString(),
          po.expectedDate ? new Date(po.expectedDate).toISOString() : '',
          po.subtotal || 0, po.discount || 0, po.taxRate || 0, po.taxAmount || 0, po.total || 0,
        ]),
        filename: `stockvault-po-summary-${dateSuffix}.csv`,
      };
    }
    case 'category': {
      const map = new Map();
      for (const p of filtered) {
        const key = p.categoryId || '__none__';
        if (!map.has(key)) map.set(key, { count: 0, units: 0, cost: 0, retail: 0 });
        const g = map.get(key);
        g.count++; g.units += p.quantity; g.cost += p.quantity * p.cost; g.retail += p.quantity * p.price;
      }
      return {
        columns: ['category', 'products', 'units', 'cost_value', 'retail_value', 'margin_pct'],
        rows: [...map.entries()].map(([id, g]) => [
          id === '__none__' ? '' : (catById.get(id) || ''),
          g.count, g.units, g.cost, g.retail,
          g.retail > 0 ? ((g.retail - g.cost) / g.retail) * 100 : 0,
        ]),
        filename: `stockvault-categories-${dateSuffix}.csv`,
      };
    }
    default:
      return { columns: [], rows: [], filename: 'stockvault-report.csv' };
  }
}

/* =========================================================
   SHARED UI PIECES
   ========================================================= */

function reportHeader(title, meta, extraFilters = {}) {
  const filters = { ...meta.filters, ...extraFilters };
  const filterText = Object.entries(filters)
    .filter(([, v]) => v && v !== '—')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ') || t('reports.noFilters');

  return el('section', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { flexWrap: 'wrap', gap: 'var(--s-3)' } }, [
      el('div', {}, [
        el('h2', { style: { margin: 0 } }, title),
        el('p', { style: { color: 'var(--text-secondary)', margin: '4px 0 0' } },
          `${meta.businessName} · ${t('reports.generatedAt', { datetime: formatDateTime(meta.generated) })}`),
      ]),
    ]),
    el('p', { class: 'field__hint', style: { marginTop: 'var(--s-3)' } }, filterText),
  ]);
}

function table([headers, ...rows], { numericCols = [] } = {}) {
  const numSet = new Set(numericCols);
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'table' }, [
      el('thead', {}, el('tr', {},
        headers.map((h, i) => el('th', { class: numSet.has(i) ? 'col-num' : '' }, h)))),
      el('tbody', {}, rows.map((r) =>
        el('tr', {}, r.map((c, i) =>
          el('td', { class: numSet.has(i) ? 'col-num' : '' }, String(c)))))),
    ]));
}

function kpi(label, value) {
  return el('article', { class: 'kpi' }, [
    el('div', { class: 'kpi__top' }, [
      el('span', { class: 'kpi__label' }, label),
    ]),
    el('div', { class: 'kpi__value' }, value),
  ]);
}

function productStatusLabel(p) {
  const s = productStockStatus(p);
  return s === 'out' ? t('products.statusOut')
       : s === 'low' ? t('products.statusLow')
       : t('products.statusIn');
}

function suggestedQty(p) {
  const target = Math.max((p.lowStockThreshold || 0) * 2, 5);
  return Math.max(target - p.quantity, 1);
}

function movementLabel(type) {
  const keys = {
    opening: 'stock.typeOpening',
    stock_in: 'stock.typeStockIn',
    stock_out: 'stock.typeStockOut',
    sale: 'stock.typeSale',
    customer_return: 'stock.typeCustomerReturn',
    supplier_return: 'stock.typeSupplierReturn',
    adjustment: 'stock.typeAdjustment',
    purchase_received: 'stock.typePurchaseReceived',
    damaged: 'stock.typeDamaged',
  };
  return keys[type] ? t(keys[type]) : type;
}

function poStatusLabel(status) {
  const keys = {
    [PO_STATUS.DRAFT]:              'purchases.statusDraft',
    [PO_STATUS.ORDERED]:            'purchases.statusOrdered',
    [PO_STATUS.PARTIALLY_RECEIVED]: 'purchases.statusPartiallyReceived',
    [PO_STATUS.RECEIVED]:           'purchases.statusReceived',
    [PO_STATUS.CANCELLED]:          'purchases.statusCancelled',
  };
  return keys[status] ? t(keys[status]) : status;
}

function describeFilters(state, catById, supById) {
  const out = {};
  if (state.categoryId) out[t('reports.category')] = catById.get(state.categoryId) || '—';
  if (state.supplierId) out[t('reports.supplier')] = supById.get(state.supplierId) || '—';
  if (state.search)     out[t('common.search')]    = state.search;
  if (state.from || state.to) {
    out[t('reports.from') + ' – ' + t('reports.to')] =
      `${state.from ? formatDate(state.from) : '·'} – ${state.to ? formatDate(state.to) : '·'}`;
  }
  return out;
}

/* =========================================================
   FIELD HELPERS
   ========================================================= */

function buildReportPicker(current, onChange) {
  const sel = el('select', { class: 'select' });
  for (const r of REPORT_KEYS) {
    const o = el('option', { value: r.key }, t(r.labelKey));
    if (r.key === current) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return el('div', { class: 'field', style: { margin: 0 } }, [
    el('label', { class: 'field__label' }, t('reports.report')),
    sel,
  ]);
}

function dateField(label, onChange) {
  const input = el('input', { class: 'input', type: 'date' });
  input.addEventListener('change', () => onChange(
    input.value ? new Date(input.value + 'T00:00:00').getTime() : null));
  return el('div', { class: 'field', style: { margin: 0 } }, [
    el('label', { class: 'field__label' }, label),
    input,
  ]);
}

function selectField(label, options, current, onChange) {
  const sel = el('select', { class: 'select' });
  for (const o of options) {
    const opt = el('option', { value: o.value }, o.label);
    if (o.value === current) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return el('div', { class: 'field', style: { margin: 0 } }, [
    el('label', { class: 'field__label' }, label),
    sel,
  ]);
}

function textField(label, placeholder, onChange) {
  const input = el('input', { class: 'input', type: 'search', placeholder });
  input.addEventListener('input', () => onChange(input.value.trim()));
  return el('div', { class: 'field', style: { margin: 0 } }, [
    el('label', { class: 'field__label' }, label),
    input,
  ]);
}