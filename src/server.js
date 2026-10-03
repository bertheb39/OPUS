import express from 'express';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { publicDir } from './paths.js';
import { decryptText, encryptText, hashPassword, loadKey, verifyPassword } from './secrets.js';
import {
  createHotspotUser,
  fetchProfiles,
  hotspotUserExists,
  removeHotspotUser,
  testRouter,
} from './mikrotik.js';
import {
  currentMonthKey,
  formatDateTime,
  formatSaleComment,
  generateResellerCode,
  generateTicketCode,
  isLimitUptime,
  localDateISO,
  monthRange,
  normalizeLimitUptime,
  normalizeResellerName,
  parseProfileScript,
  validateResellerName,
} from './hmp.js';

const key = loadKey();
const timeZone = process.env.APP_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
const port = Number(process.env.PORT) || 3080;
const sessionMs = 30 * 24 * 60 * 60 * 1000;
const loginAttempts = new Map();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/assets', express.static(publicDir));
app.use(express.static(publicDir));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

function adminCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM admins').get().count;
}

function routerConnection(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    password: decryptText(row.password_enc, key),
  };
}

function cleanHost(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').split('/')[0].trim();
}

function sendSession(res, userType, userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + sessionMs).toISOString();
  db.prepare('INSERT INTO sessions (token, user_type, user_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userType, userId, expires);
  res.setHeader('Set-Cookie', `opus_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionMs / 1000)}`);
}

function clearSession(res, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'opus_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function currentUser(req) {
  const token = readCookie(req, 'opus_session');
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (session.expires_at < new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return session;
}

function requireUser(type) {
  return (req, res, next) => {
    const session = currentUser(req);
    if (!session || session.user_type !== type) {
      res.status(401).json({ error: 'Connexion requise.' });
      return;
    }
    req.user = session;
    next();
  };
}

function guardMutation(req, res, next) {
  if (!sameOrigin(req)) {
    res.status(403).json({ error: 'Requête refusée.' });
    return;
  }
  next();
}

function tooManyAttempts(ip) {
  const entry = loginAttempts.get(ip);
  return entry && entry.count >= 8 && entry.until > Date.now();
}

function markAttempt(ip, success) {
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  const entry = loginAttempts.get(ip) || { count: 0, until: 0 };
  entry.count += 1;
  entry.until = Date.now() + 60 * 1000;
  loginAttempts.set(ip, entry);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(password, min) {
  if (String(password || '').length < min) {
    return `Le mot de passe doit contenir au moins ${min} caractères.`;
  }
  return '';
}

app.get('/', (_req, res) => {
  res.sendFile(`${publicDir}/index.html`);
});

app.get(['/v', '/vendeur'], (_req, res) => {
  res.sendFile(`${publicDir}/vendeur.html`);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/status', (_req, res) => {
  res.json({ needsSetup: adminCount() === 0, timeZone });
});

app.post('/api/setup', guardMutation, asyncRoute(async (req, res) => {
  if (adminCount() > 0) {
    res.status(403).json({ error: 'Le compte administrateur existe déjà.' });
    return;
  }
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const confirm = String(req.body?.confirm || '');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    res.status(400).json({ error: 'Identifiant : 3 à 32 lettres ou chiffres.' });
    return;
  }
  const passwordError = validatePassword(password, 8);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }
  if (password !== confirm) {
    res.status(400).json({ error: 'Les deux mots de passe ne correspondent pas.' });
    return;
  }
  const result = db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, await hashPassword(password), new Date().toISOString());
  sendSession(res, 'admin', Number(result.lastInsertRowid));
  res.json({ ok: true });
}));

app.post('/api/admin/login', guardMutation, asyncRoute(async (req, res) => {
  const ip = req.ip || 'local';
  if (tooManyAttempts(ip)) {
    res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une minute.' });
    return;
  }
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  const valid = admin ? await verifyPassword(password, admin.password_hash) : false;
  markAttempt(ip, valid);
  if (!valid) {
    res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    return;
  }
  sendSession(res, 'admin', admin.id);
  res.json({ ok: true });
}));

