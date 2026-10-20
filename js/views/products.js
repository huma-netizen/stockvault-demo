/* =========================================================
   StockVault — Products views
   - list(): table/grid, search, filters, sort, pagination,
             bulk select, CSV hook stubs, add/edit/delete actions
   - form(): create/edit modal with live profit preview
   - detail(): single-product view with movement history
   - openStockAdjust(): shared stock-adjust modal
   All user-visible strings translated via t().
   ========================================================= */

import {
  el, openModal, confirmDialog, toast, debounce,
  formatCurrency, formatNumber, formatDateTime,
} from '../ui.js';
import {
  productsRepo, categoriesRepo, suppliersRepo, stockRepo,
  productStockStatus, MOVEMENT_TYPES,
} from '../repositories.js';
import { loadSettings } from '../settings.js';
import { refreshBadges } from '../notifications.js';
import { navigate } from '../router.js';
import { t } from '../i18n.js';
import {
  pageHeader, card, filterBar, tableShell, pagination,
  field, readForm, setFieldError, clearFormErrors, statusBadge,
} from './_helpers.js';

const PAGE_SIZE = 20;

const MOVEMENT_KEYS = {
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

function movementLabel(type) {
  return MOVEMENT_KEYS[type] ? t(MOVEMENT_KEYS[type]) : type;
}

/* =========================================================
   LIST VIEW
   ========================================================= */

export async function renderProductsList(container, params = {}) {
  const settings = await loadSettings();

  const state = {
    q: params.q || '',
    categoryId: '',
    supplierId: '',
    status: '',
    sort: 'name-asc',
    view: 'table',
    page: 1,
    selected: new Set(),
    rows: [],
    categories: [],
    suppliers: [],
    currency: settings.currency,
  };

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  const header = pageHeader({
    title: t('products.title'),
    subtitle: t('products.subtitle'),
    actions: [
      el('button', { class: 'btn', id: 'prodImport' }, t('products.importCsv')),
      el('button', { class: 'btn', id: 'prodExport' }, t('products.exportCsv')),
      el('button', { class: 'btn btn--primary', id: 'prodAdd' }, t('products.addProduct')),
    ],
  });
  root.appendChild(header);

  const filters = filterBar([
    {
      name: 'q', type: 'search', placeholder: t('products.searchPlaceholder'), value: state.q,
      onChange: (v) => { state.q = v; state.page = 1; refresh(); },
    },
    {
      name: 'categoryId', type: 'select',
      options: [{ value: '', label: t('products.allCategories') }],
      onChange: (v) => { state.categoryId = v; state.page = 1; refresh(); },
    },
    {
      name: 'supplierId', type: 'select',
      options: [{ value: '', label: t('products.allSuppliers') }],
      onChange: (v) => { state.supplierId = v; state.page = 1; refresh(); },
    },
    {
      name: 'status', type: 'select',
      options: [
        { value: '', label: t('products.anyStatus') },
        { value: 'in', label: t('products.statusIn') },
        { value: 'low', label: t('products.statusLow') },
        { value: 'out', label: t('products.statusOut') },
      ],
      onChange: (v) => { state.status = v; state.page = 1; refresh(); },
    },
    {
      name: 'sort', type: 'select', value: 'name-asc',
      options: [
        { value: 'name-asc',     label: t('products.sortNameAsc') },
        { value: 'name-desc',    label: t('products.sortNameDesc') },
        { value: 'qty-asc',      label: t('products.sortQtyAsc') },
        { value: 'qty-desc',     label: t('products.sortQtyDesc') },
        { value: 'value-desc',   label: t('products.sortValueDesc') },
        { value: 'updated-desc', label: t('products.sortUpdatedDesc') },
      ],
      onChange: (v) => { state.sort = v; state.page = 1; refresh(); },
    },
  ]);
  root.appendChild(filters.node);

  const bulkBar = el('div', {
    class: 'card card--sm',
    style: { display: 'none', alignItems: 'center', justifyContent: 'space-between' },
  });
  root.appendChild(bulkBar);

  const listHost = el('div');
  root.appendChild(listHost);

  header.querySelector('#prodAdd').addEventListener('click', () => openProductForm({ onSaved: refresh }));
  header.querySelector('#prodExport').addEventListener('click', () => exportProductsCsv(state));
  header.querySelector('#prodImport').addEventListener('click', async () => {
    try {
      const mod = await import('./csv.js');
      mod.openImportWizard({ onComplete: () => refresh() });
    } catch {
      toast(t('products.importCsv') + ' — ' + t('reports.title'), { type: 'info' });
    }
  });

  [state.categories, state.suppliers] = await Promise.all([
    categoriesRepo.list(),
    suppliersRepo.list(),
  ]);
  const catSel = filters.inputs.categoryId;
  for (const c of state.categories) catSel.appendChild(el('option', { value: c.id }, c.name));
  const supSel = filters.inputs.supplierId;
  for (const s of state.suppliers) supSel.appendChild(el('option', { value: s.id }, s.name));

  async function refresh() {
    listHost.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'skeleton', style: { height: '240px' } })));

    state.rows = await productsRepo.search({
      q: state.q,
      categoryId: state.categoryId,
      supplierId: state.supplierId,
      stockStatus: state.status,
      sort: state.sort,
    });

    renderList();
    renderBulkBar();
  }

  function renderList() {
    const total = state.rows.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = state.rows.slice(start, start + PAGE_SIZE);

    const catName = (id) => state.categories.find((c) => c.id === id)?.name || '—';
    const host = el('div');

    if (!total) {
      host.appendChild(el('div', { class: 'card' }, el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon' }, '◇'),
        el('p', { class: 'empty__title' },
          state.q ? t('products.noMatchTitle') : t('products.emptyTitle')),
        el('p', { class: 'empty__text' },
          state.q ? t('products.noMatchText') : t('products.emptyText')),
        el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
          el('button', {
            class: 'btn btn--primary',
            onclick: () => openProductForm({ onSaved: refresh }),
          }, t('products.addProduct')),
        ]),
      ])));
    } else if (state.view === 'table') {
      const shell = tableShell({
        selectable: true,
        columns: [
          { label: t('products.colProduct') },
          { label: t('products.colSku') },
          { label: t('products.colCategory') },
          { label: t('products.colCost'), class: 'col-num' },
          { label: t('products.colPrice'), class: 'col-num' },
          { label: t('products.colQty'), class: 'col-num' },
          { label: t('products.colStatus') },
          { label: t('products.colActions'), class: 'col-actions' },
        ],
        rows: pageRows,
        onSelectAll: (checked) => {
          pageRows.forEach((r) => checked ? state.selected.add(r.id) : state.selected.delete(r.id));
          renderList();
          renderBulkBar();
        },
        onSelectOne: (id, checked) => {
          if (checked) state.selected.add(id); else state.selected.delete(id);
          renderBulkBar();
        },
        renderRow: (p) => {
          const status = productStockStatus(p);
          const tr = el('tr', { class: state.selected.has(p.id) ? 'is-selected' : '' });

          const cb = el('input', { type: 'checkbox', 'aria-label': `Select ${p.name}` });
          cb.checked = state.selected.has(p.id);
          cb.addEventListener('change', () => {
            if (cb.checked) state.selected.add(p.id); else state.selected.delete(p.id);
            tr.classList.toggle('is-selected', cb.checked);
            renderBulkBar();
          });
          tr.appendChild(el('td', { class: 'col-check' }, cb));

          const productCell = el('td', {}, el('div', { class: 'cell-product' }, [
            el('div', { class: 'cell-thumb' }, p.imageDataUrl
              ? el('img', { src: p.imageDataUrl, alt: '' })
              : el('span', { style: { fontSize: '14px' } }, p.name.charAt(0).toUpperCase())),
            el('div', {}, [
              el('div', { class: 'cell-name' }, p.name),
              p.brand ? el('div', { class: 'cell-sub' }, p.brand) : null,
            ]),
          ]));
          productCell.style.cursor = 'pointer';
          productCell.addEventListener('click', () => navigate('products', { id: p.id }));
          tr.appendChild(productCell);

          tr.appendChild(el('td', { class: 'mono' }, p.sku));
          tr.appendChild(el('td', {}, catName(p.categoryId)));
          tr.appendChild(el('td', { class: 'col-num' }, formatCurrency(p.cost, state.currency)));
          tr.appendChild(el('td', { class: 'col-num' }, formatCurrency(p.price, state.currency)));
          tr.appendChild(el('td', { class: 'col-num' }, formatNumber(p.quantity)));
          tr.appendChild(el('td', {}, statusBadge(status)));

          tr.appendChild(el('td', { class: 'col-actions' },
            el('div', { class: 'row-actions' }, [
              iconBtn(t('products.adjustStock'), () => openStockAdjust({ product: p, onSaved: refresh })),
              iconBtn(t('common.edit'),        () => openProductForm({ product: p, onSaved: refresh })),
              iconBtn(t('common.delete'),      async () => {
                const ok = await confirmDialog({
                  title: t('products.deleteTitle', { name: p.name }),
                  message: t('products.deleteMessage'),
                  confirmLabel: t('products.deleteConfirm'),
                  cancelLabel: t('common.cancel'),
                  danger: true,
                });
                if (!ok) return;
                await productsRepo.remove(p.id);
                toast(t('products.deleteToast'), { type: 'success' });
                refresh();
                refreshBadges();
              }),
            ])));

          return tr;
        },
      });
      host.appendChild(shell);
      host.appendChild(pagination({
        total, page: state.page, pageSize: PAGE_SIZE,
        onChange: (p) => { state.page = p; renderList(); },
      }));
    } else {
      const grid = el('div', {
        style: {
          display: 'grid',
          gap: 'var(--s-4)',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        },
      });
      for (const p of pageRows) {
        const status = productStockStatus(p);
        const tile = el('article', {
          class: 'card neu-raised is-interactive',
          style: { cursor: 'pointer' },
        }, [
          el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } }, [
            el('div', {}, [
              el('div', { style: { fontWeight: '600' } }, p.name),
              el('div', { class: 'mono', style: { color: 'var(--text-secondary)', fontSize: 'var(--fs-xs)' } }, p.sku),
            ]),
            statusBadge(status),
          ]),
          el('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: 'var(--s-3)' } }, [
            el('div', {}, [
              el('div', { style: { fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' } }, t('products.colQty')),
              el('div', { style: { fontSize: 'var(--fs-lg)', fontWeight: '600' } }, formatNumber(p.quantity)),
            ]),
            el('div', { style: { textAlign: 'right' } }, [
              el('div', { style: { fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' } }, t('dashboard.inventoryValue')),
              el('div', { style: { fontSize: 'var(--fs-lg)', fontWeight: '600' } },
                formatCurrency(p.quantity * p.cost, state.currency)),
            ]),
          ]),
        ]);
        tile.addEventListener('click', () => navigate('products', { id: p.id }));
        grid.appendChild(tile);
      }
      host.appendChild(grid);
      host.appendChild(pagination({
        total, page: state.page, pageSize: PAGE_SIZE,
        onChange: (p) => { state.page = p; renderList(); },
      }));
    }

    listHost.replaceChildren(host);
  }

  function renderBulkBar() {
    const n = state.selected.size;
    if (!n) {
      bulkBar.style.display = 'none';
      bulkBar.replaceChildren();
      return;
    }
    bulkBar.style.display = 'flex';
    bulkBar.replaceChildren(
      el('span', {}, t('products.bulkSelected', { count: formatNumber(n) })),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn--sm', onclick: () => exportProductsCsv(state, [...state.selected]) },
          t('products.bulkExport')),
        el('button', { class: 'btn btn--sm btn--danger', onclick: async () => {
          const ok = await confirmDialog({
            title: t('products.deleteTitle', { name: formatNumber(n) }),
            message: t('products.deleteMessage'),
            confirmLabel: t('products.deleteConfirm'),
            cancelLabel: t('common.cancel'),
            danger: true,
          });
          if (!ok) return;
          for (const id of state.selected) await productsRepo.remove(id);
          state.selected.clear();
          toast(t('products.deleteToast'), { type: 'success' });
          refresh();
          refreshBadges();
        } }, t('products.bulkDelete')),
        el('button', { class: 'btn btn--sm btn--ghost', onclick: () => {
          state.selected.clear();
          renderList();
          renderBulkBar();
        } }, t('products.bulkClear')),
      ])
    );
  }

  await refresh();
}

