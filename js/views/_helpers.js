/* =========================================================
   StockVault — View helpers
   Small, presentation-only utilities shared by every view:
   page header, table shell, pagination, filter bar, confirm
   shortcuts, and a typed form-field factory.
   ========================================================= */

import { el, formatNumber, debounce } from '../ui.js';

/* ---------- Page header ---------- */
export function pageHeader({ title, subtitle, actions = [] } = {}) {
  return el('div', { class: 'dash-hero' }, [
    el('div', {}, [
      el('h2', {}, title || ''),
      subtitle ? el('p', {}, subtitle) : null,
    ]),
    actions.length ? el('div', { class: 'row' }, actions) : null,
  ]);
}

/* ---------- Card wrapper ---------- */
export function card({ title, actions = [], body, footer, class: cls = '' } = {}) {
  return el('section', { class: `card ${cls}`.trim() }, [
    (title || actions.length)
      ? el('header', { class: 'card__header' }, [
          title ? el('div', { class: 'card__title' }, title) : el('span'),
          actions.length ? el('div', { class: 'row' }, actions) : null,
        ])
      : null,
    body || null,
    footer || null,
  ]);
}

/* ---------- Filter bar ---------- */
export function filterBar(fields) {
  const bar = el('div', {
    class: 'card card--sm',
    style: {
      display: 'grid',
      gap: 'var(--s-3)',
      gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))`,
      alignItems: 'end',
    },
  });
  const inputs = {};
  for (const f of fields) {
    const wrap = el('div', { class: 'field', style: { margin: 0 } });
    if (f.label) wrap.appendChild(el('label', { class: 'field__label' }, f.label));
    let input;
    if (f.type === 'select') {
      input = el('select', { class: 'select' });
      for (const opt of f.options || []) {
        input.appendChild(el('option', { value: opt.value }, opt.label));
      }
    } else {
      input = el('input', { class: 'input', type: f.type || 'text', placeholder: f.placeholder || '' });
    }
    if (f.value != null) input.value = f.value;
    if (f.onChange) {
      const evt = f.type === 'text' || f.type === 'search' ? 'input' : 'change';
      const handler = evt === 'input' ? debounce(f.onChange, 220) : f.onChange;
      input.addEventListener(evt, (e) => handler(e.target.value));
    }
    wrap.appendChild(input);
    bar.appendChild(wrap);
    inputs[f.name] = input;
  }
  return { node: bar, inputs };
}

/* ---------- Table shell ---------- */
export function tableShell({ columns, rows, empty, renderRow, selectable = false, onSelectAll = null, onSelectOne = null }) {
  const wrap = el('div', { class: 'table-wrap' });
  if (!rows.length) {
    wrap.appendChild(empty || el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon' }, '○'),
      el('p', { class: 'empty__title' }, 'Nothing here yet'),
      el('p', { class: 'empty__text' }, 'Records will appear here as you add them.'),
    ]));
    return wrap;
  }

  const table = el('table', { class: 'table' });
  const thead = el('thead');
  const headRow = el('tr');
  if (selectable) {
    const th = el('th', { class: 'col-check' });
    const cb = el('input', { type: 'checkbox', 'aria-label': 'Select all' });
    cb.addEventListener('change', () => onSelectAll?.(cb.checked));
    th.appendChild(cb);
    headRow.appendChild(th);
  }
  for (const col of columns) {
    headRow.appendChild(el('th', { class: col.class || '' }, col.label));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  rows.forEach((row, i) => {
    tbody.appendChild(renderRow(row, i, { selectable, onSelectOne }));
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/* ---------- Pagination ---------- */
export function pagination({ total, page, pageSize, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const controls = el('div', { class: 'pagination__controls' });
  const prev = el('button', { class: 'pagination__btn', disabled: page <= 1 }, '‹');
  const next = el('button', { class: 'pagination__btn', disabled: page >= totalPages }, '›');
  prev.addEventListener('click', () => onChange(page - 1));
  next.addEventListener('click', () => onChange(page + 1));
  controls.append(prev);

  // Compact window of pages around current.
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  for (let p = start; p <= end; p++) {
    const b = el('button', { class: 'pagination__btn', 'aria-current': p === page ? 'true' : null }, String(p));
    b.addEventListener('click', () => onChange(p));
    controls.appendChild(b);
  }
  controls.appendChild(next);

  return el('div', { class: 'pagination' }, [
    el('span', {}, `${from}–${to} of ${formatNumber(total)}`),
    controls,
  ]);
}

/* ---------- Form field factory ---------- */
export function field({
  name, label, type = 'text', value = '', required = false, placeholder = '',
  options = null, hint = '', error = '', rows = 4, min, max, step, disabled = false,
}) {
  const wrap = el('div', { class: 'field', dataset: { name } });
  if (label) {
    wrap.appendChild(el('label', { class: 'field__label', for: `f_${name}` }, [
      label,
      required ? el('span', { class: 'req' }, '*') : null,
    ]));
  }
  let input;
  if (type === 'textarea') {
    input = el('textarea', { class: 'textarea', id: `f_${name}`, name, placeholder, rows, disabled });
    input.value = value ?? '';
  } else if (type === 'select') {
    input = el('select', { class: 'select', id: `f_${name}`, name, disabled });
    for (const opt of options || []) {
      const o = el('option', { value: opt.value }, opt.label);
      if (String(opt.value) === String(value)) o.selected = true;
      input.appendChild(o);
    }
  } else {
    input = el('input', {
      class: 'input', id: `f_${name}`, name, type,
      placeholder, disabled,
      ...(min != null ? { min } : {}),
      ...(max != null ? { max } : {}),
      ...(step != null ? { step } : {}),
    });
    input.value = value ?? '';
  }
  wrap.appendChild(input);
  if (hint) wrap.appendChild(el('span', { class: 'field__hint' }, hint));
  if (error) wrap.appendChild(el('span', { class: 'field__error' }, error));
  else wrap.appendChild(el('span', { class: 'field__error' }));
  return wrap;
}

/* ---------- Form read helper ---------- */
export function readForm(formEl) {
  const data = {};
  formEl.querySelectorAll('[name]').forEach((input) => {
    if (input.type === 'checkbox') data[input.name] = input.checked;
    else if (input.type === 'number') data[input.name] = input.value === '' ? null : Number(input.value);
    else data[input.name] = input.value.trim();
  });
  return data;
}

export function setFieldError(formEl, name, message) {
  const wrap = formEl.querySelector(`.field[data-name="${name}"]`);
  if (!wrap) return;
  const err = wrap.querySelector('.field__error');
  if (err) err.textContent = message || '';
  wrap.classList.toggle('has-error', Boolean(message));
}

export function clearFormErrors(formEl) {
  formEl.querySelectorAll('.field').forEach((f) => {
    f.classList.remove('has-error');
    const err = f.querySelector('.field__error');
    if (err) err.textContent = '';
  });
}

/* ---------- Stock status chip ---------- */
export function statusBadge(status) {
  switch (status) {
    case 'out': return el('span', { class: 'badge badge--danger' }, [el('span', { class: 'dot' }), 'Out of stock']);
    case 'low': return el('span', { class: 'badge badge--warning' }, [el('span', { class: 'dot' }), 'Low stock']);
    default:    return el('span', { class: 'badge badge--success' }, [el('span', { class: 'dot' }), 'In stock']);
  }
}