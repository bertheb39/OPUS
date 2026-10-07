const licenseCacheKey = 'opus.license';
const licenseDeviceKey = 'opus.deviceId';
const workspaceLicenseKey = 'opus.workspaceLicense';
const workspaceIdKey = 'opus.workspaceId';
const licenseGraceMs = 7 * 24 * 60 * 60 * 1000;

function firebaseLicenseReady() {
  return Boolean(
    typeof FIREBASE_API_KEY === 'string'
    && FIREBASE_API_KEY
    && !FIREBASE_API_KEY.startsWith('VOTRE_')
    && typeof FIREBASE_PROJECT_ID === 'string'
    && FIREBASE_PROJECT_ID
    && !FIREBASE_PROJECT_ID.includes('xxxxx'),
  );
}

function licenseToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function normalizeLicenseCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function readLicenseCache() {
  try {
    return JSON.parse(localStorage.getItem(licenseCacheKey) || 'null');
  } catch {
    return null;
  }
}

function licenseWorkspaceId() {
  let id = localStorage.getItem(workspaceIdKey);
  if (!id) {
    id = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(workspaceIdKey, id);
  }
  return id;
}

function rememberWorkspaceLicense(record) {
  if (!record?.code) return;
  if (record.workspaceId) localStorage.setItem(workspaceIdKey, record.workspaceId);
  localStorage.setItem(workspaceLicenseKey, JSON.stringify({
    code: record.code,
    clientName: record.clientName || '',
    plan: record.plan || '',
    status: record.status || '',
    endsAt: record.endsAt || '',
    workspaceId: record.workspaceId || localStorage.getItem(workspaceIdKey) || '',
    checkedAt: record.checkedAt || Date.now(),
  }));
}

function workspaceStatusUrl(id) {
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const key = encodeURIComponent(FIREBASE_API_KEY);
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/workspaces/${encodeURIComponent(id)}?key=${key}`;
}

async function publishWorkspaceStatus(record) {
  if (!firebaseLicenseReady() || !record?.code) return;
  const id = record.workspaceId || localStorage.getItem(workspaceIdKey);
  if (!id) return;
  const body = JSON.stringify({
    fields: {
      code: { stringValue: record.code },
      clientName: { stringValue: record.clientName || '' },
      plan: { stringValue: record.plan || '' },
      status: { stringValue: record.status || '' },
      endsAt: { stringValue: record.endsAt || '' },
    },
  });
  const patched = await firestoreRequest(
    `${workspaceStatusUrl(id)}&updateMask.fieldPaths=code&updateMask.fieldPaths=clientName&updateMask.fieldPaths=plan&updateMask.fieldPaths=status&updateMask.fieldPaths=endsAt`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
  );
  if (patched.ok || patched.status !== 404) return;
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const key = encodeURIComponent(FIREBASE_API_KEY);
  await firestoreRequest(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/workspaces?documentId=${encodeURIComponent(id)}&key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
  );
}

function publishWorkspaceLicense(record) {
  const workspaceId = record.workspaceId || licenseWorkspaceId();
  rememberWorkspaceLicense({ ...record, workspaceId });
  if (typeof localApi !== 'function' || !record?.code) return;
  localApi('/api/settings/license', {
    method: 'PUT',
    body: {
      code: record.code,
      clientName: record.clientName || '',
      plan: record.plan || '',
      status: record.status || '',
      endsAt: record.endsAt || '',
      workspaceId,
    },
  }).catch(() => {});
  publishWorkspaceStatus({ ...record, workspaceId }).catch(() => {});
}

function writeLicenseCache(record) {
  localStorage.setItem(licenseCacheKey, JSON.stringify({
    ...record,
    checkedAt: Date.now(),
  }));
  publishWorkspaceLicense(record);
}

function readSharedWorkspaceLicense() {
  try {
    return JSON.parse(localStorage.getItem(workspaceLicenseKey) || 'null');
  } catch {
    return null;
  }
}

function workspaceLicenseRecord() {
  const shared = readSharedWorkspaceLicense();
  const owner = readLicenseCache();
  const resellerSurface = typeof document !== 'undefined'
    && document.body?.classList.contains('page-vendeur')
    && typeof isOwner === 'function'
    && !isOwner();
  if (resellerSurface) return shared || null;
  if (owner?.plan === 'fondateur' && licenseAllows(owner)) return owner;
  return owner || shared;
}

function licenseFrozen(record = workspaceLicenseRecord()) {
  if (!record || record.plan === 'fondateur') return false;
  if (record.status === 'revoked' || record.status === 'suspended') return true;
  if (record.endsAt && record.endsAt < licenseToday()) return true;
  return false;
}

function licenseBlocksLiveOps() {
  return licenseFrozen();
}

function licenseResellerAlert() {
  const name = String(workspaceLicenseRecord()?.clientName || '').trim();
  return name
    ? `Alerte Ab. Veuillez contacter ${name}`
    : 'Alerte Ab. Veuillez contacter l’administrateur.';
}

function licenseLiveOpsMessage() {
  return licenseResellerAlert();
}

function workspaceLicenseSnapshot() {
  const record = workspaceLicenseRecord();
  if (!record?.code) return null;
  return {
    code: record.code,
    clientName: record.clientName || '',
    plan: record.plan || '',
    status: record.status || '',
    endsAt: record.endsAt || '',
    workspaceId: record.workspaceId || localStorage.getItem(workspaceIdKey) || '',
  };
}

function licenseDeviceId() {
  let id = localStorage.getItem(licenseDeviceKey);
  if (!id) {
    id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(licenseDeviceKey, id);
  }
  return id;
}

function firestoreString(fields, name) {
  return String(fields?.[name]?.stringValue || '');
}

function parseLicenseDoc(doc) {
  const fields = doc.fields || {};
  return {
    clientName: firestoreString(fields, 'clientName'),
    phone: firestoreString(fields, 'phone'),
    plan: firestoreString(fields, 'plan').toLowerCase(),
    status: firestoreString(fields, 'status').toLowerCase(),
    startsAt: firestoreString(fields, 'startsAt'),
    endsAt: firestoreString(fields, 'endsAt'),
    deviceId: firestoreString(fields, 'deviceId'),
  };
}

function licensePhoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 8) return '';
  return digits.slice(-9);
}

function sameClientName(left, right) {
  const norm = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const a = norm(left);
  const b = norm(right);
  return Boolean(a && a === b);
}

function licenseLookupUrl(phoneKey) {
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const id = encodeURIComponent(phoneKey);
  const key = encodeURIComponent(FIREBASE_API_KEY);
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/license_lookups/${id}?key=${key}`;
}

