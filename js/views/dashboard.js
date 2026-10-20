/* =========================================================
   StockVault — Live dashboard
   Every number here is derived from IndexedDB records.
   Charts are drawn on plain canvas — no chart library.
   All user-visible strings are translated via t().
   ========================================================= */

import { el, formatCurrency, formatNumber, formatDateTime, relativeTime } from '../ui.js';
import { productsRepo, stockRepo, productStockStatus } from '../repositories.js';
import { loadSettings } from '../settings.js';
import { navigate } from '../router.js';
import { openProductForm } from './products.js';
import { t } from '../i18n.js';

const MOVEMENT_KEY = {
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

export async function renderDashboard(container) {
  const settings = await loadSettings();
  const [products, movements] = await Promise.all([
    productsRepo.list({ includeArchived: false }),
    stockRepo.recent(20),
  ]);

  const totalProducts = products.length;
  const inventoryValue = products.reduce((sum, p) => sum + p.quantity * p.cost, 0);

  let low = 0, out = 0;
  for (const p of products) {
    const s = productStockStatus(p);
    if (s === 'out') out++;
    else if (s === 'low') low++;
    else if (p.lowStockThreshold === 0 && p.quantity > 0 && settings.zeroThresholdBehavior === 'low_stock') low++;
  }

  const needsAttention = products
    .filter((p) => {
      const s = productStockStatus(p);
      return s === 'out' || s === 'low';
    })
    .sort((a, b) =>
      (productStockStatus(a) === 'out' ? 0 : 1) - (productStockStatus(b) === 'out' ? 0 : 1)
      || a.quantity - b.quantity)
    .slice(0, 6);

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  // --- Hero ---
  const hour = new Date().getHours();
  const greetingKey = hour < 12 ? 'dashboard.goodMorning' : hour < 18 ? 'dashboard.goodAfternoon' : 'dashboard.goodEvening';
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  root.appendChild(el('div', { class: 'dash-hero' }, [
    el('div', {}, [
      el('h2', {}, t(greetingKey)),
      el('p', {}, t('dashboard.overview', { date: dateLabel })),
    ]),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn btn--primary',
        onclick: () => openProductForm({ onSaved: () => navigate('dashboard', {}, { replace: true }) }),
      }, t('topbar.addProduct')),
    ]),
  ]));

  // --- KPI cards ---
  root.appendChild(el('div', { class: 'kpi-grid' }, [
    kpiCard(t('dashboard.totalProducts'), formatNumber(totalProducts),
      totalProducts ? `${formatNumber(totalProducts)} ` + t('nav.products').toLowerCase() : t('products.emptyText'),
      'accent', () => navigate('products')),
    kpiCard(t('dashboard.inventoryValue'), formatCurrency(inventoryValue, settings.currency),
      t('common.total'), 'success', () => navigate('reports')),
    kpiCard(t('dashboard.lowStockItems'), formatNumber(low),
      low ? t('lowStock.filterLow') : t('dashboard.allClear'),
      'warning', () => navigate('low-stock')),
    kpiCard(t('dashboard.outOfStock'), formatNumber(out),
      out ? t('lowStock.filterOut') : t('dashboard.allClear'),
      'danger', () => navigate('low-stock')),
  ]));

  // --- Analytics row ---
  const analytics = el('div', { class: 'dash-analytics' });

  analytics.appendChild(el('section', { class: 'card' }, [
    el('header', { class: 'card__header' }, [
      el('div', { class: 'card__title' }, t('dashboard.inventoryValueOverTime')),
    ]),
    el('div', { class: 'chart-box' }, el('canvas', { id: 'chartValue' })),
  ]));

  analytics.appendChild(el('section', { class: 'card' }, [
    el('header', { class: 'card__header' }, [
      el('div', { class: 'card__title' }, t('dashboard.stockDistribution')),
    ]),
    el('div', { class: 'chart-box' }, el('canvas', { id: 'chartDist' })),
    el('div', { class: 'chart-legend' }, [
      legendItem(t('dashboard.inStock'), 'var(--success)'),
      legendItem(t('dashboard.low'),     'var(--warning)'),
      legendItem(t('dashboard.out'),     'var(--danger)'),
    ]),
  ]));

  root.appendChild(analytics);

  // --- Lower row ---
  const lower = el('div', { class: 'dash-lower' });

  lower.appendChild(el('section', { class: 'card' }, [
    el('header', { class: 'card__header' }, [
      el('div', { class: 'card__title' }, t('dashboard.recentMovements')),
      el('button', { class: 'btn btn--sm btn--ghost', onclick: () => navigate('stock') }, t('dashboard.viewAll')),
    ]),
    movements.length
      ? el('div', { class: 'activity-list' }, movements.slice(0, 8).map(renderActivity))
      : emptyState(t('dashboard.noMovements'), t('dashboard.noMovementsHint')),
  ]));

  lower.appendChild(el('section', { class: 'card' }, [
    el('header', { class: 'card__header' }, [
      el('div', { class: 'card__title' }, t('dashboard.productsNeedingAttention')),
      el('button', { class: 'btn btn--sm btn--ghost', onclick: () => navigate('low-stock') }, t('dashboard.viewAll')),
    ]),
    needsAttention.length
      ? el('div', { class: 'activity-list' }, needsAttention.map(renderAttention))
      : emptyState(t('dashboard.allClear'), t('dashboard.allClearHint')),
  ]));

  root.appendChild(lower);

  // --- Charts ---
  requestAnimationFrame(() => {
    drawValueChart(container.querySelector('#chartValue'), movements);
    drawDistributionChart(container.querySelector('#chartDist'), products);
  });
}

