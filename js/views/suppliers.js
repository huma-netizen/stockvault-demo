/* =========================================================
   StockVault — Suppliers views
   - list(): search, table, archive/restore, delete-with-guard
   - detail(): info, linked products, purchase order history
   - form(): create/edit modal
   All user-visible strings translated via t().
   ========================================================= */

import {
  el, openModal, confirmDialog, toast,
  formatCurrency, formatNumber, formatDateTime, debounce,
} from '../ui.js';
import { suppliersRepo, productsRepo, purchasesRepo, PO_STATUS } from '../repositories.js';
import { loadSettings } from '../settings.js';
import { navigate } from '../router.js';
import { t } from '../i18n.js';
import {
  pageHeader, card, tableShell, field, readForm, setFieldError, clearFormErrors,
} from './_helpers.js';

/* =========================================================
   LIST
   ========================================================= */

export async function renderSuppliersList(container) {
  const settings = await loadSettings();

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  root.appendChild(pageHeader({
    title: t('suppliers.title'),
    subtitle: t('suppliers.subtitle'),
    actions: [
      el('button', {
        class: 'btn btn--primary',
        onclick: () => openSupplierForm({ onSaved: refresh }),
      }, t('suppliers.addSupplier')),
    ],
  }));

  const search = el('input', {
    class: 'input',
    type: 'search',
    placeholder: t('suppliers.searchPlaceholder'),
  });
  search.addEventListener('input', debounce((e) => refresh(e.target.value), 220));
  root.appendChild(el('div', { class: 'card card--sm' },
    el('div', { class: 'field', style: { margin: 0 } }, search)));

  const host = el('div');
  root.appendChild(host);

  async function refresh(q = '') {
    host.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'skeleton', style: { height: '200px' } })));

    const suppliers = await suppliersRepo.list({ includeArchived: true, q });

    if (!suppliers.length) {
      host.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon' }, '◇'),
        el('p', { class: 'empty__title' }, q ? t('suppliers.noMatchTitle') : t('suppliers.emptyTitle')),
        el('p', { class: 'empty__text' }, q ? t('suppliers.noMatchText') : t('suppliers.emptyText')),
        !q ? el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
          el('button', {
            class: 'btn btn--primary',
            onclick: () => openSupplierForm({ onSaved: refresh }),
          }, t('suppliers.addSupplier')),
        ]) : null,
      ])));
      return;
    }

    host.replaceChildren(tableShell({
      columns: [
        { label: t('suppliers.colName') },
        { label: t('suppliers.colCompany') },
        { label: t('suppliers.colContact') },
        { label: t('suppliers.colProducts'), class: 'col-num' },
        { label: t('common.actions'), class: 'col-actions' },
      ],
      rows: suppliers,
      renderRow: (s) => {
        const tr = el('tr', { class: s.archived ? 'is-disabled' : '' });
        const nameCell = el('td', {
          style: { fontWeight: '600', cursor: 'pointer' },
        }, s.name);
        nameCell.addEventListener('click', () => navigate('suppliers', { id: s.id }));
        tr.appendChild(nameCell);

        tr.appendChild(el('td', {}, s.company || '—'));

        tr.appendChild(el('td', {}, [
          s.email ? el('div', {}, s.email) : null,
          s.phone ? el('div', { class: 'cell-sub' }, s.phone) : null,
        ].filter(Boolean)));

        const countCell = el('td', { class: 'col-num' }, '—');
        tr.appendChild(countCell);

        tr.appendChild(el('td', { class: 'col-actions' }, el('div', { class: 'row-actions' }, [
          el('button', {
            class: 'icon-btn',
            title: t('common.search') === 'Search' ? 'View' : t('suppliers.detailContact'),
            onclick: () => navigate('suppliers', { id: s.id }),
          }, '→'),
          el('button', {
            class: 'icon-btn',
            title: t('common.edit'),
            onclick: () => openSupplierForm({ supplier: s, onSaved: refresh }),
          }, '✎'),
          el('button', {
            class: 'icon-btn',
            title: s.archived ? t('suppliers.restoreAction') : t('suppliers.archiveAction'),
            onclick: async () => {
              await suppliersRepo.setArchived(s.id, !s.archived);
              toast(
                s.archived ? t('suppliers.restoredToast') : t('suppliers.archivedToast'),
                { type: 'success' }
              );
              refresh(search.value);
            },
          }, s.archived ? '↺' : '⌫'),
          el('button', {
            class: 'icon-btn',
            title: t('common.delete'),
            onclick: async () => {
              const ok = await confirmDialog({
                title: t('suppliers.deleteTitle', { name: s.name }),
                message: t('suppliers.deleteMessage'),
                confirmLabel: t('suppliers.deleteConfirm'),
                cancelLabel: t('common.cancel'),
                danger: true,
              });
              if (!ok) return;
              const pos = await purchasesRepo.list({ supplierId: s.id });
              if (pos.length) {
                toast(`${t('suppliers.deleteMessage')} (${pos.length})`, { type: 'danger' });
                return;
              }
              await suppliersRepo.remove(s.id);
              toast(t('suppliers.deleteToast'), { type: 'success' });
              refresh(search.value);
            },
          }, '🗑'),
        ])));

        (async () => {
          try {
            const products = await productsRepo.list({ includeArchived: false });
            const n = products.filter((p) => p.supplierId === s.id).length;
            countCell.textContent = formatNumber(n);
          } catch { countCell.textContent = '—'; }
        })();

        return tr;
      },
    }));
  }

  await refresh();
}

