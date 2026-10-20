/* =========================================================
   StockVault — Settings
   Business name, currency, thresholds, stock policy,
   theme mode, accent color, language.
   All user-visible strings translated via t().
   ========================================================= */

import { el, confirmDialog, toast } from '../ui.js';
import { loadSettings, setSettings, reflectBusinessName, resetSettingsToDefaults } from '../settings.js';
import { refreshBadges } from '../notifications.js';
import { THEMES, applyThemePreset, applyThemeCustom, getTheme } from '../theme.js';
import { LANGUAGES, setLanguage, getLanguage } from '../i18n.js';
import { t } from '../i18n.js';

const THEME_KEY = 'stockvault:theme';

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar ($)' },
  { value: 'EUR', label: 'EUR — Euro (€)' },
  { value: 'GBP', label: 'GBP — British Pound (£)' },
  { value: 'CAD', label: 'CAD — Canadian Dollar ($)' },
  { value: 'AUD', label: 'AUD — Australian Dollar ($)' },
  { value: 'JPY', label: 'JPY — Japanese Yen (¥)' },
  { value: 'INR', label: 'INR — Indian Rupee (₹)' },
  { value: 'PKR', label: 'PKR — Pakistani Rupee (₨)' },
  { value: 'BRL', label: 'BRL — Brazilian Real (R$)' },
  { value: 'ZAR', label: 'ZAR — South African Rand (R)' },
  { value: 'NGN', label: 'NGN — Nigerian Naira (₦)' },
  { value: 'AED', label: 'AED — UAE Dirham (د.إ)' },
];