app.post('/api/vendeur/login', guardMutation, asyncRoute(async (req, res) => {
  const ip = req.ip || 'local';
  if (tooManyAttempts(ip)) {
    res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une minute.' });
    return;
  }
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const reseller = db.prepare('SELECT * FROM resellers WHERE username = ?').get(username);
  const valid = reseller ? await verifyPassword(password, reseller.password_hash) : false;
  markAttempt(ip, valid && reseller.active === 1);
  if (!valid) {
    res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    return;
  }
  if (reseller.active !== 1) {
    res.status(403).json({ error: 'Ce compte est désactivé.' });
    return;
  }
  sendSession(res, 'reseller', reseller.id);
  res.json({ ok: true });
}));

app.post('/api/logout', guardMutation, (req, res) => {
  clearSession(res, readCookie(req, 'opus_session'));
  res.json({ ok: true });
});

app.get('/api/admin/me', requireUser('admin'), (req, res) => {
  const admin = db.prepare('SELECT id, username FROM admins WHERE id = ?').get(req.user.user_id);
  res.json({ username: admin?.username || '', timeZone });
});

app.get('/api/admin/routers', requireUser('admin'), (_req, res) => {
  const rows = db.prepare('SELECT id, name, host, port, username FROM routers ORDER BY name COLLATE NOCASE').all();
  res.json({ routers: rows });
});

app.post('/api/admin/routers', requireUser('admin'), guardMutation, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const host = cleanHost(req.body?.host);
  const portNumber = Number(req.body?.port || 8728);
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!name || name.length > 64) {
    res.status(400).json({ error: 'Indiquez le nom du PTP.' });
    return;
  }
  if (!host || host.length > 253) {
    res.status(400).json({ error: 'Indiquez l\'adresse du routeur sur le réseau.' });
    return;
  }
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    res.status(400).json({ error: 'Le port API doit être entre 1 et 65535.' });
    return;
  }
  if (!username || !password) {
    res.status(400).json({ error: 'Indiquez l\'utilisateur API et son mot de passe.' });
    return;
  }
  const result = db.prepare(`
    INSERT INTO routers (name, host, port, username, password_enc, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, host, portNumber, username, encryptText(password, key), new Date().toISOString());
  const row = db.prepare('SELECT id, name, host, port, username FROM routers WHERE id = ?').get(result.lastInsertRowid);
  res.json({ router: row });
});

app.patch('/api/admin/routers/:id', requireUser('admin'), guardMutation, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM routers WHERE id = ?').get(id);
  if (!current) {
    res.status(404).json({ error: 'Routeur introuvable.' });
    return;
  }
  const name = String(req.body?.name || '').trim();
  const host = cleanHost(req.body?.host);
  const portNumber = Number(req.body?.port || 8728);
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!name || !host || !username) {
    res.status(400).json({ error: 'Nom, adresse et utilisateur API sont requis.' });
    return;
  }
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    res.status(400).json({ error: 'Le port API doit être entre 1 et 65535.' });
    return;
  }
  const passwordEnc = password ? encryptText(password, key) : current.password_enc;
  db.prepare(`
    UPDATE routers SET name = ?, host = ?, port = ?, username = ?, password_enc = ? WHERE id = ?
  `).run(name, host, portNumber, username, passwordEnc, id);
  const row = db.prepare('SELECT id, name, host, port, username FROM routers WHERE id = ?').get(id);
  res.json({ router: row });
});

app.delete('/api/admin/routers/:id', requireUser('admin'), guardMutation, (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) AS count FROM resellers WHERE router_id = ?').get(id).count;
  if (used > 0) {
    res.status(400).json({ error: 'Ce routeur a encore des revendeurs. Désactivez-les d\'abord.' });
    return;
  }
  db.prepare('DELETE FROM stock WHERE profile_id IN (SELECT id FROM profiles WHERE router_id = ?)').run(id);
  db.prepare('DELETE FROM profiles WHERE router_id = ?').run(id);
  db.prepare('DELETE FROM routers WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/admin/routers/:id/test', requireUser('admin'), guardMutation, asyncRoute(async (req, res) => {
  const row = db.prepare('SELECT * FROM routers WHERE id = ?').get(Number(req.params.id));
  if (!row) {
    res.status(404).json({ error: 'Routeur introuvable.' });
    return;
  }
  try {
    const result = await testRouter(routerConnection(row));
    res.json({ ok: true, identity: result.identity });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Connexion impossible.' });
  }
}));

app.post('/api/admin/routers/:id/sync', requireUser('admin'), guardMutation, asyncRoute(async (req, res) => {
  const row = db.prepare('SELECT * FROM routers WHERE id = ?').get(Number(req.params.id));
  if (!row) {
    res.status(404).json({ error: 'Routeur introuvable.' });
    return;
  }
  let remote;
  try {
    remote = await fetchProfiles(routerConnection(row));
  } catch (error) {
    res.status(502).json({ error: error.message || 'Chargement impossible.' });
    return;
  }
  const syncedAt = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO profiles (
      router_id, name, price, validity, uptime_hint, rate_limit, on_login, active, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT (router_id, name) DO UPDATE SET
      price = excluded.price,
      validity = excluded.validity,
      uptime_hint = excluded.uptime_hint,
      rate_limit = excluded.rate_limit,
      on_login = excluded.on_login,
      active = 1,
      synced_at = excluded.synced_at
  `);
  const names = [];
  for (const profile of remote) {
    const parsed = parseProfileScript(profile.onLogin);
    upsert.run(
      row.id,
      profile.name,
      parsed.price,
      parsed.validity,
      parsed.uptimeHint,
      profile.rateLimit,
      profile.onLogin,
      syncedAt,
    );
    names.push(profile.name);
  }
  if (names.length === 0) {
    db.prepare('UPDATE profiles SET active = 0 WHERE router_id = ?').run(row.id);
  } else {
    const marks = names.map(() => '?').join(',');
    db.prepare(`UPDATE profiles SET active = 0 WHERE router_id = ? AND name NOT IN (${marks})`)
      .run(row.id, ...names);
  }
  res.json({ count: names.length, profiles: profilesForRouter(row.id) });
}));