/* =========================================================
   FORM
   ========================================================= */

export async function openProductForm({ product = null, onSaved } = {}) {
  const isEdit = Boolean(product);
  const [settings, categories, suppliers] = await Promise.all([
    loadSettings(),
    categoriesRepo.list(),
    suppliersRepo.list(),
  ]);

  const initial = product || {
    name: '', sku: '', barcode: '', description: '',
    categoryId: '', supplierId: '', brand: '',
    cost: 0, price: 0, lowStockThreshold: settings.defaultLowStock,
    unit: '', location: '',
  };

  const form = el('form', { class: 'form', novalidate: true }, [
    el('div', { class: 'form-section' }, [
      el('div', { class: 'form-section__title' }, t('products.formBasic')),
      el('div', { class: 'form-grid' }, [
        field({ name: 'name',    label: t('products.fieldName'),    value: initial.name, required: true }),
        field({ name: 'sku',     label: t('products.fieldSku'),     value: initial.sku, required: true }),
        field({ name: 'barcode', label: t('products.fieldBarcode'), value: initial.barcode }),
        field({ name: 'brand',   label: t('products.fieldBrand'),   value: initial.brand }),
      ]),
    ]),
    el('div', { class: 'form-section' }, [
      el('div', { class: 'form-section__title' }, t('products.formClassification')),
      el('div', { class: 'form-grid' }, [
        field({
          name: 'categoryId', label: t('products.fieldCategory'), type: 'select',
          value: initial.categoryId,
          options: [
            { value: '', label: t('common.none') },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ],
        }),
        field({
          name: 'supplierId', label: t('products.fieldSupplier'), type: 'select',
          value: initial.supplierId,
          options: [
            { value: '', label: t('common.none') },
            ...suppliers.map((s) => ({ value: s.id, label: s.name })),
          ],
        }),
      ]),
    ]),
    el('div', { class: 'form-section' }, [
      el('div', { class: 'form-section__title' }, t('products.formPricing')),
      el('div', { class: 'form-grid' }, [
        field({ name: 'cost',  label: t('products.fieldCost'),  type: 'number', value: initial.cost, min: 0, step: '0.01', required: true }),
        field({ name: 'price', label: t('products.fieldPrice'), type: 'number', value: initial.price, min: 0, step: '0.01', required: true }),
      ]),
      profitPreview(),
    ]),
    el('div', { class: 'form-section' }, [
      el('div', { class: 'form-section__title' }, t('products.formStock')),
      el('div', { class: 'form-grid' }, [
        field({ name: 'lowStockThreshold', label: t('products.fieldLowStockThreshold'), type: 'number', value: initial.lowStockThreshold, min: 0, step: '1' }),
        field({ name: 'unit',              label: t('products.fieldUnit'),              value: initial.unit }),
        field({ name: 'location',          label: t('products.fieldLocation'),          value: initial.location }),
      ]),
      el('p', { class: 'field__hint' },
        isEdit
          ? t('stock.adjustTitle') + ' — ' + t('stock.adjustByTarget')
          : t('stock.typeOpening')),
    ]),
    el('div', { class: 'form-section' }, [
      el('div', { class: 'form-section__title' }, t('products.formAdditional')),
      field({ name: 'description', label: t('products.fieldDescription'), type: 'textarea', value: initial.description, rows: 3 }),
    ]),
  ]);

  const costInput = form.querySelector('[name="cost"]');
  const priceInput = form.querySelector('[name="price"]');
  const preview = form.querySelector('.profit-preview');
  const updatePreview = () => {
    const cost = Number(costInput.value) || 0;
    const price = Number(priceInput.value) || 0;
    const profit = price - cost;
    const margin = price > 0 ? (profit / price) * 100 : 0;
    preview.querySelector('[data-k="cost"]').textContent   = formatCurrency(cost, settings.currency);
    preview.querySelector('[data-k="price"]').textContent  = formatCurrency(price, settings.currency);
    preview.querySelector('[data-k="profit"]').textContent = formatCurrency(profit, settings.currency);
    preview.querySelector('[data-k="margin"]').textContent = `${margin.toFixed(1)}%`;
  };
  costInput.addEventListener('input', updatePreview);
  priceInput.addEventListener('input', updatePreview);
  updatePreview();

  const { close } = openModal({
    title: isEdit ? t('products.formEditTitle', { name: product.name }) : t('products.formAddTitle'),
    size: 'modal--wide',
    body: form,
    footer: [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close() }, t('common.cancel')),
      el('button', {
        class: 'btn btn--primary',
        type: 'submit',
        id: 'productFormSubmit',
      }, isEdit ? t('products.saveButton') : t('products.createButton')),
    ],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);

    const data = readForm(form);
    if (data.cost == null) data.cost = 0;
    if (data.price == null) data.price = 0;
    if (data.lowStockThreshold == null) data.lowStockThreshold = 0;

    if (!data.name) { setFieldError(form, 'name', t('common.required')); return; }
    if (!data.sku)  { setFieldError(form, 'sku', t('common.required')); return; }
    if (data.cost < 0)  { setFieldError(form, 'cost', t('products.fieldCost')); return; }
    if (data.price < 0) { setFieldError(form, 'price', t('products.fieldPrice')); return; }

    const submitBtn = document.getElementById('productFormSubmit');
    if (submitBtn) submitBtn.disabled = true;

    try {
      if (isEdit) {
        await productsRepo.update(product.id, data);
        toast(t('products.updateToast'), { type: 'success' });
      } else {
        await productsRepo.create(data);
        toast(t('products.createToast'), { type: 'success' });
      }
      close();
      onSaved?.();
      refreshBadges();
    } catch (err) {
      if (submitBtn) submitBtn.disabled = false;
      const msg = err.message || t('errors.generic');
      if (/sku/i.test(msg)) setFieldError(form, 'sku', msg);
      else toast(msg, { type: 'danger' });
    }
  });
}

