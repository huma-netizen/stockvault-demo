/* =========================================================
   StockVault — Onboarding wizard + sample data
   Runs once, on first launch. Six steps:
     1. Welcome
     2. Business name
     3. Currency
     4. Default low-stock threshold
     5. Sample data decision
     6. Done
   Sample data is loaded through real repositories so the user
   can see and edit every record afterwards.
   All user-visible strings translated via t().
   ========================================================= */

import { el, openModal, toast } from '../ui.js';
import { loadSettings, setSettings, reflectBusinessName } from '../settings.js';
import {
  productsRepo, categoriesRepo, suppliersRepo, stockRepo,
  MOVEMENT_TYPES,
} from '../repositories.js';
import { t } from '../i18n.js';

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar ($)' },
  { value: 'EUR', label: 'EUR — Euro (€)' },
  { value: 'GBP', label: 'GBP — British Pound (£)' },
  { value: 'CAD', label: 'CAD — Canadian Dollar ($)' },
  { value: 'AUD', label: 'AUD — Australian Dollar ($)' },
  { value: 'JPY', label: 'JPY — Japanese Yen (¥)' },
  { value: 'INR', label: 'INR — Indian Rupee (₹)' },
  { value: 'PKR', label: 'PKR — Pakistani Rupee (₨)' },
  { value: 'BRL', label: 'BRL — Brazilian Real (R$)' },
  { value: 'ZAR', label: 'ZAR — South African Rand (R)' },
  { value: 'NGN', label: 'NGN — Nigerian Naira (₦)' },
  { value: 'AED', label: 'AED — UAE Dirham (د.إ)' },
];

export async function maybeRunOnboarding() {
  const settings = await loadSettings();
  if (settings.onboardingComplete) return false;
  await runWizard();
  return true;
}

async function runWizard() {
  const state = {
    businessName: '',
    currency: 'USD',
    defaultLowStock: 5,
    loadSample: true,
  };

  const { modal } = openModal({
    title: t('app.name'),
    size: 'modal--sm',
    body: buildIntro(),
    footer: [
      el('button', { class: 'btn btn--ghost', id: 'onbSkip' }, t('common.back')),
    ],
    onClose: () => {
      setSettings({ onboardingComplete: true });
    },
  });

  modal.querySelector('#onbSkip').addEventListener('click', async () => {
    await finalize(state, { skip: true });
    document.querySelector('.modal__close')?.click();
  });

  await step1({ modal, state });
}

function buildIntro() {
  return el('div', { class: 'stack' }, [
    el('p', { style: { color: 'var(--text-secondary)' } }, t('data.subtitle')),
  ]);
}

async function step1({ modal, state }) {
  const body = modal.querySelector('.modal__body');
  const footer = modal.querySelector('.modal__footer');
  body.replaceChildren(buildIntro());

  footer.replaceChildren(
    el('button', { class: 'btn btn--ghost', id: 'onbSkip2' }, t('csv.skipColumn') ? 'Skip' : t('common.back')),
    el('button', { class: 'btn btn--primary', id: 'onbNext' }, t('common.continue')),
  );

  footer.querySelector('#onbSkip2').onclick = async () => {
    await finalize(state, { skip: true });
    document.querySelector('.modal__close')?.click();
  };
  footer.querySelector('#onbNext').onclick = () => step2({ modal, state });
}

async function step2({ modal, state }) {
  const body = modal.querySelector('.modal__body');
  const footer = modal.querySelector('.modal__footer');

  const input = el('input', { class: 'input', type: 'text', id: 'onbBizName' });
  input.value = state.businessName;

  body.replaceChildren(el('div', { class: 'stack' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, t('settings.businessName')),
      input,
      el('span', { class: 'field__error' }),
    ]),
  ]));

  footer.replaceChildren(
    el('button', { class: 'btn btn--ghost', id: 'onbBack' }, t('common.back')),
    el('button', { class: 'btn btn--primary', id: 'onbNext' }, t('common.continue')),
  );

  footer.querySelector('#onbBack').onclick = () => step1({ modal, state });
  footer.querySelector('#onbNext').onclick = () => {
    const name = input.value.trim();
    if (!name) {
      body.querySelector('.field__error').textContent = t('common.required');
      return;
    }
    state.businessName = name;
    step3({ modal, state });
  };
  requestAnimationFrame(() => input.focus());
}

