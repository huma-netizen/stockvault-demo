/* =========================================================
   StockVault — Purchase orders
   - list(): filter by status/supplier, search, create
   - detail(): lines, totals, receive workflow, print, cancel
   - editor(): draft creation with line items
   - receive modal: per-line quantity entry
   All user-visible strings translated via t().
   ========================================================= */

import {
  el, openModal, confirmDialog, toast,
  formatCurrency, formatNumber, formatDateTime, formatDate,
} from '../ui.js';
import {
  purchasesRepo, suppliersRepo, productsRepo, PO_STATUS,
} from '../repositories.js';
import { loadSettings } from '../settings.js';
import { navigate } from '../router.js';
import { refreshBadges } from '../notifications.js';
import { poStatusBadge } from './suppliers.js';
import { pageHeader, card, tableShell, filterBar } from './_helpers.js';
import { t } from '../i18n.js';

/* =========================================================
   LIST
   ========================================================= */

export async function renderPurchasesList(container) {
  const settings = await loadSettings();

  const state = { status: '', supplierId: '', q: '', suppliersById: {} };

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  root.appendChild(pageHeader({
    title: t('purchases.title'),
    subtitle: t('purchases.subtitle'),
    actions: [
      el('button', {
        class: 'btn btn--primary',
        onclick: () => openPoEditor({ onSaved: refresh }),
      }, t('purchases.newPurchaseOrder')),
    ],
  }));

  const filters = filterBar([
    {
      name: 'status', type: 'select',
      options: [
        { value: '', label: t('purchases.filterAllStatuses') },
        { value: PO_STATUS.DRAFT,              label: t('purchases.filterDraft') },
        { value: PO_STATUS.ORDERED,            label: t('purchases.filterOrdered') },
        { value: PO_STATUS.PARTIALLY_RECEIVED, label: t('purchases.filterPartiallyReceived') },
        { value: PO_STATUS.RECEIVED,           label: t('purchases.filterReceived') },
        { value: PO_STATUS.CANCELLED,          label: t('purchases.filterCancelled') },
      ],
      onChange: (v) => { state.status = v; refresh(); },
    },
    {
      name: 'supplierId', type: 'select',
      options: [{ value: '', label: t('purchases.filterAllSuppliers') }],
      onChange: (v) => { state.supplierId = v; refresh(); },
    },
    {
      name: 'q', type: 'search',
      placeholder: t('purchases.searchPlaceholder'),
      onChange: (v) => { state.q = v; refresh(); },
    },
  ]);
  root.appendChild(filters.node);

  const host = el('div');
  root.appendChild(host);

  async function refresh() {
    host.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'skeleton', style: { height: '240px' } })));

    const suppliers = await suppliersRepo.list({ includeArchived: true });
    state.suppliersById = Object.fromEntries(suppliers.map((s) => [s.id, s]));

    if (filters.inputs.supplierId.options.length === 1) {
      for (const s of suppliers) {
        filters.inputs.supplierId.appendChild(el('option', { value: s.id }, s.name));
      }
    }

    const pos = await purchasesRepo.list({
      status: state.status,
      supplierId: state.supplierId,
      q: state.q,
    });

    if (!pos.length) {
      host.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon' }, '◇'),
        el('p', { class: 'empty__title' }, t('purchases.emptyTitle')),
        el('p', { class: 'empty__text' }, t('purchases.emptyText')),
        el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
          el('button', {
            class: 'btn btn--primary',
            onclick: () => openPoEditor({ onSaved: refresh }),
          }, t('purchases.newPurchaseOrder')),
        ]),
      ])));
      return;
    }

    const table = tableShell({
      columns: [
        { label: t('purchases.colOrderNumber') },
        { label: t('purchases.colSupplier') },
        { label: t('purchases.colStatus') },
        { label: t('purchases.colCreated') },
        { label: t('purchases.colExpected') },
        { label: t('purchases.colTotal'), class: 'col-num' },
        { label: t('common.actions'), class: 'col-actions' },
      ],
      rows: pos,
      renderRow: (po) => {
        const sup = state.suppliersById[po.supplierId];
        const tr = el('tr');
        const num = el('td', {
          class: 'mono',
          style: { cursor: 'pointer', fontWeight: '500' },
        }, po.orderNumber);
        num.addEventListener('click', () => navigate('purchases', { id: po.id }));
        tr.appendChild(num);
        tr.appendChild(el('td', {}, sup ? sup.name : '—'));
        tr.appendChild(el('td', {}, poStatusBadge(po.status)));
        tr.appendChild(el('td', {}, formatDate(po.createdAt)));
        tr.appendChild(el('td', {}, po.expectedDate ? formatDate(po.expectedDate) : '—'));
        tr.appendChild(el('td', { class: 'col-num' }, formatCurrency(po.total || 0, settings.currency)));
        tr.appendChild(el('td', { class: 'col-actions' }, el('div', { class: 'row-actions' }, [
          el('button', {
            class: 'icon-btn',
            title: t('common.search') === 'Search' ? '→' : t('purchases.title'),
            onclick: () => navigate('purchases', { id: po.id }),
          }, '→'),
          (po.status === PO_STATUS.DRAFT || po.status === PO_STATUS.ORDERED)
            ? el('button', {
                class: 'icon-btn',
                title: t('common.edit'),
                onclick: () => openPoEditor({ po, onSaved: refresh }),
              }, '✎')
            : null,
        ].filter(Boolean))));
        return tr;
      },
    });
    host.replaceChildren(table);
  }

  await refresh();
}