function profitPreview() {
  const item = (k, label) => el('div', { class: 'profit-preview__item' }, [
    el('span', { class: 'profit-preview__label' }, label),
    el('span', { class: 'profit-preview__value', dataset: { k } }, '—'),
  ]);
  return el('div', { class: 'profit-preview' }, [
    item('cost',   t('products.profitCost')),
    item('price',  t('products.profitPrice')),
    item('profit', t('products.profitPerUnit')),
    item('margin', t('products.profitMargin')),
  ]);
}

/* =========================================================
   DETAIL VIEW
   ========================================================= */

export async function renderProductDetail(container, params) {
  const id = params.id;
  if (!id) { navigate('products'); return; }

  const settings = await loadSettings();
  const product = await productsRepo.get(id);

  if (!product) {
    container.appendChild(el('div', { class: 'card' }, el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title' }, t('errors.notFound')),
      el('p', { class: 'empty__text' }, t('errors.notFoundHint')),
      el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
        el('button', { class: 'btn', onclick: () => navigate('products') },
          `${t('errors.backTo')} ${t('products.title')}`),
      ]),
    ])));
    return;
  }

  const [cat, sup, movements] = await Promise.all([
    product.categoryId ? categoriesRepo.get(product.categoryId) : null,
    product.supplierId ? suppliersRepo.get(product.supplierId) : null,
    stockRepo.forProduct(product.id, { limit: 50 }),
  ]);

  const status = productStockStatus(product);
  const value = product.quantity * product.cost;

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  root.appendChild(el('div', { class: 'row row--between' }, [
    el('button', { class: 'btn btn--ghost', onclick: () => navigate('products') },
      `${t('errors.backTo')} ${t('products.title')}`),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn',
        onclick: () => openStockAdjust({ product, onSaved: () => navigate('products', { id }) }),
      }, t('products.adjustStock')),
      el('button', {
        class: 'btn btn--primary',
        onclick: () => openProductForm({ product, onSaved: () => navigate('products', { id }) }),
      }, t('common.edit')),
    ]),
  ]));

  root.appendChild(el('div', { class: 'dash-hero' }, [
    el('div', {}, [
      el('h2', {}, product.name),
      el('p', {}, [
        el('span', { class: 'mono' }, product.sku),
        ' · ',
        cat ? cat.name : t('common.none'),
        sup ? ` · ${sup.name}` : '',
      ]),
    ]),
    statusBadge(status),
  ]));

  root.appendChild(el('div', { class: 'kpi-grid' }, [
    kpi(t('products.colQty'), formatNumber(product.quantity), product.unit || '', 'accent'),
    kpi(t('dashboard.inventoryValue'), formatCurrency(value, settings.currency),
      formatCurrency(product.cost, settings.currency), 'success'),
    kpi(t('products.colPrice'), formatCurrency(product.price, settings.currency),
      `${t('products.profitPerUnit')} ${formatCurrency(product.price - product.cost, settings.currency)}`, 'info'),
    kpi(t('products.fieldLowStockThreshold'), formatNumber(product.lowStockThreshold), '', 'warning'),
  ]));

  const details = card({
    title: t('products.detailTitle'),
    body: el('div', { class: 'stack' }, [
      kv(t('products.fieldDescription'), product.description || '—'),
      kv(t('products.fieldBrand'),       product.brand || '—'),
      kv(t('products.fieldBarcode'),     product.barcode || '—'),
      kv(t('products.fieldLocation'),    product.location || '—'),
      kv(t('common.createdAt'),          formatDateTime(product.createdAt)),
      kv(t('common.updatedAt'),          formatDateTime(product.updatedAt)),
    ]),
  });

  const history = card({
    title: t('products.movementHistory'),
    body: movements.length ? el('div', { class: 'table-wrap' },
      el('table', { class: 'table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, t('stock.colWhen')),
          el('th', {}, t('stock.colType')),
          el('th', { class: 'col-num' }, t('stock.colChange')),
          el('th', { class: 'col-num' }, t('stock.colBalance')),
          el('th', {}, t('stock.colReference')),
        ])),
        el('tbody', {}, movements.map((m) => el('tr', {}, [
          el('td', {}, formatDateTime(m.timestamp)),
          el('td', {}, movementLabel(m.type)),
          el('td', { class: `col-num ${m.quantity > 0 ? 'text-success' : 'text-danger'}` },
            `${m.quantity > 0 ? '+' : ''}${formatNumber(m.quantity)}`),
          el('td', { class: 'col-num' }, formatNumber(m.newQuantity)),
          el('td', { class: 'mono' }, m.reference || '—'),
        ]))),
      ])
    ) : el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title' }, t('dashboard.noMovements')),
      el('p', { class: 'empty__text' }, t('dashboard.noMovementsHint')),
    ]),
  });

  root.appendChild(el('div', { class: 'dash-analytics' }, [details, history]));
}