function profilesForRouter(routerId) {
  return db.prepare(`
    SELECT id, router_id, name, price, validity, uptime_hint, limit_uptime, rate_limit, active
    FROM profiles
    WHERE router_id = ?
    ORDER BY active DESC, name COLLATE NOCASE
  `).all(routerId);
}

app.get('/api/admin/profiles', requireUser('admin'), (req, res) => {
  const routerId = Number(req.query.routerId);
  if (!routerId) {
    res.json({ profiles: [] });
    return;
  }
  res.json({ profiles: profilesForRouter(routerId) });
});

app.patch('/api/admin/profiles/:id', requireUser('admin'), guardMutation, (req, res) => {
  const id = Number(req.params.id);
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!profile) {
    res.status(404).json({ error: 'Forfait introuvable.' });
    return;
  }
  const limitUptime = normalizeLimitUptime(req.body?.limitUptime);
  if (!isLimitUptime(limitUptime)) {
    res.status(400).json({ error: 'Durée invalide. Exemple : 3h, 30m, 1d.' });
    return;
  }
  db.prepare('UPDATE profiles SET limit_uptime = ? WHERE id = ?').run(limitUptime, id);
  res.json({ profile: db.prepare(`
    SELECT id, router_id, name, price, validity, uptime_hint, limit_uptime, rate_limit, active
    FROM profiles WHERE id = ?
  `).get(id) });
});