/* =========================================================
   DETAIL
   ========================================================= */

export async function renderSupplierDetail(container, params) {
  const supplier = await suppliersRepo.get(params.id);

  if (!supplier) {
    container.appendChild(el('div', { class: 'card' }, el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title' }, t('errors.notFound')),
      el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
        el('button', {
          class: 'btn',
          onclick: () => navigate('suppliers'),
        }, `${t('errors.backTo')} ${t('suppliers.title')}`),
      ]),
    ])));
    return;
  }

  const settings = await loadSettings();
  const [allProducts, pos] = await Promise.all([
    productsRepo.list({ includeArchived: true }),
    purchasesRepo.list({ supplierId: supplier.id }),
  ]);

  const linkedProducts = allProducts.filter((p) => p.supplierId === supplier.id);
  const activeLinked = linkedProducts.filter((p) => !p.archived);
  const inventoryValue = activeLinked.reduce((sum, p) => sum + p.quantity * p.cost, 0);
  const totalOrdered = pos.reduce((sum, po) => sum + (po.total || 0), 0);

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  root.appendChild(el('div', { class: 'row row--between' }, [
    el('button', {
      class: 'btn btn--ghost',
      onclick: () => navigate('suppliers'),
    }, `${t('errors.backTo')} ${t('suppliers.title')}`),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn',
        onclick: () => openSupplierForm({
          supplier,
          onSaved: () => navigate('suppliers', { id: supplier.id }),
        }),
      }, t('common.edit')),
      supplier.archived
        ? el('button', {
            class: 'btn btn--success',
            onclick: async () => {
              await suppliersRepo.setArchived(supplier.id, false);
              toast(t('suppliers.restoredToast'), { type: 'success' });
              navigate('suppliers', { id: supplier.id });
            },
          }, t('suppliers.restoreAction'))
        : el('button', {
            class: 'btn',
            onclick: async () => {
              await suppliersRepo.setArchived(supplier.id, true);
              toast(t('suppliers.archivedToast'), { type: 'success' });
              navigate('suppliers');
            },
          }, t('suppliers.archiveAction')),
    ]),
  ]));

  root.appendChild(el('div', { class: 'dash-hero' }, [
    el('div', {}, [
      el('h2', {}, supplier.name),
      el('p', {}, supplier.company || '—'),
    ]),
    supplier.archived
      ? el('span', { class: 'badge badge--danger' }, t('common.archived'))
      : el('span', { class: 'badge badge--success' }, t('common.active')),
  ]));

  root.appendChild(el('div', { class: 'kpi-grid' }, [
    kpi(t('suppliers.kpiLinkedProducts'), formatNumber(activeLinked.length),
      `${linkedProducts.length - activeLinked.length} ${t('common.archived').toLowerCase()}`, 'accent'),
    kpi(t('suppliers.kpiInventoryValue'), formatCurrency(inventoryValue, settings.currency),
      t('dashboard.inventoryValue'), 'success'),
    kpi(t('suppliers.kpiPurchaseOrders'), formatNumber(pos.length),
      t('purchases.title'), 'info'),
    kpi(t('suppliers.kpiTotalOrdered'), formatCurrency(totalOrdered, settings.currency),
      t('purchases.grandTotal'), 'warning'),
  ]));

  root.appendChild(card({
    title: t('suppliers.detailContact'),
    body: el('div', { class: 'stack' }, [
      kv(t('suppliers.fieldEmail'), supplier.email || '—'),
      kv(t('suppliers.fieldPhone'), supplier.phone || '—'),
      kv(t('suppliers.fieldAddress'), supplier.address || '—'),
      kv(t('suppliers.fieldTaxId'), supplier.taxId || '—'),
      kv(t('suppliers.fieldNotes'), supplier.notes || '—'),
      kv(t('common.createdAt'), formatDateTime(supplier.createdAt)),
    ]),
  }));

  root.appendChild(card({
    title: t('suppliers.detailLinkedProducts', { count: activeLinked.length }),
    body: activeLinked.length ? tableShell({
      columns: [
        { label: t('products.colProduct') },
        { label: t('products.colSku') },
        { label: t('products.colQty'), class: 'col-num' },
        { label: t('products.colCost'), class: 'col-num' },
      ],
      rows: activeLinked,
      renderRow: (p) => {
        const tr = el('tr');
        const nameCell = el('td', {
          style: { cursor: 'pointer', fontWeight: '500' },
        }, p.name);
        nameCell.addEventListener('click', () => navigate('products', { id: p.id }));
        tr.appendChild(nameCell);
        tr.appendChild(el('td', { class: 'mono' }, p.sku));
        tr.appendChild(el('td', { class: 'col-num' }, formatNumber(p.quantity)));
        tr.appendChild(el('td', { class: 'col-num' }, formatCurrency(p.cost, settings.currency)));
        return tr;
      },
    }) : el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title' }, t('suppliers.detailNoProducts')),
      el('p', { class: 'empty__text' }, t('suppliers.detailNoProductsHint')),
    ]),
  }));

  root.appendChild(card({
    title: t('suppliers.detailPurchaseHistory', { count: pos.length }),
    body: pos.length ? tableShell({
      columns: [
        { label: t('purchases.colOrderNumber') },
        { label: t('purchases.colStatus') },
        { label: t('purchases.colCreated') },
        { label: t('purchases.colExpected') },
        { label: t('purchases.colTotal'), class: 'col-num' },
      ],
      rows: pos,
      renderRow: (po) => {
        const tr = el('tr');
        const n = el('td', {
          class: 'mono',
          style: { cursor: 'pointer', fontWeight: '500' },
        }, po.orderNumber);
        n.addEventListener('click', () => navigate('purchases', { id: po.id }));
        tr.appendChild(n);
        tr.appendChild(el('td', {}, poStatusBadge(po.status)));
        tr.appendChild(el('td', {}, formatDateTime(po.createdAt)));
        tr.appendChild(el('td', {}, po.expectedDate ? formatDateTime(po.expectedDate) : '—'));
        tr.appendChild(el('td', { class: 'col-num' }, formatCurrency(po.total || 0, settings.currency)));
        return tr;
      },
    }) : el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title' }, t('suppliers.detailNoOrders')),
      el('p', { class: 'empty__text' }, t('suppliers.detailNoOrdersHint')),
    ]),
  }));
}

