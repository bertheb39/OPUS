export function parseProfileScript(script) {
  const text = String(script || '');
  let price = null;
  let validity = null;
  let uptimeHint = null;

  const journal = text.match(/\|-(\d+)-\|-\$address-\|-\$mac-\|-([^|]+)-\|-([^|]+)-\|-\$comment/);
  if (journal) {
    price = Number(journal[1]);
    validity = journal[2];
    uptimeHint = journal[3];
  }

  const put = text.match(/:put\s*\(\s*",([^"]*)"\s*\)/);
  if (put) {
    const parts = put[1].split(',');
    if (price == null && /^\d+$/.test(parts[2] || '')) price = Number(parts[2]);
    if (!validity && parts[3]) validity = parts[3];
  }

  return {
    price: Number.isFinite(price) ? price : null,
    validity: validity || null,
    uptimeHint: uptimeHint || null,
  };
}

export function normalizeResellerName(name) {
  return String(name || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeResellerCode(code) {
  return String(code || '').trim();
}

export function validateResellerName(name) {
  if (!/^[A-Z0-9]{1,32}$/.test(name)) {
    return 'Le nom sur le ticket ne contient que des lettres et des chiffres, comme GOGOUNA.';
  }
  return '';
}

export function generateResellerCode(usedCodes) {
  const used = new Set((usedCodes || []).map((code) => String(code)));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = String(100 + Math.floor(Math.random() * 900));
    if (!used.has(code)) return code;
  }
  let code = 1000;
  while (used.has(String(code))) code += 1;
  return String(code);
}

export function validateResellerIdentity(code, name) {
  if (!/^\d{1,10}$/.test(code)) {
    return 'Le code revendeur est le nombre déjà utilisé dans le commentaire, par exemple 864.';
  }
  return validateResellerName(name);
}

export function formatSaleComment({ code, name, date = new Date(), timeZone }) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `vc-${code}-${value('day')}.${value('month')}.${value('year')}-${name}`;
}

export function localDateISO(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function currentMonthKey(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year').value;
  const month = parts.find((part) => part.type === 'month').value;
  return `${year}-${month}`;
}

export function formatDateTime(iso, timeZone) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function monthRange(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey || '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const start = `${match[1]}-${match[2]}-01`;
  const next = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { start, next };
}

const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';

export function generateTicketCode() {
  let code = '';
  for (let i = 0; i < 3; i += 1) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  for (let i = 0; i < 3; i += 1) code += DIGITS[Math.floor(Math.random() * DIGITS.length)];
  return code;
}

export function isLimitUptime(value) {
  return /^(\d+[smhdw])+$/i.test(String(value || '').trim());
}

export function normalizeLimitUptime(value) {
  return String(value || '').trim().toLowerCase();
}