function resellerView(row, month) {
  const range = monthRange(month);
  const totals = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(price), 0) AS amount
    FROM sales
    WHERE reseller_id = ? AND sale_date >= ? AND sale_date < ?
  `).get(row.id, range.start, range.next);
  const stock = db.prepare(`
    SELECT p.id AS profileId, p.name, p.price, p.validity, p.limit_uptime,
           COALESCE(s.remaining, 0) AS remaining
    FROM profiles p
    LEFT JOIN stock s ON s.profile_id = p.id AND s.reseller_id = ?
    WHERE p.router_id = ? AND p.active = 1
    ORDER BY p.name COLLATE NOCASE
  `).all(row.id, row.router_id);
  return {
    id: row.id,
    username: row.username,
    hmpCode: row.hmp_code,
    hmpName: row.hmp_name,
    routerId: row.router_id,
    routerName: row.router_name,
    active: row.active === 1,
    soldCount: totals.count,
    soldAmount: totals.amount,
    stock,
  };
}

app.get('/api/admin/resellers', requireUser('admin'), (req, res) => {
  const month = monthRange(req.query.month) ? req.query.month : currentMonthKey(timeZone);
  const rows = db.prepare(`
    SELECT r.*, routers.name AS router_name
    FROM resellers r
    JOIN routers ON routers.id = r.router_id
    ORDER BY r.hmp_name COLLATE NOCASE
  `).all();
  res.json({ month, resellers: rows.map((row) => resellerView(row, month)) });
});

app.post('/api/admin/resellers', requireUser('admin'), guardMutation, asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const hmpName = normalizeResellerName(req.body?.hmpName);
  const routerId = Number(req.body?.routerId);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    res.status(400).json({ error: 'Identifiant : 3 à 32 lettres ou chiffres.' });
    return;
  }
  const passwordError = validatePassword(password, 6);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }
  const nameError = validateResellerName(hmpName);
  if (nameError) {
    res.status(400).json({ error: nameError });
    return;
  }
  const usedCodes = db.prepare('SELECT hmp_code FROM resellers').all().map((row) => row.hmp_code);
  const hmpCode = generateResellerCode(usedCodes);
  const router = db.prepare('SELECT id FROM routers WHERE id = ?').get(routerId);
  if (!router) {
    res.status(400).json({ error: 'Choisissez le routeur du PTP.' });
    return;
  }
  const taken = db.prepare('SELECT id FROM resellers WHERE username = ?').get(username);
  if (taken) {
    res.status(400).json({ error: 'Cet identifiant est déjà utilisé.' });
    return;
  }
  const result = db.prepare(`
    INSERT INTO resellers (username, password_hash, hmp_code, hmp_name, router_id, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(username, await hashPassword(password), hmpCode, hmpName, routerId, new Date().toISOString());
  const row = db.prepare(`
    SELECT r.*, routers.name AS router_name
    FROM resellers r JOIN routers ON routers.id = r.router_id
    WHERE r.id = ?
  `).get(result.lastInsertRowid);
  res.json({ reseller: resellerView(row, currentMonthKey(timeZone)) });
}));

app.patch('/api/admin/resellers/:id', requireUser('admin'), guardMutation, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM resellers WHERE id = ?').get(id);
  if (!current) {
    res.status(404).json({ error: 'Revendeur introuvable.' });
    return;
  }
  const active = req.body?.active === false || req.body?.active === 0 ? 0 : 1;
  const password = String(req.body?.password || '');
  if (password) {
    const passwordError = validatePassword(password, 6);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }
    db.prepare('UPDATE resellers SET active = ?, password_hash = ? WHERE id = ?')
      .run(active, await hashPassword(password), id);
  } else {
    db.prepare('UPDATE resellers SET active = ? WHERE id = ?').run(active, id);
  }
  if (active === 0) {
    db.prepare('DELETE FROM sessions WHERE user_type = ? AND user_id = ?').run('reseller', id);
  }
  const row = db.prepare(`
    SELECT r.*, routers.name AS router_name
    FROM resellers r JOIN routers ON routers.id = r.router_id
    WHERE r.id = ?
  `).get(id);
  res.json({ reseller: resellerView(row, currentMonthKey(timeZone)) });
}));