export async function renderSettings(container) {
  const settings = await loadSettings();

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  root.appendChild(el('div', { class: 'dash-hero' }, [
    el('div', {}, [
      el('h2', {}, t('settings.title')),
      el('p', {}, t('settings.subtitle')),
    ]),
  ]));

  const form = el('form', { class: 'form' });

  /* ---------- Business ---------- */
  form.appendChild(el('div', { class: 'form-section' }, [
    el('div', { class: 'form-section__title' }, t('settings.businessSection')),
    el('div', { class: 'form-grid' }, [
      textField('businessName', t('settings.businessName'), settings.businessName),
      selectField('currency', t('settings.currency'), settings.currency,
        CURRENCIES.map((c) => ({ value: c.value, label: c.label }))),
    ]),
  ]));

  /* ---------- Stock policy ---------- */
  const zeroBehavior = el('select', { class: 'select', name: 'zeroThresholdBehavior' }, [
    el('option', { value: 'in_stock' }, t('settings.zeroInStock')),
    el('option', { value: 'low_stock' }, t('settings.zeroLowStock')),
  ]);
  zeroBehavior.value = settings.zeroThresholdBehavior;

  const allowNegative = el('input', { type: 'checkbox', name: 'allowNegativeStock' });
  allowNegative.checked = Boolean(settings.allowNegativeStock);

  form.appendChild(el('div', { class: 'form-section' }, [
    el('div', { class: 'form-section__title' }, t('settings.stockPolicySection')),
    el('div', { class: 'form-grid' }, [
      numberField('defaultLowStock', t('settings.defaultLowStock'), settings.defaultLowStock, t('settings.defaultLowStockHint')),
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('settings.zeroThreshold')),
        zeroBehavior,
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'switch' }, [
        allowNegative,
        el('span', { class: 'switch__track' }, el('span', { class: 'switch__thumb' })),
        el('span', {}, t('settings.allowNegative')),
      ]),
    ]),
  ]));

  /* ---------- Appearance ---------- */
  const themeSel = el('select', { class: 'select', name: 'theme' }, [
    el('option', { value: 'light' }, t('settings.themeLight')),
    el('option', { value: 'dark' }, t('settings.themeDark')),
    el('option', { value: 'system' }, t('settings.themeSystem')),
  ]);
  themeSel.value = localStorage.getItem(THEME_KEY) || 'system';

  form.appendChild(el('div', { class: 'form-section' }, [
    el('div', { class: 'form-section__title' }, t('settings.appearanceSection')),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('settings.themeMode')),
        themeSel,
      ]),
    ]),
  ]));

  /* ---------- Accent color ---------- */
  const themeState = getTheme();
  const swatchGrid = el('div', {
    style: { display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap', marginBottom: 'var(--s-4)' },
  });

  THEMES.forEach((preset) => {
    const isActive = themeState.kind === 'preset' && themeState.key === preset.key;
    const swatch = el('button', {
      type: 'button',
      title: preset.label,
      'aria-label': preset.label,
      'aria-pressed': isActive ? 'true' : 'false',
      style: {
        width: '42px',
        height: '42px',
        borderRadius: '50%',
        background: preset.accent,
        border: '3px solid var(--surface-raised)',
        boxShadow: isActive ? 'var(--shadow-pressed), 0 0 0 3px ' + preset.accent : 'var(--shadow-raised-sm)',
        cursor: 'pointer',
        transition: 'box-shadow 140ms var(--ease-out)',
      },
    });
    swatch.addEventListener('click', () => {
      applyThemePreset(preset.key);
      renderThemeSwatches();
    });
    swatch.dataset.themeKey = preset.key;
    swatchGrid.appendChild(swatch);
  });

  const customInput = el('input', {
    type: 'color',
    value: themeState.kind === 'custom' ? themeState.accent : '#5865F2',
  });
  customInput.style.cssText = 'width: 60px; height: 42px; border: 0; border-radius: var(--r-md); background: var(--surface-inset); box-shadow: var(--shadow-inset-sm); cursor: pointer;';
  customInput.addEventListener('input', () => {
    applyThemeCustom(customInput.value);
    renderThemeSwatches();
  });

  form.appendChild(el('div', { class: 'form-section' }, [
    el('div', { class: 'form-section__title' }, t('settings.accentColor')),
    swatchGrid,
    el('div', { class: 'row', style: { alignItems: 'center', gap: 'var(--s-3)' } }, [
      customInput,
      el('span', { style: { color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' } }, t('settings.accentCustom')),
    ]),
  ]));

  function renderThemeSwatches() {
    const active = getTheme();
    swatchGrid.querySelectorAll('button[data-theme-key]').forEach((b) => {
      const isOn = active.kind === 'preset' && active.key === b.dataset.themeKey;
      b.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      b.style.boxShadow = isOn
        ? 'var(--shadow-pressed), 0 0 0 3px ' + b.style.background
        : 'var(--shadow-raised-sm)';
    });
  }

  /* ---------- Language ---------- */
  const langSel = el('select', { class: 'select', name: 'language' });
  for (const l of LANGUAGES) {
    const o = el('option', { value: l.code }, l.label);
    if (l.code === getLanguage()) o.selected = true;
    langSel.appendChild(o);
  }
  langSel.addEventListener('change', async () => {
    await setLanguage(langSel.value);
    toast(t('settings.savedToast'), { type: 'success' });
  });

  form.appendChild(el('div', { class: 'form-section' }, [
    el('div', { class: 'form-section__title' }, t('settings.language')),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('settings.language')),
        langSel,
        el('span', { class: 'field__hint' }, t('settings.languageHint')),
      ]),
    ]),
  ]));

  /* ---------- Actions ---------- */
  form.appendChild(el('div', { class: 'form-actions' }, [
    el('button', { class: 'btn btn--primary', type: 'submit' }, t('settings.saveChanges')),
  ]));

  root.appendChild(el('section', { class: 'card' }, form));

  /* ---------- Danger zone ---------- */
  root.appendChild(el('section', { class: 'card' }, [
    el('header', { class: 'card__header' },
      el('div', { class: 'card__title' }, t('settings.resetSection'))),
    el('p', { style: { color: 'var(--text-secondary)' } }, t('settings.resetDescription')),
    el('button', {
      class: 'btn btn--danger',
      onclick: async () => {
        const ok = await confirmDialog({
          title: t('settings.resetConfirmTitle'),
          message: t('settings.resetConfirmMessage'),
          confirmLabel: t('settings.resetConfirmAction'),
          cancelLabel: t('common.cancel'),
          danger: true,
        });
        if (!ok) return;
        await resetSettingsToDefaults();
        localStorage.removeItem(THEME_KEY);
        toast(t('settings.resetToast'), { type: 'success' });
        setTimeout(() => location.reload(), 500);
      },
    }, t('settings.resetButton')),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await setSettings({
        businessName: form.querySelector('[name="businessName"]').value.trim() || t('profile.defaultName'),
        currency: form.querySelector('[name="currency"]').value,
        defaultLowStock: Math.max(0, Math.floor(Number(form.querySelector('[name="defaultLowStock"]').value) || 0)),
        allowNegativeStock: form.querySelector('[name="allowNegativeStock"]').checked,
        zeroThresholdBehavior: form.querySelector('[name="zeroThresholdBehavior"]').value,
      });

      const theme = form.querySelector('[name="theme"]').value;
      if (theme === 'system') {
        localStorage.removeItem(THEME_KEY);
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        localStorage.setItem(THEME_KEY, theme);
        document.documentElement.setAttribute('data-theme', theme);
      }

      reflectBusinessName(form.querySelector('[name="businessName"]').value);
      await refreshBadges();
      toast(t('settings.savedToast'), { type: 'success' });
    } catch (err) {
      toast(err.message || t('errors.generic'), { type: 'danger' });
    }
  });
}

/* ---------- Field helpers ---------- */

function textField(name, label, value) {
  const input = el('input', { class: 'input', type: 'text', name, value });
  return el('div', { class: 'field' }, [
    el('label', { class: 'field__label' }, label),
    input,
  ]);
}

function numberField(name, label, value, hint) {
  const input = el('input', { class: 'input', type: 'number', name, value: String(value), min: '0', step: '1' });
  return el('div', { class: 'field' }, [
    el('label', { class: 'field__label' }, label),
    input,
    hint ? el('span', { class: 'field__hint' }, hint) : null,
  ]);
}

function selectField(name, label, value, options) {
  const sel = el('select', { class: 'select', name });
  for (const o of options) {
    const opt = el('option', { value: o.value }, o.label);
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  }
  return el('div', { class: 'field' }, [
    el('label', { class: 'field__label' }, label),
    sel,
  ]);
}