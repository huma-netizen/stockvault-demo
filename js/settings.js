/* =========================================================
   StockVault — Settings facade
   Two tiers:
     1) localStorage   — tiny UI prefs (theme, sidebar state, last route)
     2) settings store — business config (currency, thresholds, policies)

   The settings store is authoritative. localStorage is used only
   for state that must be readable before the DB opens.
   ========================================================= */

import { settingsRepo } from './repositories.js';
import { openDatabase } from './database.js';

const LS_PREFIX = 'stockvault:';

/* ---------- localStorage helpers ---------- */

export const localPrefs = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(LS_PREFIX + key); } catch {}
  },
};

/* ---------- Defaults ---------- */

export const DEFAULT_SETTINGS = Object.freeze({
  businessName:         'Your Business',
  currency:             'USD',
  locale:               'en-US',
  defaultLowStock:      5,
  allowNegativeStock:   false,
  zeroThresholdBehavior:'in_stock',   // 'in_stock' | 'low_stock'
  onboardingComplete:   false,
  sampleDataLoaded:     false,
  schemaVersion:        1,
  lastBackupAt:         null,
});

/* ---------- In-memory cache ---------- */

let cache = null;

export async function loadSettings() {
  if (cache) return { ...cache };
  await openDatabase();                // ensure DB exists before reading
  const stored = await settingsRepo.all();
  cache = { ...DEFAULT_SETTINGS, ...stored };
  return { ...cache };
}

export async function getSetting(key) {
  if (!cache) await loadSettings();
  return cache[key];
}

export async function setSetting(key, value) {
  if (!cache) await loadSettings();
  cache[key] = value;
  await settingsRepo.set(key, value);
  return value;
}

export async function setSettings(patch) {
  if (!cache) await loadSettings();
  const next = { ...cache, ...patch };
  for (const [k, v] of Object.entries(patch)) {
    await settingsRepo.set(k, v);
  }
  cache = next;
  return { ...cache };
}

export function settingsSnapshot() {
  return cache ? { ...cache } : null;
}

/**
 * Update the tiny UI pref used by the shell to reflect the business name
 * immediately after onboarding or a settings save.
 */
export function reflectBusinessName(name) {
  const el = document.getElementById('businessName');
  if (el) el.textContent = name || 'Your Business';
}

/* ---------- Reset (used by Data Management) ---------- */

export async function resetSettingsToDefaults() {
  cache = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await settingsRepo.set(k, v);
  }
  return { ...cache };
}