app.post('/api/admin/stock', requireUser('admin'), guardMutation, (req, res) => {
  const resellerId = Number(req.body?.resellerId);
  const profileId = Number(req.body?.profileId);
  const quantity = Number(req.body?.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    res.status(400).json({ error: 'Indiquez un nombre de tickets entre 1 et 10000.' });
    return;
  }
  const reseller = db.prepare('SELECT * FROM resellers WHERE id = ?').get(resellerId);
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!reseller || !profile || profile.router_id !== reseller.router_id) {
    res.status(400).json({ error: 'Ce forfait n\'appartient pas au routeur du revendeur.' });
    return;
  }
  db.prepare(`
    INSERT INTO stock (reseller_id, profile_id, remaining) VALUES (?, ?, ?)
    ON CONFLICT (reseller_id, profile_id) DO UPDATE SET remaining = remaining + excluded.remaining
  `).run(resellerId, profileId, quantity);
  const remaining = db.prepare('SELECT remaining FROM stock WHERE reseller_id = ? AND profile_id = ?')
    .get(resellerId, profileId).remaining;
  res.json({ remaining });
});

app.get('/api/admin/sales', requireUser('admin'), (req, res) => {
  const month = monthRange(req.query.month) ? String(req.query.month) : currentMonthKey(timeZone);
  const range = monthRange(month);
  const resellerId = Number(req.query.resellerId) || 0;
  const rows = resellerId
    ? db.prepare(`
        SELECT s.*, r.hmp_name, r.hmp_code
        FROM sales s JOIN resellers r ON r.id = s.reseller_id
        WHERE s.sale_date >= ? AND s.sale_date < ? AND s.reseller_id = ?
        ORDER BY s.created_at DESC
        LIMIT 1000
      `).all(range.start, range.next, resellerId)
    : db.prepare(`
        SELECT s.*, r.hmp_name, r.hmp_code
        FROM sales s JOIN resellers r ON r.id = s.reseller_id
        WHERE s.sale_date >= ? AND s.sale_date < ?
        ORDER BY s.created_at DESC
        LIMIT 1000
      `).all(range.start, range.next);
  const totals = rows.reduce((sum, row) => sum + (row.price || 0), 0);
  res.json({
    month,
    count: rows.length,
    amount: totals,
    sales: rows.map((row) => ({
      id: row.id,
      when: formatDateTime(row.created_at, timeZone),
      reseller: row.hmp_name,
      hmpCode: row.hmp_code,
      code: row.code,
      profile: row.profile_name,
      price: row.price,
      validity: row.validity,
      limitUptime: row.limit_uptime,
      comment: row.comment,
    })),
  });
});

app.get('/api/vendeur/me', requireUser('reseller'), (req, res) => {
  const reseller = db.prepare(`
    SELECT r.hmp_name, r.active, routers.name AS router_name
    FROM resellers r JOIN routers ON routers.id = r.router_id
    WHERE r.id = ?
  `).get(req.user.user_id);
  if (!reseller || reseller.active !== 1) {
    res.status(403).json({ error: 'Compte désactivé.' });
    return;
  }
  res.json({ name: reseller.hmp_name, routerName: reseller.router_name });
});

app.get('/api/vendeur/forfaits', requireUser('reseller'), (req, res) => {
  const reseller = db.prepare('SELECT * FROM resellers WHERE id = ? AND active = 1').get(req.user.user_id);
  if (!reseller) {
    res.status(403).json({ error: 'Compte désactivé.' });
    return;
  }
  const rows = db.prepare(`
    SELECT p.id, p.name, p.price, p.validity, p.limit_uptime AS limitUptime,
           COALESCE(s.remaining, 0) AS remaining
    FROM profiles p
    LEFT JOIN stock s ON s.profile_id = p.id AND s.reseller_id = ?
    WHERE p.router_id = ? AND p.active = 1
      AND p.price IS NOT NULL
      AND p.limit_uptime IS NOT NULL
      AND p.limit_uptime != ''
    ORDER BY p.name COLLATE NOCASE
  `).all(reseller.id, reseller.router_id);
  res.json({ forfaits: rows });
});