async function step3({ modal, state }) {
  const body = modal.querySelector('.modal__body');
  const footer = modal.querySelector('.modal__footer');

  const select = el('select', { class: 'select', id: 'onbCurrency' });
  for (const c of CURRENCIES) {
    const o = el('option', { value: c.value }, c.label);
    if (c.value === state.currency) o.selected = true;
    select.appendChild(o);
  }

  body.replaceChildren(el('div', { class: 'stack' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, t('settings.currency')),
      select,
    ]),
  ]));

  footer.replaceChildren(
    el('button', { class: 'btn btn--ghost', id: 'onbBack' }, t('common.back')),
    el('button', { class: 'btn btn--primary', id: 'onbNext' }, t('common.continue')),
  );

  footer.querySelector('#onbBack').onclick = () => step2({ modal, state });
  footer.querySelector('#onbNext').onclick = () => {
    state.currency = select.value;
    step4({ modal, state });
  };
}

async function step4({ modal, state }) {
  const body = modal.querySelector('.modal__body');
  const footer = modal.querySelector('.modal__footer');

  const input = el('input', { class: 'input', type: 'number', min: '0', step: '1', id: 'onbThreshold' });
  input.value = String(state.defaultLowStock);

  body.replaceChildren(el('div', { class: 'stack' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, t('settings.defaultLowStock')),
      input,
      el('span', { class: 'field__hint' }, t('settings.defaultLowStockHint')),
    ]),
  ]));

  footer.replaceChildren(
    el('button', { class: 'btn btn--ghost', id: 'onbBack' }, t('common.back')),
    el('button', { class: 'btn btn--primary', id: 'onbNext' }, t('common.continue')),
  );

  footer.querySelector('#onbBack').onclick = () => step3({ modal, state });
  footer.querySelector('#onbNext').onclick = () => {
    const v = Math.max(0, Math.floor(Number(input.value) || 0));
    state.defaultLowStock = v;
    step5({ modal, state });
  };
}

