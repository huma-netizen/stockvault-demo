/* =========================================================
   StockVault — Backup & restore
   ========================================================= */

import { STORES, withTransaction, requestToPromise, DB_VERSION } from './database.js';

export const BACKUP_SCHEMA_VERSION = 1;
export const APP_VERSION = '1.0.0';

export async function createBackup() {
  const stores = Object.values(STORES);
  const data = {};
  await withTransaction(stores, async (handles) => {
    for (const name of stores) {
      data[name] = await requestToPromise(handles[name].getAll());
    }
    return true;
  });
  return {
    app: 'StockVault',
    appVersion: APP_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    dbVersion: DB_VERSION,
    createdAt: Date.now(),
    counts: Object.fromEntries(stores.map((s) => [s, data[s].length])),
    data,
  };
}

export function validateBackup(parsed) {
  const issues = [];
  const warnings = [];
  if (!parsed || typeof parsed !== 'object') {
    issues.push('File is not a JSON object.');
    return { ok: false, issues, warnings, summary: null };
  }
  if (parsed.app !== 'StockVault') issues.push('This file does not appear to be a StockVault backup.');
  if (typeof parsed.schemaVersion !== 'number') issues.push('Missing schema version.');
  else if (parsed.schemaVersion > BACKUP_SCHEMA_VERSION) issues.push(`Backup schema v${parsed.schemaVersion} is newer than this app supports.`);
  if (!parsed.data || typeof parsed.data !== 'object') issues.push('Missing data section.');

  const summary = {};
  if (parsed.data && typeof parsed.data === 'object') {
    for (const name of Object.values(STORES)) {
      const rows = parsed.data[name];
      if (rows == null) { warnings.push(`Store "${name}" is missing.`); summary[name] = 0; continue; }
      if (!Array.isArray(rows)) { issues.push(`Store "${name}" is not an array.`); continue; }
      summary[name] = rows.length;
    }
  }
  return { ok: issues.length === 0, issues, warnings, summary };
}

export async function restoreBackup(parsed) {
  const validation = validateBackup(parsed);
  if (!validation.ok) throw new Error(validation.issues.join(' '));
  const stores = Object.values(STORES);
  await withTransaction(stores, async (handles) => {
    for (const name of stores) {
      const store = handles[name];
      await requestToPromise(store.clear());
      const rows = parsed.data[name] || [];
      for (const row of rows) {
        await requestToPromise(store.put(row));
      }
    }
    return true;
  });
  return {
    restoredAt: Date.now(),
    counts: Object.fromEntries(stores.map((s) => [s, (parsed.data[s] || []).length])),
  };
}

export function suggestBackupFilename() {
  const d = new Date();
  const stamp = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  return `stockvault-backup-${stamp}.json`;
}

export async function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result))); }
      catch { reject(new Error('File is not valid JSON.')); }
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsText(file);
  });
}