async function publishLicenseLookup(record) {
  const phoneKey = licensePhoneKey(record?.phone);
  const code = normalizeLicenseCode(record?.code);
  if (!phoneKey || !code || code.startsWith('HT-ESSAI') || record.plan === 'fondateur') return;
  const body = JSON.stringify({
    fields: {
      code: { stringValue: code },
      clientName: { stringValue: record.clientName || '' },
      phone: { stringValue: record.phone || '' },
    },
  });
  const patched = await firestoreRequest(
    `${licenseLookupUrl(phoneKey)}&updateMask.fieldPaths=code&updateMask.fieldPaths=clientName&updateMask.fieldPaths=phone`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
  );
  if (patched.ok) return;
  if (patched.status !== 404) return;
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const key = encodeURIComponent(FIREBASE_API_KEY);
  await firestoreRequest(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/license_lookups?documentId=${encodeURIComponent(phoneKey)}&key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
  );
}

async function resolveLicenseByIdentity({ clientName, phone }) {
  const phoneKey = licensePhoneKey(phone);
  if (!phoneKey) throw new Error('Indiquez le numéro enregistré à l’abonnement.');
  const response = await firestoreRequest(licenseLookupUrl(phoneKey));
  if (response.status === 404) {
    throw new Error('Aucun abonnement pour ce numéro. Vérifiez le téléphone, ou contactez HORIZON TEAM.');
  }
  if (!response.ok) throw new Error('Recherche impossible pour le moment.');
  const fields = (await response.json()).fields || {};
  const code = firestoreString(fields, 'code');
  const name = firestoreString(fields, 'clientName');
  if (!sameClientName(clientName, name)) throw new Error('Le nom ne correspond pas à ce numéro.');
  if (!code) throw new Error('Fiche incomplète. Contactez HORIZON TEAM.');
  return { code, clientName: name, phone: firestoreString(fields, 'phone') || phone };
}

async function recoverLicenseByIdentity({ clientName, phone }) {
  const found = await resolveLicenseByIdentity({ clientName, phone });
  await activateLicense(found.code);
}