/* =========================================================
   UI helpers
   ========================================================= */

function kpiCard(label, value, foot, tone, onClick) {
  const card = el('article', {
    class: 'kpi',
    role: 'group',
    'aria-label': label,
    style: onClick ? { cursor: 'pointer' } : {},
  }, [
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
  if (onClick) {
    card.addEventListener('click', onClick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    });
    card.tabIndex = 0;
  }
  return card;
}

function legendItem(label, color) {
  return el('span', {}, [el('i', { style: { background: color } }), label]);
}

function emptyState(title, text) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty__icon' }, '○'),
    el('p', { class: 'empty__title' }, title),
    el('p', { class: 'empty__text' }, text),
  ]);
}

function renderActivity(m) {
  const isUp = m.quantity > 0;
  const icon = el('span', { class: `activity-item__icon activity-item__icon--${isUp ? 'in' : 'out'}` },
    isUp
      ? el('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>' })
      : el('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>' })
  );

  const typeLabel = MOVEMENT_KEY[m.type] ? t(MOVEMENT_KEY[m.type]) : m.type;
  const refLabel = m.reference || '—';

  const item = el('div', { class: 'activity-item', role: 'button', tabIndex: 0 }, [
    icon,
    el('div', {}, [
      el('div', { class: 'activity-item__title' }, typeLabel),
      el('div', { class: 'activity-item__meta' }, `${refLabel} · ${relativeTime(m.timestamp)}`),
    ]),
    el('div', { class: `activity-item__delta ${isUp ? 'activity-item__delta--up' : 'activity-item__delta--down'}` },
      `${isUp ? '+' : ''}${formatNumber(m.quantity)}`),
  ]);
  item.addEventListener('click', () => navigate('products', { id: m.productId }));
  item.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate('products', { id: m.productId }); });
  return item;
}

function renderAttention(p) {
  const status = productStockStatus(p);
  const statusLabel = status === 'out' ? t('dashboard.out') : t('dashboard.low');
  const meta = `${formatNumber(p.quantity)} · ${formatNumber(p.lowStockThreshold)}`;

  const item = el('div', { class: 'activity-item', role: 'button', tabIndex: 0 }, [
    el('span', {
      class: 'activity-item__icon',
      html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    }),
    el('div', {}, [
      el('div', { class: 'activity-item__title' }, p.name),
      el('div', { class: 'activity-item__meta' }, meta),
    ]),
    el('span', { class: `badge ${status === 'out' ? 'badge--danger' : 'badge--warning'}` }, statusLabel),
  ]);
  item.addEventListener('click', () => navigate('products', { id: p.id }));
  return item;
}

