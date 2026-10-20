/* =========================================================
   StockVault — Stock movement ledger
   Full-history view across all products with date filters,
   type filter, and search by reference/reason.
   All user-visible strings translated via t().
   ========================================================= */

import { el, formatNumber, formatDateTime, debounce, toast, openModal } from '../ui.js';
import { stockRepo, productsRepo, MOVEMENT_TYPES } from '../repositories.js';
import { loadSettings } from '../settings.js';
import { navigate } from '../router.js';
import { openStockAdjust } from './products.js';
import { pageHeader, tableShell, pagination, field, filterBar, readForm } from './_helpers.js';
import { t } from '../i18n.js';

const PAGE_SIZE = 30;

const TYPE_KEYS = {
  [MOVEMENT_TYPES.OPENING]:           'stock.typeOpening',
  [MOVEMENT_TYPES.STOCK_IN]:          'stock.typeStockIn',
  [MOVEMENT_TYPES.STOCK_OUT]:         'stock.typeStockOut',
  [MOVEMENT_TYPES.SALE]:              'stock.typeSale',
  [MOVEMENT_TYPES.CUSTOMER_RETURN]:   'stock.typeCustomerReturn',
  [MOVEMENT_TYPES.SUPPLIER_RETURN]:   'stock.typeSupplierReturn',
  [MOVEMENT_TYPES.ADJUSTMENT]:        'stock.typeAdjustment',
  [MOVEMENT_TYPES.PURCHASE_RECEIVED]: 'stock.typePurchaseReceived',
  [MOVEMENT_TYPES.DAMAGED]:           'stock.typeDamaged',
};

function typeLabel(type) {
  return TYPE_KEYS[type] ? t(TYPE_KEYS[type]) : type;
}

export async function renderStockLedger(container) {
  const settings = await loadSettings();

  const state = {
    from: null,
    to: null,
    type: '',
    q: '',
    page: 1,
    rows: [],
    productsById: {},
  };

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  root.appendChild(pageHeader({
    title: t('stock.title'),
    subtitle: t('stock.subtitle'),
    actions: [
      el('button', {
        class: 'btn btn--primary',
        onclick: () => openQuickAdjust(),
      }, t('stock.recordMovement')),
    ],
  }));

  const filters = filterBar([
    {
      name: 'from', type: 'date', label: t('stock.filterFrom'),
      onChange: (v) => {
        state.from = v ? new Date(v + 'T00:00:00').getTime() : null;
        state.page = 1;
        refresh();
      },
    },
    {
      name: 'to', type: 'date', label: t('stock.filterTo'),
      onChange: (v) => {
        state.to = v ? new Date(v + 'T23:59:59').getTime() : null;
        state.page = 1;
        refresh();
      },
    },
    {
      name: 'type', type: 'select', label: t('stock.filterType'),
      options: [
        { value: '', label: t('stock.allTypes') },
        ...Object.entries(TYPE_KEYS).map(([value, key]) => ({ value, label: t(key) })),
      ],
      onChange: (v) => { state.type = v; state.page = 1; refresh(); },
    },
    {
      name: 'q', type: 'search', label: t('stock.filterSearch'),
      placeholder: t('stock.searchPlaceholder'),
      onChange: debounce((v) => { state.q = v; state.page = 1; refresh(); }, 220),
    },
  ]);
  root.appendChild(filters.node);

  const host = el('div');
  root.appendChild(host);

  async function ensureProductsLoaded() {
    if (Object.keys(state.productsById).length) return;
    const products = await productsRepo.list({ includeArchived: true });
    for (const p of products) state.productsById[p.id] = p;
  }

  async function refresh() {
    host.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'skeleton', style: { height: '300px' } })));

    await ensureProductsLoaded();

    let rows = (state.from != null || state.to != null)
      ? await stockRepo.inRange(state.from ?? 0, state.to ?? Date.now(), { limit: 500 })
      : await stockRepo.recent(500);

    if (state.type) rows = rows.filter((m) => m.type === state.type);
    if (state.q) {
      const needle = state.q.toLowerCase();
      rows = rows.filter((m) =>
        (m.reference || '').toLowerCase().includes(needle) ||
        (m.reason || '').toLowerCase().includes(needle) ||
        (m.notes || '').toLowerCase().includes(needle));
    }

    state.rows = rows;
    render();
  }

  function render() {
    const total = state.rows.length;
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = state.rows.slice(start, start + PAGE_SIZE);

    if (!total) {
      host.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon' }, '○'),
        el('p', { class: 'empty__title' }, t('stock.emptyTitle')),
        el('p', { class: 'empty__text' }, t('stock.emptyText')),
      ])));
      return;
    }

    const table = tableShell({
      columns: [
        { label: t('stock.colWhen') },
        { label: t('stock.colProduct') },
        { label: t('stock.colType') },
        { label: t('stock.colChange'), class: 'col-num' },
        { label: t('stock.colBalance'), class: 'col-num' },
        { label: t('stock.colReference') },
      ],
      rows: pageRows,
      renderRow: (m) => {
        const p = state.productsById[m.productId];
        const tr = el('tr');
        tr.appendChild(el('td', {}, formatDateTime(m.timestamp)));

        const pCell = el('td', {});
        if (p) {
          const a = el('a', { href: `#/products?id=${p.id}`, style: { fontWeight: '500' } }, p.name);
          pCell.append(a, el('div', { class: 'cell-sub mono' }, p.sku));
        } else {
          pCell.append(el('span', { class: 'text-muted' }, '—'));
        }
        tr.appendChild(pCell);

        tr.appendChild(el('td', {}, typeLabel(m.type)));
        tr.appendChild(el('td', {
          class: `col-num ${m.quantity > 0 ? 'text-success' : 'text-danger'}`,
        }, `${m.quantity > 0 ? '+' : ''}${formatNumber(m.quantity)}`));
        tr.appendChild(el('td', { class: 'col-num' }, formatNumber(m.newQuantity)));
        tr.appendChild(el('td', { class: 'mono' }, m.reference || '—'));
        return tr;
      },
    });

    const wrap = el('div', {}, [
      table,
      pagination({
        total,
        page: state.page,
        pageSize: PAGE_SIZE,
        onChange: (p) => { state.page = p; render(); },
      }),
    ]);
    host.replaceChildren(wrap);
  }

  async function openQuickAdjust() {
    const products = await productsRepo.list({ includeArchived: false });
    if (!products.length) {
      toast(t('products.emptyTitle'), { type: 'info' });
      return;
    }

    const select = el('select', { class: 'select', name: 'productId', id: 'f_productId' });
    select.appendChild(el('option', { value: '' }, t('products.allCategories') && '—'));
    for (const p of products) {
      select.appendChild(el('option', { value: p.id }, `${p.name} — ${p.sku} (${p.quantity})`));
    }

    const form = el('form', { class: 'form' }, [
      el('div', { class: 'form-section' }, [
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label' }, t('stock.colProduct')),
          select,
        ]),
      ]),
    ]);

    const { close } = openModal({
      title: t('stock.recordMovement'),
      body: form,
      size: 'modal--sm',
      footer: [
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close() }, t('common.cancel')),
        el('button', { class: 'btn btn--primary', type: 'submit' }, t('common.continue')),
      ],
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = select.value;
      if (!id) return;
      close();
      const product = await productsRepo.get(id);
      if (product) {
        openStockAdjust({ product, onSaved: refresh });
      }
    });
  }

  await refresh();
}