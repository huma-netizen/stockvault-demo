/* =========================================================
   StockVault — App bootstrap
   ========================================================= */

import { startRouter, navigate, registerView } from './router.js';
import { $, el, openModal, toast, debounce } from './ui.js';
import { openDatabase } from './database.js';
import { loadSettings, reflectBusinessName, settingsSnapshot } from './settings.js';
import { refreshBadges } from './notifications.js';
import { maybeRunOnboarding } from './views/onboarding.js';
import { renderProductsList, renderProductDetail, openProductForm } from './views/products.js';
import { renderCategories } from './views/categories.js';
import { renderSuppliersList, renderSupplierDetail } from './views/suppliers.js';
import { renderStockLedger } from './views/stock.js';
import { renderLowStock } from './views/low-stock.js';
import { renderPurchasesList, renderPurchaseDetail } from './views/purchases.js';
import { renderDashboard } from './views/dashboard.js';
import { renderReports } from './views/reports.js';
import { renderDataManagement } from './views/data.js';
import { renderSettings } from './views/settings.js';
import { loadTheme } from './theme.js';
import { loadLanguage, t } from './i18n.js';

/* ---------- Theme ---------- */
const THEME_KEY = 'stockvault:theme';
const rootEl = document.documentElement;

function applyTheme(theme) {
  rootEl.setAttribute('data-theme', theme);
  const toggle = document.getElementById('themeToggle');
  if (toggle) toggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = theme === 'dark' ? '#1B2130' : '#E9EDF3';
  document.head.appendChild(meta);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));

  $('#themeToggle')?.addEventListener('click', () => {
    const next = rootEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
  });
}

/* ---------- Sidebar ---------- */
function initSidebar() {
  const shell = document.getElementById('appShell');
  const toggle = document.getElementById('sidebarToggle');
  const overlay = document.getElementById('sidebarOverlay');
  const mq = window.matchMedia('(max-width: 860px)');

  function isMobile() { return mq.matches; }
  function syncToggle() {
    if (!toggle) return;
    const expanded = isMobile()
      ? shell.classList.contains('is-drawer-open')
      : !shell.classList.contains('is-collapsed');
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  toggle?.addEventListener('click', () => {
    if (isMobile()) {
      const open = shell.classList.toggle('is-drawer-open');
      if (overlay) overlay.hidden = !open;
    } else {
      shell.classList.toggle('is-collapsed');
      localStorage.setItem('stockvault:sidebarCollapsed',
        shell.classList.contains('is-collapsed') ? '1' : '0');
    }
    syncToggle();
  });

  overlay?.addEventListener('click', () => {
    shell.classList.remove('is-drawer-open');
    if (overlay) overlay.hidden = true;
    syncToggle();
  });

  mq.addEventListener('change', () => {
    shell.classList.remove('is-drawer-open');
    if (overlay) overlay.hidden = true;
    syncToggle();
  });

  if (!isMobile() && localStorage.getItem('stockvault:sidebarCollapsed') === '1') {
    shell.classList.add('is-collapsed');
  }
  syncToggle();
}

/* ---------- Status ---------- */
function initStatus() {
  const netDot = document.getElementById('netStatusDot');
  const netText = document.getElementById('netStatusText');
  const dbDot = document.getElementById('dbStatusDot');
  const dbText = document.getElementById('dbStatusText');

  function updateNet() {
    const online = navigator.onLine;
    netDot?.classList.toggle('status-dot--ok', online);
    netDot?.classList.toggle('status-dot--warn', !online);
    if (netText) netText.textContent = online ? t('status.online') : t('status.offlineReady');
  }

  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);
  updateNet();

  if (dbDot) dbDot.classList.add('status-dot--ok');
  if (dbText) dbText.textContent = t('status.localStorage');
}

/* ---------- Search ---------- */
function initGlobalSearch() {
  const input = document.getElementById('globalSearch');
  if (!input) return;
  const run = debounce((q) => { if (q) navigate('products', { q }); }, 260);
  input.addEventListener('input', (e) => run(e.target.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) navigate('products', { q });
    }
  });
}

/* ---------- Quick add ---------- */
function initQuickAdd() {
  document.getElementById('quickAddBtn')?.addEventListener('click', () => {
    openProductForm({
      onSaved: () => window.dispatchEvent(new HashChangeEvent('hashchange')),
    });
  });
}

/* ---------- Notifications ---------- */
function initNotifications() {
  document.getElementById('notificationsBtn')?.addEventListener('click', () => {
    navigate('low-stock');
  });
}

/* ---------- Route registration ---------- */
function registerAllViews() {
  registerView('dashboard', (container) => renderDashboard(container));

  registerView('products', (container, params) => {
    if (params.id) return renderProductDetail(container, params);
    return renderProductsList(container, params);
  });

  registerView('categories', (container) => renderCategories(container));

  registerView('suppliers', (container, params) => {
    if (params.id) return renderSupplierDetail(container, params);
    return renderSuppliersList(container);
  });

  registerView('stock', (container) => renderStockLedger(container));
  registerView('low-stock', (container) => renderLowStock(container));

  registerView('purchases', (container, params) => {
    if (params.id) return renderPurchaseDetail(container, params);
    return renderPurchasesList(container);
  });

  registerView('reports',  (container) => renderReports(container));
  registerView('data',     (container) => renderDataManagement(container));
  registerView('settings', (container) => renderSettings(container));
}