/* =========================================================
   CHARTS — plain canvas, no library
   ========================================================= */

function drawValueChart(canvas, movements) {
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const { w, h } = ctx.__size;
  const padding = { top: 16, right: 12, bottom: 26, left: 48 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  const days = 30;
  const now = Date.now();
  const dayMs = 86400_000;
  const buckets = new Array(days).fill(0);

  const deltas = movements.slice().sort((a, b) => a.timestamp - b.timestamp);
  if (!deltas.length) {
    drawEmptyChart(ctx, t('dashboard.noMovements'));
    return;
  }

  const dayIndex = (ts) => days - 1 - Math.floor((now - ts) / dayMs);
  const perDayNet = new Map();
  for (const m of deltas) {
    const idx = dayIndex(m.timestamp);
    if (idx < 0 || idx >= days) continue;
    if (!perDayNet.has(idx)) perDayNet.set(idx, []);
    perDayNet.get(idx).push(m);
  }

  let running = 0;
  for (let i = 0; i < days; i++) {
    const dayMovements = perDayNet.get(i) || [];
    for (const m of dayMovements) running += m.quantity;
    buckets[i] = running;
  }

  const max = Math.max(1, ...buckets);
  const min = Math.min(0, ...buckets);

  drawAxes(ctx, padding, plotW, plotH, max, min);
  drawLine(ctx, padding, plotW, plotH, buckets, min, max,
    'rgba(88, 101, 242, 0.9)', 'rgba(88, 101, 242, 0.15)');
}

function drawDistributionChart(canvas, products) {
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const { w, h } = ctx.__size;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 - 20;

  let inStock = 0, low = 0, out = 0;
  for (const p of products) {
    const s = productStockStatus(p);
    if (s === 'out') out++;
    else if (s === 'low') low++;
    else inStock++;
  }
  const total = inStock + low + out;
  if (!total) {
    drawEmptyChart(ctx, t('products.emptyTitle'));
    return;
  }

  const segments = [
    { value: inStock, color: '#278B68' },
    { value: low,     color: '#D99126' },
    { value: out,     color: '#D94F59' },
  ].filter((s) => s.value > 0);

  const inner = r * 0.62;
  let angle = -Math.PI / 2;
  for (const seg of segments) {
    const sweep = (seg.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.arc(cx, cy, inner, angle + sweep, angle, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    angle += sweep;
  }

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#253047';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(total), cx, cy - 6);
  ctx.font = '400 11px system-ui, sans-serif';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#758198';
  ctx.fillText(t('nav.products').toLowerCase(), cx, cy + 14);
}

function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.__size = { w: rect.width, h: rect.height };
  ctx.clearRect(0, 0, rect.width, rect.height);
  return ctx;
}

function drawAxes(ctx, padding, plotW, plotH, max, min) {
  const css = getComputedStyle(document.documentElement);
  const gridColor = css.getPropertyValue('--border').trim() || 'rgba(0,0,0,0.08)';
  const textColor = css.getPropertyValue('--text-secondary').trim() || '#758198';

  ctx.strokeStyle = gridColor;
  ctx.fillStyle = textColor;
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const lines = 4;
  for (let i = 0; i <= lines; i++) {
    const y = padding.top + (plotH * i) / lines;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotW, y);
    ctx.stroke();
    const v = Math.round(max - ((max - min) * i) / lines);
    ctx.fillText(String(v), padding.left - 6, y);
  }
}

function drawLine(ctx, padding, plotW, plotH, values, min, max, lineColor, fillColor) {
  const stepX = plotW / Math.max(1, values.length - 1);
  const range = Math.max(1, max - min);

  const points = values.map((v, i) => [
    padding.left + i * stepX,
    padding.top + plotH - ((v - min) / range) * plotH,
  ]);

  ctx.beginPath();
  ctx.moveTo(points[0][0], padding.top + plotH);
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.lineTo(points[points.length - 1][0], padding.top + plotH);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawEmptyChart(ctx, message) {
  const { w, h } = ctx.__size;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#97A2B6';
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, w / 2, h / 2);
}