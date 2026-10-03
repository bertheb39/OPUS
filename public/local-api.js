const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const sessionKey = 'opus.session';
const loginAttempts = new Map();

function fail(status, error) {
  return { status, error };
}

function ok(data) {
  return { status: 200, data };
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || 'null');
  } catch {
    return null;
  }
}

function writeSession(session) {
  if (!session) localStorage.removeItem(sessionKey);
  else localStorage.setItem(sessionKey, JSON.stringify(session));
}

function requireSession(type) {
  const session = readSession();
  if (!session || session.type !== type) return null;
  return session;
}

function tooManyAttempts(key) {
  const entry = loginAttempts.get(key);
  return entry && entry.count >= 8 && entry.until > Date.now();
}

function markAttempt(key, success) {
  if (success) {
    loginAttempts.delete(key);
    return;
  }
  const entry = loginAttempts.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  entry.until = Date.now() + 60 * 1000;
  loginAttempts.set(key, entry);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeResellerName(name) {
  return String(name || '').trim().toUpperCase().replace(/\s+/g, '');
}

function validateResellerName(name) {
  if (!/^[A-Z0-9]{1,32}$/.test(name)) {
    return 'Le nom sur le ticket ne contient que des lettres et des chiffres, comme GOGOUNA.';
  }
  return '';
}

function validatePassword(password, min) {
  if (String(password || '').length < min) return `Le mot de passe doit contenir au moins ${min} caractères.`;
  return '';
}

function cleanHost(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').split('/')[0].trim();
}

function generateResellerCode(usedCodes) {
  const used = new Set((usedCodes || []).map((code) => String(code)));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = String(100 + Math.floor(Math.random() * 900));
    if (!used.has(code)) return code;
  }
  let code = 1000;
  while (used.has(String(code))) code += 1;
  return String(code);
}

function monthCodesMap(reseller, month) {
  const root = reseller && reseller.hmp_codes && typeof reseller.hmp_codes === 'object'
    ? reseller.hmp_codes
    : {};
  const entry = root[month];
  if (typeof entry === 'string') return { '*': entry };
  if (entry && typeof entry === 'object') return { ...entry };
  return {};
}

async function usedCodesForMonth(month) {
  const used = [];
  const current = currentMonthKey();
  for (const reseller of await getAll('resellers')) {
    const map = monthCodesMap(reseller, month);
    Object.values(map).forEach((code) => {
      if (code) used.push(String(code));
    });
    if (!Object.keys(map).length && reseller.hmp_code && month === current) {
      used.push(String(reseller.hmp_code));
    }
  }
  return used;
}

async function ensureResellerMonthCodes(resellerId) {
  let reseller = await getOne('resellers', resellerId);
  if (!reseller) return [];
  const month = currentMonthKey();
  const profiles = (await getAll('profiles'))
    .filter((profile) => profile.router_id === reseller.router_id && profile.active === 1 && profileSellable(profile))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const root = { ...(reseller.hmp_codes && typeof reseller.hmp_codes === 'object' ? reseller.hmp_codes : {}) };
  let monthMap = monthCodesMap(reseller, month);
  if (!Object.keys(monthMap).length && reseller.hmp_code) {
    monthMap['*'] = String(reseller.hmp_code);
  }
  const used = await usedCodesForMonth(month);
  Object.values(monthMap).forEach((code) => used.push(String(code)));
  let changed = false;
  const list = [];
  for (const profile of profiles) {
    const key = String(profile.id);
    if (!monthMap[key]) {
      const code = generateResellerCode(used);
      monthMap[key] = code;
      used.push(code);
      changed = true;
    }
    list.push({ profileId: profile.id, profile: profile.name, code: monthMap[key] });
  }
  if (changed || !root[month]) {
    root[month] = monthMap;
    reseller.hmp_codes = root;
    reseller.hmp_code = list[0] ? list[0].code : (monthMap['*'] || reseller.hmp_code || '');
    await putOne('resellers', reseller);
  }
  return list;
}

async function saleCommentCode(reseller, profileId) {
  const month = currentMonthKey();
  const list = await ensureResellerMonthCodes(reseller.id);
  const found = list.find((item) => Number(item.profileId) === Number(profileId));
  if (found) return found.code;
  const fresh = await getOne('resellers', reseller.id);
  const map = monthCodesMap(fresh, month);
  if (map[String(profileId)]) return map[String(profileId)];
  if (map['*']) return map['*'];
  return String(fresh.hmp_code || '');
}

function parseProfileScript(script) {
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

function isLimitUptime(value) {
  return /^(\d+[smhdw])+$/i.test(String(value || '').trim());
}

function formatSaleComment({ code, name, date = new Date() }) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `vc-${code}-${value('day')}.${value('month')}.${value('year')}-${name}`;
}

function parseSaleScriptName(name) {
  const raw = String(name || '');
  let parts = raw.split('-|-');
  if (parts.length < 9) parts = raw.split('|--|');
  if (parts.length < 9) return null;
  const date = parts[0];
  const time = parts[1];
  const code = parts[2];
  const priceRaw = parts[3];
  const address = parts[4];
  const mac = parts[5];
  const validity = parts[6];
  const uptimeHint = parts[7];
  const comment = parts.slice(8).join('-|-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !code) return null;
  const price = Number(priceRaw);
  return {
    date,
    time,
    code,
    price: Number.isFinite(price) ? price : null,
    address: address || '',
    mac: mac || '',
    validity: validity || '',
    uptimeHint: uptimeHint || '',
    comment: comment || '',
    scriptName: raw,
  };
}

function scriptConnectedAt(entry) {
  const stamp = `${entry.date}T${entry.time || '00:00:00'}`;
  const parsed = new Date(stamp);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return new Date(`${entry.date}T00:00:00`);
}

function resellerNameFromComment(comment) {
  const text = String(comment || '').trim();
  if (!text) return '';
  const shaped = text.match(/^vc-[^-]+-\d{2}\.\d{2}\.\d{2}-(.+)$/i);
  if (shaped) return String(shaped[1] || '').trim();
  const idx = text.lastIndexOf('-');
  return idx >= 0 ? text.slice(idx + 1).trim() : text;
}

function scriptOwnersBetween(from, to) {
  const start = String(from || '').slice(0, 7);
  const end = String(to || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  const owners = [];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    owners.push(`${String(month).padStart(2, '0')}${year}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return owners;
}

function parseSaleKeywords(value) {
  return [...new Set(
    String(value || '')
      .split(/[,;\n]+/)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((item) => item.replace(/\s+/g, ' '))
      .filter((item) => item.length <= 40)
  )];
}

function parseRatePercent(value) {
  if (value === '' || value == null) return null;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

function shareFromAmount(amount, ratePercent) {
  const total = Number(amount) || 0;
  const rate = parseRatePercent(ratePercent);
  if (rate == null) {
    return { rate: null, resellerShare: null, networkShare: null };
  }
  // Le taux = % à reverser au réseau. Le reste = part du revendeur.
  const networkShare = Math.round((total * rate) / 100);
  return {
    rate,
    networkShare,
    resellerShare: total - networkShare,
  };
}

function settlementFromSales(sales, resellers, routers = []) {
  const total = sumPrices(sales);
  const map = new Map(resellers.map((item) => [Number(item.id), item]));
  const routerMap = new Map(routers.map((item) => [Number(item.id), item]));
  const groups = new Map();
  sales.forEach((sale) => {
    const id = Number(sale.reseller_id) || 0;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(sale);
  });
  let resellerShare = 0;
  let networkShare = 0;
  let missingRate = 0;
  let singleRate = null;
  let sameRate = true;
  const networkNames = new Set();
  const resellerNames = new Set();
  for (const [id, rows] of groups) {
    const amount = sumPrices(rows);
    const reseller = map.get(id);
    const share = shareFromAmount(amount, reseller ? reseller.rate_percent : null);
    const routerId = reseller
      ? Number(reseller.router_id)
      : Number(rows[0]?.router_id) || 0;
    const router = routerMap.get(routerId);
    if (router && router.name) networkNames.add(router.name);
    if (reseller && reseller.hmp_name) resellerNames.add(reseller.hmp_name);
    else if (rows[0]?.reseller_name) resellerNames.add(rows[0].reseller_name);
    if (share.rate == null) {
      missingRate += 1;
      sameRate = false;
      continue;
    }
    resellerShare += share.resellerShare;
    networkShare += share.networkShare;
    if (singleRate == null) singleRate = share.rate;
    else if (singleRate !== share.rate) sameRate = false;
  }
  const networkList = [...networkNames];
  const resellerList = [...resellerNames];
  return {
    total,
    rate: sameRate ? singleRate : null,
    resellerShare: missingRate ? null : resellerShare,
    networkShare: missingRate ? null : networkShare,
    missingRate,
    networkName: networkList.length === 1 ? networkList[0] : '',
    resellerName: resellerList.length === 1 ? resellerList[0] : '',
  };
}

function resellerSaleLabels(reseller) {
  const labels = [reseller.hmp_name, ...(Array.isArray(reseller.sale_keywords) ? reseller.sale_keywords : [])];
  return [...new Set(labels.map((item) => String(item || '').trim()).filter(Boolean))];
}

function resellerMatchesComment(reseller, comment, label = '') {
  const text = commentKey(comment);
  const tip = commentKey(label || resellerNameFromComment(comment));
  return resellerSaleLabels(reseller).some((name) => {
    const key = commentKey(name);
    if (!key) return false;
    return text === key || text.endsWith(`-${key}`) || tip === key || commentMatchesName(comment, name);
  });
}

function matchResellerForScript(entry, resellers, routerId) {
  const label = entry.resellerLabel || resellerNameFromComment(entry.comment);
  const candidates = resellers.filter((item) => (
    Number(item.router_id) === Number(routerId)
    && resellerMatchesComment(item, entry.comment, label)
  ));
  if (!candidates.length) return null;
  const active = candidates.find((item) => item.active === 1);
  return active || candidates[0];
}

async function rematchOrphanScriptSales() {
  const [sales, resellers] = await Promise.all([getAll('sales'), getAll('resellers')]);
  const orphans = sales.filter((sale) => sale.script_key && !Number(sale.reseller_id));
  if (!orphans.length) return 0;
  let updated = 0;
  for (const sale of orphans) {
    const owner = matchResellerForScript({
      comment: sale.comment,
      resellerLabel: sale.reseller_name || resellerNameFromComment(sale.comment),
    }, resellers, sale.router_id);
    if (!owner) continue;
    sale.reseller_id = owner.id;
    sale.reseller_name = owner.hmp_name;
    await putOne('sales', sale);
    updated += 1;
  }
  return updated;
}

/** Recalcule le propriétaire de chaque vente script (ex. après renommage / mots-clés). */
let scriptSalesRematchBusy = null;
async function rematchAllScriptSales() {
  if (scriptSalesRematchBusy) return scriptSalesRematchBusy;
  scriptSalesRematchBusy = (async () => {
    const [sales, resellers] = await Promise.all([getAll('sales'), getAll('resellers')]);
    const changed = [];
    for (const sale of sales) {
      if (!sale.script_key) continue;
      const owner = matchResellerForScript({
        comment: sale.comment,
        resellerLabel: resellerNameFromComment(sale.comment) || sale.reseller_name,
      }, resellers, sale.router_id);
      const nextId = owner ? Number(owner.id) : 0;
      const nextName = owner ? owner.hmp_name : (resellerNameFromComment(sale.comment) || '');
      if (Number(sale.reseller_id || 0) === nextId && String(sale.reseller_name || '') === String(nextName || '')) {
        continue;
      }
      sale.reseller_id = nextId;
      sale.reseller_name = nextName;
      changed.push(sale);
    }
    if (!changed.length) return 0;
    const db = await openDatabase();
    const tx = db.transaction(['sales'], 'readwrite');
    const store = tx.objectStore('sales');
    changed.forEach((sale) => { store.put(sale); });
    await transactionDone(tx);
    return changed.length;
  })();
  try {
    return await scriptSalesRematchBusy;
  } finally {
    scriptSalesRematchBusy = null;
  }
}

let scriptSalesRematchSession = false;
async function rematchAllScriptSalesOnce() {
  if (scriptSalesRematchSession) return 0;
  scriptSalesRematchSession = true;
  return rematchAllScriptSales();
}

function matchProfileForScript(entry, profiles, routerId) {
  const list = profiles.filter((item) => Number(item.router_id) === Number(routerId) && item.price != null);
  const byPriceValidity = list.find((item) => (
    Number(item.price) === Number(entry.price)
    && String(item.validity || '') === String(entry.validity || '')
  ));
  if (byPriceValidity) return byPriceValidity;
  return list.find((item) => Number(item.price) === Number(entry.price)) || null;
}

function localDateISO(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function currentMonthKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year').value;
  const month = parts.find((part) => part.type === 'month').value;
  return `${year}-${month}`;
}

function previousMonthKey(date = new Date()) {
  const current = currentMonthKey(date);
  let year = Number(current.slice(0, 4));
  let month = Number(current.slice(5, 7)) - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

const scriptListCache = new Map();
const SCRIPT_LIST_TTL_MS = 90000;
const syncSalesCache = new Map();
const SYNC_SALES_TTL_MS = 60000;
let salesPurgeClean = false;

function scriptListCacheKey(router, owners) {
  const host = cleanHost(router && router.host);
  const ownerKey = Array.isArray(owners) && owners.length ? owners.join(',') : '*';
  return `${Number(router && router.id) || 0}|${host}|${ownerKey}`;
}

function invalidateScriptListCache(routerId = 0) {
  if (!routerId) {
    scriptListCache.clear();
    return;
  }
  const prefix = `${Number(routerId)}|`;
  for (const key of [...scriptListCache.keys()]) {
    if (key.startsWith(prefix)) scriptListCache.delete(key);
  }
}

function syncSalesCacheKey({ resellerId = 0, routerId = 0, from = '', to = '' } = {}) {
  return `${Number(resellerId) || 0}|${Number(routerId) || 0}|${from || ''}|${to || ''}`;
}

function monthRange(monthKey) {
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

function formatDateTime(iso) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';

function generateTicketCode() {
  let code = '';
  for (let i = 0; i < 3; i += 1) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  for (let i = 0; i < 3; i += 1) code += DIGITS[Math.floor(Math.random() * DIGITS.length)];
  return code;
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

const OWNER_SALT = 'bb5717dee10be569d6fbd37dcff97cbc';
const OWNER_HASH = 'fdf6da3a3461aee51d1ed539f9acc8af86499e0f0af8f33b357aafcb98a6be51';

async function ownerPasswordMatches(password) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: hexToBytes(OWNER_SALT),
    iterations: 120000,
    hash: 'SHA-256',
  }, key, 256);
  const actual = bytesToHex(new Uint8Array(bits));
  if (actual.length !== OWNER_HASH.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual.charCodeAt(i) ^ OWNER_HASH.charCodeAt(i);
  return diff === 0;
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt,
    iterations: 120000,
    hash: 'SHA-256',
  }, key, 256);
  return `pbkdf2$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !saltHex || !hashHex) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: hexToBytes(saltHex),
    iterations: 120000,
    hash: 'SHA-256',
  }, key, 256);
  const actual = bytesToHex(new Uint8Array(bits));
  if (actual.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('Opération annulée.'));
    tx.onerror = () => reject(tx.error);
  });
}