/* =========================================================
   STOCK ADJUST MODAL (shared)
   ========================================================= */

export async function openStockAdjust({ product, onSaved } = {}) {
  const settings = await loadSettings();

  const preview = el('div', {
    class: 'profit-preview',
    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  });
  const previewValue = el('span', { class: 'profit-preview__value' }, formatNumber(product.quantity));
  preview.append(
    el('div', { class: 'profit-preview__item' }, [
      el('span', { class: 'profit-preview__label' }, t('stock.currentBalance')),
      el('span', { class: 'profit-preview__value' }, formatNumber(product.quantity)),
    ]),
    el('div', { class: 'profit-preview__item', style: { textAlign: 'right' } }, [
      el('span', { class: 'profit-preview__label' }, t('stock.projectedBalance')),
      previewValue,
    ]),
  );

  const typeSelect = el('select', { class: 'select', name: 'type' }, [
    el('option', { value: MOVEMENT_TYPES.STOCK_IN },         t('stock.typeStockIn')),
    el('option', { value: MOVEMENT_TYPES.STOCK_OUT },        t('stock.typeStockOut')),
    el('option', { value: MOVEMENT_TYPES.SALE },             t('stock.typeSale')),
    el('option', { value: MOVEMENT_TYPES.CUSTOMER_RETURN },  t('stock.typeCustomerReturn')),
    el('option', { value: MOVEMENT_TYPES.SUPPLIER_RETURN },  t('stock.typeSupplierReturn')),
    el('option', { value: MOVEMENT_TYPES.ADJUSTMENT },       t('stock.typeAdjustment')),
    el('option', { value: MOVEMENT_TYPES.DAMAGED },          t('stock.typeDamaged')),
  ]);

  const qtyInput = el('input', { class: 'input', type: 'number', min: '1', step: '1', name: 'quantity' });
  const refInput = el('input', { class: 'input', type: 'text', name: 'reference' });
  const reasonInput = el('input', { class: 'input', type: 'text', name: 'reason' });
  const notesInput = el('textarea', { class: 'textarea', name: 'notes', rows: 2 });

  function recompute() {
    const q = Math.floor(Number(qtyInput.value) || 0);
    const type = typeSelect.value;
    const decreasing = [
      MOVEMENT_TYPES.STOCK_OUT, MOVEMENT_TYPES.SALE,
      MOVEMENT_TYPES.SUPPLIER_RETURN, MOVEMENT_TYPES.DAMAGED,
    ].includes(type);
    const target = product.quantity + (decreasing ? -q : q);
    previewValue.textContent = formatNumber(target);
    previewValue.classList.toggle('text-danger', target < 0);
    previewValue.classList.toggle('text-success', target >= 0);
  }
  qtyInput.addEventListener('input', recompute);
  typeSelect.addEventListener('change', recompute);
  recompute();

  const form = el('form', { class: 'form', novalidate: true }, [
    el('div', { class: 'form-section' }, [
      el('div', { class: 'form-section__title' }, `${product.name} · ${product.sku}`),
      preview,
    ]),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field', dataset: { name: 'type' } }, [
        el('label', { class: 'field__label' }, t('stock.movementType')),
        typeSelect,
        el('span', { class: 'field__error' }),
      ]),
      el('div', { class: 'field', dataset: { name: 'quantity' } }, [
        el('label', { class: 'field__label' }, t('stock.quantity')),
        qtyInput,
        el('span', { class: 'field__error' }),
      ]),
    ]),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field', dataset: { name: 'reference' } }, [
        el('label', { class: 'field__label' }, t('stock.reference')),
        refInput,
      ]),
    ]),
    el('div', { class: 'form-section' }, [
      el('div', { class: 'field', dataset: { name: 'reason' } }, [
        el('label', { class: 'field__label' }, t('stock.reason')),
        reasonInput,
      ]),
      el('div', { class: 'field', dataset: { name: 'notes' } }, [
        el('label', { class: 'field__label' }, t('common.notes')),
        notesInput,
      ]),
    ]),
  ]);

  const { close } = openModal({
    title: t('stock.adjustTitle'),
    body: form,
    size: 'modal--wide',
    footer: [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close() }, t('common.cancel')),
      el('button', { class: 'btn btn--primary', type: 'submit' }, t('stock.recordButton')),
    ],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);

    const type = typeSelect.value;
    const rawQty = Math.floor(Number(qtyInput.value) || 0);
    if (rawQty <= 0) { setFieldError(form, 'quantity', t('common.required')); return; }

    const submitBtn = document.querySelector('.modal__footer button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      await stockRepo.applyMovement({
        productId: product.id,
        type,
        quantity: rawQty,
        reference: refInput.value,
        reason: reasonInput.value,
        notes: notesInput.value,
        allowNegative: settings.allowNegativeStock,
      });
      toast(t('stock.recordToast'), { type: 'success' });
      close();
      onSaved?.();
      refreshBadges();
    } catch (err) {
      if (submitBtn) submitBtn.disabled = false;
      toast(err.message || t('errors.generic'), { type: 'danger' });
    }
  });
}

