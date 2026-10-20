/* =========================================================
   StockVault — CSV utilities
   ========================================================= */

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

export function parseCsv(text) {
  if (typeof text !== 'string') return [];
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { if (field === '') { inQuotes = true; i++; continue; } field += ch; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') {
      row.push(field); rows.push(row); row = []; field = '';
      if (text[i + 1] === '\n') i += 2; else i++;
      continue;
    }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function parseCsvWithHeader(text) {
  const raw = parseCsv(text);
  if (!raw.length) return { headers: [], rows: [] };
  const headers = raw[0].map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const cells = raw[i];
    if (cells.length === 1 && cells[0] === '') continue;
    const obj = { _line: i + 1 };
    headers.forEach((h, idx) => { obj[h] = cells[idx] ?? ''; });
    rows.push(obj);
  }
  return { headers, rows };
}

function escapeCell(value, mitigate) {
  let s = value == null ? '' : String(value);
  if (mitigate && s.length && FORMULA_TRIGGERS.includes(s[0])) s = "'" + s;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function serializeCsv(rows, { columns = null, mitigateFormulas = true } = {}) {
  if (!rows.length && (!columns || !columns.length)) return '';
  const body = columns ? [columns, ...rows] : rows;
  const width = body.reduce((m, r) => Math.max(m, r.length), 0);
  return body.map((row) => {
    const cells = [];
    for (let i = 0; i < width; i++) cells.push(escapeCell(row[i], mitigateFormulas));
    return cells.join(',');
  }).join('\r\n');
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

export function downloadJson(filename, object) {
  const blob = new Blob([JSON.stringify(object, null, 2)], { type: 'application/json;charset=utf-8;' });
  triggerDownload(blob, filename);
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  triggerDownload(blob, filename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(filename);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function safeFilename(name) {
  return String(name || 'export')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ').trim().slice(0, 180) || 'export';
}

export const PRODUCT_IMPORT_HEADERS = [
  'name', 'sku', 'barcode', 'description', 'category', 'supplier',
  'brand', 'cost', 'price', 'quantity', 'lowStockThreshold', 'unit', 'location',
];

export function downloadProductTemplate() {
  const sample = [
    PRODUCT_IMPORT_HEADERS,
    ['Claw Hammer 16oz', 'TL-HAM-16', '', 'Steel head', 'Tools', 'Ridgeway Tools', 'Ridgeway', '6.20', '14.99', '24', '5', 'pcs', 'A1-01'],
  ];
  downloadCsv('stockvault-product-template.csv', serializeCsv(sample, { mitigateFormulas: false }));
}

export function validateProductImport(rows, mapping) {
  const valid = [], errors = [], seenSkus = new Set();
  for (const raw of rows) {
    const record = { _line: raw._line, _raw: raw };
    for (const [csvCol, productField] of Object.entries(mapping)) {
      if (!productField) continue;
      record[productField] = (raw[csvCol] ?? '').toString().trim();
    }
    const line = raw._line;
    if (!record.name) errors.push({ _line: line, field: 'name', message: 'Product name is required.' });
    if (!record.sku) errors.push({ _line: line, field: 'sku', message: 'SKU is required.' });
    if (record.sku) {
      const sku = record.sku.toUpperCase();
      if (seenSkus.has(sku)) errors.push({ _line: line, field: 'sku', message: `Duplicate SKU in file: ${record.sku}` });
      seenSkus.add(sku);
    }
    for (const f of ['cost', 'price', 'quantity', 'lowStockThreshold']) {
      const v = record[f];
      if (v == null || v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n)) errors.push({ _line: line, field: f, message: `Invalid number: "${v}"` });
      else if (n < 0) errors.push({ _line: line, field: f, message: 'Cannot be negative.' });
    }
    if (!errors.find((e) => e._line === line)) valid.push(record);
  }
  return { valid, errors };
}