/* =========================================================
   DETAIL
   ========================================================= */

export async function renderPurchaseDetail(container, params) {
  const po = await purchasesRepo.get(params.id);

  if (!po) {
    container.appendChild(el('div', { class: 'card' }, el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title' }, t('errors.notFound')),
      el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
        el('button', {
          class: 'btn',
          onclick: () => navigate('purchases'),
        }, `${t('errors.backTo')} ${t('purchases.title')}`),
      ]),
    ])));
    return;
  }

  const settings = await loadSettings();
  const supplier = await suppliersRepo.get(po.supplierId);

  const root = el('div', { class: 'stack no-print-prep' });
  container.appendChild(root);

  root.appendChild(el('div', { class: 'row row--between no-print' }, [
    el('button', {
      class: 'btn btn--ghost',
      onclick: () => navigate('purchases'),
    }, t('common.back')),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn', onclick: () => window.print() }, t('common.print')),
      (po.status === PO_STATUS.DRAFT || po.status === PO_STATUS.ORDERED)
        ? el('button', {
            class: 'btn',
            onclick: () => openPoEditor({ po, onSaved: () => navigate('purchases', { id: po.id }) }),
          }, t('common.edit'))
        : null,
      (po.status !== PO_STATUS.RECEIVED && po.status !== PO_STATUS.CANCELLED)
        ? el('button', {
            class: 'btn btn--primary',
            onclick: () => openReceiveModal({ po, onSaved: () => navigate('purchases', { id: po.id }) }),
          }, t('purchases.receiveAction'))
        : null,
      (po.status === PO_STATUS.DRAFT || po.status === PO_STATUS.ORDERED)
        ? el('button', {
            class: 'btn btn--danger',
            onclick: async () => {
              const ok = await confirmDialog({
                title: t('purchases.cancelTitle', { orderNumber: po.orderNumber }),
                message: t('purchases.cancelMessage'),
                confirmLabel: t('purchases.cancelConfirm'),
                cancelLabel: t('common.cancel'),
                danger: true,
              });
              if (!ok) return;
              try {
                await purchasesRepo.cancel(po.id);
                toast(t('purchases.cancelToast'), { type: 'success' });
                navigate('purchases', { id: po.id });
              } catch (err) {
                toast(err.message, { type: 'danger' });
              }
            },
          }, t('purchases.cancelAction'))
        : null,
    ].filter(Boolean)),
  ]));

  root.appendChild(el('div', { class: 'card', style: { marginBottom: 'var(--s-4)' } }, [
    el('div', { class: 'row row--between', style: { flexWrap: 'wrap' } }, [
      el('div', {}, [
        el('h2', { style: { margin: 0 } },
          t('purchases.printHeaderTitle', { orderNumber: po.orderNumber })),
        el('p', { style: { color: 'var(--text-secondary)', margin: '4px 0 0' } },
          `${settings.businessName} · ${formatDateTime(Date.now())}`),
      ]),
      poStatusBadge(po.status),
    ]),
    el('div', { class: 'dash-analytics', style: { marginTop: 'var(--s-5)' } }, [
      el('div', {}, [
        el('h4', {}, t('purchases.printSupplier')),
        el('p', {}, supplier ? supplier.name : '—'),
        supplier?.company ? el('p', { style: { color: 'var(--text-secondary)', margin: 0 } }, supplier.company) : null,
        supplier?.email ? el('p', { style: { color: 'var(--text-secondary)', margin: 0 } }, supplier.email) : null,
        supplier?.phone ? el('p', { style: { color: 'var(--text-secondary)', margin: 0 } }, supplier.phone) : null,
      ]),
      el('div', {}, [
        el('h4', {}, t('purchases.printDates')),
        kv(t('purchases.colCreated'), formatDateTime(po.createdAt)),
        kv(t('purchases.colExpected'), po.expectedDate ? formatDate(po.expectedDate) : '—'),
        kv(t('common.updatedAt'), formatDateTime(po.updatedAt)),
      ]),
    ]),
  ]));

  root.appendChild(card({
    title: t('purchases.lineItems'),
    class: 'print-block',
    body: el('div', { class: 'table-wrap' },
      el('table', { class: 'table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, t('purchases.colLineProduct')),
          el('th', {}, t('products.colSku')),
          el('th', { class: 'col-num' }, t('purchases.receiveColOrdered')),
          el('th', { class: 'col-num' }, t('purchases.receiveColReceived')),
          el('th', { class: 'col-num' }, t('purchases.colLineUnitCost')),
          el('th', { class: 'col-num' }, t('purchases.colLineTotal')),
        ])),
        el('tbody', {}, po.items.map((it) => el('tr', {}, [
          el('td', {}, it.name),
          el('td', { class: 'mono' }, it.sku),
          el('td', { class: 'col-num' }, formatNumber(it.orderedQty)),
          el('td', { class: `col-num ${it.receivedQty >= it.orderedQty ? 'text-success' : it.receivedQty > 0 ? 'text-warning' : ''}` },
            formatNumber(it.receivedQty)),
          el('td', { class: 'col-num' }, formatCurrency(it.unitCost, settings.currency)),
          el('td', { class: 'col-num' }, formatCurrency(it.unitCost * it.orderedQty, settings.currency)),
        ]))),
      ])
    ),
  }));

  root.appendChild(card({
    title: t('purchases.printTotals'),
    class: 'print-block',
    body: el('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
      el('div', { style: { minWidth: '280px' } }, [
        kv(t('common.subtotal'), formatCurrency(po.subtotal || 0, settings.currency)),
        po.discount ? kv(t('common.discount'), `− ${formatCurrency(po.discount, settings.currency)}`) : null,
        po.taxRate ? kv(`${t('common.tax')} (${po.taxRate}%)`, formatCurrency(po.taxAmount || 0, settings.currency)) : null,
        el('div', {
          class: 'row row--between',
          style: {
            paddingTop: 'var(--s-3)',
            marginTop: 'var(--s-2)',
            borderTop: '2px solid var(--border-strong)',
          },
        }, [
          el('span', { style: { fontWeight: '600' } }, t('purchases.grandTotal')),
          el('span', { style: { fontWeight: '700', fontSize: 'var(--fs-lg)' } },
            formatCurrency(po.total || 0, settings.currency)),
        ]),
      ].filter(Boolean))
    ),
  }));

  if (po.notes) {
    root.appendChild(card({
      title: t('common.notes'),
      body: el('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, po.notes),
    }));
  }
}

