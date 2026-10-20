/* =========================================================
   StockVault — Low stock alerts
   Dynamic status from product.quantity vs threshold.
   Suggests replenishment quantity and estimated cost.
   All user-visible strings translated via t().
   ========================================================= */

import { el, formatCurrency, formatNumber, toast } from '../ui.js';
import { productsRepo, suppliersRepo, productStockStatus } from '../repositories.js';
import { loadSettings } from '../settings.js';
import { navigate } from '../router.js';
import { openStockAdjust } from './products.js';
import { pageHeader, card, tableShell, filterBar } from './_helpers.js';
import { t } from '../i18n.js';

export async function renderLowStock(container) {
  const settings = await loadSettings();

  const state = {
    status: '',
    supplierId: '',
    q: '',
    rows: [],
    suppliersById: {},
  };

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  root.appendChild(pageHeader({
    title: t('lowStock.title'),
    subtitle: t('lowStock.subtitle'),
  }));

  const filters = filterBar([
    {
      name: 'status',
      type: 'select',
      options: [
        { value: '', label: t('lowStock.filterAll') },
        { value: 'out', label: t('lowStock.filterOut') },
        { value: 'low', label: t('lowStock.filterLow') },
      ],
      onChange: (v) => { state.status = v; refresh(); },
    },
    {
      name: 'supplierId',
      type: 'select',
      options: [{ value: '', label: t('lowStock.filterSupplier') }],
      onChange: (v) => { state.supplierId = v; refresh(); },
    },
    {
      name: 'q',
      type: 'search',
      placeholder: t('lowStock.searchPlaceholder'),
      onChange: (v) => { state.q = v.toLowerCase(); refresh(); },
    },
  ]);
  root.appendChild(filters.node);

  const host = el('div');
  root.appendChild(host);

  async function refresh() {
    host.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'skeleton', style: { height: '240px' } })));

    const [allProducts, suppliers] = await Promise.all([
      productsRepo.list({ includeArchived: false }),
      suppliersRepo.list(),
    ]);

    state.suppliersById = Object.fromEntries(suppliers.map((s) => [s.id, s]));

    if (filters.inputs.supplierId.options.length === 1) {
      for (const s of suppliers) {
        filters.inputs.supplierId.appendChild(el('option', { value: s.id }, s.name));
      }
    }

    let rows = allProducts.filter((p) => {
      const status = productStockStatus(p);
      return status === 'low' || status === 'out';
    });

    if (state.status) rows = rows.filter((p) => productStockStatus(p) === state.status);
    if (state.supplierId) rows = rows.filter((p) => p.supplierId === state.supplierId);
    if (state.q) {
      rows = rows.filter((p) =>
        p.name.toLowerCase().includes(state.q) || p.sku.toLowerCase().includes(state.q));
    }

    rows.sort((a, b) => {
      const sa = productStockStatus(a) === 'out' ? 0 : 1;
      const sb = productStockStatus(b) === 'out' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return a.quantity - b.quantity;
    });

    state.rows = rows;
    render();
  }

  function render() {
    const rows = state.rows;

    if (!rows.length) {
      host.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon' }, '✓'),
        el('p', { class: 'empty__title' }, t('lowStock.emptyTitle')),
        el('p', { class: 'empty__text' }, t('lowStock.emptyText')),
      ])));
      return;
    }

    const outCount = rows.filter((p) => productStockStatus(p) === 'out').length;
    const lowCount = rows.length - outCount;
    const totalEstimatedCost = rows.reduce((sum, p) => sum + estimatedCost(p, settings.defaultLowStock), 0);

    const summary = el('div', { class: 'kpi-grid' }, [
      kpi(t('lowStock.kpiOut'), formatNumber(outCount), t('lowStock.filterOut'), 'danger'),
      kpi(t('lowStock.kpiLow'), formatNumber(lowCount), t('lowStock.filterLow'), 'warning'),
      kpi(t('lowStock.kpiEstimatedCost'), formatCurrency(totalEstimatedCost, settings.currency), t('lowStock.colSuggested'), 'info'),
      kpi(t('lowStock.kpiSuppliers'),
        formatNumber(new Set(rows.map((p) => p.supplierId).filter(Boolean)).size),
        t('suppliers.title'), 'accent'),
    ]);
    host.replaceChildren(summary);

    const table = tableShell({
      columns: [
        { label: t('lowStock.colProduct') },
        { label: t('lowStock.colSupplier') },
        { label: t('lowStock.colOnHand'), class: 'col-num' },
        { label: t('lowStock.colThreshold'), class: 'col-num' },
        { label: t('lowStock.colSuggested'), class: 'col-num' },
        { label: t('lowStock.colEstimatedCost'), class: 'col-num' },
        { label: t('lowStock.colActions'), class: 'col-actions' },
      ],
      rows,
      renderRow: (p) => {
        const status = productStockStatus(p);
        const suggested = suggestedOrderQty(p, settings.defaultLowStock);
        const cost = suggested * p.cost;
        const sup = state.suppliersById[p.supplierId];
        const tr = el('tr');

        const statusLabel = status === 'out' ? t('dashboard.out') : t('dashboard.low');
        const pCell = el('td', {}, [
          el('div', { style: { fontWeight: '500', cursor: 'pointer' } }, p.name),
          el('div', { class: 'cell-sub' }, [
            el('span', { class: 'mono' }, p.sku),
            ' · ',
            status === 'out'
              ? el('span', { class: 'text-danger' }, statusLabel)
              : el('span', { class: 'text-warning' }, statusLabel),
          ]),
        ]);
        pCell.querySelector('div').addEventListener('click', () => navigate('products', { id: p.id }));
        tr.appendChild(pCell);

        const supCell = el('td', {}, sup ? sup.name : el('span', { class: 'text-muted' }, t('lowStock.unassigned')));
        if (sup) {
          supCell.style.cursor = 'pointer';
          supCell.addEventListener('click', () => navigate('suppliers', { id: sup.id }));
        }
        tr.appendChild(supCell);

        tr.appendChild(el('td', { class: 'col-num' }, formatNumber(p.quantity)));
        tr.appendChild(el('td', { class: 'col-num' }, formatNumber(p.lowStockThreshold)));
        tr.appendChild(el('td', { class: 'col-num', style: { fontWeight: '600' } }, formatNumber(suggested)));
        tr.appendChild(el('td', { class: 'col-num' }, formatCurrency(cost, settings.currency)));

        tr.appendChild(el('td', { class: 'col-actions' }, el('div', { class: 'row-actions' }, [
          el('button', {
            class: 'btn btn--sm',
            onclick: () => openStockAdjust({ product: p, onSaved: refresh }),
          }, t('lowStock.restock')),
          el('button', {
            class: 'btn btn--sm btn--ghost',
            onclick: () => {
              toast(t('lowStock.createPo') + ' — ' + t('purchases.title'), { type: 'info' });
            },
          }, t('lowStock.createPo')),
        ])));
        return tr;
      },
    });
    host.appendChild(table);
  }

  await refresh();
}

function suggestedOrderQty(product, defaultThreshold) {
  const threshold = product.lowStockThreshold || defaultThreshold;
  const target = Math.max(threshold * 2, 5);
  const delta = target - product.quantity;
  return Math.max(delta, 1);
}

function estimatedCost(product, defaultThreshold) {
  return suggestedOrderQty(product, defaultThreshold) * product.cost;
}

function kpi(label, value, foot, tone) {
  return el('article', { class: 'kpi' }, [
    el('div', { class: 'kpi__top' }, [
      el('span', { class: 'kpi__label' }, label),
      el('span', {
        class: `kpi__icon kpi__icon--${tone}`,
        html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>',
      }),
    ]),
    el('div', { class: 'kpi__value' }, value),
    el('div', { class: 'kpi__foot' }, foot),
  ]);
}