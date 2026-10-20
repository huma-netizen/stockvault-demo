/* =========================================================
   StockVault — Hash router (Phase 1 stub)
   Phase 5 will expand this with real views.
   The router is intentionally minimal here so that the shell
   boots, updates the active nav, breadcrumb, and page title.
   ========================================================= */

const ROUTES = {
  dashboard:   { title: 'Dashboard',         crumbs: ['Dashboard'] },
  products:    { title: 'Products',          crumbs: ['Inventory', 'Products'] },
  categories:  { title: 'Categories',        crumbs: ['Inventory', 'Categories'] },
  stock:       { title: 'Stock Movements',   crumbs: ['Inventory', 'Stock Movements'] },
  'low-stock': { title: 'Low Stock Alerts',  crumbs: ['Inventory', 'Low Stock Alerts'] },
  suppliers:   { title: 'Suppliers',         crumbs: ['Purchasing', 'Suppliers'] },
  purchases:   { title: 'Purchase Orders',   crumbs: ['Purchasing', 'Purchase Orders'] },
  reports:     { title: 'Reports & Analytics', crumbs: ['Insights', 'Reports & Analytics'] },
  data:        { title: 'Data Management',   crumbs: ['System', 'Data Management'] },
  settings:    { title: 'Settings',          crumbs: ['System', 'Settings'] },
};

const VIEW_RENDERERS = new Map(); // routeKey -> async (container, params) => void

export function registerView(key, renderer) {
  VIEW_RENDERERS.set(key, renderer);
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [pathPart, queryPart] = raw.split('?');
  const [route, ...rest] = pathPart.split('/');
  const params = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { route: route || 'dashboard', sub: rest, params };
}

export function navigate(route, params = {}) {
  const qs = new URLSearchParams(params).toString();
  location.hash = `#/${route}${qs ? `?${qs}` : ''}`;
}

export function currentRoute() {
  return parseHash();
}

export function startRouter({ onRoute } = {}) {
  const handle = async () => {
    const { route, params } = parseHash();
    const meta = ROUTES[route] || ROUTES.dashboard;

    // Update sidebar active state
    document.querySelectorAll('.nav-item').forEach((a) => {
      a.removeAttribute('aria-current');
      if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    });

    // Update breadcrumbs + title
    const titleEl = document.getElementById('pageTitle');
    const crumbsEl = document.getElementById('breadcrumbs');
    if (titleEl) titleEl.textContent = meta.title;
    if (crumbsEl) {
      const ol = crumbsEl.querySelector('ol');
      ol.innerHTML = '';
      const home = document.createElement('li');
      const homeA = document.createElement('a');
      homeA.href = '#/dashboard';
      homeA.textContent = 'StockVault';
      home.appendChild(homeA);
      ol.appendChild(home);

      meta.crumbs.forEach((label, idx) => {
        const li = document.createElement('li');
        if (idx === meta.crumbs.length - 1) {
          li.setAttribute('aria-current', 'page');
          li.textContent = label;
        } else {
          li.textContent = label;
        }
        ol.appendChild(li);
      });
    }

    // Close mobile drawer
    document.getElementById('appShell')?.classList.remove('is-drawer-open');
    document.getElementById('sidebarOverlay')?.setAttribute('hidden', '');

    const container = document.getElementById('view');
    if (container) container.replaceChildren();

    const renderer = VIEW_RENDERERS.get(route);
    if (renderer && container) {
      try {
        await renderer(container, params);
      } catch (err) {
        console.error('[router] view render failed', err);
        container.innerHTML = `<div class="empty"><p class="empty__title">Something went wrong</p><p class="empty__text">${String(err.message || err)}</p></div>`;
      }
    } else if (container) {
      container.innerHTML = `<div class="empty">
        <div class="empty__icon">…</div>
        <p class="empty__title">${meta.title}</p>
        <p class="empty__text">This view arrives in a later phase.</p>
      </div>`;
    }

    onRoute?.({ route, params });
  };

  window.addEventListener('hashchange', handle);
  if (!location.hash) location.hash = '#/dashboard';
  else handle();
}