function passwordResetDocUrl(code) {
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const id = encodeURIComponent(normalizeLicenseCode(code));
  const key = encodeURIComponent(FIREBASE_API_KEY);
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/password_resets/${id}?key=${key}`;
}

async function fetchPasswordReset(code) {
  const response = await firestoreRequest(passwordResetDocUrl(code));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Vérification de l’autorisation impossible.');
  const fields = (await response.json()).fields || {};
  return {
    code: firestoreString(fields, 'code') || code,
    until: firestoreString(fields, 'until'),
    used: firestoreString(fields, 'used'),
  };
}

async function writePasswordReset(code, record) {
  const body = JSON.stringify({
    fields: {
      code: { stringValue: normalizeLicenseCode(code) },
      until: { stringValue: record.until || '' },
      used: { stringValue: record.used || '0' },
    },
  });
  const patched = await firestoreRequest(
    `${passwordResetDocUrl(code)}&updateMask.fieldPaths=code&updateMask.fieldPaths=until&updateMask.fieldPaths=used`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
  );
  if (patched.ok) return;
  if (patched.status !== 404) throw new Error('Autorisation non enregistrée. Publiez les règles password_resets.');
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const key = encodeURIComponent(FIREBASE_API_KEY);
  const created = await firestoreRequest(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/password_resets?documentId=${encodeURIComponent(normalizeLicenseCode(code))}&key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
  );
  if (!created.ok) throw new Error('Autorisation non enregistrée. Publiez les règles password_resets.');
}

async function authorizePasswordReset(code) {
  const until = new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString();
  await writePasswordReset(code, { until, used: '0' });
  return until;
}

async function consumeAuthorizedPasswordReset({ clientName, phone }) {
  const found = await resolveLicenseByIdentity({ clientName, phone });
  const reset = await fetchPasswordReset(found.code);
  if (!reset || reset.used === '1' || !reset.until || reset.until < new Date().toISOString()) {
    throw new Error('Réinitialisation non autorisée. Contactez HORIZON TEAM.');
  }
  return { code: found.code, until: reset.until };
}

async function markPasswordResetUsed(code, until) {
  try {
    await writePasswordReset(code, { until: until || '', used: '1' });
  } catch { /* l’autorisation expire dans les 24 h */ }
}

function licenseAllows(record) {
  if (!record) return false;
  if (record.plan === 'fondateur') return true;
  if (record.status !== 'active') return false;
  if (record.endsAt && record.endsAt < licenseToday()) return false;
  return true;
}

function licenseLocksOneDevice(record) {
  return Boolean(record && record.plan && record.plan !== 'fondateur');
}

function licenseDeviceTaken(record, deviceId) {
  if (!licenseLocksOneDevice(record)) return false;
  return Boolean(record.deviceId && record.deviceId !== deviceId);
}

const LICENSE_RIGHTS = {
  basique: {
    maxRouters: 1, maxResellers: 2, maxResellersPerRouter: 2, drive: false,
    blurb: '1 routeur · 2 revendeurs · sauvegarde fichier · pas de Drive',
  },
  standard: {
    maxRouters: 1, maxResellers: 5, maxResellersPerRouter: 5, drive: true,
    blurb: '1 routeur · 5 revendeurs · Drive · formation',
  },
  essai: {
    maxRouters: 1, maxResellers: 5, maxResellersPerRouter: 5, drive: true, days: 5,
    blurb: '5 jours au niveau Standard, puis abonnement',
  },
  pro: {
    maxRouters: 5, maxResellers: 30, maxResellersPerRouter: 10, drive: true,
    blurb: 'Jusqu’à 5 routeurs · 10 revendeurs / routeur (max 30) · Drive',
  },
  fondateur: {
    maxRouters: 99, maxResellers: 999, maxResellersPerRouter: 999, drive: true,
    blurb: 'Illimité · Drive · non revendable',
  },
};

function currentLicensePlan() {
  const cache = readLicenseCache();
  if (!cache || !licenseAllows(cache)) return '';
  return String(cache.plan || '');
}

function isFounderLicense() {
  return currentLicensePlan() === 'fondateur';
}

function licenseRights(plan) {
  const key = plan || currentLicensePlan() || 'basique';
  return LICENSE_RIGHTS[key] || LICENSE_RIGHTS.basique;
}

function licenseAllowsDrive(plan) {
  return Boolean(licenseRights(plan).drive);
}

function formatLicenseDate(iso) {
  const value = String(iso || '').slice(0, 10);
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function licenseRemainingLabel(record = workspaceLicenseRecord() || readLicenseCache()) {
  if (!record || record.plan === 'fondateur') return '';
  if (licenseFrozen(record)) return 'Terminé';
  const days = licenseDaysLeft(record);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return 'Dernier jour';
  if (days === 1) return '1 jour restant';
  return `${days} jours restants`;
}

function licenseStatusCardHtml() {
  if (typeof isFounderLicense === 'function' && isFounderLicense()) return '';
  const record = workspaceLicenseRecord() || readLicenseCache();
  const plan = currentLicensePlan() || record?.plan || '';
  const remaining = licenseRemainingLabel(record);
  const until = formatLicenseDate(record?.endsAt);
  const frozen = licenseFrozen(record);
  return `
    <section class="card license-status-card${frozen ? ' is-expired' : ''}">
      <h2>Mon abonnement</h2>
      <p><strong>${esc(licensePlanLabel(plan || (frozen ? record?.plan : '') || 'Aucune offre'))}</strong></p>
      ${until ? `<p class="meta">Valable jusqu’au ${esc(until)}</p>` : ''}
      ${remaining ? `<p class="license-remaining">${esc(remaining)}</p>` : '<p class="meta">Durée non définie.</p>'}
      <button type="button" class="btn-quiet btn-block" data-action="manage-subscription">${frozen ? 'Renouveler' : 'Gérer mon abonnement'}</button>
    </section>
  `;
}

function licenseDaysLeft(record = readLicenseCache()) {
  if (!record?.endsAt || record.plan === 'fondateur') return Infinity;
  const today = new Date(`${licenseToday()}T00:00:00`);
  const end = new Date(`${record.endsAt}T00:00:00`);
  if (Number.isNaN(today.getTime()) || Number.isNaN(end.getTime())) return Infinity;
  return Math.round((end - today) / 86400000);
}

function licenseExpiryWarning(record = workspaceLicenseRecord() || readLicenseCache()) {
  if (!record || record.plan === 'fondateur') return null;
  if (licenseFrozen(record)) {
    const kind = record.plan === 'essai' ? 'essai' : 'abonnement';
    return {
      days: -1,
      kind,
      expired: true,
      text: kind === 'essai'
        ? 'Votre essai est terminé. Choisissez une offre pour continuer.'
        : 'Abonnement terminé. Choisissez une offre pour le renouveler.',
    };
  }
  if (!licenseAllows(record)) return null;
  const days = licenseDaysLeft(record);
  const limit = record.plan === 'essai' ? 2 : 7;
  if (!Number.isFinite(days) || days > limit) return null;
  const kind = record.plan === 'essai' ? 'essai' : 'abonnement';
  const when = days <= 0
    ? `Dernier jour de votre ${kind}`
    : `Votre ${kind} se termine dans ${days} jour${days > 1 ? 's' : ''}`;
  return { days, kind, text: `${when} (${record.endsAt}).` };
}

function licenseHoldBannerHtml(role) {
  if (!licenseFrozen()) return '';
  if (role === 'reseller') {
    return `<section class="card license-expiry-banner" id="license-expiry-banner"><p><strong>${esc(licenseResellerAlert())}</strong></p></section>`;
  }
  const warning = licenseExpiryWarning() || { text: licenseBlockMessage(workspaceLicenseRecord()) };
  return `
    <section class="card license-expiry-banner" id="license-expiry-banner">
      <p><strong>${esc(warning.text)}</strong></p>
      <p class="meta">La liaison au routeur et les ventes sont coupées. Les données déjà enregistrées restent visibles.</p>
      <button type="button" class="btn-sell" data-action="manage-subscription">Renouveler</button>
    </section>
  `;
}

function licenseCanRenew(record) {
  if (!record) return true;
  if (record.status === 'revoked') return false;
  return true;
}

function licenseBlockMessage(record) {
  if (!record) return 'Licence requise.';
  if (record.status === 'suspended') return 'Abonnement interrompu. Choisissez une offre ou contactez HORIZON TEAM.';
  if (record.status === 'revoked') return 'Cette licence a été retirée.';
  if (record.endsAt && record.endsAt < licenseToday()) {
    if (record.plan === 'essai') return 'Votre essai de 5 jours est terminé. Choisissez une offre pour continuer.';
    return 'Abonnement terminé. Choisissez une offre pour le renouveler.';
  }
  return 'Licence inactive.';
}

function licenseDocUrl(code) {
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const id = encodeURIComponent(code);
  const key = encodeURIComponent(FIREBASE_API_KEY);
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/licenses/${id}?key=${key}`;
}

async function firestoreRequest(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) || 15000;
  const fetchOptions = { ...options };
  delete fetchOptions.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Firebase ne répond pas (délai dépassé).');
    throw new Error('Pas d’accès à Firebase. Vérifiez Internet, puis réessayez.');
  } finally {
    clearTimeout(timer);
  }
}