app.get('/api/vendeur/ventes', requireUser('reseller'), (req, res) => {
  const rows = db.prepare(`
    SELECT code, profile_name, price, validity, limit_uptime, created_at
    FROM sales
    WHERE reseller_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(req.user.user_id);
  res.json({
    sales: rows.map((row) => ({
      code: row.code,
      profile: row.profile_name,
      price: row.price,
      validity: row.validity,
      limitUptime: row.limit_uptime,
      when: formatDateTime(row.created_at, timeZone),
    })),
  });
});

app.post('/api/vendeur/vendre', requireUser('reseller'), guardMutation, asyncRoute(async (req, res) => {
  const reseller = db.prepare('SELECT * FROM resellers WHERE id = ?').get(req.user.user_id);
  if (!reseller || reseller.active !== 1) {
    res.status(403).json({ error: 'Compte désactivé.' });
    return;
  }
  const profile = db.prepare(`
    SELECT * FROM profiles WHERE id = ? AND router_id = ? AND active = 1
  `).get(Number(req.body?.profileId), reseller.router_id);
  if (!profile || profile.price == null || !profile.limit_uptime) {
    res.status(400).json({ error: 'Ce forfait n\'est pas disponible.' });
    return;
  }

  const decremented = db.prepare(`
    UPDATE stock SET remaining = remaining - 1
    WHERE reseller_id = ? AND profile_id = ? AND remaining > 0
  `).run(reseller.id, profile.id);
  if (decremented.changes !== 1) {
    res.status(400).json({ error: 'Stock épuisé pour ce forfait.' });
    return;
  }

  const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(reseller.router_id);
  const router = routerConnection(routerRow);
  const comment = formatSaleComment({
    code: reseller.hmp_code,
    name: reseller.hmp_name,
    timeZone,
  });
  let code = '';
  let userCreated = false;
  let saleSaved = false;
  const soldAt = new Date();

  const payload = () => ({
    code,
    profile: profile.name,
    price: profile.price,
    validity: profile.validity,
    limitUptime: profile.limit_uptime,
    comment,
    when: formatDateTime(soldAt.toISOString(), timeZone),
  });

  const insertSale = () => {
    db.prepare(`
      INSERT INTO sales (
        reseller_id, router_id, profile_id, profile_name, code, price, validity,
        limit_uptime, comment, sale_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reseller.id,
      reseller.router_id,
      profile.id,
      profile.name,
      code,
      profile.price,
      profile.validity,
      profile.limit_uptime,
      comment,
      localDateISO(soldAt, timeZone),
      soldAt.toISOString(),
    );
    saleSaved = true;
  };

  const restoreStock = () => {
    db.prepare('UPDATE stock SET remaining = remaining + 1 WHERE reseller_id = ? AND profile_id = ?')
      .run(reseller.id, profile.id);
  };

  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = generateTicketCode();
      const localHit = db.prepare('SELECT id FROM sales WHERE router_id = ? AND code = ?')
        .get(reseller.router_id, candidate);
      if (localHit) continue;
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
    insertSale();
    console.log(`Vente ${reseller.hmp_name} ${profile.name} ${code}`);
    res.json(payload());
  } catch (error) {
    if (code && !userCreated && !saleSaved && error.code === 'TIMEOUT') {
      try {
        if (await hotspotUserExists(router, code)) userCreated = true;
      } catch {
        // Le routeur est injoignable : le stock sera rendu si le ticket n'est pas confirmé.
      }
    }
    if (userCreated && !saleSaved) {
      try {
        insertSale();
        res.json(payload());
        return;
      } catch {
        try {
          await removeHotspotUser(router, code);
          userCreated = false;
        } catch {
          res.status(500).json({
            error: `Le ticket ${code} a été créé sur le routeur. Notez-le : l'enregistrement local a échoué.`,
          });
          return;
        }
      }
    }
    if (!saleSaved && !userCreated) restoreStock();
    const known = error.code === 'TRAP' || error.code === 'NETWORK' || error.code === 'TIMEOUT';
    res.status(502).json({ error: known ? error.message : (error.message || 'La vente a échoué.') });
  }
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (!res.headersSent) res.status(500).json({ error: 'Erreur interne.' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Administration : http://localhost:${port}/`);
  console.log(`Revendeurs     : http://localhost:${port}/v`);
});
