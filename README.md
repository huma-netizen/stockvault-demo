# StockVault

**Your inventory. Your device. Your control.**

An offline-first inventory management PWA with a premium 3D neumorphic interface. Built as a single-page static site that works without a backend, cloud account, or subscription. All data is stored locally in the browser's IndexedDB.

---

## Features

- **Local-first persistence** — all records live in IndexedDB, no server required.
- **Installable PWA** — add to home screen on desktop and mobile; works fully offline after first load.
- **3D neumorphic UI** — light and dark themes, eight accent presets plus custom color picker.
- **Multi-language** — English, Arabic, Urdu, Persian, Spanish, Hindi, Chinese, Japanese, Korean.
- **Products, categories, suppliers** — full CRUD with search, filter, sort, and pagination.
- **Stock movement ledger** — every quantity change is recorded with reason, reference, and previous/new balance.
- **Purchase orders** — create, edit, receive (full or partial), print.
- **Low-stock alerts** — dynamic thresholds per product, reorder suggestions, estimated restock cost.
- **CSV import/export** — template download, column mapping, validation, error reporting, formula-injection mitigation.
- **Backup & restore** — full JSON snapshot with atomic restore and schema versioning.
- **Reports & printing** — eight reports with date-range filters, CSV export, and a dedicated print stylesheet.

---

## Requirements

- A modern browser with IndexedDB support and ES modules. Chrome, Edge, Firefox, Safari, and their mobile equivalents all work.
- For **PWA installation and offline caching**, the app must be served over **HTTP with a proper origin** (localhost is fine) or **HTTPS**. Opening `index.html` directly with `file://` will not activate the service worker, will break ES module imports, and will disable IndexedDB in some browsers.
- No build step. No Node.js. No package manager. Just static files.

---

## Running locally

Because the app uses ES modules and a service worker, you need a local HTTP server. Pick one:

**Python 3:**
```bash
cd stockvault
python3 -m http.server 8080
# Then open http://localhost:8080/
```

**Node.js (npx):**
```bash
cd stockvault
npx serve -l 8080
# Then open http://localhost:8080/
```

**VS Code Live Server extension:**
Right-click `index.html` → "Open with Live Server".

**PHP:**
```bash
cd stockvault
php -S localhost:8080
```

Once running, open the URL in a browser. On first load, the app will show the onboarding wizard. Choose **Load sample data** if you want a demo inventory to explore, or **Start empty** for a clean slate.

---

## Installing as a PWA

Once loaded over HTTP or HTTPS:

- **Chrome / Edge (desktop):** an install icon appears in the address bar. Click it → "Install".
- **Chrome (Android):** menu → "Add to Home screen".
- **Safari (iOS):** Share → "Add to Home Screen".
- **Firefox:** does not support PWA installation, but the app works fine offline after first load.

After installation, the app launches in a standalone window with its own icon, and works entirely offline.

---

## Deploying to HTTPS

Any static host works. Upload the entire `stockvault/` folder. Suggested hosts:

- **Netlify** — drag-and-drop the folder at `app.netlify.com/drop`. The included `_headers` file sets correct cache headers.
- **Cloudflare Pages** — connect a repo or upload via the dashboard. `_headers` is honored.
- **GitHub Pages** — push to a repo, enable Pages in Settings. Rename `_headers` to `.nojekyll` handling is not needed; you may skip the headers file if you don't care about caching.
- **Vercel** — `vercel --prod` from the folder. Configure `vercel.json` if you want custom headers.
- **Traditional hosting** (cPanel, Plesk, etc.) — upload via FTP. The included `.htaccess` sets correct headers on Apache.

**The service worker requires HTTPS.** On HTTP, it only activates on `localhost`. If you deploy on a host that serves over HTTP only, the app will still work but won't be installable or offline-capable.

---

## Packaging for Codester

1. Test everything locally first: `python3 -m http.server 8080` and click through every page.
2. Replace the placeholder business name in `js/settings.js` defaults if you want a different initial value.
3. Regenerate `assets/icons/icon-192.png`, `icon-512.png`, and `icon-maskable-512.png` from `favicon.svg` if you want custom branding.
4. Review `manifest.json` — update `name`, `short_name`, `description` if needed.
5. Update `README.md` with your own support URL and any license notes.
6. Zip the entire `stockvault/` folder (excluding any `.git/` folder and OS-generated files like `.DS_Store`).
7. Upload the zip to Codester with:
   - A short description (2–3 sentences).
   - 5–8 screenshots showing: dashboard, products list, product form, stock adjustment modal, purchase order, low-stock alerts, reports, settings (with theme picker visible).
   - A features list matching the **Features** section above.
   - Support contact information.