function openDatabase() {
  if (!openDatabase.promise) {
    openDatabase.promise = new Promise((resolve, reject) => {
      const request = indexedDB.open('opus', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('admins')) {
          const admins = db.createObjectStore('admins', { keyPath: 'id', autoIncrement: true });
          admins.createIndex('username', 'username', { unique: true });
        }
        if (!db.objectStoreNames.contains('routers')) {
          db.createObjectStore('routers', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('profiles')) {
          const profiles = db.createObjectStore('profiles', { keyPath: 'id', autoIncrement: true });
          profiles.createIndex('router', 'router_id');
        }
        if (!db.objectStoreNames.contains('resellers')) {
          const resellers = db.createObjectStore('resellers', { keyPath: 'id', autoIncrement: true });
          resellers.createIndex('username', 'username', { unique: true });
        }
        if (!db.objectStoreNames.contains('stock')) db.createObjectStore('stock', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sales')) {
          const sales = db.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
          sales.createIndex('reseller', 'reseller_id');
        }
        if (!db.objectStoreNames.contains('assigned')) {
          db.createObjectStore('assigned', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return openDatabase.promise;
}

async function getAll(storeName) {
  const db = await openDatabase();
  return requestToPromise(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

async function getOne(storeName, key) {
  const db = await openDatabase();
  return requestToPromise(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

async function getByIndex(storeName, indexName, value) {
  const db = await openDatabase();
  const store = db.transaction(storeName, 'readonly').objectStore(storeName);
  return requestToPromise(store.index(indexName).get(value));
}

async function putOne(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  const key = await requestToPromise(tx.objectStore(storeName).put(value));
  await transactionDone(tx);
  return key;
}

async function deleteOne(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await transactionDone(tx);
}

const backupStores = ['admins', 'routers', 'profiles', 'resellers', 'stock', 'sales', 'assigned'];

async function replaceDatabase(snapshot) {
  const db = await openDatabase();
  const tx = db.transaction(backupStores, 'readwrite');
  backupStores.forEach((name) => {
    const store = tx.objectStore(name);
    store.clear();
    snapshot[name].forEach((row) => {
      if (row && typeof row === 'object') store.put(row);
    });
  });
  await transactionDone(tx);
}

async function exportSnapshot() {
  const snapshot = { opus: 1, savedAt: new Date().toISOString() };
  snapshot.currency = localStorage.getItem('opus.currency') || 'XOF';
  for (const name of backupStores) snapshot[name] = await getAll(name);
  return snapshot;
}

async function importSnapshot(snapshot) {
  if (!snapshot || snapshot.opus !== 1 || !Array.isArray(snapshot.admins) || snapshot.admins.length === 0) {
    throw new Error('Cette copie est inutilisable.');
  }
  const required = backupStores.filter((name) => name !== 'assigned');
  if (!required.every((name) => Array.isArray(snapshot[name]))) {
    throw new Error('Cette copie est inutilisable.');
  }
  await replaceDatabase({ ...snapshot, assigned: Array.isArray(snapshot.assigned) ? snapshot.assigned : [] });
  const currency = String(snapshot.currency || '');
  if (['XOF', 'CDF', 'EUR', 'USD'].includes(currency)) localStorage.setItem('opus.currency', currency);
  writeSession({ type: 'admin', id: snapshot.admins[0].id });
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(text) {
  const raw = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = raw + '==='.slice((raw.length + 3) % 4);
  const binary = atob(pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encodeInviteToken(pack) {
  const json = new TextEncoder().encode(JSON.stringify(pack));
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
      return `OPUS1.gz.${bytesToBase64Url(compressed)}`;
    } catch {
      // repli sans compression
    }
  }
  return `OPUS1.${bytesToBase64Url(json)}`;
}

async function decodeInviteToken(token) {
  const text = String(token || '').trim().replace(/\s+/g, '');
  const gzipMatch = text.match(/^OPUS1\.gz\.([A-Za-z0-9_-]+)$/);
  const plainMatch = text.match(/^OPUS1\.([A-Za-z0-9_-]+)$/);
  if (!gzipMatch && !plainMatch) {
    throw new Error('Code d’invitation invalide. Collez le message complet reçu de l’administration.');
  }
  let bytes = base64UrlToBytes((gzipMatch || plainMatch)[1]);
  if (gzipMatch) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Cet appareil ne peut pas lire cette invitation. Mettez à jour l’application.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  let pack;
  try {
    pack = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Code d’invitation illisible.');
  }
  if (!pack || pack.opusInvite !== 1 || !pack.reseller || !pack.router) {
    throw new Error('Cette invitation est inutilisable.');
  }
  return pack;
}

async function buildResellerInvite(resellerId) {
  const reseller = await getOne('resellers', Number(resellerId));
  if (!reseller) throw new Error('Revendeur introuvable.');
  if (reseller.active !== 1) throw new Error('Réactivez ce revendeur avant de l’inviter.');
  const router = await getOne('routers', Number(reseller.router_id));
  if (!router) throw new Error('Routeur du revendeur introuvable.');
  const profiles = (await getAll('profiles')).filter((item) => Number(item.router_id) === Number(router.id));
  const stock = (await getAll('stock')).filter((item) => Number(item.reseller_id) === Number(reseller.id));
  const assigned = (await getAll('assigned')).filter((item) => Number(item.reseller_id) === Number(reseller.id));
  const pack = {
    opusInvite: 1,
    createdAt: new Date().toISOString(),
    currency: localStorage.getItem('opus.currency') || 'XOF',
    reseller,
    router,
    profiles,
    stock,
    assigned,
  };
  const token = await encodeInviteToken(pack);
  return {
    token,
    name: reseller.hmp_name,
    shareText: `Tickets — invitation ${reseller.hmp_name}\n\n1) Ouvrez Tickets\n2) « Rejoindre avec un code »\n3) Collez ce message puis validez\n4) Entrez votre mot de passe revendeur\n\n${token}`,
  };
}

async function importResellerInvite(token) {
  const pack = await decodeInviteToken(token);
  const admins = await getAll('admins');
  if (admins.length) {
    throw new Error('Cet appareil est déjà configuré en administration. Utilisez un téléphone vide pour le revendeur.');
  }
  const existing = await getAll('resellers');
  if (existing.some((item) => Number(item.id) !== Number(pack.reseller.id))) {
    throw new Error('Cet appareil a déjà un autre compte revendeur. Désinstallez l’app ou effacez ses données, puis réessayez.');
  }
  const routerId = Number(pack.router.id);
  const resellerId = Number(pack.reseller.id);
  await putOne('routers', pack.router);
  const oldProfiles = (await getAll('profiles')).filter((item) => Number(item.router_id) === routerId);
  for (const profile of oldProfiles) await deleteOne('profiles', profile.id);
  for (const profile of pack.profiles || []) {
    if (profile && typeof profile === 'object') await putOne('profiles', profile);
  }
  await putOne('resellers', pack.reseller);
  const oldStock = (await getAll('stock')).filter((item) => Number(item.reseller_id) === resellerId);
  for (const row of oldStock) await deleteOne('stock', row.id);
  for (const row of pack.stock || []) {
    if (row && typeof row === 'object') await putOne('stock', row);
  }
  const oldAssigned = (await getAll('assigned')).filter((item) => Number(item.reseller_id) === resellerId);
  for (const row of oldAssigned) await deleteOne('assigned', row.id);
  for (const row of pack.assigned || []) {
    if (row && typeof row === 'object') await putOne('assigned', row);
  }
  const currency = String(pack.currency || '');
  if (['XOF', 'CDF', 'EUR', 'USD'].includes(currency)) localStorage.setItem('opus.currency', currency);
  writeSession(null);
  return { name: pack.reseller.hmp_name || 'revendeur' };
}

function publicRouter(router) {
  return {
    id: router.id,
    name: router.name,
    host: router.host,
    admin_host: router.admin_host || '',
    port: router.port,
    username: router.username,
  };
}

const reachModeKey = 'opus.reach';
const reachGoodKey = 'opus.reachGood';

function canUseRemoteHost() {
  const session = readSession();
  if (session && session.type === 'admin') return true;
  try {
    return sessionStorage.getItem('opus.owner') === '1';
  } catch {
    return false;
  }
}

function adminReachMode() {
  try {
    const mode = localStorage.getItem(reachModeKey) || 'auto';
    if (mode === 'local' || mode === 'distant' || mode === 'auto') return mode;
  } catch {
    // stockage indisponible
  }
  return 'auto';
}

function setAdminReachMode(mode) {
  const value = mode === 'local' || mode === 'distant' ? mode : 'auto';
  localStorage.setItem(reachModeKey, value);
  return value;
}

function readLastGoodHost(routerId) {
  try {
    const map = JSON.parse(localStorage.getItem(reachGoodKey) || '{}');
    return cleanHost(map[String(routerId)] || '');
  } catch {
    return '';
  }
}

function writeLastGoodHost(routerId, host) {
  if (!routerId || !host) return;
  try {
    const map = JSON.parse(localStorage.getItem(reachGoodKey) || '{}');
    map[String(routerId)] = cleanHost(host);
    localStorage.setItem(reachGoodKey, JSON.stringify(map));
  } catch {
    // stockage indisponible
  }
}

function resellerReachHost(router, reseller) {
  return cleanHost(reseller && reseller.host) || cleanHost(router && router.host);
}

function routerForReseller(router, reseller) {
  if (!router) return null;
  if (canUseRemoteHost()) return router;
  const host = resellerReachHost(router, reseller);
  return { ...router, host, admin_host: '' };
}

function routerHosts(router) {
  const local = cleanHost(router && router.host);
  const remote = cleanHost(router && router.admin_host);
  if (!canUseRemoteHost()) return local ? [local] : [];
  const mode = adminReachMode();
  if (mode === 'local') return local ? [local] : [];
  if (mode === 'distant') return remote ? [remote] : (local ? [local] : []);
  const hosts = [];
  const last = router && router.id ? readLastGoodHost(router.id) : '';
  if (last && (last === local || last === remote)) hosts.push(last);
  if (local && !hosts.includes(local)) hosts.push(local);
  if (remote && !hosts.includes(remote)) hosts.push(remote);
  return hosts;
}

function profileSellable(profile) {
  return Boolean(profile && profile.sellable !== 0);
}

function publicProfile(profile) {
  return {
    id: profile.id,
    router_id: profile.router_id,
    name: profile.name,
    price: profile.price,
    validity: profile.validity,
    uptime_hint: profile.uptime_hint,
    limit_uptime: profile.limit_uptime || null,
    rate_limit: profile.rate_limit || '',
    active: profile.active,
    sellable: profileSellable(profile),
  };
}

async function profilesForRouter(routerId) {
  const profiles = (await getAll('profiles')).filter((profile) => profile.router_id === routerId);
  profiles.sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'fr'));
  return profiles.map(publicProfile);
}

async function resellerView(reseller, month) {
  const range = monthRange(month);
  const routers = await getAll('routers');
  const router = routers.find((item) => item.id === reseller.router_id);
  const reachHost = resellerReachHost(router, reseller);
  const latest = await getOne('resellers', reseller.id) || reseller;
  const sales = (await getAll('sales')).filter((sale) => (
    sale.script_key
    && sale.reseller_id === reseller.id
    && sale.sale_date >= range.start
    && sale.sale_date < range.next
  ));
  const soldAmount = sales.reduce((sum, sale) => sum + (sale.price || 0), 0);
  const ratePercent = parseRatePercent(latest.rate_percent);
  const monthShare = shareFromAmount(soldAmount, ratePercent);
  const profiles = (await getAll('profiles')).filter((profile) => (
    profile.router_id === reseller.router_id && profile.active && profileSellable(profile)
  ));
  const stocks = await getAll('stock');
  const assignedItems = (await getAll('assigned')).filter((item) => item.reseller_id === reseller.id);
  const handedCount = assignedItems.filter((item) => item.handed_at).length;
  const assignedGroups = new Map();
  assignedItems.forEach((item) => {
    const key = commentKey(item.comment);
    if (!assignedGroups.has(key)) {
      assignedGroups.set(key, { comment: String(item.comment || '').trim(), count: 0, profiles: new Set() });
    }
    const group = assignedGroups.get(key);
    group.count += 1;
    if (item.profile) group.profiles.add(item.profile);
  });
  const assignedLots = [...assignedGroups.values()].map((group) => ({
    comment: group.comment,
    count: group.count,
    profiles: [...group.profiles].sort((a, b) => a.localeCompare(b, 'fr')),
  }));
  assignedLots.sort((a, b) => a.comment.localeCompare(b.comment, 'fr'));
  profiles.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const monthCodes = await ensureResellerMonthCodes(reseller.id);
  const refreshed = await getOne('resellers', reseller.id) || latest;
  return {
    id: refreshed.id,
    username: refreshed.username,
    hmpCode: monthCodes[0] ? monthCodes[0].code : (refreshed.hmp_code || ''),
    monthCodes,
    monthKey: currentMonthKey(),
    hmpName: refreshed.hmp_name,
    saleKeywords: Array.isArray(refreshed.sale_keywords) ? refreshed.sale_keywords : [],
    ratePercent,
    routerId: refreshed.router_id,
    routerName: router ? router.name : '',
    host: refreshed.host || '',
    reachHost,
    active: refreshed.active === 1,
    soldCount: sales.length,
    soldAmount,
    resellerShare: monthShare.resellerShare,
    networkShare: monthShare.networkShare,
    assignedCount: assignedItems.length,
    handedCount,
    assignedLots,
    stock: profiles.map((profile) => {
      const stock = stocks.find((item) => item.id === `${reseller.id}:${profile.id}`);
      return {
        profileId: profile.id,
        name: profile.name,
        price: profile.price,
        validity: profile.validity,
        limit_uptime: profile.limit_uptime || '',
        remaining: stock ? stock.remaining : 0,
      };
    }),
  };
}

function routerPlugin() {
  return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RouterOs;
}

async function routerRunOnce(router, commands, timeoutMs) {
  const plugin = routerPlugin();
  if (plugin) {
    try {
      const response = await plugin.run({
        host: router.host,
        port: Number(router.port) || 8728,
        username: router.username,
        password: router.password,
        timeout: timeoutMs || 15000,
        commands,
      });
      return response.results || [];
    } catch (error) {
      const message = (error && error.message) || 'Impossible de joindre le routeur.';
      const wrapped = new Error(message);
      if (/refusée|refusé/i.test(message)) wrapped.code = 'TRAP';
      else if (/ne répond pas/i.test(message)) wrapped.code = 'TIMEOUT';
      else wrapped.code = 'NETWORK';
      throw wrapped;
    }
  }
  let response;
  try {
    response = await fetch('/api/router', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: router.host,
        port: Number(router.port) || 8728,
        username: router.username,
        password: router.password,
        timeout: timeoutMs || 15000,
        commands,
      }),
    });
  } catch {
    const error = new Error('Impossible de joindre le routeur depuis l\'ordinateur.');
    error.code = 'NETWORK';
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Impossible de joindre le routeur.');
    if (/refusée|refusé/i.test(error.message)) error.code = 'TRAP';
    else if (/ne répond pas/i.test(error.message)) error.code = 'TIMEOUT';
    else error.code = 'NETWORK';
    throw error;
  }
  return payload.results || [];
}

async function routerRun(router, commands, timeoutMs) {
  const hosts = routerHosts(router);
  if (!hosts.length) {
    const error = new Error('Adresse du routeur manquante.');
    error.code = 'NETWORK';
    throw error;
  }
  const fullTimeout = timeoutMs || 15000;
  const attempts = [];
  for (let index = 0; index < hosts.length; index += 1) {
    // En multi-adresses (local + VPN), ne pas rester longtemps bloqué sur la première.
    const budget = index < hosts.length - 1 ? Math.min(fullTimeout, 2500) : fullTimeout;
    try {
      const result = await routerRunOnce({ ...router, host: hosts[index] }, commands, budget);
      writeLastGoodHost(router.id, hosts[index]);
      return result;
    } catch (error) {
      attempts.push({ host: hosts[index], error });
      // Toujours tenter l’autre adresse : une erreur d’auth sur le local
      // ne doit pas empêcher d’essayer le VPN (et inversement).
      if (index >= hosts.length - 1) break;
    }
  }
  const trap = attempts.find((item) => item.error && item.error.code === 'TRAP');
  if (trap) throw trap.error;
  const last = attempts[attempts.length - 1];
  throw (last && last.error) || new Error('Impossible de joindre le routeur.');
}

async function testRouter(router) {
  const results = await routerRun(router, [['/system/identity/print']]);
  return { identity: results[0]?.rows?.[0]?.name || '' };
}

async function fetchProfiles(router) {
  const results = await routerRun(router, [['/ip/hotspot/user/profile/print']]);
  return (results[0]?.rows || [])
    .filter((row) => row.name)
    .map((row) => ({
      name: row.name,
      onLogin: row['on-login'] || '',
      rateLimit: row['rate-limit'] || '',
    }));
}

async function hotspotUserExists(router, name) {
  const results = await routerRun(router, [[
    '/ip/hotspot/user/print',
    `?name=${name}`,
    '=.proplist=name',
  ]], 8000);
  return (results[0]?.rows || []).length > 0;
}

async function listHotspotUsersByComment(router, name) {
  const results = await routerRun(router, [[
    '/ip/hotspot/user/print',
    '=.proplist=name,password,profile,comment,uptime,bytes-in,bytes-out',
  ]], 20000);
  const rows = results[0]?.rows || [];
  return rows.filter((row) => row.name && commentMatchesName(row.comment, name));
}

async function listSaleScripts(router, options = {}) {
  const owners = Array.isArray(options.owners) ? options.owners.filter(Boolean) : [];
  const cacheKey = scriptListCacheKey(router, owners);
  const cached = scriptListCache.get(cacheKey);
  if (!options.force && cached) {
    if (cached.entries && cached.expires > Date.now()) return cached.entries;
    if (cached.promise) return cached.promise;
  }
  const loadPromise = (async () => {
    const queries = owners.length
      ? owners.map((owner) => ([
        '/system/script/print',
        `?owner=${owner}`,
        '=.proplist=name,owner,comment',
      ]))
      : [[
        '/system/script/print',
        '=.proplist=name,owner,comment',
      ]];
    const results = await routerRun(router, queries, owners.length ? 45000 : 60000);
    const rows = [];
    (results || []).forEach((result) => {
      (result?.rows || []).forEach((row) => rows.push(row));
    });
    const seen = new Set();
    const parsed = [];
    rows.forEach((row) => {
      const entry = parseSaleScriptName(row.name);
      if (!entry || seen.has(entry.scriptName)) return;
      seen.add(entry.scriptName);
      parsed.push({
        ...entry,
        owner: row.owner || '',
        scriptComment: row.comment || '',
        resellerLabel: resellerNameFromComment(entry.comment),
      });
    });
    parsed.sort((a, b) => (
      a.date.localeCompare(b.date)
      || String(a.time || '').localeCompare(String(b.time || ''))
      || a.code.localeCompare(b.code)
    ));
    scriptListCache.set(cacheKey, {
      entries: parsed,
      expires: Date.now() + SCRIPT_LIST_TTL_MS,
    });
    return parsed;
  })();
  scriptListCache.set(cacheKey, { promise: loadPromise, expires: 0 });
  try {
    return await loadPromise;
  } catch (error) {
    const current = scriptListCache.get(cacheKey);
    if (current && current.promise === loadPromise) scriptListCache.delete(cacheKey);
    throw error;
  }
}

async function findSaleScriptForCode(router, code, options = {}) {
  const wanted = String(code || '').trim();
  if (!wanted) return null;
  const today = localDateISO(new Date());
  const fromMonth = previousMonthKey();
  const owners = scriptOwnersBetween(`${fromMonth}-01`, today);
  const entries = await listSaleScripts(router, { owners });
  const hit = entries.find((entry) => entry.code === wanted);
  if (hit) return hit;
  // Pas de dump complet : trop lent. Les connexions anciennes sont déjà dans sales.
  if (options.deep) {
    const all = await listSaleScripts(router, { force: Boolean(options.force) });
    return all.find((entry) => entry.code === wanted) || null;
  }
  return null;
}

async function createHotspotUser(router, user) {
  await routerRun(router, [[
    '/ip/hotspot/user/add',
    `=name=${user.name}`,
    `=password=${user.password}`,
    `=profile=${user.profile}`,
    `=limit-uptime=${user.limitUptime}`,
    `=comment=${user.comment}`,
  ]]);
}

function hotspotLoginUrl(host, code, password) {
  const secret = password || code;
  return `http://${cleanHost(host)}/login?username=${encodeURIComponent(code)}&password=${encodeURIComponent(secret)}`;
}

function normalizeCommentName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80 || /[\r\n\t]/.test(name)) return '';
  return name;
}

function commentKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('fr');
}

function commentMatchesName(comment, name) {
  const text = commentKey(comment);
  const wanted = commentKey(name);
  if (!text || !wanted) return false;
  return text === wanted || text.endsWith(`-${wanted}`);
}

async function exactCommentOwners(routerId) {
  const [assigned, sales, resellers] = await Promise.all([
    getAll('assigned'),
    getAll('sales'),
    getAll('resellers'),
  ]);
  const names = new Map(resellers.map((item) => [Number(item.id), item.hmp_name]));
  const owners = new Map();
  const add = (comment, resellerId) => {
    const key = commentKey(comment);
    if (!key) return;
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key).add(Number(resellerId));
  };
  const router = Number(routerId);
  assigned.forEach((item) => {
    if (Number(item.router_id) === router) add(item.comment, item.reseller_id);
  });
  sales.forEach((sale) => {
    if (Number(sale.router_id) === router) add(sale.comment, sale.reseller_id);
  });
  return { owners, names };
}

function otherOwnersOf(book, comment, resellerId) {
  const ids = book.owners.get(commentKey(comment));
  if (!ids) return [];
  return [...ids]
    .filter((id) => id !== Number(resellerId))
    .map((id) => book.names.get(id) || 'un revendeur');
}

function ticketConsumed(row) {
  const uptime = String(row.uptime || '').trim().toLowerCase();
  const bytesIn = Number(row['bytes-in'] || 0);
  const bytesOut = Number(row['bytes-out'] || 0);
  if (bytesIn > 0 || bytesOut > 0) return true;
  if (!uptime || uptime === '0s' || uptime === '00:00:00') return false;
  return /[1-9]/.test(uptime);
}

async function readTicketUsage(router, codes) {
  const wanted = new Set(codes);
  const found = new Map();
  const results = await routerRun(router, [[
    '/ip/hotspot/user/print',
    '=.proplist=name,uptime,bytes-in,bytes-out',
  ]], 20000);
  (results[0]?.rows || []).forEach((row) => {
    if (!row.name || !wanted.has(row.name)) return;
    found.set(row.name, ticketConsumed(row));
  });
  try {
    const active = await routerRun(router, [[
      '/ip/hotspot/active/print',
      '=.proplist=user',
    ]], 8000);
    (active[0]?.rows || []).forEach((row) => {
      if (row.user && wanted.has(row.user)) found.set(row.user, true);
    });
  } catch {
    // La liste des sessions complète la lecture des utilisateurs.
  }
  return found;
}

function saleRecord(sale, resellers, routers) {
  const seller = resellers.find((item) => item.id === sale.reseller_id);
  const router = routers.find((item) => item.id === sale.router_id);
  const keyword = resellerNameFromComment(sale.comment) || sale.reseller_name || (seller ? seller.hmp_name : '');
  return {
    id: sale.id,
    when: sale.connected_at || formatDateTime(sale.created_at),
    date: sale.sale_date,
    reseller: seller ? seller.hmp_name : (sale.reseller_name || ''),
    keyword,
    router: router ? router.name : '',
    code: sale.code,
    profile: sale.profile_name,
    price: sale.price,
    validity: sale.validity,
    limitUptime: sale.limit_uptime,
    comment: sale.comment || '',
    source: sale.source === 'HAP' ? 'HAP' : 'AP',
    loginUrl: router ? hotspotLoginUrl(router.host, sale.code, sale.password) : sale.code,
  };
}

function saleSourceFromAssigned(ticket) {
  return ticket.handed_at || ticket.channel === 'AP' ? 'AP' : 'HAP';
}

async function saleExistsForCode(routerId, code) {
  const sales = await getAll('sales');
  return sales.some((sale) => Number(sale.router_id) === Number(routerId) && sale.code === code);
}

async function findSaleForCode(routerId, code) {
  const sales = await getAll('sales');
  return sales.find((sale) => Number(sale.router_id) === Number(routerId) && sale.code === code) || null;
}

function formatVenduMessage(dateValue, timeValue = '') {
  const raw = String(dateValue || '').trim();
  let datePart = raw;
  let timePart = String(timeValue || '').trim();
  if (raw.includes(' ')) {
    const bits = raw.split(/\s+/);
    datePart = bits[0] || '';
    if (!timePart) timePart = bits.slice(1).join(' ');
  }
  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const frDate = match ? `${match[3]}/${match[2]}/${match[1]}` : datePart;
  if (!frDate) return 'Ce ticket a déjà été vendu.';
  return timePart
    ? `Ce ticket a été vendu le ${frDate} à ${timePart}.`
    : `Ce ticket a été vendu le ${frDate}.`;
}

function ticketResponse(router, ticket, profile, whenIso) {
  const password = ticket.password && ticket.password !== ticket.name ? ticket.password : '';
  const host = router ? router.host : '';
  return {
    code: ticket.name,
    profile: profile.name,
    price: profile.price,
    validity: profile.validity,
    limitUptime: profile.limit_uptime,
    comment: ticket.comment || '',
    loginUrl: host ? hotspotLoginUrl(host, ticket.name, ticket.password) : ticket.name,
    when: formatDateTime(whenIso),
    pending: true,
  };
}

async function syncHapSales({ resellerId = 0, routerId = 0, from = '', to = '', force = false } = {}) {
  const windowFrom = from || `${currentMonthKey()}-01`;
  const windowTo = to || localDateISO(new Date());
  const cacheKey = syncSalesCacheKey({ resellerId, routerId, from: windowFrom, to: windowTo });
  const cached = syncSalesCache.get(cacheKey);
  if (!force && cached) {
    if (cached.result && cached.expires > Date.now()) return cached.result;
    if (cached.promise) return cached.promise;
  }

  const runPromise = (async () => {
    const [allRouters, resellers, sales, profiles, assigned] = await Promise.all([
      getAll('routers'),
      getAll('resellers'),
      getAll('sales'),
      getAll('profiles'),
      getAll('assigned'),
    ]);
    const selected = allRouters.filter((router) => !routerId || Number(router.id) === Number(routerId));
    if (!selected.length) {
      return { created: 0, removed: 0, read: 0, unmatched: 0, warning: 'Aucun routeur enregistré.' };
    }
    await rematchOrphanScriptSales();
    const owners = scriptOwnersBetween(windowFrom, windowTo);
    const sold = new Set(sales.map((sale) => `${sale.router_id}:${sale.code}`));
    const scriptKeys = new Set(sales.map((sale) => sale.script_key).filter(Boolean));
    let created = 0;
    let removed = 0;
    let read = 0;
    let unmatched = 0;
    const warnings = [];
    let readOk = 0;
    const missingNames = new Set();

    for (const baseRouter of selected) {
      let router = baseRouter;
      if (resellerId) {
        const reseller = await getOne('resellers', resellerId);
        if (!reseller || Number(reseller.router_id) !== Number(baseRouter.id)) continue;
        router = routerForReseller(baseRouter, reseller) || baseRouter;
      }
      let entries = [];
      try {
        entries = await listSaleScripts(router, { owners, force: Boolean(force) });
        entries = entries.filter((entry) => (
          entry.date >= String(windowFrom).slice(0, 10)
          && entry.date <= String(windowTo).slice(0, 10)
        ));
        readOk += 1;
        read += entries.length;
      } catch (error) {
        warnings.push(`${baseRouter.name || 'Routeur'} : ${error.message || 'scripts inaccessibles'}`);
        continue;
      }
      let createdHere = 0;
      for (const entry of entries) {
        if (scriptKeys.has(entry.scriptName)) continue;
        if (sold.has(`${baseRouter.id}:${entry.code}`)) continue;
        const owner = matchResellerForScript(entry, resellers, baseRouter.id);
        const label = entry.resellerLabel || resellerNameFromComment(entry.comment);
        if (resellerId) {
          if (!owner || Number(owner.id) !== Number(resellerId)) {
            if (!owner && label) missingNames.add(label);
            unmatched += 1;
            continue;
          }
        } else if (!owner) {
          unmatched += 1;
          if (label) missingNames.add(label);
        }
        const profile = matchProfileForScript(entry, profiles, baseRouter.id);
        const held = assigned.find((item) => (
          Number(item.router_id) === Number(baseRouter.id) && item.name === entry.code
        ));
        const connectedAt = scriptConnectedAt(entry);
        await putOne('sales', {
          reseller_id: owner ? owner.id : 0,
          reseller_name: owner ? owner.hmp_name : label,
          router_id: baseRouter.id,
          profile_id: profile ? profile.id : 0,
          profile_name: profile ? profile.name : (entry.uptimeHint || ''),
          code: entry.code,
          password: held && held.password && held.password !== held.name ? held.password : '',
          price: entry.price != null ? entry.price : (profile ? profile.price : 0),
          validity: entry.validity || (profile ? profile.validity : ''),
          limit_uptime: profile ? (profile.limit_uptime || '') : (entry.uptimeHint || ''),
          comment: entry.comment,
          source: saleSourceFromAssigned(held || {}),
          sale_date: entry.date,
          created_at: connectedAt.toISOString(),
          script_key: entry.scriptName,
          connected_at: `${entry.date} ${entry.time || ''}`.trim(),
        });
        sold.add(`${baseRouter.id}:${entry.code}`);
        scriptKeys.add(entry.scriptName);
        if (held) await deleteOne('assigned', held.id);
        created += 1;
        createdHere += 1;
      }
      const removedHere = await reconcileMissingScriptSales(
        baseRouter.id,
        entries,
        String(windowFrom).slice(0, 10),
        String(windowTo).slice(0, 10),
        sales,
      );
      removed += removedHere;
      if (createdHere || removedHere) invalidateScriptListCache(baseRouter.id);
    }
    if ((created || removed) && typeof scheduleDriveBackup === 'function') scheduleDriveBackup();
    // Seulement les vraies erreurs réseau — pas de messages « Import OK » / listes de noms.
    let warning = warnings.join(' · ');
    if (!readOk && selected.length) {
      warning = warning || 'Impossible de lire les scripts MikroTik. Vérifiez que le routeur est joignable depuis cet appareil.';
    }
    return { created, removed, read, unmatched, warning };
  })();

  syncSalesCache.set(cacheKey, { promise: runPromise, expires: 0 });
  try {
    const result = await runPromise;
    syncSalesCache.set(cacheKey, {
      result,
      expires: Date.now() + SYNC_SALES_TTL_MS,
    });
    return result;
  } catch (error) {
    const current = syncSalesCache.get(cacheKey);
    if (current && current.promise === runPromise) syncSalesCache.delete(cacheKey);
    throw error;
  }
}


function pendingRemisesFrom(assigned, profiles, routers, resellerId) {
  return assigned
    .filter((item) => Number(item.reseller_id) === Number(resellerId) && item.handed_at)
    .map((item) => {
      const profile = profiles.find((entry) => (
        Number(entry.router_id) === Number(item.router_id) && entry.name === item.profile
      ));
      const router = routers.find((entry) => Number(entry.id) === Number(item.router_id));
      return {
        code: item.name,
        profile: item.profile,
        price: profile ? profile.price : null,
        validity: profile ? profile.validity : '',
        limitUptime: profile ? (profile.limit_uptime || '') : '',
        comment: item.comment || '',
        handedAt: item.handed_at,
        when: formatDateTime(item.handed_at),
        channel: item.channel === 'AP' ? 'AP' : 'LOT',
        routerId: item.router_id,
        loginUrl: router ? hotspotLoginUrl(router.host, item.name, item.password) : item.name,
      };
    })
    .sort((a, b) => String(b.handedAt || '').localeCompare(String(a.handedAt || '')));
}

async function pendingRemises(resellerId) {
  const [assigned, profiles, routers] = await Promise.all([
    getAll('assigned'),
    getAll('profiles'),
    getAll('routers'),
  ]);
  return pendingRemisesFrom(assigned, profiles, routers, resellerId);
}

async function listActiveSessions(router) {
  const results = await routerRun(router, [[
    '/ip/hotspot/active/print',
    '=.proplist=user,address,mac-address,uptime,idle-time,bytes-in,bytes-out,server,login-by,comment',
  ]], 10000);
  return results[0]?.rows || [];
}

async function activeUsersView({ resellerId = 0, routerId = 0 } = {}) {
  const routers = await getAll('routers');
  const selected = routers.filter((router) => !routerId || Number(router.id) === Number(routerId));
  const [sales, assigned, resellers] = await Promise.all([
    getAll('sales'),
    getAll('assigned'),
    getAll('resellers'),
  ]);
  const salesByKey = new Map(sales.map((sale) => [`${sale.router_id}:${sale.code}`, sale]));
  const assignedByKey = new Map(assigned.map((item) => [`${item.router_id}:${item.name}`, item]));
  const lockedReseller = resellerId ? await getOne('resellers', resellerId) : null;
  const sessions = [];
  let warning = '';
  for (const base of selected) {
    let router = base;
    if (resellerId) {
      if (!lockedReseller || Number(lockedReseller.router_id) !== Number(base.id)) continue;
      router = routerForReseller(base, lockedReseller) || base;
    }
    let rows = [];
    try {
      rows = await listActiveSessions(router);
    } catch (error) {
      warning = error.message || 'Impossible de lire les sessions actives.';
      continue;
    }
    const paidCodes = new Set();
    if (lockedReseller) {
      sales.forEach((sale) => {
        if (Number(sale.router_id) !== Number(base.id) || !sale.script_key) return;
        if (!resellerMatchesComment(lockedReseller, sale.comment, sale.reseller_name)
          && Number(sale.reseller_id) !== Number(lockedReseller.id)) return;
        paidCodes.add(sale.code);
      });
      assigned.forEach((item) => {
        if (Number(item.router_id) !== Number(base.id)) return;
        if (Number(item.reseller_id) !== Number(lockedReseller.id)) return;
        if (item.handed_at) paidCodes.add(item.name);
      });
    }
    rows.forEach((row) => {
      const code = String(row.user || '').trim();
      if (!code) return;
      const sale = salesByKey.get(`${base.id}:${code}`);
      const held = assignedByKey.get(`${base.id}:${code}`);
      if (lockedReseller) {
        if (!paidCodes.has(code)) return;
      }
      let ownerId = sale ? Number(sale.reseller_id) : (held ? Number(held.reseller_id) : 0);
      let seller = resellers.find((item) => Number(item.id) === Number(ownerId));
      if (!seller && sale) {
        seller = resellers.find((item) => (
          Number(item.router_id) === Number(base.id)
          && resellerMatchesComment(item, sale.comment, sale.reseller_name)
        ));
        if (seller) ownerId = seller.id;
      }
      if (lockedReseller) {
        if (Number(ownerId) !== Number(lockedReseller.id)
          && !(seller && Number(seller.id) === Number(lockedReseller.id))) {
          if (!sale || !resellerMatchesComment(lockedReseller, sale.comment, sale.reseller_name)) return;
          ownerId = lockedReseller.id;
          seller = lockedReseller;
        }
      }
      const liveComment = String(row.comment || '').trim();
      const durableComment = sale ? (sale.comment || '') : (held ? (held.comment || '') : '');
      sessions.push({
        code,
        address: row.address || '',
        mac: row['mac-address'] || '',
        uptime: row.uptime || '',
        idle: row['idle-time'] || '',
        bytesIn: Number(row['bytes-in'] || 0),
        bytesOut: Number(row['bytes-out'] || 0),
        server: row.server || '',
        loginBy: row['login-by'] || '',
        router: base.name,
        routerId: base.id,
        reseller: seller ? seller.hmp_name : (sale ? (sale.reseller_name || '') : ''),
        resellerId: ownerId || 0,
        profile: sale ? sale.profile_name : (held ? held.profile : ''),
        source: sale ? (sale.source === 'HAP' ? 'HAP' : 'AP') : (held ? 'AP' : ''),
        price: sale ? sale.price : null,
        comment: durableComment || liveComment,
        keyword: sale
          ? (resellerNameFromComment(sale.comment) || sale.reseller_name || '')
          : (held ? resellerNameFromComment(held.comment) : ''),
      });
    });
  }
  sessions.sort((a, b) => (
    String(b.uptime || '').localeCompare(String(a.uptime || ''), 'fr')
    || a.code.localeCompare(b.code, 'fr')
  ));
  return { sessions, warning, at: new Date().toISOString() };
}

function reportWindow(query, lockedResellerId) {
  const today = localDateISO(new Date());
  const month = currentMonthKey();
  const span = monthRange(month);
  let from = query.get('from') || today;
  let to = query.get('to') || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  return {
    today,
    monthFrom: span.start,
    monthNext: span.next,
    from,
    to,
    routerId: Number(query.get('routerId')) || 0,
    resellerId: lockedResellerId || Number(query.get('resellerId')) || 0,
  };
}

async function reportRows(range) {
  const sales = (await getAll('sales')).filter((sale) => sale.script_key);
  const inScope = (sale) => (
    (!range.resellerId || sale.reseller_id === range.resellerId)
    && (!range.routerId || sale.router_id === range.routerId)
  );
  const scoped = sales.filter(inScope);
  const period = scoped
    .filter((sale) => sale.sale_date >= range.from && sale.sale_date <= range.to)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    todayRows: scoped.filter((sale) => sale.sale_date === range.today),
    monthRows: scoped.filter((sale) => sale.sale_date >= range.monthFrom && sale.sale_date < range.monthNext),
    periodRows: period.slice(0, 500),
    periodAll: period,
    periodCount: period.length,
    periodAmount: sumPrices(period),
  };
}

async function purgeNonScriptSales() {
  if (salesPurgeClean) return 0;
  const sales = await getAll('sales');
  let removed = 0;
  for (const sale of sales) {
    if (sale.script_key) continue;
    await deleteOne('sales', sale.id);
    removed += 1;
  }
  salesPurgeClean = true;
  return removed;
}

/** Retire les ventes locales dont le script MikroTik n’existe plus (lecture réussie uniquement). */
async function reconcileMissingScriptSales(routerId, entries, windowFrom, windowTo, salesRows = null) {
  const liveKeys = new Set((entries || []).map((entry) => entry.scriptName).filter(Boolean));
  const sales = salesRows || await getAll('sales');
  let removed = 0;
  for (let index = sales.length - 1; index >= 0; index -= 1) {
    const sale = sales[index];
    if (Number(sale.router_id) !== Number(routerId)) continue;
    if (!sale.script_key) continue;
    const day = String(sale.sale_date || '').slice(0, 10);
    if (day && (day < windowFrom || day > windowTo)) continue;
    if (liveKeys.has(sale.script_key)) continue;
    await deleteOne('sales', sale.id);
    if (salesRows) sales.splice(index, 1);
    removed += 1;
  }
  return removed;
}

function sumPrices(rows) {
  return rows.reduce((total, sale) => total + (sale.price || 0), 0);
}

async function usageMap(rows) {
  const statuses = {};
  let warning = '';
  const groups = new Map();
  rows.forEach((sale) => {
    if (sale.script_key || sale.connected_at) {
      statuses[sale.id] = 'connecte';
      return;
    }
    if (!groups.has(sale.router_id)) groups.set(sale.router_id, []);
    groups.get(sale.router_id).push(sale);
  });
  const session = readSession();
  let sessionReseller = null;
  if (session && session.type === 'reseller' && !canUseRemoteHost()) {
    sessionReseller = await getOne('resellers', session.id);
  }
  for (const [routerId, group] of groups) {
    const router = await getOne('routers', routerId);
    if (!router) {
      group.forEach((sale) => { statuses[sale.id] = 'absent'; });
      continue;
    }
    const reach = routerForReseller(router, sessionReseller);
    try {
      const found = await readTicketUsage(reach, group.map((sale) => sale.code));
      group.forEach((sale) => {
        if (!found.has(sale.code) || found.get(sale.code) === null) statuses[sale.id] = 'absent';
        else statuses[sale.id] = found.get(sale.code) ? 'connecte' : 'attente';
      });
    } catch (error) {
      warning = error.message;
      group.forEach((sale) => { statuses[sale.id] = 'inconnu'; });
    }
  }
  return { statuses, warning };
}

async function removeHotspotUser(router, name) {
  const results = await routerRun(router, [[
    '/ip/hotspot/user/print',
    `?name=${name}`,
    '=.proplist=.id',
  ]]);
  const id = results[0]?.rows?.[0]?.['.id'];
  if (!id) return;
  await routerRun(router, [['/ip/hotspot/user/remove', `=.id=${id}`]]);
}

async function takeStock(resellerId, profileId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('stock', 'readwrite');
    const request = tx.objectStore('stock').get(`${resellerId}:${profileId}`);
    let taken = false;
    request.onsuccess = () => {
      const stock = request.result;
      if (!stock || stock.remaining < 1) return;
      stock.remaining -= 1;
      tx.objectStore('stock').put(stock);
      taken = true;
    };
    tx.oncomplete = () => resolve(taken);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Stock non mis à jour.'));
  });
}

