/* =========================================================
   StockVault — Local notifications
   Aggregates alert-worthy state from repositories. No
   background execution, no OS notifications — this is a
   foreground, in-app alert center. That constraint is a
   deliberate trade-off for an offline-first PWA.
   ========================================================= */

import { productsRepo, productStockStatus } from './repositories.js';
import { loadSettings } from './settings.js';

/* ---------- Public API ---------- */

/**
 * Compute the current alert list.
 * Each alert: { id, type, severity, title, message, productId }
 * Types: 'out_of_stock' | 'low_stock' | 'zero_threshold'
 */
export async function computeAlerts() {
  const [settings, products] = await Promise.all([
    loadSettings(),
    productsRepo.list({ includeArchived: false }),
  ]);

  const alerts = [];

  for (const p of products) {
    const status = productStockStatus(p);

    if (status === 'out') {
      alerts.push({
        id: `out:${p.id}`,
        type: 'out_of_stock',
        severity: 'danger',
        title: 'Out of stock',
        message: `${p.name} (SKU ${p.sku}) has no stock on hand.`,
        productId: p.id,
      });
      continue;
    }

    if (status === 'low') {
      alerts.push({
        id: `low:${p.id}`,
        type: 'low_stock',
        severity: 'warning',
        title: 'Low stock',
        message: `${p.name} is at ${p.quantity} ${p.unit} — threshold ${p.lowStockThreshold}.`,
        productId: p.id,
      });
      continue;
    }

    // Threshold of zero with stock on hand: honor user preference.
    if (p.lowStockThreshold === 0 && p.quantity > 0 && settings.zeroThresholdBehavior === 'low_stock') {
      alerts.push({
        id: `zero:${p.id}`,
        type: 'zero_threshold',
        severity: 'info',
        title: 'Threshold unset',
        message: `${p.name} has stock but no low-stock threshold configured.`,
        productId: p.id,
      });
    }
  }

  // Highest severity first.
  const order = { danger: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  return alerts;
}

/** Counts used by the sidebar badge and KPI tiles. */
export async function getAlertCounts() {
  const [settings, products] = await Promise.all([
    loadSettings(),
    productsRepo.list({ includeArchived: false }),
  ]);

  let low = 0, out = 0;
  for (const p of products) {
    const status = productStockStatus(p);
    if (status === 'out') out++;
    else if (status === 'low') low++;
    else if (p.lowStockThreshold === 0 && p.quantity > 0 && settings.zeroThresholdBehavior === 'low_stock') low++;
  }

  return { low, out, total: low + out };
}

/* ---------- UI integration ---------- */

/**
 * Refresh badge counters on the sidebar and topbar.
 * Phase 3 will call this after any stock-changing operation.
 */
export async function refreshBadges() {
  const counts = await getAlertCounts();
  const sidebarBadge = document.getElementById('lowStockBadge');
  const notifBadge = document.getElementById('notifBadge');

  if (sidebarBadge) {
    sidebarBadge.textContent = String(counts.total);
    sidebarBadge.hidden = counts.total === 0;
  }
  if (notifBadge) {
    notifBadge.hidden = counts.total === 0;
  }
  return counts;
}