/* =========================================================
   EDITOR
   ========================================================= */

export async function openPoEditor({ po = null, onSaved } = {}) {
  const isEdit = Boolean(po);
  const settings = await loadSettings();

  const [suppliers, products] = await Promise.all([
    suppliersRepo.list({ includeArchived: true }),
    productsRepo.list({ includeArchived: false }),
  ]);
  const productsById = Object.fromEntries(products.map((p) => [p.id, p]));

  const items = isEdit ? po.items.map((it) => ({ ...it })) : [];

  const supplierSelect = el('select', { class: 'select', name: 'supplierId' });
  supplierSelect.appendChild(el('option', { value: '' }, t('common.none')));
  for (const s of suppliers) {
    const o = el('option', { value: s.id }, s.name + (s.company ? ` — ${s.company}` : ''));
    if (isEdit && s.id === po.supplierId) o.selected = true;
    supplierSelect.appendChild(o);
  }

  const expectedInput = el('input', { class: 'input', type: 'date', name: 'expectedDate' });
  if (isEdit && po.expectedDate) expectedInput.value = new Date(po.expectedDate).toISOString().slice(0, 10);

  const taxInput = el('input', { class: 'input', type: 'number', min: '0', step: '0.01', name: 'taxRate' });
  taxInput.value = String(isEdit ? (po.taxRate || 0) : 0);

  const discountInput = el('input', { class: 'input', type: 'number', min: '0', step: '0.01', name: 'discount' });
  discountInput.value = String(isEdit ? (po.discount || 0) : 0);

  const notesInput = el('textarea', { class: 'textarea', name: 'notes', rows: 2 });
  if (isEdit) notesInput.value = po.notes || '';

  const linesHost = el('div', { class: 'stack' });

  function addLine(productId = '') {
    const p = productsById[productId];
    items.push({
      productId: p?.id || '',
      name: p?.name || '',
      sku: p?.sku || '',
      orderedQty: 1,
      receivedQty: 0,
      unitCost: p?.cost || 0,
    });
    renderLines();
  }

  function removeLine(idx) {
    items.splice(idx, 1);
    renderLines();
  }

  function renderLines() {
    linesHost.replaceChildren();
    if (!items.length) {
      linesHost.appendChild(el('div', { class: 'empty', style: { padding: 'var(--s-5)' } }, [
        el('p', { class: 'empty__text' }, t('purchases.addLine')),
      ]));
    }

    items.forEach((it, idx) => {
      const prodSelect = el('select', { class: 'select' });
      prodSelect.appendChild(el('option', { value: '' }, t('common.none')));
      for (const p of products) {
        const o = el('option', { value: p.id }, `${p.name} — ${p.sku}`);
        if (p.id === it.productId) o.selected = true;
        prodSelect.appendChild(o);
      }
      prodSelect.addEventListener('change', () => {
        const p = productsById[prodSelect.value];
        if (p) {
          it.productId = p.id;
          it.name = p.name;
          it.sku = p.sku;
          it.unitCost = p.cost;
        } else {
          it.productId = '';
          it.name = '';
          it.sku = '';
        }
        renderLines();
      });

      const qtyInput = el('input', { class: 'input', type: 'number', min: '1', step: '1' });
      qtyInput.value = String(it.orderedQty);
      qtyInput.addEventListener('input', () => {
        it.orderedQty = Math.max(0, Math.floor(Number(qtyInput.value) || 0));
        renderTotals();
      });

      const costInput = el('input', { class: 'input', type: 'number', min: '0', step: '0.01' });
      costInput.value = String(it.unitCost);
      costInput.addEventListener('input', () => {
        it.unitCost = Math.max(0, Number(costInput.value) || 0);
        renderTotals();
      });

      const lineTotal = el('div', {
        class: 'mono',
        style: { textAlign: 'right', paddingTop: '10px' },
      }, formatCurrency((it.orderedQty || 0) * (it.unitCost || 0), settings.currency));

      linesHost.appendChild(el('div', {
        class: 'card card--sm',
        style: {
          display: 'grid',
          gap: 'var(--s-3)',
          gridTemplateColumns: '2fr 90px 110px 120px auto',
          alignItems: 'end',
        },
      }, [
        el('div', { class: 'field', style: { margin: 0 } }, [
          el('label', { class: 'field__label' }, t('purchases.colLineProduct')),
          prodSelect,
        ]),
        el('div', { class: 'field', style: { margin: 0 } }, [
          el('label', { class: 'field__label' }, t('purchases.colLineQty')),
          qtyInput,
        ]),
        el('div', { class: 'field', style: { margin: 0 } }, [
          el('label', { class: 'field__label' }, t('purchases.colLineUnitCost')),
          costInput,
        ]),
        el('div', { class: 'field', style: { margin: 0 } }, [
          el('label', { class: 'field__label' }, t('purchases.colLineTotal')),
          lineTotal,
        ]),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          title: t('purchases.colLineRemove'),
          onclick: () => removeLine(idx),
        }, '×'),
      ]));
    });

    renderTotals();
  }

  const totalsHost = el('div', {
    style: { display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--s-4)' },
  });

  function renderTotals() {
    const subtotal = items.reduce((sum, it) => sum + (it.orderedQty || 0) * (it.unitCost || 0), 0);
    const discount = Math.max(0, Number(discountInput.value) || 0);
    const taxable = Math.max(0, subtotal - discount);
    const taxRate = Math.max(0, Number(taxInput.value) || 0);
    const tax = taxable * (taxRate / 100);
    const total = taxable + tax;

    totalsHost.replaceChildren(el('div', { style: { minWidth: '260px' } }, [
      kv(t('common.subtotal'), formatCurrency(subtotal, settings.currency)),
      discount ? kv(t('common.discount'), `− ${formatCurrency(discount, settings.currency)}`) : null,
      taxRate ? kv(`${t('common.tax')} (${taxRate}%)`, formatCurrency(tax, settings.currency)) : null,
      el('div', {
        class: 'row row--between',
        style: {
          paddingTop: 'var(--s-2)',
          marginTop: 'var(--s-2)',
          borderTop: '2px solid var(--border-strong)',
        },
      }, [
        el('span', { style: { fontWeight: '600' } }, t('purchases.grandTotal')),
        el('span', { style: { fontWeight: '700', fontSize: 'var(--fs-lg)' } },
          formatCurrency(total, settings.currency)),
      ]),
    ].filter(Boolean)));
  }

  taxInput.addEventListener('input', renderTotals);
  discountInput.addEventListener('input', renderTotals);

  const form = el('form', { class: 'form' }, [
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('purchases.fieldSupplier')),
        supplierSelect,
        el('span', { class: 'field__error' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('purchases.fieldExpectedDelivery')),
        expectedInput,
      ]),
    ]),
    el('div', { class: 'form-section' }, [
      el('div', { class: 'form-section__title' }, t('purchases.lineItems')),
      linesHost,
      el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
        el('button', { class: 'btn btn--sm', type: 'button', onclick: () => addLine() },
          t('purchases.addLine')),
      ]),
    ]),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('purchases.fieldTaxRate')),
        taxInput,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('purchases.fieldDiscount')),
        discountInput,
      ]),
    ]),
    el('div', { class: 'form-section' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('common.notes')),
        notesInput,
      ]),
    ]),
    totalsHost,
  ]);

  renderLines();

  const { close } = openModal({
    title: isEdit
      ? t('purchases.formEditTitle', { orderNumber: po.orderNumber })
      : t('purchases.formNewTitle'),
    body: form,
    size: 'modal--wide',
    footer: [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close() }, t('common.cancel')),
      el('button', { class: 'btn', type: 'submit', 'data-mode': 'draft' }, t('purchases.saveAsDraft')),
      el('button', { class: 'btn btn--primary', type: 'submit', 'data-mode': 'ordered' },
        isEdit ? t('purchases.saveAndOrder') : t('purchases.createAndOrder')),
    ],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = e.submitter?.dataset.mode || 'draft';

    const supplierId = supplierSelect.value;
    if (!supplierId) {
      form.querySelector('.field__error').textContent = t('common.required');
      return;
    }
    const validItems = items.filter((it) => it.productId && it.orderedQty > 0);
    if (!validItems.length) {
      toast(t('purchases.addLine'), { type: 'danger' });
      return;
    }

    const expectedDate = expectedInput.value ? new Date(expectedInput.value).getTime() : null;
    const payload = {
      supplierId,
      expectedDate,
      items: validItems,
      taxRate: Math.max(0, Number(taxInput.value) || 0),
      discount: Math.max(0, Number(discountInput.value) || 0),
      notes: notesInput.value.trim(),
      status: mode === 'draft' ? PO_STATUS.DRAFT : PO_STATUS.ORDERED,
    };

    try {
      if (isEdit) {
        await purchasesRepo.update(po.id, payload);
        toast(t('purchases.updateToast'), { type: 'success' });
      } else {
        await purchasesRepo.create(payload);
        toast(t('purchases.createToast'), { type: 'success' });
      }
      close();
      onSaved?.();
    } catch (err) {
      toast(err.message, { type: 'danger' });
    }
  });
}

