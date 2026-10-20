/* =========================================================
   StockVault — Data Management
   Local database status, backup, restore, and clear-all.
   All user-visible strings translated via t().
   ========================================================= */

import {
  el, openModal, confirmDialog, toast, formatNumber, formatDateTime,
} from '../ui.js';
import { getDatabaseInfo, estimateStorage, destroyAllData } from '../database.js';
import { loadSettings, setSetting } from '../settings.js';
import {
  createBackup, validateBackup, restoreBackup,
  readJsonFile, suggestBackupFilename,
} from '../backup.js';
import { downloadJson } from '../csv.js';
import { loadSampleData } from './onboarding.js';
import { refreshBadges } from '../notifications.js';
import { t } from '../i18n.js';

export async function renderDataManagement(container) {
  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  root.appendChild(el('div', { class: 'dash-hero' }, [
    el('div', {}, [
      el('h2', {}, t('data.title')),
      el('p', {}, t('data.subtitle')),
    ]),
  ]));

  const statusHost = el('div');
  root.appendChild(statusHost);

  async function refreshStatus() {
    const info = await getDatabaseInfo();
    const storage = await estimateStorage();
    const settings = await loadSettings();
    const usageText = storage
      ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}`
      : '—';

    statusHost.replaceChildren(
      el('div', { class: 'dash-analytics' }, [
        card(t('data.localDatabase'), [
          kv(t('settings.title'), info.name),
          kv(t('reports.report') + ' v', `v${info.version}`),
          kv(t('settings.businessName'), usageText),
        ]),
        card(t('data.recordCounts'),
          Object.entries(info.counts).map(([store, n]) => kv(store, formatNumber(n)))),
      ]),

      card(t('data.backupRestore'), [
        el('p', { style: { color: 'var(--text-secondary)' } }, t('data.backupDescription')),
        el('div', { class: 'row row--wrap' }, [
          el('button', {
            class: 'btn btn--primary',
            onclick: onExportBackup,
          }, t('data.exportBackup')),
          el('button', {
            class: 'btn',
            onclick: onImportBackup,
          }, t('data.restoreBackup')),
        ]),
        el('p', { class: 'field__hint' },
          t('data.lastBackup', {
            datetime: settings.lastBackupAt
              ? formatDateTime(settings.lastBackupAt)
              : t('data.never'),
          })),
      ]),

      card(t('data.sampleData'), [
        el('p', { style: { color: 'var(--text-secondary)' } }, t('data.sampleDataDescription')),
        el('button', {
          class: 'btn',
          onclick: async () => {
            try {
              await loadSampleData({ defaultLowStock: settings.defaultLowStock });
              toast(t('data.sampleLoaded'), { type: 'success' });
              refreshBadges();
            } catch (err) {
              toast(err.message, { type: 'danger' });
            }
          },
        }, t('data.loadSampleData')),
      ]),

      card(t('data.dangerZone'), [
        el('p', { style: { color: 'var(--text-secondary)' } }, t('data.dangerDescription')),
        el('button', {
          class: 'btn btn--danger',
          onclick: async () => {
            const ok = await confirmDialog({
              title: t('data.clearTitle'),
              message: t('data.clearMessage'),
              confirmLabel: t('data.clearConfirm'),
              cancelLabel: t('common.cancel'),
              danger: true,
            });
            if (!ok) return;
            try {
              await destroyAllData();
              toast(t('data.clearedToast'), { type: 'success' });
              setTimeout(() => location.reload(), 600);
            } catch (err) {
              toast(err.message, { type: 'danger' });
            }
          },
        }, t('data.clearAll')),
      ]),
    );
  }

  async function onExportBackup() {
    try {
      const backup = await createBackup();
      downloadJson(suggestBackupFilename(), backup);
      await setSetting('lastBackupAt', Date.now());
      toast(t('data.exportBackup'), { type: 'success' });
      refreshStatus();
    } catch (err) {
      toast(err.message || t('errors.generic'), { type: 'danger' });
    }
  }

  async function onImportBackup() {
    const input = el('input', {
      class: 'input',
      type: 'file',
      accept: '.json,application/json',
    });

    const body = el('div', { class: 'stack' }, [
      el('p', { style: { color: 'var(--text-secondary)' } }, t('data.restoreConfirmMessage')),
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('data.restoreFileLabel')),
        input,
      ]),
    ]);

    const { close } = openModal({
      title: t('data.restoreTitle'),
      size: 'modal--sm',
      body,
      footer: [
        el('button', { class: 'btn btn--ghost', onclick: () => close() }, t('common.cancel')),
        el('button', {
          class: 'btn btn--primary',
          onclick: async () => {
            const file = input.files?.[0];
            if (!file) { toast(t('data.chooseFile'), { type: 'info' }); return; }
            try {
              const parsed = await readJsonFile(file);
              const validation = validateBackup(parsed);
              close();
              showRestoreConfirm(parsed, validation);
            } catch (err) {
              toast(err.message || t('errors.generic'), { type: 'danger' });
            }
          },
        }, t('data.restoreContinue')),
      ],
    });
  }

  function showRestoreConfirm(parsed, validation) {
    const body = el('div', { class: 'stack' }, [
      el('p', {
        style: { color: validation.ok ? 'var(--success)' : 'var(--danger)' },
      }, validation.ok
        ? t('data.restoreValid')
        : `${t('data.restoreInvalid')}: ${validation.issues.join(' ')}`),
      el('p', { style: { color: 'var(--text-secondary)' } }, t('data.restoreConfirmMessage')),
    ]);

    const { close } = openModal({
      title: t('data.restoreConfirmTitle'),
      body,
      footer: [
        el('button', { class: 'btn btn--ghost', onclick: () => close() }, t('common.cancel')),
        el('button', {
          class: 'btn btn--danger',
          disabled: !validation.ok,
          onclick: async () => {
            try {
              await restoreBackup(parsed);
              toast(t('data.restoreToast'), { type: 'success' });
              close();
              setTimeout(() => location.reload(), 600);
            } catch (err) {
              toast(err.message || t('errors.generic'), { type: 'danger' });
            }
          },
        }, t('data.restoreRestore')),
      ],
    });
  }

  await refreshStatus();
}

function formatBytes(n) {
  if (!n || n < 1) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function card(title, children) {
  return el('section', { class: 'card' }, [
    el('header', { class: 'card__header' },
      el('div', { class: 'card__title' }, title)),
    el('div', { class: 'stack' }, children),
  ]);
}

function kv(label, value) {
  return el('div', {
    class: 'row row--between',
    style: { padding: '6px 0', borderBottom: '1px solid var(--divider)' },
  }, [
    el('span', { style: { color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' } }, label),
    el('span', {}, value),
  ]);
}