async function firestoreFail(response, fallback, code = '') {
  let detail = '';
  try {
    const data = await response.json();
    detail = String(data?.error?.message || '');
  } catch { /* ignore */ }
  if (response.status === 404) {
    return detail
      ? `Introuvable dans le projet ${FIREBASE_PROJECT_ID}. ${detail}`
      : `Document licenses/${code || codeHint()} introuvable dans le projet ${FIREBASE_PROJECT_ID}.`;
  }
  if (response.status === 403 || /PERMISSION_DENIED/i.test(detail)) {
    return 'Firestore a refusé l’accès. Republiez les règles, et activez l’API Cloud Firestore.';
  }
  return detail || fallback;
}

function codeHint() {
  return 'ce code';
}

async function fetchLicenseRemote(code) {
  const response = await firestoreRequest(licenseDocUrl(code));
  if (!response.ok) throw new Error(await firestoreFail(response, 'Vérification impossible pour le moment.', code));
  return parseLicenseDoc(await response.json());
}

async function seedFounderLicense(code) {
  if (code !== 'HT-FONDATEUR-001') return false;
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const key = encodeURIComponent(FIREBASE_API_KEY);
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/licenses?documentId=${encodeURIComponent(code)}&key=${key}`;
  const response = await firestoreRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        clientName: { stringValue: 'HORIZON TEAM' },
        phone: { stringValue: '' },
        plan: { stringValue: 'fondateur' },
        status: { stringValue: 'active' },
        startsAt: { stringValue: '2026-10-07' },
        endsAt: { stringValue: '2099-12-31' },
        deviceId: { stringValue: '' },
        notes: { stringValue: 'Licence interne' },
      },
    }),
  });
  if (response.ok || response.status === 409) return true;
  return false;
}

async function bindLicenseDevice(code, deviceId) {
  const response = await firestoreRequest(`${licenseDocUrl(code)}&updateMask.fieldPaths=deviceId`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: { deviceId: { stringValue: deviceId } },
    }),
  });
  if (!response.ok) throw new Error(await firestoreFail(response, 'Impossible de lier cet appareil.'));
}

function clearLicenseGate() {
  const root = document.getElementById('license-gate');
  if (root) root.remove();
  document.body.classList.remove('license-locked');
}

const SUBSCRIPTION_PERIODS = [
  { months: 1, label: '1 mois' },
  { months: 3, label: '3 mois' },
  { months: 12, label: '12 mois' },
];

function defaultSubscriptionPlans() {
  return [
    { id: 'basique', name: 'Basique', price: '', price3: '', price12: '', blurb: LICENSE_RIGHTS.basique.blurb, active: '1' },
    { id: 'standard', name: 'Standard', price: '', price3: '', price12: '', blurb: LICENSE_RIGHTS.standard.blurb, active: '1' },
    { id: 'pro', name: 'Pro', price: '', price3: '', price12: '', blurb: LICENSE_RIGHTS.pro.blurb, active: '1' },
  ];
}

function normalizePeriodMonths(raw) {
  const months = Number(raw);
  if (months === 3 || months === 12) return months;
  return 1;
}

function periodLabel(months) {
  const value = normalizePeriodMonths(months);
  return SUBSCRIPTION_PERIODS.find((item) => item.months === value)?.label || `${value} mois`;
}

function licenseAddMonths(iso, months) {
  const date = new Date(`${String(iso || '').slice(0, 10)}T00:00:00`);
  const base = Number.isNaN(date.getTime()) ? new Date() : date;
  const day = base.getDate();
  base.setDate(1);
  base.setMonth(base.getMonth() + Number(months || 1));
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(day, last));
  const month = String(base.getMonth() + 1).padStart(2, '0');
  const dayPart = String(base.getDate()).padStart(2, '0');
  return `${base.getFullYear()}-${month}-${dayPart}`;
}

function parsePlanDoc(doc) {
  const id = decodeURIComponent(String(doc.name || '').split('/').pop() || '');
  const fields = doc.fields || {};
  return {
    id,
    name: firestoreString(fields, 'name') || id,
    price: firestoreString(fields, 'price'),
    price3: firestoreString(fields, 'price3'),
    price12: firestoreString(fields, 'price12'),
    days: firestoreString(fields, 'days'),
    blurb: firestoreString(fields, 'blurb'),
    active: firestoreString(fields, 'active') || '1',
  };
}

function planPriceLabel(plan) {
  if (plan.price === '' || plan.price == null) return 'Sur demande';
  const amount = Number(plan.price);
  if (!Number.isFinite(amount) || amount <= 0) return 'Gratuit';
  return typeof money === 'function' ? money(amount) : `${amount}`;
}

function planPeriodPriceLabel(plan, months) {
  const value = normalizePeriodMonths(months);
  const override = value === 3 ? plan.price3 : (value === 12 ? plan.price12 : '');
  if (override !== '' && override != null) return planPriceLabel({ price: override });
  const monthly = Number(plan.price);
  if (plan.price === '' || plan.price == null) return 'Sur demande';
  if (!Number.isFinite(monthly) || monthly <= 0) return 'Gratuit';
  return planPriceLabel({ price: String(monthly * value) });
}

async function loadPublicPlans() {
  const merged = new Map(defaultSubscriptionPlans().map((item) => [item.id, item]));
  try {
    const project = encodeURIComponent(FIREBASE_PROJECT_ID);
    const key = encodeURIComponent(FIREBASE_API_KEY);
    const response = await firestoreRequest(`https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/plans?key=${key}`);
    if (response.ok) {
      const data = await response.json();
      (data.documents || []).forEach((doc) => {
        const plan = parsePlanDoc(doc);
        if (plan.id) merged.set(plan.id, { ...merged.get(plan.id), ...plan });
      });
    }
  } catch { /* catalogue local */ }
  return [...merged.values()].filter((item) => (
    item.active !== '0' && ['basique', 'standard', 'pro'].includes(item.id)
  ));
}

const licenseRequestKey = 'opus.licenseRequest';

async function sendLicenseRequest(payload) {
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const key = encodeURIComponent(FIREBASE_API_KEY);
  const id = `req-${Date.now().toString(36)}`;
  const cache = readLicenseCache();
  const response = await firestoreRequest(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/license_requests?documentId=${encodeURIComponent(id)}&key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          clientName: { stringValue: payload.clientName },
          phone: { stringValue: payload.phone },
          plan: { stringValue: payload.plan },
          months: { stringValue: String(normalizePeriodMonths(payload.months)) },
          status: { stringValue: 'pending' },
          createdAt: { stringValue: new Date().toISOString() },
          deviceId: { stringValue: licenseDeviceId() },
          currentCode: { stringValue: cache?.code || '' },
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error('Demande non envoyée. Publiez les règles plans et license_requests.');
  }
  localStorage.setItem(licenseRequestKey, id);
  return id;
}

async function fetchLicenseRequest(id) {
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const key = encodeURIComponent(FIREBASE_API_KEY);
  const response = await firestoreRequest(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/license_requests/${encodeURIComponent(id)}?key=${key}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Demande introuvable.');
  const doc = await response.json();
  const fields = doc.fields || {};
  return {
    id,
    clientName: firestoreString(fields, 'clientName'),
    phone: firestoreString(fields, 'phone'),
    plan: firestoreString(fields, 'plan'),
    months: firestoreString(fields, 'months') || '1',
    status: firestoreString(fields, 'status') || 'pending',
    code: firestoreString(fields, 'code'),
  };
}

async function applyAcceptedLicense(request) {
  if (!request || request.status !== 'accepted' || !request.code) return false;
  await activateLicense(request.code);
  localStorage.removeItem(licenseRequestKey);
  return true;
}

function bindLicenseCodeForm(root) {
  const form = root.querySelector('[data-license-form]');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-license-status]');
    const code = normalizeLicenseCode(form.elements.code.value);
    if (!code) return;
    button.disabled = true;
    if (status) {
      status.hidden = false;
      status.textContent = 'Vérification…';
    }
    try {
      await activateLicense(code);
      if (status) status.textContent = 'Licence acceptée. Ouverture…';
      clearLicenseGate();
      location.reload();
    } catch (error) {
      const text = error.message || 'Code refusé.';
      if (status) status.textContent = text;
      showToast(text, 'err');
    } finally {
      button.disabled = false;
    }
  });
}

async function paintLicenseOffers(root) {
  const host = root.querySelector('[data-license-offers]');
  if (!host) return;
  host.textContent = 'Chargement des offres…';
  const plans = await loadPublicPlans();
  host.innerHTML = plans.map((plan) => `
    <button type="button" class="license-offer" data-pick-plan="${esc(plan.id)}">
      <strong>${esc(plan.name)}</strong>
      <span>${esc(planPriceLabel(plan))}${plan.days ? ` · ${esc(plan.days)} j` : ''}</span>
      ${plan.blurb ? `<span class="meta">${esc(plan.blurb)}</span>` : ''}
    </button>
  `).join('');
  const requestBox = root.querySelector('[data-license-request]');
  host.querySelectorAll('[data-pick-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      const plan = plans.find((item) => item.id === button.dataset.pickPlan);
      if (!plan || !requestBox) return;
      host.querySelectorAll('.license-offer').forEach((item) => item.classList.toggle('is-on', item === button));
      requestBox.hidden = false;
      requestBox.querySelector('[name="plan"]').value = plan.id;
      requestBox.querySelector('[data-request-choice]').textContent = `${plan.name} · ${planPriceLabel(plan)}`;
    });
  });
  const requestForm = requestBox?.querySelector('form');
  if (requestForm) {
    requestForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = requestBox.querySelector('[data-request-status]');
      const button = requestForm.querySelector('button[type="submit"]');
      const data = Object.fromEntries(new FormData(requestForm).entries());
      button.disabled = true;
      if (status) {
        status.hidden = false;
        status.textContent = 'Envoi…';
      }
      try {
        await sendLicenseRequest({
          clientName: String(data.clientName || '').trim(),
          phone: String(data.phone || '').trim(),
          plan: String(data.plan || ''),
          months: data.months,
        });
        if (status) status.textContent = 'Demande envoyée. Dès validation, la licence s’active ici.';
        showToast('Demande envoyée.', 'ok');
      } catch (error) {
        if (status) status.textContent = error.message;
        showToast(error.message, 'err');
      } finally {
        button.disabled = false;
      }
    });
  }
}

function showLicenseGate(options = {}) {
  const mode = options.mode || 'enter';
  const message = options.message || '';
  document.body.classList.add('license-locked');
  let root = document.getElementById('license-gate');
  if (!root) {
    root = document.createElement('div');
    root.id = 'license-gate';
    root.className = 'license-gate';
    document.body.appendChild(root);
  }
  if (mode === 'config') {
    root.innerHTML = `
      <section class="license-gate-card" role="dialog" aria-modal="true">
        <h1>Configuration Firebase</h1>
        <p>Copiez <strong>firebase-client.example.js</strong> vers <strong>firebase-client.js</strong> dans le dossier public, puis collez apiKey, projectId et appId de l’app <strong>tickets-web</strong>.</p>
        <p class="meta">Rechargez ensuite cette page. Les clés restent sur cet ordinateur.</p>
      </section>
    `;
    return;
  }
  const blocked = mode === 'blocked';
  const showOffers = options.canRenew !== false;
  root.innerHTML = `
    <section class="license-gate-card" role="dialog" aria-modal="true">
      <h1>${blocked ? 'Licence' : 'Activer Tickets'}</h1>
      <p>${esc(message || 'Choisissez une offre ou entrez un code déjà reçu.')}</p>
      ${showOffers ? '<button type="button" class="btn-sell btn-block" data-action="manage-subscription">Voir les offres</button>' : ''}
      <p class="meta">Vous avez déjà un code ?</p>
      <form data-license-form>
        <label for="license-code">Code licence</label>
        <input id="license-code" name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="HT-XXXX-000">
        <p class="meta" data-license-status hidden></p>
        <button class="btn-block" type="submit">Valider</button>
      </form>
    </section>
  `;
  bindLicenseCodeForm(root);
}

let subscriptionPoll = 0;

function closeSubscriptionModal() {
  clearInterval(subscriptionPoll);
  subscriptionPoll = 0;
  document.getElementById('subscription-modal')?.remove();
}

async function refreshSubscriptionModal(root) {
  const current = currentLicensePlan();
  const pendingId = localStorage.getItem(licenseRequestKey) || '';
  let pending = null;
  if (pendingId) {
    try { pending = await fetchLicenseRequest(pendingId); } catch { /* ignore */ }
    if (pending && await applyAcceptedLicense(pending)) {
      closeSubscriptionModal();
      location.reload();
      return;
    }
  }
  const plans = await loadPublicPlans();
  const cache = readLicenseCache();
  root.innerHTML = `
    <section class="modal modal-form" role="dialog" aria-modal="true">
      <h2>Mon abonnement</h2>
      <p class="meta">${current || licenseFrozen(cache)
        ? `Offre en cours : <strong>${esc(licensePlanLabel(current || cache?.plan))}</strong> — ${esc(licenseRights(current || cache?.plan).blurb)}`
        : 'Aucune offre active.'}</p>
      ${cache?.endsAt ? `<p><strong>${esc(licenseRemainingLabel(cache))}</strong>${formatLicenseDate(cache.endsAt) ? ` · jusqu’au ${esc(formatLicenseDate(cache.endsAt))}` : ''}</p>` : ''}
      ${cache?.code && !String(cache.code).startsWith('HT-ESSAI') && cache.plan !== 'fondateur'
        ? `<p class="meta">Votre code : <strong data-own-license-code>${esc(cache.code)}</strong> <button type="button" class="btn-quiet" data-copy-license-code>Copier</button></p>`
        : ''}
      ${pending && pending.status === 'pending'
        ? `<p class="meta">Demande <strong>${esc(licensePlanLabel(pending.plan))}</strong> · ${esc(periodLabel(pending.months))} envoyée. Elle s’activera dès validation du paiement.</p>`
        : `
      <div class="license-offers" data-license-offers>
        ${plans.map((plan) => `
          <button type="button" class="license-offer" data-pick-plan="${esc(plan.id)}">
            <strong>${esc(plan.name)}</strong>
            <span>${esc(planPeriodPriceLabel(plan, 1))} / mois</span>
            <span class="meta">${esc(plan.blurb || LICENSE_RIGHTS[plan.id]?.blurb || '')}</span>
          </button>
        `).join('')}
      </div>
      <form data-license-request-form class="stack" hidden>
        <input type="hidden" name="plan" value="">
        <input type="hidden" name="months" value="1">
        <p class="meta">Durée</p>
        <div class="license-periods">
          ${SUBSCRIPTION_PERIODS.map((period) => `
            <button type="button" class="license-period${period.months === 1 ? ' is-on' : ''}" data-pick-period="${period.months}">${esc(period.label)}</button>
          `).join('')}
        </div>
        <p><strong data-request-choice></strong></p>
        <label>Nom et prénom</label>
        <input name="clientName" required value="${esc(cache?.clientName || '')}" placeholder="Nom et prénom" autocomplete="name">
        <label>Téléphone</label>
        <input name="phone" required placeholder="Téléphone" inputmode="tel" autocomplete="tel">
        <p class="meta" data-request-status hidden></p>
        <button class="btn-sell" type="submit">Envoyer la demande</button>
      </form>`}
      <form data-license-transfer-form class="stack">
        <p class="meta">Nouveau téléphone ? Après détachement, le même nom et le même numéro qu’à l’abonnement suffisent.</p>
        <label>Nom et prénom</label>
        <input name="clientName" required placeholder="Nom et prénom" autocomplete="name" value="${esc(cache?.clientName || '')}">
        <label>Téléphone</label>
        <input name="phone" required placeholder="Téléphone" inputmode="tel" autocomplete="tel" value="${esc(cache?.phone || '')}">
        <p class="meta" data-transfer-status hidden></p>
        <button type="submit" class="btn-block">Lier ce téléphone</button>
      </form>
      <div class="modal-actions">
        <button type="button" class="btn-quiet" data-close-subscription>Fermer</button>
      </div>
    </section>
  `;
  root.querySelector('[data-copy-license-code]')?.addEventListener('click', async () => {
    const code = root.querySelector('[data-own-license-code]')?.textContent || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showToast('Code copié.', 'ok');
    } catch {
      showToast(code, 'ok');
    }
  });
  root.querySelector('[data-close-subscription]')?.addEventListener('click', closeSubscriptionModal);
  root.addEventListener('click', (event) => {
    if (event.target === root) closeSubscriptionModal();
  });
  const form = root.querySelector('[data-license-request-form]');
  const paintChoice = () => {
    if (!form) return;
    const plan = plans.find((item) => item.id === form.elements.plan.value);
    if (!plan) return;
    const months = normalizePeriodMonths(form.elements.months.value);
    form.querySelector('[data-request-choice]').textContent = `${plan.name} · ${periodLabel(months)} · ${planPeriodPriceLabel(plan, months)}`;
    form.querySelectorAll('[data-pick-period]').forEach((item) => {
      item.classList.toggle('is-on', Number(item.dataset.pickPeriod) === months);
    });
  };
  root.querySelectorAll('[data-pick-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      const plan = plans.find((item) => item.id === button.dataset.pickPlan);
      if (!plan || !form) return;
      root.querySelectorAll('.license-offer').forEach((item) => item.classList.toggle('is-on', item === button));
      form.hidden = false;
      form.elements.plan.value = plan.id;
      paintChoice();
    });
  });
  root.querySelectorAll('[data-pick-period]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!form) return;
      form.elements.months.value = String(normalizePeriodMonths(button.dataset.pickPeriod));
      paintChoice();
    });
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const status = form.querySelector('[data-request-status]');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    if (status) {
      status.hidden = false;
      status.textContent = 'Envoi…';
    }
    try {
      await sendLicenseRequest({
        clientName: String(data.clientName || '').trim(),
        phone: String(data.phone || '').trim(),
        plan: String(data.plan || ''),
        months: data.months,
      });
      showToast('Demande envoyée.', 'ok');
      await refreshSubscriptionModal(root);
    } catch (error) {
      if (status) status.textContent = error.message;
      showToast(error.message, 'err');
      button.disabled = false;
    }
  });
  const transfer = root.querySelector('[data-license-transfer-form]');
  transfer?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = transfer.querySelector('[data-transfer-status]');
    const button = transfer.querySelector('button[type="submit"]');
    button.disabled = true;
    if (status) {
      status.hidden = false;
      status.textContent = 'Liaison…';
    }
    try {
      await recoverLicenseByIdentity({
        clientName: String(transfer.elements.clientName.value || '').trim(),
        phone: String(transfer.elements.phone.value || '').trim(),
      });
      showToast('Téléphone lié. Ouverture…', 'ok');
      closeSubscriptionModal();
      location.reload();
    } catch (error) {
      const text = error.message || 'Liaison impossible.';
      if (status) status.textContent = text;
      showToast(text, 'err');
      button.disabled = false;
    }
  });
}

async function openSubscriptionModal() {
  if (typeof isFounderLicense === 'function' && isFounderLicense()) return;
  let root = document.getElementById('subscription-modal');
  if (!root) {
    root = document.createElement('div');
    root.id = 'subscription-modal';
    root.className = 'modal-overlay';
    document.body.appendChild(root);
  }
  root.innerHTML = '<section class="modal modal-form"><p class="meta">Chargement…</p></section>';
  await refreshSubscriptionModal(root);
  clearInterval(subscriptionPoll);
  subscriptionPoll = setInterval(async () => {
    if (!document.getElementById('subscription-modal')) {
      clearInterval(subscriptionPoll);
      return;
    }
    const id = localStorage.getItem(licenseRequestKey);
    if (!id) return;
    try {
      const pending = await fetchLicenseRequest(id);
      if (pending && await applyAcceptedLicense(pending)) {
        closeSubscriptionModal();
        location.reload();
      }
    } catch { /* ignore */ }
  }, 8000);
}

if (!window.__opusSubscriptionBound) {
  window.__opusSubscriptionBound = true;
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-action="manage-subscription"]')) return;
    event.preventDefault();
    openSubscriptionModal().catch((error) => showToast(error.message, 'err'));
  });
}

async function activateLicense(code) {
  let remote;
  try {
    remote = await fetchLicenseRemote(code);
  } catch (error) {
    if (code === 'HT-FONDATEUR-001' && await seedFounderLicense(code)) {
      remote = await fetchLicenseRemote(code);
    } else if (code === 'HT-FONDATEUR-001') {
      throw new Error('Fiche fondateur invisible pour l’app. Dans Firestore → Règles, ajoutez allow create: if true; puis Publier, et validez à nouveau.');
    } else {
      throw error;
    }
  }
  const mine = licenseDeviceId();
  if (licenseDeviceTaken(remote, mine)) {
    throw new Error('Ce code est déjà lié à un autre téléphone.');
  }
  if (licenseLocksOneDevice(remote) && !remote.deviceId) {
    await bindLicenseDevice(code, mine);
    remote.deviceId = mine;
  }
  if (!licenseAllows(remote)) throw new Error(licenseBlockMessage(remote));
  writeLicenseCache({ code, ...remote });
  publishLicenseLookup({ code, ...remote }).catch(() => {});
}

function licenseAddDays(iso, days) {
  const date = new Date(`${iso}T00:00:00`);
  const base = Number.isNaN(date.getTime()) ? new Date() : date;
  base.setDate(base.getDate() + Number(days || 0));
  const month = String(base.getMonth() + 1).padStart(2, '0');
  const day = String(base.getDate()).padStart(2, '0');
  return `${base.getFullYear()}-${month}-${day}`;
}

function startLocalEssai() {
  const start = licenseToday();
  writeLicenseCache({
    code: `HT-ESSAI-${licenseDeviceId().replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase() || '000'}`,
    plan: 'essai',
    status: 'active',
    startsAt: start,
    endsAt: licenseAddDays(start, 5),
    clientName: '',
    deviceId: licenseDeviceId(),
    workspaceId: licenseWorkspaceId(),
  });
}

async function refreshLicenseOrGrace() {
  let cache = readLicenseCache();
  if (!cache?.code) {
    const shared = workspaceLicenseRecord();
    if (shared?.code) writeLicenseCache(shared);
    cache = readLicenseCache();
  }
  if (!cache?.code) {
    startLocalEssai();
    clearLicenseGate();
    return false;
  }
  try {
    const remote = await fetchLicenseRemote(cache.code);
    const mine = licenseDeviceId();
    if (licenseDeviceTaken(remote, mine)) {
      showLicenseGate({ mode: 'blocked', canRenew: false, message: 'Ce code est déjà lié à un autre téléphone.' });
      return true;
    }
    if (licenseLocksOneDevice(remote) && !remote.deviceId) {
      await bindLicenseDevice(cache.code, mine);
      remote.deviceId = mine;
    }
    writeLicenseCache({ code: cache.code, ...remote });
    clearLicenseGate();
    if (!licenseAllows(remote) && remote.status === 'revoked') {
      showLicenseGate({ mode: 'blocked', canRenew: false, message: licenseBlockMessage(remote) });
      return true;
    }
    return false;
  } catch (error) {
    if (cache.plan === 'essai' && licenseAllows(cache)) {
      clearLicenseGate();
      return false;
    }
    if (licenseFrozen(cache)) {
      clearLicenseGate();
      return false;
    }
    const freshEnough = cache.checkedAt && (Date.now() - Number(cache.checkedAt) < licenseGraceMs);
    if (licenseAllows(cache) && freshEnough) {
      clearLicenseGate();
      return false;
    }
    showLicenseGate({
      mode: 'blocked',
      canRenew: licenseCanRenew(cache),
      message: freshEnough ? licenseBlockMessage(cache) : (error.message || 'Vérification impossible.'),
    });
    return true;
  }
}

function licensePlanLabel(plan) {
  return ({
    fondateur: 'Fondateur',
    essai: 'Essai',
    basique: 'Basique',
    standard: 'Standard',
    pro: 'Pro',
  })[plan] || plan || 'Licence';
}

function paintLicenseBadge() {
  const host = document.querySelector('header .header-actions');
  if (!host) return;
  let badge = document.getElementById('license-badge');
  const cache = workspaceLicenseRecord() || readLicenseCache();
  if (!cache?.code) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'license-badge';
    badge.className = 'license-badge';
    host.prepend(badge);
  }
  const remoteOk = cache.checkedAt && (Date.now() - Number(cache.checkedAt) < licenseGraceMs);
  const warning = licenseExpiryWarning(cache);
  const days = licenseDaysLeft(cache);
  let label = licensePlanLabel(cache.plan);
  if (licenseFrozen(cache)) label = 'Expiré';
  else if (!remoteOk) label += ' (hors-ligne)';
  else if (Number.isFinite(days) && cache.plan !== 'fondateur') {
    label += days <= 0 ? ' · dernier jour' : ` · ${days} j`;
  }
  badge.textContent = label;
  badge.title = cache.endsAt
    ? `${licensePlanLabel(cache.plan)} · ${licenseRemainingLabel(cache)} · ${formatLicenseDate(cache.endsAt)}`
    : cache.code;
  badge.classList.toggle('is-warn', Boolean(warning) || licenseFrozen(cache));
}

function paintLicenseExpiryNotice() {
  document.getElementById('license-expiry-banner')?.remove();
  if (typeof isFounderLicense === 'function' && isFounderLicense()) return;
  const sheet = document.querySelector('#app .sheet');
  if (!sheet) return;
  if (licenseFrozen()) {
    sheet.insertAdjacentHTML('afterbegin', licenseHoldBannerHtml('owner'));
    const warnKey = 'opus.license.warnDay';
    if (localStorage.getItem(warnKey) !== licenseToday() && typeof showToast === 'function') {
      localStorage.setItem(warnKey, licenseToday());
      showToast(licenseExpiryWarning()?.text || 'Abonnement terminé.', 'err');
    }
    return;
  }
  const warning = licenseExpiryWarning();
  if (!warning) return;
  const banner = document.createElement('section');
  banner.id = 'license-expiry-banner';
  banner.className = 'card license-expiry-banner';
  banner.innerHTML = `
    <p><strong>${esc(warning.text)}</strong></p>
    <p class="meta">Choisissez une offre avant la coupure. Après validation du paiement, la licence se réactive ici.</p>
    <button type="button" class="btn-sell" data-action="manage-subscription">Renouveler</button>
  `;
  sheet.prepend(banner);
  const warnKey = 'opus.license.warnDay';
  if (localStorage.getItem(warnKey) !== licenseToday() && typeof showToast === 'function') {
    localStorage.setItem(warnKey, licenseToday());
    showToast(warning.text, 'err');
  }
}

async function hydrateWorkspaceLicense() {
  try {
    const saved = await localApi('/api/settings/license');
    if (saved?.code) {
      const current = readSharedWorkspaceLicense();
      if (!current?.code || (!current.clientName && saved.clientName)) {
        rememberWorkspaceLicense({ ...current, ...saved });
      }
    }
  } catch { /* pas encore de fiche locale */ }
  const workspaceId = workspaceLicenseRecord()?.workspaceId || localStorage.getItem(workspaceIdKey) || '';
  if (workspaceId && firebaseLicenseReady()) {
    try {
      const response = await firestoreRequest(workspaceStatusUrl(workspaceId));
      if (response.ok) {
        const fields = (await response.json()).fields || {};
        const live = {
          code: firestoreString(fields, 'code'),
          clientName: firestoreString(fields, 'clientName'),
          plan: firestoreString(fields, 'plan'),
          status: firestoreString(fields, 'status'),
          endsAt: firestoreString(fields, 'endsAt'),
          workspaceId,
        };
        if (live.code) rememberWorkspaceLicense({ ...workspaceLicenseRecord(), ...live });
      }
    } catch { /* hors-ligne */ }
  }
  const latest = workspaceLicenseRecord();
  const resellerOnly = document.body?.classList.contains('page-vendeur')
    && typeof isOwner === 'function'
    && !isOwner();
  const owner = readLicenseCache();
  if (!resellerOnly && latest?.code && (
    !owner?.code || owner.code === latest.code || String(owner.code).startsWith('HT-ESSAI-')
  )) {
    writeLicenseCache({ ...(owner || {}), ...latest });
  }
  if (!latest?.code || latest.plan === 'fondateur' || !firebaseLicenseReady()) return latest;
  if (String(latest.code).startsWith('HT-ESSAI-')) return latest;
  try {
    const remote = await fetchLicenseRemote(latest.code);
    const merged = { ...latest, ...remote, code: latest.code };
    rememberWorkspaceLicense(merged);
    if (!resellerOnly && readLicenseCache()?.code === latest.code) {
      writeLicenseCache({ ...readLicenseCache(), ...remote });
    }
    return merged;
  } catch {
    return latest;
  }
}

async function recoverFounderLicense() {
  const cache = readLicenseCache();
  if (cache?.plan === 'fondateur' && licenseAllows(cache)) return;
  try {
    const remote = await fetchLicenseRemote('HT-FONDATEUR-001');
    const mine = licenseDeviceId();
    if (!remote.deviceId || remote.deviceId !== mine) return;
    writeLicenseCache({ code: 'HT-FONDATEUR-001', ...remote, plan: 'fondateur' });
  } catch { /* cet appareil n’est pas le fondateur */ }
}

async function enforceLicense() {
  if (!firebaseLicenseReady()) {
    showLicenseGate({ mode: 'config' });
    return true;
  }
  await hydrateWorkspaceLicense();
  await recoverFounderLicense();
  const pendingId = localStorage.getItem(licenseRequestKey);
  if (pendingId) {
    try {
      const pending = await fetchLicenseRequest(pendingId);
      if (pending && await applyAcceptedLicense(pending)) {
        location.reload();
        return true;
      }
    } catch { /* continue */ }
  }
  return refreshLicenseOrGrace();
}
