/* =========================================================
   StockVault — Theme color manager
   Changes only the accent hue. Surfaces, text, and shadows
   stay as designed. Persists choice to localStorage.
   ========================================================= */

const STORAGE_KEY = 'stockvault:accent';

/* ---------- Presets ---------- */
/* Each preset provides --accent and --accent-strong.
   All other accent-derived tokens are computed at runtime. */

export const THEMES = Object.freeze([
  { key: 'indigo',  label: 'Indigo',  accent: '#5865F2', strong: '#4B57D6' },
  { key: 'emerald', label: 'Emerald', accent: '#278B68', strong: '#1F7355' },
  { key: 'rose',    label: 'Rose',    accent: '#D94F77', strong: '#BE3F63' },
  { key: 'amber',   label: 'Amber',   accent: '#D99126', strong: '#B8781C' },
  { key: 'ocean',   label: 'Ocean',   accent: '#3484D8', strong: '#2869B1' },
  { key: 'violet',  label: 'Violet',  accent: '#9A4FD9', strong: '#7E3EB5' },
  { key: 'slate',   label: 'Slate',   accent: '#5B6B85', strong: '#48566B' },
  { key: 'crimson', label: 'Crimson', accent: '#C43F4B', strong: '#A3333D' },
]);

/* ---------- Current state ---------- */
let current = { kind: 'preset', key: 'indigo', accent: '#5865F2', strong: '#4B57D6' };

/* ---------- Utilities ---------- */

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function darken(hex, amount = 0.12) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const f = 1 - amount;
  const r = Math.max(0, Math.round(rgb.r * f));
  const g = Math.max(0, Math.round(rgb.g * f));
  const b = Math.max(0, Math.round(rgb.b * f));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/* ---------- Apply ---------- */

function applyAccentVariables(accent, strong) {
  const rootEl = document.documentElement;
  rootEl.style.setProperty('--accent', accent);
  rootEl.style.setProperty('--accent-strong', strong || darken(accent));
  // Soft is derived — a translucent version of the accent.
  const rgb = hexToRgb(accent);
  if (rgb) {
    rootEl.style.setProperty('--accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
  }
}

/* =========================================================
   PUBLIC API
   ========================================================= */

/**
 * Apply a preset theme by key.
 */
export function applyThemePreset(key) {
  const preset = THEMES.find((t) => t.key === key) || THEMES[0];
  current = { kind: 'preset', key: preset.key, accent: preset.accent, strong: preset.strong };
  applyAccentVariables(preset.accent, preset.strong);
  persist();
  return current;
}

/**
 * Apply a custom accent color (any hex string like "#FF6B35").
 */
export function applyThemeCustom(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return current;
  const normalized = `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  current = { kind: 'custom', key: 'custom', accent: normalized, strong: darken(normalized) };
  applyAccentVariables(current.accent, current.strong);
  persist();
  return current;
}

/**
 * Restore the persisted theme, or the default if none was saved.
 * Called once during boot.
 */
export function loadTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      applyThemePreset('indigo');
      return current;
    }
    const saved = JSON.parse(raw);
    if (saved.kind === 'custom' && saved.accent) return applyThemeCustom(saved.accent);
    if (saved.kind === 'preset' && saved.key)   return applyThemePreset(saved.key);
  } catch {}
  return applyThemePreset('indigo');
}

export function getTheme() {
  return { ...current };
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch {}
}