/* =========================================================
   SMALL HELPERS
   ========================================================= */

function iconBtn(label, onClick) {
  const b = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': label,
    title: label,
    onclick: onClick,
  });
  b.innerHTML = iconFor(label);
  return b;
}

function iconFor(label) {
  // The label may be in any language; decide by matching against known keys.
  const editLabel = t('common.edit');
  const deleteLabel = t('common.delete');
  const adjustLabel = t('products.adjustStock');

  if (label === editLabel)   return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  if (label === deleteLabel) return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
  if (label === adjustLabel) return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
  return '';
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

function kv(label, value) {
  return el('div', {
    class: 'row row--between',
    style: { padding: '6px 0', borderBottom: '1px solid var(--divider)' },
  }, [
    el('span', { style: { color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' } }, label),
    el('span', {}, value),
  ]);
}

/* =========================================================
   CSV EXPORT (used by list and bulk actions)
   ========================================================= */

function exportProductsCsv(state, ids = null) {
  const rows = ids
    ? state.rows.filter((r) => ids.includes(r.id))
    : state.rows;
  if (!rows.length) { toast(t('products.emptyTitle'), { type: 'info' }); return; }

  const catById = Object.fromEntries(state.categories.map((c) => [c.id, c.name]));
  const supById = Object.fromEntries(state.suppliers.map((s) => [s.id, s.name]));
  const headers = [
    'name', 'sku', 'barcode', 'description', 'category', 'supplier',
    'brand', 'unit', 'location', 'cost', 'price', 'quantity', 'lowStockThreshold', 'status',
  ];

  const escape = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [headers.join(',')];
  for (const p of rows) {
    lines.push([
      p.name, p.sku, p.barcode || '', p.description || '',
      catById[p.categoryId] || '', supById[p.supplierId] || '',
      p.brand || '', p.unit || '', p.location || '',
      p.cost, p.price, p.quantity, p.lowStockThreshold,
      p.archived ? 'archived' : 'active',
    ].map(escape).join(','));
  }

  const csv = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stockvault-products-${new Date().toISOString().slice(0, 10)}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  toast(t('products.exportCsv'), { type: 'success' });
}