8. In the Codester item description, mention:
   - **No build step required** — it's pure HTML/CSS/JS.
   - **No backend, no API keys, no subscriptions** — everything runs locally.
   - **Installable PWA** — works offline after first load.
   - **9 languages included**.
   - **Works on any static host** — Netlify, Cloudflare Pages, GitHub Pages, or any traditional web host.

---

## Testing checklist

Before shipping, walk through this list. Each item should pass.

**Database & persistence**
- [ ] First launch initializes IndexedDB.
- [ ] Onboarding wizard completes and saves settings.
- [ ] A product can be created and remains after page reload.
- [ ] A product remains after closing and reopening the browser.
- [ ] Duplicate SKU is rejected with a clear error.
- [ ] Editing a product updates the record correctly.
- [ ] Stock-in increases quantity and creates a movement.
- [ ] Stock-out decreases quantity and creates a movement.
- [ ] Overselling is rejected (unless negative stock is enabled).
- [ ] Stock movements appear in the ledger with correct previous/new balance.

**Inventory workflows**
- [ ] Low-stock alerts update automatically after a stock change.
- [ ] Supplier records persist.
- [ ] Purchase orders can be created with line items.
- [ ] Partial receiving updates stock once and marks the PO as partially received.
- [ ] Full receiving marks the PO as received.

**CSV, backup, reports**
- [ ] CSV export produces a valid, correctly escaped file.
- [ ] CSV import validates rows and reports errors with line numbers.
- [ ] Full backup and restore preserve relationships between records.
- [ ] Cancelled restore leaves existing records untouched.
- [ ] Reports render and print correctly (no sidebar, no buttons in print).

**Themes & languages**
- [ ] Theme preference (light / dark / system) persists across reload.
- [ ] Accent color persists across reload.
- [ ] Language preference persists across reload.
- [ ] RTL languages (Arabic, Urdu, Persian) flip the layout correctly.
- [ ] All nine languages render the shell without missing keys.

**PWA & offline**
- [ ] The app shell loads offline after caching.
- [ ] PWA installation metadata is valid (DevTools → Application → Manifest shows no errors).
- [ ] Existing data survives a service worker update.
- [ ] All navigation links and buttons work.
- [ ] The layout is usable on mobile (test at 360px and 768px).

**Error handling**
- [ ] Browser storage or database failures produce helpful errors instead of blank screens.
- [ ] Opening the console on every page shows zero red errors.

---

## File structure

```
stockvault/
├── index.html
├── manifest.json
├── service-worker.js
├── README.md
├── .htaccess              # Apache headers
├── _headers               # Netlify/Cloudflare headers
├── assets/
│   ├── icons/
│   │   ├── favicon.svg
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   └── icon-maskable-512.png
│   └── images/
├── css/
│   ├── variables.css
│   ├── base.css
│   ├── neumorphism.css
│   ├── layout.css
│   ├── components.css
│   ├── tables.css
│   ├── forms.css
│   ├── dashboard.css
│   └── responsive.css
└── js/
    ├── app.js
    ├── router.js
    ├── ui.js
    ├── database.js
    ├── repositories.js
    ├── settings.js
    ├── notifications.js
    ├── csv.js
    ├── backup.js
    ├── theme.js
    ├── i18n.js
    ├── locales/
    │   ├── en.json
    │   ├── ar.json
    │   ├── ur.json
    │   ├── fa.json
    │   ├── es.json
    │   ├── hi.json
    │   ├── zh.json
    │   ├── ja.json
    │   └── ko.json
    └── views/
        ├── _helpers.js
        ├── onboarding.js
        ├── dashboard.js
        ├── products.js
        ├── categories.js
        ├── suppliers.js
        ├── stock.js
        ├── low-stock.js
        ├── purchases.js
        ├── reports.js
        ├── data.js
        ├── settings.js
        └── import-csv.js
```

---

## Browser storage limitations

StockVault stores your data in the browser's IndexedDB, which is **persistent but not a security boundary**:

- Clearing site data, uninstalling the browser, or losing the device will destroy unbacked-up data.
- IndexedDB is not encrypted by default. Anyone with access to the device and the browser profile can read it.
- The browser may evict data under storage pressure if your site is not installed as a PWA and does not request persistent storage.

To protect your data:

1. **Export a backup regularly** from Data Management.
2. **Install StockVault as a PWA** so the browser grants persistent storage in most cases.
3. **Keep a backup file off-device** (external drive, cloud storage, or email).

StockVault is designed as a single-device local inventory tool, not a multi-user or synchronized enterprise platform.

---

## License

Distributed with the Codester package. See the license file included with your purchase.

---

## Support

For questions or issues, contact the developer using the support information provided with your Codester purchase.