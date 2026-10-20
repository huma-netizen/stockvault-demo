/* =========================================================
   StockVault — UI helpers
   DOM creation, formatting, toasts, modal scaffolding.
   No business logic here; presentation only.
   ========================================================= */

/* ---------- Tiny DOM builder ---------- */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      // Deliberate opt-in for pre-sanitized markup only. Avoid for user data.
      node.innerHTML = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child);
  }
  return node;
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- Safe text ---------- */
export function setText(node, text) {
  if (node) node.textContent = text == null ? '' : String(text);
}

/* ---------- Formatting ---------- */
const DEFAULT_LOCALE = navigator.language || 'en-US';

export function formatCurrency(amount, currency = 'USD', locale = DEFAULT_LOCALE) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function formatNumber(value, decimals = 0, locale = DEFAULT_LOCALE) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatDate(ts, opts = { dateStyle: 'medium' }) {
  if (!ts) return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, opts).format(d);
}

export function formatDateTime(ts) {
  return formatDate(ts, { dateStyle: 'medium', timeStyle: 'short' });
}

export function relativeTime(ts) {
  if (!ts) return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  const diff = Date.now() - d.getTime();
  const s = Math.round(diff / 1000);
  if (Math.abs(s) < 45) return 'just now';
  const units = [
    ['year',   31536000],
    ['month',  2592000],
    ['week',   604800],
    ['day',    86400],
    ['hour',   3600],
    ['minute', 60],
  ];
  for (const [unit, secs] of units) {
    const v = Math.round(s / secs);
    if (Math.abs(v) >= 1) {
      try {
        return new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: 'auto' })
          .format(-v, unit);
      } catch { return `${v} ${unit}${Math.abs(v) === 1 ? '' : 's'} ago`; }
    }
  }
  return 'just now';
}

/* ---------- Debounce / throttle ---------- */
export function debounce(fn, wait = 220) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ---------- ID generation ---------- */
export function uid(prefix = '') {
  const rand = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
  return prefix ? `${prefix}_${rand}` : rand;
}

/* =========================================================
   TOASTS
   ========================================================= */
const TOAST_ICONS = {
  info:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  success: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  warning: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  danger:  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
};

export function toast(message, { type = 'info', title = '', timeout = 4200 } = {}) {
  const root = document.getElementById('toastRoot');
  if (!root) return;

  const node = el('div', { class: `toast toast--${type}`, role: 'status' }, [
    el('span', { class: 'toast__icon', html: TOAST_ICONS[type] || TOAST_ICONS.info }),
    el('div', { class: 'toast__body' }, [
      title ? el('div', { class: 'toast__title' }, title) : null,
      el('div', { class: 'toast__msg' }, message),
    ]),
    el('button', { class: 'toast__close', 'aria-label': 'Dismiss', onclick: () => dismiss() }, '×'),
  ]);

  root.appendChild(node);

  let timer = timeout > 0 ? setTimeout(dismiss, timeout) : null;

  function dismiss() {
    if (timer) clearTimeout(timer);
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }

  return dismiss;
}

/* =========================================================
   MODAL
   ========================================================= */
export function openModal({ title, body, footer, size = '', onClose } = {}) {
  const root = document.getElementById('modalRoot');
  if (!root) return { close() {} };

  const previouslyFocused = document.activeElement;

  const backdrop = el('div', { class: 'modal-backdrop', onclick: close });
  const modal = el('div', { class: `modal ${size}`.trim(), role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { class: 'modal__header' }, [
      el('h2', { class: 'modal__title' }, title || ''),
      el('button', { class: 'modal__close', 'aria-label': 'Close', onclick: close }, '×'),
    ]),
    el('div', { class: 'modal__body' }, body || ''),
    footer ? el('div', { class: 'modal__footer' }, footer) : null,
  ]);

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') trapFocus(e);
  }

  function trapFocus(e) {
    const focusables = modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    root.innerHTML = '';
    if (previouslyFocused?.focus) previouslyFocused.focus();
    onClose?.();
  }

  root.innerHTML = '';
  root.append(backdrop, modal);
  document.addEventListener('keydown', onKey);

  requestAnimationFrame(() => {
    const first = modal.querySelector('input, select, textarea, button:not(.modal__close)');
    (first || modal.querySelector('.modal__close'))?.focus();
  });

  return { close, modal };
}

export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const footer = [
      el('button', { class: 'btn btn--ghost', onclick: () => done(false) }, cancelLabel),
      el('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, onclick: () => done(true) }, confirmLabel),
    ];
    const body = el('p', { style: { color: 'var(--text-secondary)', margin: 0 } }, message);
    const { close } = openModal({ title, body, footer, size: 'modal--sm', onClose: () => resolve(false) });
    let resolved = false;
    function done(v) {
      if (resolved) return;
      resolved = true;
      close();
      resolve(v);
    }
  });
}