/* =========================================================
   FORM
   ========================================================= */

export async function openSupplierForm({ supplier = null, onSaved } = {}) {
  const isEdit = Boolean(supplier);
  const initial = supplier || {
    name: '', company: '', email: '', phone: '', address: '', taxId: '', notes: '',
  };

  const form = el('form', { class: 'form', novalidate: true }, [
    el('div', { class: 'form-grid' }, [
      field({ name: 'name',    label: t('suppliers.fieldName'),    value: initial.name, required: true }),
      field({ name: 'company', label: t('suppliers.fieldCompany'), value: initial.company }),
    ]),
    el('div', { class: 'form-grid' }, [
      field({ name: 'email', label: t('suppliers.fieldEmail'), type: 'email', value: initial.email }),
      field({ name: 'phone', label: t('suppliers.fieldPhone'), value: initial.phone }),
    ]),
    el('div', { class: 'form-section' }, [
      field({ name: 'address', label: t('suppliers.fieldAddress'), type: 'textarea', value: initial.address, rows: 2 }),
    ]),
    el('div', { class: 'form-grid' }, [
      field({ name: 'taxId', label: t('suppliers.fieldTaxId'), value: initial.taxId }),
    ]),
    el('div', { class: 'form-section' }, [
      field({ name: 'notes', label: t('suppliers.fieldNotes'), type: 'textarea', value: initial.notes, rows: 3 }),
    ]),
  ]);

  const { close } = openModal({
    title: isEdit
      ? t('suppliers.formEditTitle', { name: supplier.name })
      : t('suppliers.formAddTitle'),
    body: form,
    size: 'modal--wide',
    footer: [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close() }, t('common.cancel')),
      el('button', { class: 'btn btn--primary', type: 'submit' },
        isEdit ? t('suppliers.saveButton') : t('suppliers.createButton')),
    ],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    const data = readForm(form);
    if (!data.name) {
      setFieldError(form, 'name', t('common.required'));
      return;
    }
    try {
      if (isEdit) await suppliersRepo.update(supplier.id, data);
      else        await suppliersRepo.create(data);
      toast(isEdit ? t('suppliers.updateToast') : t('suppliers.createToast'), { type: 'success' });
      close();
      onSaved?.();
    } catch (err) {
      toast(err.message, { type: 'danger' });
    }
  });
}

/* =========================================================
   HELPERS (shared with purchases.js)
   ========================================================= */

export function poStatusBadge(status) {
  const map = {
    [PO_STATUS.DRAFT]:              ['badge',                    t('purchases.statusDraft')],
    [PO_STATUS.ORDERED]:            ['badge badge--info',        t('purchases.statusOrdered')],
    [PO_STATUS.PARTIALLY_RECEIVED]: ['badge badge--warning',     t('purchases.statusPartiallyReceived')],
    [PO_STATUS.RECEIVED]:           ['badge badge--success',     t('purchases.statusReceived')],
    [PO_STATUS.CANCELLED]:          ['badge badge--danger',      t('purchases.statusCancelled')],
  };
  const [cls, label] = map[status] || ['badge', status];
  return el('span', { class: cls }, label);
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