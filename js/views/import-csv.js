/* =========================================================
   StockVault — CSV import wizard
   Seven steps: pick file → preview → map columns → validate
   → review errors → confirm → summary.
   Nothing is written until the user confirms on step 6.
   All user-visible strings translated via t().
   ========================================================= */

import { el, openModal, toast, formatNumber } from '../ui.js';
import {
  parseCsvWithHeader, validateProductImport,
  downloadProductTemplate,
} from '../csv.js';
import { productsRepo, categoriesRepo, suppliersRepo } from '../repositories.js';
import { refreshBadges } from '../notifications.js';
import { t } from '../i18n.js';

const TARGET_FIELDS = [
  { value: '',                  labelKey: 'csv.skipColumn' },
  { value: 'name',              labelKey: 'products.fieldName' },
  { value: 'sku',               labelKey: 'products.fieldSku' },
  { value: 'barcode',           labelKey: 'products.fieldBarcode' },
  { value: 'description',       labelKey: 'products.fieldDescription' },
  { value: 'category',          labelKey: 'products.fieldCategory' },
  { value: 'supplier',          labelKey: 'products.fieldSupplier' },
  { value: 'brand',             labelKey: 'products.fieldBrand' },
  { value: 'cost',              labelKey: 'products.fieldCost' },
  { value: 'price',             labelKey: 'products.fieldPrice' },
  { value: 'quantity',          labelKey: 'products.colQty' },
  { value: 'lowStockThreshold', labelKey: 'products.fieldLowStockThreshold' },
  { value: 'unit',              labelKey: 'products.fieldUnit' },
  { value: 'location',          labelKey: 'products.fieldLocation' },
];

