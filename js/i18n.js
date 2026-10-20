/* =========================================================
   StockVault — Internationalization
   Loads a locale JSON, exposes t() for lookups, and fires
   an event so the shell can re-render on language change.
   Falls back to English for any missing key.
   ========================================================= */

const STORAGE_KEY = 'stockvault:language';
const FALLBACK_LANG = 'en';

export const LANGUAGES = Object.freeze([
  { code: 'en', label: 'English',        dir: 'ltr' },
  { code: 'ar', label: 'العربية',         dir: 'rtl' },
  { code: 'ur', label: 'اردو',            dir: 'rtl' },
  { code: 'fa', label: 'فارسی',           dir: 'rtl' },
  { code: 'es', label: 'Español',        dir: 'ltr' },
  { code: 'hi', label: 'हिन्दी',           dir: 'ltr' },
  { code: 'zh', label: '中文（简体）',      dir: 'ltr' },
  { code: 'ja', label: '日本語',           dir: 'ltr' },
  { code: 'ko', label: '한국어',           dir: 'ltr' },
]);

let currentLang = FALLBACK_LANG;
let currentBundle = {};
let fallbackBundle = {};
let ready = false;

/* =========================================================
   LOADING
   ========================================================= */

async function fetchLocale(code) {
  // Relative to the document root, not to this module.
  const url = new URL(`./locales/${code}.json`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Locale ${code} not found (${res.status})`);
  return res.json();
}

export async function loadLanguage(code = null) {
  // 1. Load English (fallback) once.
  if (!Object.keys(fallbackBundle).length) {
    try {
      fallbackBundle = await fetchLocale(FALLBACK_LANG);
    } catch (err) {
      console.warn('[i18n] could not load English fallback:', err);
      fallbackBundle = {};
    }
  }

  // 2. Determine target language.
  const target = code
    || safeLocalStorageGet(STORAGE_KEY)
    || detectBrowserLanguage()
    || FALLBACK_LANG;

  // 3. Load target bundle (English just reuses the fallback).
  if (target === FALLBACK_LANG) {
    currentBundle = fallbackBundle;
  } else {
    try {
      currentBundle = await fetchLocale(target);
    } catch (err) {
      console.warn(`[i18n] falling back to English — could not load "${target}":`, err);
      currentBundle = fallbackBundle;
      currentLang = FALLBACK_LANG;
      ready = true;
      applyDirection(currentLang);
      return currentLang;
    }
  }

  currentLang = target;
  ready = true;
  applyDirection(currentLang);
  return currentLang;
}

/**
 * Change language at runtime. Persists the choice and fires
 * a `stockvault:language-changed` event on window.
 */
export async function setLanguage(code) {
  await loadLanguage(code);
  try { localStorage.setItem(STORAGE_KEY, currentLang); } catch {}
  window.dispatchEvent(new CustomEvent('stockvault:language-changed', {
    detail: { language: currentLang },
  }));
  return currentLang;
}

export function getLanguage() {
  return currentLang;
}

export function isReady() {
  return ready;
}

/* =========================================================
   TRANSLATION
   ========================================================= */

/**
 * Look up a translation key. Supports dot-path keys ("nav.products").
 * Supports {placeholder} interpolation.
 *
 *   t('nav.products')                          → "Products"
 *   t('greeting.hello', { name: 'Sam' })       → "Hello, Sam"
 *
 * Missing keys return the fallback bundle's value, or the key itself.
 */
export function t(key, params = null) {
  const value = resolve(currentBundle, key) ?? resolve(fallbackBundle, key) ?? key;
  if (params == null) return value;
  return String(value).replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
}

function resolve(bundle, key) {
  if (!bundle || typeof bundle !== 'object') return undefined;
  const parts = String(key).split('.');
  let node = bundle;
  for (const p of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[p];
  }
  return typeof node === 'string' ? node : undefined;
}

/* =========================================================
   HELPERS
   ========================================================= */

function safeLocalStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function detectBrowserLanguage() {
  const raw = navigator.language || navigator.userLanguage || '';
  const code = raw.toLowerCase().split('-')[0];
  return LANGUAGES.some((l) => l.code === code) ? code : null;
}

function applyDirection(code) {
  const meta = LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
  document.documentElement.setAttribute('lang', meta.code);
  document.documentElement.setAttribute('dir', meta.dir);
}