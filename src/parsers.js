const clean = (value = '') => String(value).trim().replace(/^['"]|['"]$/g, '');
const slug = (label) => clean(label).toLowerCase().replace(/[ _-]/g, '');

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && text[i + 1] === '"' && quoted) { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row.');
  const headers = rows.shift().map(slug);
  return rows.map((values, index) => Object.fromEntries(headers.map((header, i) => [header, clean(values[i])]))).map((row, index) => ({ ...row, __row: index + 2 }));
}

export function parseRulesCsv(text) {
  return parseCsv(text).map((row, index) => validateRule({
    id: row.ruleid || `RULE-${String(index + 1).padStart(2, '0')}`,
    scope: row.scope,
    appliesTo: row.appliesto,
    type: row.type,
    value: row.value,
    stackable: /^(true|yes|1)$/i.test(row.stackable),
    minCartValue: row.mincartvalue,
  }));
}

export function parseCartCsv(text) {
  return parseCsv(text).map((row, index) => validateItem({
    id: row.itemid || `ITEM-${String(index + 1).padStart(2, '0')}`,
    product: row.product, brand: row.brand, platform: row.platform, basePrice: row.baseprice,
  }));
}

const number = (value) => Number(String(value).replace(/[^0-9.]/g, ''));
export function validateRule(draft) {
  const scope = clean(draft.scope).toLowerCase();
  const type = clean(draft.type).toLowerCase();
  const value = number(draft.value);
  const minCartValue = draft.minCartValue === '' || draft.minCartValue == null ? 0 : number(draft.minCartValue);
  if (!['brand', 'platform', 'cart'].includes(scope)) throw new Error('Rule scope must be Brand, Platform, or Cart.');
  if (!['flat', 'percentage'].includes(type)) throw new Error('Rule type must be Flat or Percentage.');
  if (!Number.isFinite(value) || value <= 0 || (type === 'percentage' && value > 100)) throw new Error('Rule value must be positive (percentage cannot exceed 100).');
  if (scope !== 'cart' && !clean(draft.appliesTo)) throw new Error('Brand and Platform rules need an “applies to” value.');
  if (scope === 'cart' && (!Number.isFinite(minCartValue) || minCartValue <= 0)) throw new Error('Cart rules need a positive minimum cart value.');
  return { id: clean(draft.id) || `RULE-${Date.now()}`, scope, appliesTo: clean(draft.appliesTo), type, value, stackable: Boolean(draft.stackable), minCartValue };
}

export function validateItem(item) {
  const basePrice = number(item.basePrice);
  if (![item.product, item.brand, item.platform].every((value) => clean(value)) || !Number.isFinite(basePrice) || basePrice < 0) throw new Error(`Malformed cart row ${item.__row || ''}: product, brand, platform, and base price are required.`);
  return { id: clean(item.id), product: clean(item.product), brand: clean(item.brand), platform: clean(item.platform), basePrice };
}

export function parseRuleText(input) {
  const text = input.trim();
  const percent = text.match(/(\d+(?:\.\d+)?)\s*%/i);
  const flat = text.match(/(?:rs\.?|₹|inr)\s*(\d+(?:\.\d+)?)/i);
  const type = percent ? 'percentage' : flat ? 'flat' : null;
  const value = percent?.[1] || flat?.[1];
  const cart = /\b(cart|order)\b/i.test(text);
  const target = text.match(/\bfor\s+(?:the\s+)?(.+?)\s+(brand|items?|platform)\b/i) || text.match(/\bon\s+(?:all\s+)?(.+?)\s+(items?|products?)\b/i);
  const scope = cart ? 'cart' : target?.[2]?.toLowerCase().startsWith('brand') ? 'brand' : target ? 'platform' : null;
  const appliesTo = target ? target[1].replace(/\b(all|the)\b/gi, '').trim() : '';
  const threshold = text.match(/(?:more than|over|above|at least|>=|≥)\s*(?:rs\.?|₹|inr)?\s*([\d,]+)/i);
  const minCartValue = threshold ? Number(threshold[1].replace(/,/g, '')) : 0;
  const stackable = /\bstackable\b|\bwith other offers\b/i.test(text);
  const missing = [];
  if (!type || !value) missing.push('a discount value, such as “15%” or “Rs.100”');
  if (!scope) missing.push('what the rule applies to (brand, platform, or cart)');
  if (scope === 'cart' && !minCartValue) missing.push('a cart threshold, such as “over Rs.5,000”');
  if (scope && scope !== 'cart' && !appliesTo) missing.push('a brand or platform name');
  if (missing.length) return { ok: false, message: `I could not resolve ${missing.join(' and ')}. Please be more specific.` };
  try {
    return { ok: true, rule: validateRule({ id: `RULE-NL-${Date.now()}`, scope, appliesTo, type, value, stackable, minCartValue }) };
  } catch (error) { return { ok: false, message: error.message }; }
}

export async function parseCartPdf(file) {
  const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const byY = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      const group = byY.get(y) || [];
      group.push({ x: item.transform[4], text: item.str });
      byY.set(y, group);
    }
    lines.push(...[...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, words]) => words.sort((a, b) => a.x - b.x).map((word) => word.text).join('  ')));
  }
  return parsePdfText(lines.join('\n'));
}

export function parsePdfText(text) {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const start = rows.findIndex((row) => /product.*brand.*platform.*base\s*price/i.test(row));
  const dataRows = start >= 0 ? rows.slice(start + 1) : rows;
  const items = [];
  const errors = [];
  for (const line of dataRows) {
    const match = line.match(/^(.*?)\s{2,}(.*?)\s{2,}(.*?)\s{2,}(?:Rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)\s*$/i);
    if (!match) continue;
    try { items.push(validateItem({ id: `PDF-${items.length + 1}`, product: match[1], brand: match[2], platform: match[3], basePrice: match[4] })); }
    catch (error) { errors.push(`${line}: ${error.message}`); }
  }
  if (!items.length) throw new Error('No valid rows found. Use a text-based PDF table with Product, Brand, Platform, and Base Price columns.');
  return { items, errors };
}