/* =========================================================
   RECEIVE MODAL
   ========================================================= */

export async function openReceiveModal({ po, onSaved } = {}) {
  const settings = await loadSettings();

  const working = po.items.map((it) => ({
    ...it,
    receiveNow: it.orderedQty - it.receivedQty,
  }));

  const host = el('div', { class: 'stack' });

  function render() {
    host.replaceChildren();
    const rows = working.filter((it) => it.orderedQty > 0);
    host.appendChild(el('div', { class: 'table-wrap' },
      el('table', { class: 'table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, t('purchases.receiveColProduct')),
          el('th', { class: 'col-num' }, t('purchases.receiveColOrdered')),
          el('th', { class: 'col-num' }, t('purchases.receiveColReceived')),
          el('th', { class: 'col-num' }, t('purchases.receiveColOutstanding')),
          el('th', { class: 'col-num' }, t('purchases.receiveColNow')),
        ])),
        el('tbody', {}, rows.map((it) => {
          const outstanding = it.orderedQty - it.receivedQty;
          const input = el('input', {
            class: 'input',
            type: 'number',
            min: '0',
            max: String(outstanding),
            step: '1',
          });
          input.value = String(Math.min(it.receiveNow ?? outstanding, outstanding));
          input.addEventListener('input', () => {
            const v = Math.max(0, Math.min(outstanding, Math.floor(Number(input.value) || 0)));
            input.value = String(v);
            it.receiveNow = v;
          });
          return el('tr', {}, [
            el('td', {}, [
              el('div', { style: { fontWeight: '500' } }, it.name),
              el('div', { class: 'cell-sub mono' }, it.sku),
            ]),
            el('td', { class: 'col-num' }, formatNumber(it.orderedQty)),
            el('td', { class: 'col-num' }, formatNumber(it.receivedQty)),
            el('td', { class: 'col-num' }, formatNumber(outstanding)),
            el('td', { class: 'col-num', style: { maxWidth: '120px' } }, input),
          ]);
        })),
      ])
    ));
  }
  render();

  let submitting = false;

  const { close } = openModal({
    title: t('purchases.receiveTitle', { orderNumber: po.orderNumber }),
    body: host,
    size: 'modal--wide',
    footer: [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close() }, t('common.cancel')),
      el('button', { class: 'btn btn--primary', onclick: submit }, t('purchases.receiveButton')),
    ],
  });

  async function submit() {
    if (submitting) return;
    const receipts = working
      .filter((it) => (it.receiveNow || 0) > 0)
      .map((it) => ({ productId: it.productId, quantity: it.receiveNow }));
    if (!receipts.length) {
      toast(t('purchases.emptyTitle'), { type: 'info' });
      return;
    }
    submitting = true;
    const btn = document.querySelector('.modal__footer button.btn--primary');
    if (btn) { btn.disabled = true; btn.textContent = t('common.loading'); }
    try {
      await purchasesRepo.receive(po.id, receipts);
      toast(t('purchases.receiveToast'), { type: 'success' });
      close();
      onSaved?.();
      refreshBadges();
    } catch (err) {
      submitting = false;
      if (btn) { btn.disabled = false; btn.textContent = t('purchases.receiveButton'); }
      toast(err.message, { type: 'danger' });
    }
  }
}

/* =========================================================
   HELPERS
   ========================================================= */

function kv(label, value) {
  return el('div', { class: 'row row--between', style: { padding: '4px 0' } }, [
    el('span', { style: { color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' } }, label),
    el('span', {}, value),
  ]);
}