export async function openImportWizard({ onComplete } = {}) {
  const state = {
    file: null,
    headers: [],
    rows: [],
    mapping: {},
    valid: [],
    errors: [],
    result: null,
  };

  const root = el('div', { class: 'stack' });
  const footer = el('div', { class: 'row', style: { justifyContent: 'flex-end' } });

  const { close } = openModal({
    title: t('csv.importTitle'),
    size: 'modal--wide',
    body: root,
    footer: [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close() }, t('common.cancel')),
      el('button', { class: 'btn', type: 'button', onclick: () => downloadProductTemplate() }, t('csv.templateTitle')),
      footer,
    ],
  });

  /* ---------- Step 1: file picker ---------- */
  function step1() {
    const input = el('input', {
      class: 'input',
      type: 'file',
      accept: '.csv,text/csv',
      id: 'csvFile',
    });

    root.replaceChildren(el('div', { class: 'stack' }, [
      el('p', { style: { color: 'var(--text-secondary)' } }, t('csv.step1Intro')),
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('csv.fileLabel')),
        input,
      ]),
    ]));

    footer.replaceChildren(el('button', {
      class: 'btn btn--primary',
      onclick: async () => {
        const file = input.files?.[0];
        if (!file) { toast(t('data.chooseFile'), { type: 'info' }); return; }
        try {
          const text = await file.text();
          const parsed = parseCsvWithHeader(text);
          if (!parsed.headers.length) {
            toast(t('products.emptyTitle'), { type: 'danger' });
            return;
          }
          state.file = file;
          state.headers = parsed.headers;
          state.rows = parsed.rows;
          guessMapping();
          step2();
        } catch (err) {
          toast(err.message || t('errors.generic'), { type: 'danger' });
        }
      },
    }, t('common.continue')));
  }

  /* ---------- Step 2: preview ---------- */
  function step2() {
    const preview = state.rows.slice(0, 5);
    const table = el('div', { class: 'table-wrap' },
      el('table', { class: 'table' }, [
        el('thead', {}, el('tr', {}, state.headers.map((h) => el('th', {}, h)))),
        el('tbody', {}, preview.map((r) =>
          el('tr', {}, state.headers.map((h) => el('td', {}, r[h] ?? ''))))),
      ]));

    root.replaceChildren(el('div', { class: 'stack' }, [
      el('p', {}, t('csv.step2Hint', {
        filename: state.file.name,
        count: formatNumber(state.rows.length),
        preview: preview.length,
      })),
      table,
    ]));

    footer.replaceChildren(
      el('button', { class: 'btn btn--ghost', onclick: () => step1() }, t('common.back')),
      el('button', { class: 'btn btn--primary', onclick: () => step3() }, t('csv.step3MapTitle')),
    );
  }

  /* ---------- Step 3: column mapping ---------- */
  function step3() {
    const rows = state.headers.map((h) => {
      const select = el('select', { class: 'select' });
      for (const f of TARGET_FIELDS) {
        const o = el('option', { value: f.value }, t(f.labelKey));
        if (state.mapping[h] === f.value) o.selected = true;
        select.appendChild(o);
      }
      select.addEventListener('change', () => { state.mapping[h] = select.value; });
      return el('tr', {}, [
        el('td', { class: 'mono' }, h),
        el('td', { class: 'cell-sub' }, state.rows[0]?.[h] ?? ''),
        el('td', {}, select),
      ]);
    });

    root.replaceChildren(el('div', { class: 'stack' }, [
      el('p', { style: { color: 'var(--text-secondary)' } }, t('csv.step3Intro')),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' }, [
          el('thead', {}, el('tr', {}, [
            el('th', {}, t('csv.colCsvColumn')),
            el('th', {}, t('csv.colSample')),
            el('th', {}, t('csv.colMapsTo')),
          ])),
          el('tbody', {}, rows),
        ])),
    ]));

    footer.replaceChildren(
      el('button', { class: 'btn btn--ghost', onclick: () => step2() }, t('common.back')),
      el('button', { class: 'btn btn--primary', onclick: () => step4() }, t('csv.step4Validate')),
    );
  }

  /* ---------- Step 4 + 5: validate + review ---------- */
  async function step4() {
    const mapped = Object.values(state.mapping).filter(Boolean);
    if (!mapped.includes('name') || !mapped.includes('sku')) {
      toast(t('csv.mustMapBoth'), { type: 'danger' });
      return;
    }

    const { valid, errors } = validateProductImport(state.rows, state.mapping);

    const existing = await productsRepo.list({ includeArchived: true });
    const existingSkus = new Set(existing.map((p) => (p.sku || '').toUpperCase()));
    const dupes = valid.filter((r) => existingSkus.has((r.sku || '').toUpperCase()));
    const dupeLines = new Set(dupes.map((r) => r._line));

    state.valid = valid.filter((r) => !dupeLines.has(r._line));
    state.errors = [
      ...errors,
      ...dupes.map((r) => ({
        _line: r._line,
        field: 'sku',
        message: `${t('products.fieldSku')}: ${r.sku}`,
      })),
    ];

    step5();
  }

  function step5() {
    const errPreview = state.errors.slice(0, 20);

    root.replaceChildren(el('div', { class: 'stack' }, [
      el('div', { class: 'kpi-grid' }, [
        miniKpi(t('csv.step2Preview'), formatNumber(state.rows.length), 'accent'),
        miniKpi(t('csv.step5Ready'), formatNumber(state.valid.length), 'success'),
        miniKpi(t('csv.step5Errors'), formatNumber(state.errors.length),
          state.errors.length ? 'danger' : 'success'),
      ]),
      state.errors.length
        ? el('div', { class: 'stack' }, [
            el('h4', {}, t('csv.step5Errors')),
            el('div', { class: 'table-wrap' },
              el('table', { class: 'table' }, [
                el('thead', {}, el('tr', {}, [
                  el('th', {}, '#'),
                  el('th', {}, t('csv.colCsvColumn')),
                  el('th', {}, t('csv.colSample')),
                ])),
                el('tbody', {}, errPreview.map((e) => el('tr', {}, [
                  el('td', {}, String(e._line)),
                  el('td', { class: 'mono' }, e.field),
                  el('td', {}, e.message),
                ]))),
              ])),
            state.errors.length > errPreview.length
              ? el('p', { class: 'cell-sub' },
                  t('csv.step5MoreErrors', { count: state.errors.length - errPreview.length }))
              : null,
          ])
        : el('p', { style: { color: 'var(--success)' } }, t('csv.step5NoIssues')),
    ]));

    footer.replaceChildren(
      el('button', { class: 'btn btn--ghost', onclick: () => step3() }, t('common.back')),
      el('button', {
        class: 'btn btn--primary',
        disabled: state.valid.length === 0,
        onclick: () => step6(),
      }, t('csv.step5ImportButton', { count: formatNumber(state.valid.length) })),
    );
  }

  /* ---------- Step 6: confirm + execute ---------- */
  async function step6() {
    const confirmBtn = footer.querySelector('.btn--primary');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = t('csv.step6Importing');
    }

    try {
      const [cats, sups] = await Promise.all([categoriesRepo.list(), suppliersRepo.list()]);
      const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
      const supByName = new Map(sups.map((s) => [s.name.toLowerCase(), s.id]));

      const prepared = state.valid.map((r) => ({
        _row: r._line,
        name: r.name,
        sku: r.sku,
        barcode: r.barcode || '',
        description: r.description || '',
        categoryId: r.category ? (catByName.get(String(r.category).toLowerCase()) || '') : '',
        supplierId: r.supplier ? (supByName.get(String(r.supplier).toLowerCase()) || '') : '',
        brand: r.brand || '',
        cost: num(r.cost),
        price: num(r.price),
        quantity: num(r.quantity),
        lowStockThreshold: num(r.lowStockThreshold),
        unit: r.unit || '',
        location: r.location || '',
      }));

      const created = await productsRepo.bulkCreate(prepared);

      const { stockRepo, MOVEMENT_TYPES } = await import('../repositories.js');
      let openingCount = 0;
      for (let i = 0; i < created.length; i++) {
        const qty = prepared[i].quantity;
        if (qty > 0) {
          await stockRepo.applyMovement({
            productId: created[i].id,
            type: MOVEMENT_TYPES.OPENING,
            quantity: qty,
            reason: t('stock.typeOpening'),
          });
          openingCount++;
        }
      }

      state.result = { imported: created.length, openingMovements: openingCount };
      step7();
      refreshBadges();
      onComplete?.();
    } catch (err) {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = t('csv.step6Retry');
      }
      toast(err.message || t('errors.generic'), { type: 'danger' });
    }
  }

  /* ---------- Step 7: summary ---------- */
  function step7() {
    root.replaceChildren(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon' }, '✓'),
      el('p', { class: 'empty__title' }, t('csv.step7Complete')),
      el('p', { class: 'empty__text' }, t('csv.step7Summary', {
        imported: formatNumber(state.result.imported),
        movements: formatNumber(state.result.openingMovements),
      })),
    ]));
    footer.replaceChildren(
      el('button', { class: 'btn btn--primary', onclick: () => close() }, t('csv.done')),
    );
  }

  /* ---------- Helpers ---------- */

  function guessMapping() {
    state.mapping = {};
    for (const h of state.headers) {
      const lower = h.toLowerCase().trim();
      const match = TARGET_FIELDS.find((f) => f.value && f.value.toLowerCase() === lower)
                 || TARGET_FIELDS.find((f) => f.value && lower.includes(f.value.toLowerCase()));
      state.mapping[h] = match?.value || '';
    }
  }

  function num(v) {
    if (v == null || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function miniKpi(label, value, tone) {
    return el('article', { class: 'kpi' }, [
      el('div', { class: 'kpi__top' }, [
        el('span', { class: 'kpi__label' }, label),
        el('span', {
          class: `kpi__icon kpi__icon--${tone}`,
          html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>',
        }),
      ]),
      el('div', { class: 'kpi__value' }, value),
    ]);
  }

  step1();
  return { close };
}