async function step5({ modal, state }) {
  const body = modal.querySelector('.modal__body');
  const footer = modal.querySelector('.modal__footer');

  const yes = el('input', { type: 'radio', name: 'onbSample', value: 'yes' });
  const no  = el('input', { type: 'radio', name: 'onbSample', value: 'no' });
  (state.loadSample ? yes : no).checked = true;

  const makeChoice = (input, title, desc) => el('label', {
    class: 'card card--sm',
    style: { cursor: 'pointer', display: 'flex', gap: 'var(--s-3)', alignItems: 'flex-start' },
  }, [
    input,
    el('div', {}, [
      el('div', { style: { fontWeight: '600' } }, title),
      el('div', { style: { color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' } }, desc),
    ]),
  ]);

  body.replaceChildren(el('div', { class: 'stack' }, [
    makeChoice(yes, t('data.loadSampleData'), t('data.sampleDataDescription')),
    makeChoice(no, t('common.no'), t('products.emptyText')),
  ]));

  footer.replaceChildren(
    el('button', { class: 'btn btn--ghost', id: 'onbBack' }, t('common.back')),
    el('button', { class: 'btn btn--primary', id: 'onbFinish' }, t('settings.saveChanges')),
  );

  footer.querySelector('#onbBack').onclick = () => step4({ modal, state });
  footer.querySelector('#onbFinish').onclick = async () => {
    state.loadSample = body.querySelector('input[name="onbSample"]:checked').value === 'yes';
    footer.querySelector('#onbFinish').disabled = true;
    footer.querySelector('#onbFinish').textContent = t('common.loading');
    try {
      await finalize(state, { skip: false });
      document.querySelector('.modal__close')?.click();
      toast(t('data.sampleLoaded'), { type: 'success', title: t('app.name') });
    } catch (err) {
      console.error(err);
      toast(err.message || t('errors.generic'), { type: 'danger' });
      footer.querySelector('#onbFinish').disabled = false;
      footer.querySelector('#onbFinish').textContent = t('settings.saveChanges');
    }
  };
}

async function finalize(state, { skip }) {
  await setSettings({
    businessName: state.businessName || t('profile.defaultName'),
    currency: state.currency,
    defaultLowStock: state.defaultLowStock,
    onboardingComplete: true,
  });
  reflectBusinessName(state.businessName || t('profile.defaultName'));

  if (!skip && state.loadSample) {
    await loadSampleData({ defaultLowStock: state.defaultLowStock });
    await setSettings({ sampleDataLoaded: true });
  }
}

/* =========================================================
   SAMPLE DATA
   ========================================================= */

export async function loadSampleData({ defaultLowStock = 5 } = {}) {
  const existingProducts = await productsRepo.list({ includeArchived: true });
  if (existingProducts.length > 0) {
    throw new Error('Sample data was not loaded: you already have products.');
  }

  const categories = await Promise.all([
    categoriesRepo.create({ name: 'Tools', description: 'Hand tools and power tools' }),
    categoriesRepo.create({ name: 'Fasteners', description: 'Screws, bolts, and nails' }),
    categoriesRepo.create({ name: 'Electrical', description: 'Cables, switches, and fittings' }),
    categoriesRepo.create({ name: 'Consumables', description: 'Tape, glue, and abrasives' }),
  ]);
  const cat = Object.fromEntries(categories.map((c) => [c.name, c.id]));

  const suppliers = await Promise.all([
    suppliersRepo.create({ name: 'Northwind Supply', company: 'Northwind Supply Co.', email: 'orders@northwind.example', phone: '+1 555 0100' }),
    suppliersRepo.create({ name: 'Ridgeway Tools', company: 'Ridgeway Tools Ltd.', email: 'sales@ridgeway.example', phone: '+44 20 5555 0101' }),
    suppliersRepo.create({ name: 'Kestrel Electric', company: 'Kestrel Electric GmbH', email: 'kontakt@kestrel.example', phone: '+49 30 5555 0102' }),
  ]);
  const sup = Object.fromEntries(suppliers.map((s) => [s.name, s.id]));

  const seed = [
    ['Claw Hammer 16oz',    'TL-HAM-16',   'Tools',       'Ridgeway Tools',  6.20, 14.99, 24, defaultLowStock, 'pcs', 'A1-01'],
    ['Screwdriver Set 12pc','TL-SDR-12',   'Tools',       'Ridgeway Tools',  8.40, 19.99, 12, defaultLowStock, 'set', 'A1-02'],
    ['Tape Measure 5m',     'TL-TAP-05',   'Tools',       'Ridgeway Tools',  2.10, 6.50,  3,  defaultLowStock, 'pcs', 'A1-03'],
    ['Wood Screw 4×40 (200)','FN-WS-0440', 'Fasteners',   'Northwind Supply',1.10, 3.20,  40, defaultLowStock, 'box', 'B2-01'],
    ['Wall Plug 8mm (100)', 'FN-WP-0800',  'Fasteners',   'Northwind Supply',0.85, 2.75,  0,  defaultLowStock, 'box', 'B2-02'],
    ['Hex Bolt M8×60 (50)', 'FN-HB-0860',  'Fasteners',   'Northwind Supply',2.60, 7.40,  18, defaultLowStock, 'box', 'B2-03'],
    ['Twin & Earth 1.5mm',  'EL-TE-15',    'Electrical',  'Kestrel Electric',28.90, 54.00, 6,  defaultLowStock, 'roll','C1-01'],
    ['Socket Outlet 2-Gang','EL-SO-2G',    'Electrical',  'Kestrel Electric',1.80, 5.20,  30, defaultLowStock, 'pcs', 'C1-02'],
    ['Light Switch 1-Gang', 'EL-LS-1G',    'Electrical',  'Kestrel Electric',0.95, 3.10,  2,  defaultLowStock, 'pcs', 'C1-03'],
    ['PVC Insulation Tape', 'CS-IT-PVC',   'Consumables', 'Northwind Supply',0.40, 1.60,  60, defaultLowStock, 'roll','D3-01'],
    ['Super Glue 20g',      'CS-SG-20',    'Consumables', 'Northwind Supply',1.20, 4.20,  9,  defaultLowStock, 'pcs', 'D3-02'],
    ['Sanding Disc 125mm',  'CS-SD-125',   'Consumables', 'Ridgeway Tools',  0.60, 2.10,  4,  defaultLowStock, 'pcs', 'D3-03'],
  ];

  const created = [];
  for (const [name, sku, catName, supName, cost, price, qty, threshold, unit, location] of seed) {
    const p = await productsRepo.create({
      name, sku, cost, price,
      categoryId: cat[catName],
      supplierId: sup[supName],
      quantity: 0,
      lowStockThreshold: threshold,
      unit, location,
      description: '',
    });
    if (qty > 0) {
      await stockRepo.applyMovement({
        productId: p.id,
        type: MOVEMENT_TYPES.OPENING,
        quantity: qty,
        reason: 'Sample data opening stock',
      });
    }
    created.push(p);
  }

  const hammer = created.find((p) => p.sku === 'TL-HAM-16');
  const screws = created.find((p) => p.sku === 'FN-WS-0440');
  if (hammer) await stockRepo.applyMovement({ productId: hammer.id, type: MOVEMENT_TYPES.SALE, quantity: 2, reference: 'INV-1001', reason: 'Counter sale' });
  if (screws) await stockRepo.applyMovement({ productId: screws.id, type: MOVEMENT_TYPES.SALE, quantity: 5, reference: 'INV-1002', reason: 'Counter sale' });

  return created;
}