async function restoreStock(resellerId, profileId) {
  const key = `${resellerId}:${profileId}`;
  const stock = await getOne('stock', key);
  if (!stock) return;
  stock.remaining += 1;
  await putOne('stock', stock);
}

async function passwordAlreadyUsed(password, exceptResellerId) {
  for (const admin of await getAll('admins')) {
    if (await verifyPassword(password, admin.password_hash)) return true;
  }
  for (const reseller of await getAll('resellers')) {
    if (exceptResellerId && reseller.id === exceptResellerId) continue;
    if (await verifyPassword(password, reseller.password_hash)) return true;
  }
  return false;
}

async function handle(method, url, body) {
  const parsed = new URL(url, 'http://app.local');
  const path = parsed.pathname;
  const query = parsed.searchParams;

  if (method === 'GET' && path === '/api/status') {
    const [admins, resellers] = await Promise.all([getAll('admins'), getAll('resellers')]);
    return ok({
      needsSetup: admins.length === 0 && resellers.length === 0,
      timeZone,
    });
  }

  if (method === 'POST' && path === '/api/invite/accept') {
    try {
      const result = await importResellerInvite(body.token || body.code || '');
      return ok(result);
    } catch (error) {
      return fail(400, error.message || 'Invitation refusée.');
    }
  }

  if (method === 'POST' && path === '/api/enter') {
    if (tooManyAttempts('enter')) return fail(429, 'Trop de tentatives. Réessayez dans une minute.');
    const password = String(body.password || '');
    const admins = await getAll('admins');
    const resellers = await getAll('resellers');
    if (admins.length === 0 && resellers.length === 0) {
      if (!(await ownerPasswordMatches(password))) {
        markAttempt('enter', false);
        return fail(401, 'Aucun compte sur cet appareil. Les revendeurs doivent d’abord « Rejoindre avec un code », puis entrer leur mot de passe.');
      }
      const id = await putOne('admins', {
        username: 'admin',
        password_hash: await hashPassword(password),
        created_at: new Date().toISOString(),
      });
      markAttempt('enter', true);
      writeSession({ type: 'admin', id });
      return ok({ role: 'admin' });
    }
    for (const candidate of admins) {
      if (await verifyPassword(password, candidate.password_hash)) {
        markAttempt('enter', true);
        writeSession({ type: 'admin', id: candidate.id });
        return ok({ role: 'admin' });
      }
    }
    for (const candidate of resellers) {
      if (await verifyPassword(password, candidate.password_hash)) {
        if (candidate.active !== 1) {
          markAttempt('enter', false);
          return fail(403, 'Ce compte est désactivé.');
        }
        markAttempt('enter', true);
        writeSession({ type: 'reseller', id: candidate.id });
        return ok({ role: 'reseller' });
      }
    }
    markAttempt('enter', false);
    return fail(401, 'Mot de passe incorrect.');
  }

  if (method === 'POST' && path === '/api/setup') {
    return fail(403, 'Mot de passe incorrect.');
  }

  if (method === 'POST' && path === '/api/admin/login') {
    if (tooManyAttempts('admin')) return fail(429, 'Trop de tentatives. Réessayez dans une minute.');
    const password = String(body.password || '');
    const admins = await getAll('admins');
    let admin = null;
    for (const candidate of admins) {
      if (await verifyPassword(password, candidate.password_hash)) {
        admin = candidate;
        break;
      }
    }
    markAttempt('admin', Boolean(admin));
    if (!admin) return fail(401, 'Mot de passe incorrect.');
    writeSession({ type: 'admin', id: admin.id });
    return ok({ ok: true });
  }

  if (method === 'POST' && path === '/api/vendeur/login') {
    if (tooManyAttempts('reseller')) return fail(429, 'Trop de tentatives. Réessayez dans une minute.');
    const password = String(body.password || '');
    const resellers = await getAll('resellers');
    let reseller = null;
    for (const candidate of resellers) {
      if (await verifyPassword(password, candidate.password_hash)) {
        reseller = candidate;
        break;
      }
    }
    markAttempt('reseller', Boolean(reseller && reseller.active === 1));
    if (!reseller) return fail(401, 'Mot de passe incorrect.');
    if (reseller.active !== 1) return fail(403, 'Ce compte est désactivé.');
    writeSession({ type: 'reseller', id: reseller.id });
    return ok({ ok: true });
  }

  if (method === 'POST' && path === '/api/logout') {
    writeSession(null);
    return ok({ ok: true });
  }

  const admin = requireSession('admin');
  const resellerSession = requireSession('reseller');

  if (path.startsWith('/api/admin') && !admin) return fail(401, 'Connexion requise.');
  if (path.startsWith('/api/vendeur') && !resellerSession) return fail(401, 'Connexion requise.');

  if (method === 'GET' && path === '/api/admin/me') {
    const row = await getOne('admins', admin.id);
    return ok({ username: row ? row.username : '', timeZone });
  }

  if (method === 'GET' && path === '/api/admin/backup') {
    return ok(await exportSnapshot());
  }

  if (method === 'POST' && path === '/api/admin/restore') {
    try {
      await importSnapshot(body);
      return ok({ ok: true });
    } catch (error) {
      return fail(400, error.message || 'Cette copie est inutilisable.');
    }
  }

  if (method === 'GET' && path === '/api/admin/routers') {
    const routers = await getAll('routers');
    routers.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return ok({ routers: routers.map(publicRouter) });
  }

  if (method === 'POST' && path === '/api/admin/routers') {
    const name = String(body.name || '').trim();
    const host = cleanHost(body.host);
    const adminHost = cleanHost(body.admin_host || body.adminHost || '');
    const portNumber = Number(body.port || 8728);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!name || name.length > 64) return fail(400, 'Indiquez le nom du PTP.');
    if (!host || host.length > 253) return fail(400, 'Indiquez l\'adresse Wi-Fi du point de vente.');
    if (adminHost && adminHost.length > 253) return fail(400, 'Adresse distante trop longue.');
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return fail(400, 'Le port API doit être entre 1 et 65535.');
    }
    if (!username || !password) return fail(400, 'Indiquez l\'utilisateur API et son mot de passe.');
    const id = await putOne('routers', {
      name,
      host,
      admin_host: adminHost,
      port: portNumber,
      username,
      password,
      created_at: new Date().toISOString(),
    });
    return ok({ router: publicRouter(await getOne('routers', id)) });
  }

  const routerMatch = path.match(/^\/api\/admin\/routers\/(\d+)$/);
  if (routerMatch && method === 'PATCH') {
    const current = await getOne('routers', Number(routerMatch[1]));
    if (!current) return fail(404, 'Routeur introuvable.');
    const name = String(body.name || '').trim();
    const host = cleanHost(body.host);
    const adminHost = cleanHost(body.admin_host || body.adminHost || '');
    const portNumber = Number(body.port || 8728);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!name || !host || !username) return fail(400, 'Nom, adresse Wi-Fi et utilisateur API sont requis.');
    if (adminHost && adminHost.length > 253) return fail(400, 'Adresse distante trop longue.');
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return fail(400, 'Le port API doit être entre 1 et 65535.');
    }
    current.name = name;
    current.host = host;
    current.admin_host = adminHost;
    current.port = portNumber;
    current.username = username;
    if (password) current.password = password;
    await putOne('routers', current);
    return ok({ router: publicRouter(current) });
  }

  if (routerMatch && method === 'DELETE') {
    const id = Number(routerMatch[1]);
    const used = (await getAll('resellers')).some((reseller) => reseller.router_id === id);
    if (used) return fail(400, 'Ce routeur a encore des revendeurs. Désactivez-les d\'abord.');
    const profiles = (await getAll('profiles')).filter((profile) => profile.router_id === id);
    const profileIds = new Set(profiles.map((profile) => profile.id));
    for (const stock of await getAll('stock')) {
      const profileId = Number(String(stock.id).split(':')[1]);
      if (profileIds.has(profileId)) await deleteOne('stock', stock.id);
    }
    for (const profile of profiles) await deleteOne('profiles', profile.id);
    await deleteOne('routers', id);
    return ok({ ok: true });
  }

  const routerAction = path.match(/^\/api\/admin\/routers\/(\d+)\/(test|sync)$/);
  if (routerAction && method === 'POST') {
    const row = await getOne('routers', Number(routerAction[1]));
    if (!row) return fail(404, 'Routeur introuvable.');
    try {
      if (routerAction[2] === 'test') {
        const result = await testRouter(row);
        return ok({ ok: true, identity: result.identity });
      }
      const remote = await fetchProfiles(row);
      const syncedAt = new Date().toISOString();
      const existing = (await getAll('profiles')).filter((profile) => profile.router_id === row.id);
      const names = new Set();
      for (const profile of remote) {
        const parsedProfile = parseProfileScript(profile.onLogin);
        const current = existing.find((item) => item.name === profile.name);
        const record = {
          router_id: row.id,
          name: profile.name,
          price: parsedProfile.price,
          validity: parsedProfile.validity,
          uptime_hint: parsedProfile.uptimeHint,
          limit_uptime: current ? current.limit_uptime : null,
          rate_limit: profile.rateLimit,
          on_login: profile.onLogin,
          active: 1,
          sellable: current && current.sellable === 0 ? 0 : 1,
          synced_at: syncedAt,
        };
        if (current) record.id = current.id;
        await putOne('profiles', record);
        names.add(profile.name);
      }
      for (const profile of existing) {
        if (!names.has(profile.name)) {
          profile.active = 0;
          await putOne('profiles', profile);
        }
      }
      return ok({ count: names.size, profiles: await profilesForRouter(row.id) });
    } catch (error) {
      return fail(502, error.message || 'Connexion impossible.');
    }
  }

  if (method === 'GET' && path === '/api/admin/profiles') {
    const routerId = Number(query.get('routerId'));
    if (!routerId) return ok({ profiles: [] });
    return ok({ profiles: await profilesForRouter(routerId) });
  }

  const profileMatch = path.match(/^\/api\/admin\/profiles\/(\d+)$/);
  if (profileMatch && method === 'PATCH') {
    const profile = await getOne('profiles', Number(profileMatch[1]));
    if (!profile) return fail(404, 'Forfait introuvable.');
    if (Object.prototype.hasOwnProperty.call(body, 'sellable')) {
      profile.sellable = body.sellable === false || body.sellable === 0 || body.sellable === '0' ? 0 : 1;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'limitUptime')) {
      const limitUptime = String(body.limitUptime || '').trim().toLowerCase();
      if (!isLimitUptime(limitUptime)) return fail(400, 'Durée invalide. Exemple : 3h, 30m, 1d.');
      profile.limit_uptime = limitUptime;
    }
    await putOne('profiles', profile);
    return ok({ profile: publicProfile(profile) });
  }

  if (method === 'GET' && path === '/api/admin/resellers') {
    const month = monthRange(query.get('month')) ? query.get('month') : currentMonthKey();
    const light = query.get('light') === '1';
    await purgeNonScriptSales();
    if (!light) await rematchAllScriptSalesOnce();
    const resellers = await getAll('resellers');
    resellers.sort((a, b) => a.hmp_name.localeCompare(b.hmp_name, 'fr'));
    const views = [];
    for (const reseller of resellers) views.push(await resellerView(reseller, month));
    return ok({ month, resellers: views });
  }

  const inviteMatch = path.match(/^\/api\/admin\/resellers\/(\d+)\/invite$/);
  if (inviteMatch && method === 'POST') {
    try {
      return ok(await buildResellerInvite(Number(inviteMatch[1])));
    } catch (error) {
      return fail(400, error.message || 'Invitation impossible.');
    }
  }

  if (method === 'POST' && path === '/api/admin/resellers') {
    const password = String(body.password || '');
    const hmpName = normalizeResellerName(body.hmpName);
    const routerId = Number(body.routerId);
    const host = cleanHost(body.host);
    const passwordError = validatePassword(password, 4);
    if (passwordError) return fail(400, passwordError);
    const nameError = validateResellerName(hmpName);
    if (nameError) return fail(400, nameError);
    const router = await getOne('routers', routerId);
    if (!router) return fail(400, 'Choisissez le routeur du PTP.');
    if (host && host.length > 253) return fail(400, 'Adresse du revendeur trop longue.');
    if (await passwordAlreadyUsed(password)) return fail(400, 'Ce mot de passe est déjà utilisé.');
    const ratePercent = parseRatePercent(body.ratePercent);
    if (body.ratePercent !== '' && body.ratePercent != null && ratePercent == null) {
      return fail(400, 'Le taux doit être un pourcentage entre 0 et 100.');
    }
    const month = currentMonthKey();
    const hmpCode = generateResellerCode(await usedCodesForMonth(month));
    const id = await putOne('resellers', {
      username: `${hmpName.toLowerCase()}-${Date.now().toString(36)}`,
      password_hash: await hashPassword(password),
      hmp_code: hmpCode,
      hmp_codes: { [month]: { '*': hmpCode } },
      hmp_name: hmpName,
      sale_keywords: parseSaleKeywords(body.saleKeywords),
      rate_percent: ratePercent,
      router_id: routerId,
      host: host || router.host || '',
      active: 1,
      created_at: new Date().toISOString(),
    });
    return ok({ reseller: await resellerView(await getOne('resellers', id), currentMonthKey()) });
  }

  const resellerMatch = path.match(/^\/api\/admin\/resellers\/(\d+)$/);
  if (resellerMatch && method === 'PATCH') {
    const current = await getOne('resellers', Number(resellerMatch[1]));
    if (!current) return fail(404, 'Revendeur introuvable.');
    const active = body.active === false || body.active === 0 ? 0 : 1;
    const password = String(body.password || '');
    let identityChanged = false;
    if (Object.prototype.hasOwnProperty.call(body, 'hmpName')) {
      const hmpName = normalizeResellerName(body.hmpName);
      const nameError = validateResellerName(hmpName);
      if (nameError) return fail(400, nameError);
      if (commentKey(current.hmp_name) !== commentKey(hmpName)) identityChanged = true;
      current.hmp_name = hmpName;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'saleKeywords')) {
      const nextKeywords = parseSaleKeywords(body.saleKeywords);
      const prev = JSON.stringify(Array.isArray(current.sale_keywords) ? current.sale_keywords : []);
      const next = JSON.stringify(nextKeywords);
      if (prev !== next) identityChanged = true;
      current.sale_keywords = nextKeywords;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'ratePercent')) {
      const ratePercent = parseRatePercent(body.ratePercent);
      if (body.ratePercent !== '' && body.ratePercent != null && ratePercent == null) {
        return fail(400, 'Le taux doit être un pourcentage entre 0 et 100.');
      }
      current.rate_percent = ratePercent;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'routerId')) {
      const routerId = Number(body.routerId);
      if (!(await getOne('routers', routerId))) return fail(400, 'Choisissez le routeur du PTP.');
      if (Number(current.router_id) !== routerId) identityChanged = true;
      current.router_id = routerId;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'host') || Object.prototype.hasOwnProperty.call(body, 'reachHost')) {
      const host = cleanHost(body.host);
      if (host && host.length > 253) return fail(400, 'Adresse du revendeur trop longue.');
      current.host = host;
    }
    if (password) {
      const passwordError = validatePassword(password, 4);
      if (passwordError) return fail(400, passwordError);
      if (await passwordAlreadyUsed(password, current.id)) return fail(400, 'Ce mot de passe est déjà utilisé.');
      current.password_hash = await hashPassword(password);
    }
    current.active = active;
    await putOne('resellers', current);
    if (identityChanged) {
      scriptSalesRematchSession = false;
      await rematchAllScriptSales();
      scriptSalesRematchSession = true;
    } else await rematchOrphanScriptSales();
    if (active === 0) {
      const session = readSession();
      if (session && session.type === 'reseller' && session.id === current.id) writeSession(null);
    }
    return ok({ reseller: await resellerView(current, currentMonthKey()) });
  }

  if (method === 'GET' && path === '/api/admin/reach') {
    return ok({ mode: adminReachMode() });
  }

  if (method === 'POST' && path === '/api/admin/reach') {
    return ok({ mode: setAdminReachMode(body.mode) });
  }

  if (method === 'GET' && path === '/api/admin/lots') {
    const reseller = await getOne('resellers', Number(query.get('resellerId')));
    if (!reseller) return fail(404, 'Revendeur introuvable.');
    const commentName = normalizeCommentName(query.get('commentName'));
    if (!commentName) return fail(400, 'Indiquez le nom présent dans le commentaire.');
    const router = await getOne('routers', reseller.router_id);
    if (!router) return fail(404, 'Routeur introuvable.');
    const sales = await getAll('sales');
    const assigned = await getAll('assigned');
    const book = await exactCommentOwners(router.id);
    const sold = new Set(sales.filter((sale) => sale.router_id === router.id).map((sale) => sale.code));
    const taken = new Set(assigned.filter((item) => item.router_id === router.id).map((item) => item.name));
    let rows = [];
    try {
      rows = await listHotspotUsersByComment(router, commentName);
    } catch (error) {
      return fail(502, error.message || 'Impossible de lire les tickets.');
    }
    const groups = new Map();
    rows.forEach((row) => {
      const key = commentKey(row.comment);
      if (!groups.has(key)) groups.set(key, { comment: String(row.comment || '').trim(), tickets: [] });
      groups.get(key).tickets.push(row);
    });
    const lots = [];
    let hidden = 0;
    groups.forEach((group) => {
      const profiles = [...new Set(group.tickets.map((row) => row.profile).filter(Boolean))];
      profiles.sort((a, b) => a.localeCompare(b, 'fr'));
      const others = otherOwnersOf(book, group.comment, reseller.id);
      let count = 0;
      let used = 0;
      group.tickets.forEach((row) => {
        if (sold.has(row.name) || taken.has(row.name)) {
          hidden += 1;
          return;
        }
        if (ticketConsumed(row)) {
          used += 1;
          return;
        }
        count += 1;
      });
      lots.push({
        comment: group.comment,
        profiles,
        count,
        used,
        blocked: others.length > 0,
        owner: others.join(', '),
      });
    });
    lots.sort((a, b) => a.comment.localeCompare(b.comment, 'fr'));
    return ok({ commentName, lots, hidden });
  }

  if (method === 'POST' && path === '/api/admin/lots') {
    const reseller = await getOne('resellers', Number(body.resellerId));
    if (!reseller) return fail(404, 'Revendeur introuvable.');
    const comments = [...new Set((Array.isArray(body.comments) ? body.comments : []).map((item) => String(item || '').trim()).filter(Boolean))];
    if (!comments.length) return fail(400, 'Cochez au moins un commentaire.');
    const router = await getOne('routers', reseller.router_id);
    if (!router) return fail(404, 'Routeur introuvable.');
    const commentName = normalizeCommentName(body.commentName);
    if (!commentName) return fail(400, 'Indiquez le nom présent dans le commentaire.');
    const wanted = new Set(comments.filter((item) => commentMatchesName(item, commentName)).map((item) => commentKey(item)));
    if (!wanted.size) return fail(400, 'Cochez au moins un commentaire.');
    let rows = [];
    try {
      rows = await listHotspotUsersByComment(router, commentName);
    } catch (error) {
      return fail(502, error.message || 'Impossible de lire les tickets.');
    }
    const book = await exactCommentOwners(router.id);
    const sales = await getAll('sales');
    const sold = new Set(sales.filter((sale) => sale.router_id === router.id).map((sale) => sale.code));
    let count = 0;
    for (const row of rows) {
      if (!wanted.has(commentKey(row.comment)) || sold.has(row.name) || ticketConsumed(row)) continue;
      if (otherOwnersOf(book, row.comment, reseller.id).length) continue;
      const existing = await getOne('assigned', `${router.id}:${row.name}`);
      if (existing) continue;
      await putOne('assigned', {
        id: `${router.id}:${row.name}`,
        router_id: router.id,
        reseller_id: reseller.id,
        name: row.name,
        password: row.password || row.name,
        profile: row.profile || '',
        comment: row.comment || '',
        assigned_at: new Date().toISOString(),
      });
      count += 1;
    }
    if (!count) return fail(400, 'Aucun ticket à attribuer pour ces commentaires.');
    return ok({ count });
  }

  if (method === 'POST' && path === '/api/admin/lots/retrait') {
    const reseller = await getOne('resellers', Number(body.resellerId));
    if (!reseller) return fail(404, 'Revendeur introuvable.');
    const comments = [...new Set((Array.isArray(body.comments) ? body.comments : []).map((item) => String(item || '').trim()))];
    const wanted = new Set(comments.map((item) => commentKey(item)));
    if (!wanted.size) return fail(400, 'Cochez au moins un commentaire.');
    const rows = (await getAll('assigned')).filter((item) => (
      item.reseller_id === reseller.id && wanted.has(commentKey(item.comment))
    ));
    for (const row of rows) await deleteOne('assigned', row.id);
    if (!rows.length) return fail(400, 'Ces commentaires ne sont plus attribués.');
    return ok({ count: rows.length });
  }

  if (method === 'POST' && path === '/api/admin/stock') {
    const resellerId = Number(body.resellerId);
    const profileId = Number(body.profileId);
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      return fail(400, 'Indiquez un nombre de tickets entre 1 et 10000.');
    }
    const reseller = await getOne('resellers', resellerId);
    const profile = await getOne('profiles', profileId);
    if (!reseller || !profile || profile.router_id !== reseller.router_id) {
      return fail(400, 'Ce forfait n\'appartient pas au routeur du revendeur.');
    }
    const key = `${resellerId}:${profileId}`;
    const stock = (await getOne('stock', key)) || { id: key, reseller_id: resellerId, profile_id: profileId, remaining: 0 };
    stock.remaining += quantity;
    await putOne('stock', stock);
    return ok({ remaining: stock.remaining });
  }

  if (method === 'GET' && path === '/api/admin/sales') {
    const range = reportWindow(query, 0);
    if (!range) return fail(400, 'La période est invalide.');
    const purged = await purgeNonScriptSales();
    const skipSync = query.get('sync') === '0';
    const sync = skipSync
      ? { warning: '', created: 0, removed: 0, read: 0 }
      : await syncHapSales({
        resellerId: range.resellerId,
        routerId: range.routerId,
        from: range.from,
        to: range.to,
        force: query.get('force') === '1',
      });
    const rows = await reportRows(range);
    const resellers = await getAll('resellers');
    const routers = await getAll('routers');
    let pendingItems = [];
    if (range.resellerId) {
      pendingItems = await pendingRemises(range.resellerId);
    } else {
      const allAssigned = await getAll('assigned');
      const allProfiles = await getAll('profiles');
      for (const reseller of resellers) {
        pendingItems = pendingItems.concat(
          pendingRemisesFrom(allAssigned, allProfiles, routers, reseller.id),
        );
      }
    }
    if (range.routerId) {
      pendingItems = pendingItems.filter((item) => Number(item.routerId) === Number(range.routerId));
    }
    const settlement = settlementFromSales(rows.periodAll, resellers, routers);
    return ok({
      todayDate: range.today,
      monthFrom: range.monthFrom,
      today: { count: rows.todayRows.length, amount: sumPrices(rows.todayRows) },
      month: { count: rows.monthRows.length, amount: sumPrices(rows.monthRows) },
      period: { from: range.from, to: range.to, count: rows.periodCount, amount: rows.periodAmount },
      settlement: {
        rate: settlement.rate,
        resellerShare: settlement.resellerShare,
        networkShare: settlement.networkShare,
        missingRate: settlement.missingRate,
        networkName: settlement.networkName,
        resellerName: settlement.resellerName,
      },
      sales: rows.periodRows.map((sale) => saleRecord(sale, resellers, routers)),
      pending: {
        count: pendingItems.length,
        amount: pendingItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0),
        items: pendingItems,
      },
      syncWarning: sync.warning || '',
      synced: sync.created || 0,
      syncedRemoved: sync.removed || 0,
      syncedRead: sync.read || 0,
      purged: purged || 0,
    });
  }

  if (method === 'GET' && path === '/api/admin/usage') {
    const range = reportWindow(query, 0);
    if (!range) return fail(400, 'La période est invalide.');
    const rows = await reportRows(range);
    const usage = await usageMap(rows.periodRows);
    return ok(usage);
  }

  if (method === 'GET' && path === '/api/admin/actifs') {
    const routerId = Number(query.get('routerId')) || 0;
    try {
      return ok(await activeUsersView({ routerId }));
    } catch (error) {
      return fail(502, error.message || 'Impossible de lire les sessions actives.');
    }
  }

  if (method === 'GET' && path === '/api/vendeur/me') {
    const reseller = await getOne('resellers', resellerSession.id);
    if (!reseller || reseller.active !== 1) return fail(403, 'Compte désactivé.');
    const router = await getOne('routers', reseller.router_id);
    return ok({
      name: reseller.hmp_name,
      routerName: router ? router.name : '',
      routerHost: resellerReachHost(router, reseller),
      ratePercent: parseRatePercent(reseller.rate_percent),
    });
  }

  if (method === 'GET' && path === '/api/vendeur/forfaits') {
    const reseller = await getOne('resellers', resellerSession.id);
    if (!reseller || reseller.active !== 1) return fail(403, 'Compte désactivé.');
    const [stocks, profiles, assigned, routers] = await Promise.all([
      getAll('stock'),
      getAll('profiles'),
      getAll('assigned'),
      getAll('routers'),
    ]);
    const forfaits = profiles
      .filter((profile) => (
        profile.router_id === reseller.router_id
        && profile.active
        && profileSellable(profile)
        && profile.price != null
        && profile.limit_uptime
      ))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((profile) => {
        const stock = stocks.find((item) => item.id === `${reseller.id}:${profile.id}`);
        return {
          id: profile.id,
          name: profile.name,
          price: profile.price,
          validity: profile.validity,
          limitUptime: profile.limit_uptime,
          remaining: stock ? stock.remaining : 0,
        };
      });
    const groups = new Map();
    assigned
      .filter((item) => Number(item.reseller_id) === Number(reseller.id))
      .forEach((item) => {
        const key = item.profile || '';
        if (!groups.has(key)) {
          const profile = profiles.find((entry) => entry.router_id === reseller.router_id && entry.name === key);
          groups.set(key, {
            profile: key,
            price: profile ? profile.price : null,
            validity: profile ? profile.validity : '',
            limitUptime: profile ? (profile.limit_uptime || '') : '',
            ready: Boolean(profile && profile.active === 1 && profile.price != null),
            remaining: 0,
            pending: 0,
          });
        }
        const group = groups.get(key);
        if (item.handed_at) group.pending += 1;
        else group.remaining += 1;
      });
    const lots = [...groups.values()].sort((a, b) => a.profile.localeCompare(b.profile, 'fr'));
    const router = routers.find((item) => Number(item.id) === Number(reseller.router_id));
    const pending = assigned
      .filter((item) => Number(item.reseller_id) === Number(reseller.id) && item.handed_at)
      .map((item) => {
        const profile = profiles.find((entry) => (
          Number(entry.router_id) === Number(item.router_id) && entry.name === item.profile
        ));
        return {
          code: item.name,
          profile: item.profile,
          price: profile ? profile.price : null,
          validity: profile ? profile.validity : '',
          limitUptime: profile ? (profile.limit_uptime || '') : '',
          comment: item.comment || '',
          handedAt: item.handed_at,
          when: formatDateTime(item.handed_at),
          channel: item.channel === 'AP' ? 'AP' : 'LOT',
          routerId: item.router_id,
          loginUrl: router ? hotspotLoginUrl(router.host, item.name, item.password) : item.name,
        };
      })
      .sort((a, b) => String(b.handedAt || '').localeCompare(String(a.handedAt || '')));
    return ok({ forfaits, lots, pending });
  }

  if (method === 'GET' && path === '/api/vendeur/ventes') {
    const range = reportWindow(query, resellerSession.id);
    if (!range) return fail(400, 'La période est invalide.');
    const purged = await purgeNonScriptSales();
    const sync = await syncHapSales({
      resellerId: resellerSession.id,
      from: range.from,
      to: range.to,
      force: query.get('force') === '1',
    });
    const rows = await reportRows(range);
    const resellers = await getAll('resellers');
    const routers = await getAll('routers');
    const pending = await pendingRemises(resellerSession.id);
    const settlement = settlementFromSales(rows.periodAll, resellers, routers);
    const me = resellers.find((item) => Number(item.id) === Number(resellerSession.id));
    const myRouter = me
      ? routers.find((item) => Number(item.id) === Number(me.router_id))
      : null;
    return ok({
      todayDate: range.today,
      monthFrom: range.monthFrom,
      today: { count: rows.todayRows.length, amount: sumPrices(rows.todayRows) },
      month: { count: rows.monthRows.length, amount: sumPrices(rows.monthRows) },
      period: { from: range.from, to: range.to, count: rows.periodCount, amount: rows.periodAmount },
      settlement: {
        rate: settlement.rate,
        resellerShare: settlement.resellerShare,
        networkShare: settlement.networkShare,
        missingRate: settlement.missingRate,
        networkName: settlement.networkName || (myRouter ? myRouter.name : ''),
        resellerName: settlement.resellerName || (me ? me.hmp_name : ''),
      },
      sales: rows.periodRows.map((sale) => saleRecord(sale, resellers, routers)),
      pending: {
        count: pending.length,
        amount: pending.reduce((sum, item) => sum + (Number(item.price) || 0), 0),
        items: pending,
      },
      syncWarning: sync.warning || '',
      synced: sync.created || 0,
      syncedRemoved: sync.removed || 0,
      syncedRead: sync.read || 0,
      purged: purged || 0,
    });
  }

  if (method === 'GET' && path === '/api/vendeur/usage') {
    const range = reportWindow(query, resellerSession.id);
    if (!range) return fail(400, 'La période est invalide.');
    const rows = await reportRows(range);
    return ok(await usageMap(rows.periodRows));
  }

  if (method === 'GET' && path === '/api/vendeur/actifs') {
    try {
      return ok(await activeUsersView({ resellerId: resellerSession.id }));
    } catch (error) {
      return fail(502, error.message || 'Impossible de lire les sessions actives.');
    }
  }

  if (method === 'POST' && path === '/api/vendeur/vendre') {
    const reseller = await getOne('resellers', resellerSession.id);
    if (!reseller || reseller.active !== 1) return fail(403, 'Compte désactivé.');
    const profile = await getOne('profiles', Number(body.profileId));
    if (!profile || profile.router_id !== reseller.router_id || profile.active !== 1 || !profileSellable(profile) || profile.price == null || !profile.limit_uptime) {
      return fail(400, 'Ce forfait n\'est pas disponible.');
    }
    if (!(await takeStock(reseller.id, profile.id))) return fail(400, 'Stock épuisé pour ce forfait.');
    const baseRouter = await getOne('routers', reseller.router_id);
    const router = routerForReseller(baseRouter, reseller);
    if (!router || !router.host) return fail(400, 'Adresse du routeur manquante pour ce revendeur.');
    const commentCode = await saleCommentCode(reseller, profile.id);
    if (!commentCode) return fail(500, 'Impossible de créer le code du mois pour ce forfait.');
    const comment = formatSaleComment({ code: commentCode, name: reseller.hmp_name });
    let code = '';
    let userCreated = false;
    let remisSaved = false;
    const soldAt = new Date();
    const saveRemise = async () => {
      await putOne('assigned', {
        id: `${reseller.router_id}:${code}`,
        router_id: reseller.router_id,
        reseller_id: reseller.id,
        name: code,
        password: code,
        profile: profile.name,
        comment,
        assigned_at: soldAt.toISOString(),
        handed_at: soldAt.toISOString(),
        channel: 'AP',
        profile_id: profile.id,
      });
      remisSaved = true;
    };
    try {
      const [sales, assigned] = await Promise.all([getAll('sales'), getAll('assigned')]);
      const used = new Set();
      sales.forEach((sale) => {
        if (Number(sale.router_id) === Number(reseller.router_id)) used.add(sale.code);
      });
      assigned.forEach((item) => {
        if (Number(item.router_id) === Number(reseller.router_id)) used.add(item.name);
      });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        let candidate = '';
        for (let pick = 0; pick < 24; pick += 1) {
          const next = generateTicketCode();
          if (!used.has(next)) {
            candidate = next;
            break;
          }
        }
        if (!candidate) break;
        used.add(candidate);
        if (await hotspotUserExists(router, candidate)) continue;
        code = candidate;
        break;
      }
      if (!code) throw new Error('Impossible de générer un code. Réessayez.');
      await createHotspotUser(router, {
        name: code,
        password: code,
        profile: profile.name,
        limitUptime: profile.limit_uptime,
        comment,
      });
      userCreated = true;
      await saveRemise();
      return ok(ticketResponse(baseRouter, {
        name: code,
        password: code,
        comment,
      }, profile, soldAt.toISOString()));
    } catch (error) {
      if (code && !userCreated && !remisSaved && error.code === 'TIMEOUT') {
        try {
          if (await hotspotUserExists(router, code)) userCreated = true;
        } catch {
          // Le routeur reste injoignable.
        }
      }
      if (userCreated && !remisSaved) {
        try {
          await saveRemise();
          return ok(ticketResponse(baseRouter, {
            name: code,
            password: code,
            comment,
          }, profile, soldAt.toISOString()));
        } catch {
          try {
            await removeHotspotUser(router, code);
            userCreated = false;
          } catch {
            return fail(500, `Le ticket ${code} a été créé sur le routeur. Notez-le : l'enregistrement local a échoué.`);
          }
        }
      }
      if (!remisSaved && !userCreated) await restoreStock(reseller.id, profile.id);
      return fail(502, error.message || 'La vente a échoué.');
    }
  }

  if (method === 'POST' && path === '/api/vendeur/vendre-lot') {
    const reseller = await getOne('resellers', resellerSession.id);
    if (!reseller || reseller.active !== 1) return fail(403, 'Compte désactivé.');
    const profileName = String(body.profile || '').trim();
    if (!profileName) return fail(400, 'Ce forfait n\'est pas disponible.');
    const profile = (await getAll('profiles')).find((item) => (
      item.router_id === reseller.router_id && item.name === profileName && item.active === 1 && item.price != null
    ));
    if (!profile) return fail(400, 'Le prix de ce forfait n\'est pas disponible. Chargez les forfaits dans l\'administration.');
    const baseRouter = await getOne('routers', reseller.router_id);
    const router = routerForReseller(baseRouter, reseller);
    if (!router || !router.host) return fail(400, 'Adresse du routeur manquante pour ce revendeur.');
    const sales = await getAll('sales');
    const waiting = (await getAll('assigned'))
      .filter((item) => (
        item.reseller_id === reseller.id
        && item.profile === profileName
        && !item.handed_at
        && !sales.some((sale) => sale.router_id === reseller.router_id && sale.code === item.name)
      ))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!waiting.length) return fail(400, 'Aucun ticket à remettre pour ce forfait.');
    const ticket = waiting[0];
    let scriptHit = null;
    try {
      scriptHit = await findSaleScriptForCode(router, ticket.name);
    } catch (error) {
      return fail(502, error.message || 'Impossible de vérifier ce ticket sur le routeur.');
    }
    if (scriptHit) {
      await syncHapSales({ resellerId: reseller.id, force: false });
      return fail(400, `Ce ticket est déjà connecté depuis le ${scriptHit.date} à ${scriptHit.time}. Ne le remettez pas.`);
    }
    const handedAt = new Date().toISOString();
    ticket.handed_at = handedAt;
    ticket.channel = ticket.channel || 'LOT';
    await putOne('assigned', ticket);
    return ok(ticketResponse(baseRouter, ticket, profile, handedAt));
  }

  if (method === 'POST' && path === '/api/vendeur/verifier') {
    const reseller = await getOne('resellers', resellerSession.id);
    if (!reseller || reseller.active !== 1) return fail(403, 'Compte désactivé.');
    const code = String(body.code || '').trim();
    if (!code) return fail(400, 'Indiquez le code du ticket.');
    const baseRouter = await getOne('routers', reseller.router_id);
    const router = routerForReseller(baseRouter, reseller);
    if (!router || !router.host) return fail(400, 'Adresse du routeur manquante pour ce revendeur.');
    let scriptHit = null;
    try {
      scriptHit = await findSaleScriptForCode(router, code);
    } catch (error) {
      return fail(502, error.message || 'Impossible de vérifier ce ticket sur le routeur.');
    }
    if (scriptHit) {
      await syncHapSales({ resellerId: reseller.id, force: false });
      return ok({
        status: 'sold',
        code,
        date: scriptHit.date,
        time: scriptHit.time || '',
        message: formatVenduMessage(scriptHit.date, scriptHit.time),
      });
    }
    const existingSale = await findSaleForCode(reseller.router_id, code);
    if (existingSale) {
      return ok({
        status: 'sold',
        code,
        date: existingSale.sale_date || '',
        time: '',
        message: formatVenduMessage(existingSale.connected_at || existingSale.sale_date || existingSale.created_at),
      });
    }
    const ticket = (await getAll('assigned')).find((item) => (
      Number(item.reseller_id) === Number(reseller.id)
      && item.name === code
    ));
    if (!ticket) return fail(404, 'Ticket introuvable pour votre compte (pas encore remis ou autre revendeur).');
    const profile = (await getAll('profiles')).find((item) => (
      item.router_id === reseller.router_id && item.name === ticket.profile && item.active === 1 && item.price != null
    ));
    if (!profile) return fail(400, 'Le forfait de ce ticket n\'est plus disponible.');
    const handedAt = new Date().toISOString();
    ticket.handed_at = ticket.handed_at || handedAt;
    await putOne('assigned', ticket);
    return ok({
      status: 'ready',
      ...ticketResponse(baseRouter, ticket, profile, ticket.handed_at),
      reused: true,
    });
  }

  if (method === 'POST' && path === '/api/vendeur/annuler-remise') {
    const reseller = await getOne('resellers', resellerSession.id);
    if (!reseller || reseller.active !== 1) return fail(403, 'Compte désactivé.');
    const code = String(body.code || '').trim();
    if (!code) return fail(400, 'Indiquez le code du ticket.');
    const baseRouter = await getOne('routers', reseller.router_id);
    const router = routerForReseller(baseRouter, reseller);
    if (!router || !router.host) return fail(400, 'Adresse du routeur manquante pour ce revendeur.');
    if (await saleExistsForCode(reseller.router_id, code)) {
      return fail(400, 'Ce ticket est déjà comptabilisé. Annulation impossible.');
    }
    let scriptHit = null;
    try {
      scriptHit = await findSaleScriptForCode(router, code);
    } catch (error) {
      return fail(502, error.message || 'Impossible de vérifier ce ticket sur le routeur.');
    }
    if (scriptHit) {
      await syncHapSales({ resellerId: reseller.id, force: false });
      return fail(400, `Ce ticket est déjà connecté depuis le ${scriptHit.date} à ${scriptHit.time}. Annulation impossible.`);
    }
    const ticket = (await getAll('assigned')).find((item) => (
      Number(item.reseller_id) === Number(reseller.id)
      && item.name === code
      && item.handed_at
    ));
    if (!ticket) return fail(404, 'Aucune remise en attente trouvée pour ce code.');
    if (ticket.channel === 'AP') {
      let profileId = Number(ticket.profile_id) || 0;
      if (!profileId && ticket.profile) {
        const profile = (await getAll('profiles')).find((item) => (
          item.router_id === reseller.router_id && item.name === ticket.profile
        ));
        profileId = profile ? Number(profile.id) : 0;
      }
      try {
        await removeHotspotUser(router, ticket.name);
      } catch (error) {
        return fail(502, error.message || 'Impossible de retirer le ticket du routeur.');
      }
      await deleteOne('assigned', ticket.id);
      if (profileId) await restoreStock(reseller.id, profileId);
      return ok({ cancelled: true, channel: 'AP', code: ticket.name, stockRestored: Boolean(profileId) });
    }
    delete ticket.handed_at;
    await putOne('assigned', ticket);
    return ok({ cancelled: true, channel: 'LOT', code: ticket.name, stockRestored: false });
  }

  return fail(404, 'Introuvable.');
}

function noteDataChange(method, url) {
  if (method === 'GET') return;
  const path = new URL(url, 'http://app.local').pathname;
  if (['/api/admin/backup', '/api/admin/restore', '/api/logout', '/api/enter', '/api/invite/accept', '/api/setup', '/api/admin/login', '/api/vendeur/login'].includes(path)) return;
  if (path.endsWith('/test') || path.endsWith('/usage') || path.endsWith('/actifs')) return;
  if (typeof scheduleDriveBackup === 'function') scheduleDriveBackup();
}

async function localApi(url, options = {}) {
  try {
    const method = options.method || 'GET';
    const result = await handle(method, url, options.body || {});
    if (result.error) throw new Error(result.error);
    noteDataChange(method, url);
    return result.data;
  } catch (error) {
    if (error && error.message && error.message !== 'Failed to execute') throw error;
    throw new Error('Stockage local indisponible.');
  }
}