/* ---------- Shell translations ---------- */
function applyShellTranslations() {
  const navMap = {
    'dashboard':     'nav.dashboard',
    'products':      'nav.products',
    'categories':    'nav.categories',
    'stock':         'nav.stockMovements',
    'low-stock':     'nav.lowStockAlerts',
    'suppliers':     'nav.suppliers',
    'purchases':     'nav.purchaseOrders',
    'reports':       'nav.reports',
    'data':          'nav.dataManagement',
    'settings':      'nav.settings',
  };

  document.querySelectorAll('.nav-item').forEach((a) => {
    const key = navMap[a.dataset.route];
    if (!key) return;
    const label = a.querySelector('span:not(.nav-icon):not(.nav-badge)');
    if (label) label.textContent = t(key);
  });

  const sectionMap = {
    'nav-overview':   'nav.overview',
    'nav-inventory':  'nav.inventory',
    'nav-purchasing': 'nav.purchasing',
    'nav-insights':   'nav.insights',
    'nav-system':     'nav.system',
  };
  Object.entries(sectionMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  });

  // Topbar
  const search = document.getElementById('globalSearch');
  if (search) search.placeholder = t('topbar.searchPlaceholder');

  const addBtn = document.querySelector('#quickAddBtn span:not(svg)');
  if (addBtn) addBtn.textContent = t('topbar.addProduct');

  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.setAttribute('aria-label', t('topbar.toggleTheme'));

  const notifBtn = document.getElementById('notificationsBtn');
  if (notifBtn) notifBtn.setAttribute('aria-label', t('topbar.notifications'));

  const sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) sidebarToggle.setAttribute('aria-label', t('topbar.toggleNav'));

  // Sidebar footer
  const dbText = document.getElementById('dbStatusText');
  if (dbText) dbText.textContent = t('status.localStorage');
  const netText = document.getElementById('netStatusText');
  if (netText && navigator.onLine) netText.textContent = t('status.online');
  else if (netText) netText.textContent = t('status.offlineReady');
}

/* ---------- Boot ---------- */
async function boot() {
  initTheme();
  loadTheme();              // apply saved accent color
  await loadLanguage();     // load locale bundle before first render

  initSidebar();
  initStatus();
  initGlobalSearch();
  initQuickAdd();
  initNotifications();

  const shell = document.getElementById('appShell');
  shell?.setAttribute('aria-busy', 'true');

  try {
    await openDatabase();
    await loadSettings();
  } catch (err) {
    console.error('[boot] database unavailable', err);
    const view = document.getElementById('view');
    if (view) {
      view.innerHTML = `
        <div class="empty">
          <div class="empty__icon" aria-hidden="true">!</div>
          <p class="empty__title">${t('errors.dbUnavailable')}</p>
          <p class="empty__text">${t('errors.dbUnavailableHint')}</p>
        </div>`;
    }
    shell?.removeAttribute('aria-busy');
    return;
  }

  const settings = settingsSnapshot() || {};
  reflectBusinessName(settings.businessName);

  try {
    await maybeRunOnboarding();
  } catch (err) {
    console.error('[boot] onboarding failed', err);
  }

  registerAllViews();

  try {
    await refreshBadges();
  } catch (err) {
    console.warn('[boot] badge refresh failed', err);
  }

  // Re-render shell + current view whenever the language changes.
  // One listener only. Note: applyShellTranslations runs again after
  // the initial render so the sidebar reflects the loaded locale.
  window.addEventListener('stockvault:language-changed', () => {
    try { applyShellTranslations(); }
    catch (err) { console.warn('[boot] shell re-translate failed', err); }
    if (typeof window.__stockvaultRerender === 'function') {
      window.__stockvaultRerender();
    }
  });

  startRouter();

  // Router re-render hook used by the language-changed listener above.
  window.__stockvaultRerender = () => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  // Reflect loaded locale in the shell once the router has mounted.
  applyShellTranslations();

  shell?.removeAttribute('aria-busy');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

/* =========================================================
   SERVICE WORKER REGISTRATION
   ========================================================= */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then((reg) => {
        console.log('[sw] registered', reg.scope);

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateAvailable();
            }
          });
        });
      })
      .catch((err) => console.warn('[sw] registration failed', err));
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}

function showUpdateAvailable() {
  const bar = document.createElement('div');
  bar.style.cssText = `
    position: fixed; bottom: 16px; left: 16px; right: 16px;
    max-width: 420px; margin: 0 auto;
    padding: 12px 16px; border-radius: 12px;
    background: var(--surface-raised); color: var(--text);
    box-shadow: var(--shadow-raised-lg), var(--shadow-overlay);
    display: flex; align-items: center; gap: 12px; z-index: 9999;
    font-size: 14px;
  `;
  bar.innerHTML = `<span style="flex:1">${t('app.name')} — ${t('reports.generatedAt', { datetime: '' })}`.replace(/\s+·\s*$/, '') + '</span>';
  const refresh = document.createElement('button');
  refresh.className = 'btn btn--primary btn--sm';
  refresh.textContent = t('common.refresh');
  refresh.addEventListener('click', () => {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg?.waiting) reg.waiting.postMessage('SKIP_WAITING');
      else location.reload();
    });
  });
  const dismiss = document.createElement('button');
  dismiss.className = 'btn btn--ghost btn--sm';
  dismiss.textContent = t('common.close');
  dismiss.addEventListener('click', () => bar.remove());

  bar.append(refresh, dismiss);
  document.body.appendChild(bar);
}