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
  let previous = {};
  try { previous = JSON.parse(localStorage.getItem(workspaceLicenseKey) || '{}'); } catch { previous = {}; }
  localStorage.setItem(workspaceLicenseKey, JSON.stringify({
    code: record.code,
    clientName: record.clientName || '',
    plan: record.plan || '',
    status: record.status || '',
    endsAt: record.endsAt || '',
    workspaceId: record.workspaceId || localStorage.getItem(workspaceIdKey) || '',
    checkedAt: record.checkedAt || Date.now(),
    quotaKeep: record.quotaKeep != null ? String(record.quotaKeep) : String(previous.quotaKeep || ''),
  }));
}

function parseQuotaKeep(raw) {
  const text = String(raw || '');
  if (!text.startsWith('kept:')) return null;
  const [plan, routerPart, resellerPart] = text.slice(5).split(';');
  if (!plan || routerPart == null) return null;
  const ids = (part) => String(part || '').split(',').map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0);
  return { pending: false, plan, routers: ids(routerPart), resellers: ids(resellerPart) };
}

function quotaHoldRecord() {
  const raw = String(workspaceLicenseRecord()?.quotaKeep || '');
  if (raw.startsWith('pending:')) {
    const plan = raw.slice(8);
    return plan ? { pending: true, plan, routers: [], resellers: [] } : null;
  }
  return parseQuotaKeep(raw);
}

function resellerDroppedByPlan(resellerId) {
  const hold = quotaHoldRecord();
  if (!hold) return false;
  if (hold.pending) return true;
  return !hold.resellers.includes(Number(resellerId));
}

function routerParkedByPlan(routerId) {
  const hold = quotaHoldRecord();
  if (!hold) return false;
  if (hold.pending) return true;
  return !hold.routers.includes(Number(routerId));
}

function workspaceExceedsRights(routers, resellers, rights) {
  if (!rights) return false;
  if ((routers || []).length > rights.maxRouters || (resellers || []).length > rights.maxResellers) return true;
  const counts = new Map();
  for (const reseller of resellers || []) {
    const routerId = Number(reseller.routerId != null ? reseller.routerId : reseller.router_id);
    const count = (counts.get(routerId) || 0) + 1;
    counts.set(routerId, count);
    if (count > rights.maxResellersPerRouter) return true;
  }
  return false;
}

function quotaHoldFitsPlan(plan, rights, routers, resellers) {
  const hold = quotaHoldRecord();
  if (!hold || hold.pending || hold.plan !== plan || !rights) return false;
  const liveRouters = new Set((routers || []).map((router) => Number(router.id)));
  const liveResellers = new Set((resellers || []).map((reseller) => Number(reseller.id)));
  const keptRouters = hold.routers.filter((id) => liveRouters.has(id));
  const keptResellers = hold.resellers.filter((id) => liveResellers.has(id));
  if (keptRouters.length > rights.maxRouters || keptResellers.length > rights.maxResellers) return false;
  const keptRouterSet = new Set(keptRouters);
  const perRouter = new Map();
  for (const reseller of resellers || []) {
    const id = Number(reseller.id);
    if (!liveResellers.has(id) || !hold.resellers.includes(id)) continue;
    const routerId = Number(reseller.routerId != null ? reseller.routerId : reseller.router_id);
    if (!keptRouterSet.has(routerId)) return false;
    const count = (perRouter.get(routerId) || 0) + 1;
    if (count > rights.maxResellersPerRouter) return false;
    perRouter.set(routerId, count);
  }
  return true;
}

async function writeQuotaKeep(quotaKeep) {
  const record = workspaceLicenseRecord();
  if (!record?.code) return;
  rememberWorkspaceLicense({ ...record, quotaKeep });
  if (!firebaseLicenseReady()) return;
  const id = record.workspaceId || localStorage.getItem(workspaceIdKey);
  if (!id) return;
  await firestoreRequest(
    `${workspaceStatusUrl(id)}&updateMask.fieldPaths=quotaKeep`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { quotaKeep: { stringValue: quotaKeep } } }),
    },
  );
}

async function publishQuotaKeep(plan, routerIds, resellerIds) {
  const routers = (routerIds || []).map((id) => Number(id)).filter((id) => id > 0).join(',');
  const resellers = (resellerIds || []).map((id) => Number(id)).filter((id) => id > 0).join(',');
  await writeQuotaKeep(`kept:${plan};${routers};${resellers}`);
}

async function ensureQuotaPending(plan) {
  if (!plan) return;
  const raw = String(workspaceLicenseRecord()?.quotaKeep || '');
  if (raw === `pending:${plan}`) return;
  await writeQuotaKeep(`pending:${plan}`);
}

async function clearQuotaHold() {
  if (!String(workspaceLicenseRecord()?.quotaKeep || '')) return;
  await writeQuotaKeep('');
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
    plan: firestoreString(fields, 'plan').trim().toLowerCase(),
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
  if (!record?.plan) return false;
  if (record.plan === 'fondateur') return false;
  if (normalizeLicenseCode(record.code) === 'HT-FONDATEUR-001') return false;
  return true;
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

const planQuotaById = {};

function readPlanQuota(plan) {
  if (!plan?.id || plan.id === 'fondateur') return null;
  const base = LICENSE_RIGHTS[plan.id] || null;
  const routers = Number(plan.maxRouters);
  const resellers = Number(plan.maxResellers);
  const per = Number(plan.maxResellersPerRouter);
  const days = Number(plan.days);
  const valid = Number.isInteger(routers) && routers >= 1 && Number.isInteger(resellers) && resellers >= 1;
  if (!valid) {
    if (!base) return null;
    return {
      maxRouters: base.maxRouters,
      maxResellers: base.maxResellers,
      maxResellersPerRouter: base.maxResellersPerRouter,
      days: base.days || 0,
      custom: false,
    };
  }
  const perRouter = Number.isInteger(per) && per >= 1
    ? Math.min(per, resellers)
    : Math.min(base?.maxResellersPerRouter || resellers, resellers);
  return {
    maxRouters: routers,
    maxResellers: resellers,
    maxResellersPerRouter: perRouter,
    days: Number.isInteger(days) && days >= 1 ? days : (base?.days || 0),
    custom: true,
  };
}

function rememberPlanQuotas(plans) {
  Object.keys(planQuotaById).forEach((key) => { delete planQuotaById[key]; });
  (plans || []).forEach((plan) => {
    const quota = readPlanQuota(plan);
    if (quota?.custom) planQuotaById[plan.id] = quota;
  });
}

function licenseRights(plan) {
  const key = plan || currentLicensePlan() || 'basique';
  const base = LICENSE_RIGHTS[key] || {
    maxRouters: 1,
    maxResellers: 1,
    maxResellersPerRouter: 1,
    drive: true,
    blurb: '',
    days: 0,
  };
  if (key === 'fondateur') return base;
  const quota = planQuotaById[key];
  if (!quota) return base;
  return {
    ...base,
    maxRouters: quota.maxRouters,
    maxResellers: quota.maxResellers,
    maxResellersPerRouter: quota.maxResellersPerRouter,
    ...(quota.days >= 1 ? { days: quota.days } : {}),
  };
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
  const frozen = licenseFrozen(record);
  const days = licenseDaysLeft(record);
  const until = formatLicenseDate(record?.endsAt);
  let daysLabel = 'Durée non définie';
  if (frozen) daysLabel = 'Terminé';
  else if (Number.isFinite(days)) {
    if (days <= 0) daysLabel = 'Dernier jour';
    else if (days === 1) daysLabel = '1 jour';
    else daysLabel = `${days} jours`;
  }
  const planLabel = licensePlanLabel(plan || (frozen ? record?.plan : '') || 'Aucune offre');
  return `
    <section class="license-status-card${frozen ? ' is-expired' : ''}">
      <span class="license-status-plan">${esc(planLabel)}</span>
      <span class="license-status-copy">
        <strong>${esc(daysLabel)}</strong>
        ${until ? `<span>jusqu’au ${esc(until)}</span>` : '<span>Sans date de fin</span>'}
      </span>
      <button type="button" class="license-status-btn" data-action="manage-subscription">${frozen ? 'Renouveler' : 'Gérer'}</button>
      ${typeof aboutInfoButtonHtml === 'function' ? aboutInfoButtonHtml() : ''}
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
    if (record.plan === 'essai') return 'Votre essai est terminé. Choisissez une offre pour continuer.';
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
    maxRouters: firestoreString(fields, 'maxRouters'),
    maxResellers: firestoreString(fields, 'maxResellers'),
    maxResellersPerRouter: firestoreString(fields, 'maxResellersPerRouter'),
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

function planPriceNumber(raw) {
  const text = String(raw ?? '').replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

function planMoneyAmount(plan, months) {
  if (!plan) return null;
  const value = Math.max(1, Number(months) || 1);
  const packaged = value === 3 ? plan.price3 : (value === 12 ? plan.price12 : '');
  if ((value === 3 || value === 12) && packaged !== '' && packaged != null) {
    return planPriceNumber(packaged);
  }
  return plan.price === '' || plan.price == null ? null : (() => {
    const monthly = planPriceNumber(plan.price);
    return monthly == null ? null : monthly * value;
  })();
}

function licenseDayCount(start, end) {
  const from = new Date(`${String(start || '').slice(0, 10)}T00:00:00`);
  const to = new Date(`${String(end || '').slice(0, 10)}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
}

function prepaidMonthsUntil(endsAt, today) {
  const end = String(endsAt || '').slice(0, 10);
  const start = String(today || licenseToday()).slice(0, 10);
  if (!end || !start || end < start) return 0;
  let months = 0;
  let cursor = start;
  while (months < 36) {
    const next = licenseAddMonths(cursor, 1);
    if (!next || next <= cursor || next > end) break;
    months += 1;
    cursor = next;
  }
  return months;
}

function licenseUpgradeQuote(cache, nextPlan, plans, extraMonths = 0) {
  if (!cache || !nextPlan) return null;
  const planId = String(cache.plan || '').trim().toLowerCase();
  if (!planId || planId === 'essai' || planId === 'fondateur' || planId === nextPlan.id) return null;
  if (cache.status && String(cache.status).toLowerCase() !== 'active') return null;
  const endsAt = String(cache.endsAt || '').slice(0, 10);
  const today = licenseToday();
  if (!endsAt || endsAt < today) return null;
  const currentPlan = (plans || []).find((item) => item.id === planId);
  if (!currentPlan) return null;
  const oldMonthly = planPriceNumber(currentPlan.price);
  const newMonthly = planPriceNumber(nextPlan.price);
  if (oldMonthly == null || newMonthly == null || newMonthly <= oldMonthly) return null;
  const fullMonths = prepaidMonthsUntil(endsAt, today);
  let complement = 0;
  let partialDays = 0;
  if (fullMonths >= 1) {
    const from = planMoneyAmount(currentPlan, fullMonths);
    const to = planMoneyAmount(nextPlan, fullMonths);
    if (from == null || to == null || to <= from) return null;
    complement = to - from;
  } else {
    partialDays = licenseDayCount(today, endsAt);
    const monthDays = Math.max(1, licenseDayCount(today, licenseAddMonths(today, 1)));
    complement = Math.round((newMonthly - oldMonthly) * partialDays / monthDays);
  }
  const extra = [0, 1, 3, 12].includes(Number(extraMonths)) ? Number(extraMonths) : 0;
  const extraAmount = extra ? (planMoneyAmount(nextPlan, extra) || 0) : 0;
  const due = complement + extraAmount;
  if (due <= 0) return null;
  return {
    months: fullMonths,
    partialDays,
    extra,
    complement,
    extraAmount,
    due,
    endsAt: extra ? licenseAddMonths(endsAt, extra) : endsAt,
    keptEndsAt: endsAt,
    plan: nextPlan.id,
    fromPlan: planId,
  };
}

function paymentProofSrc(value) {
  const text = String(value || '');
  return /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(text) ? text : '';
}

function readPaymentProof(file) {
  if (!file) return Promise.reject(new Error('Joignez la capture d’écran du paiement.'));
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const max = 960;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('Image illisible.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let quality = 0.7;
      let data = canvas.toDataURL('image/jpeg', quality);
      while (data.length > 700000 && quality > 0.4) {
        quality = Math.round((quality - 0.1) * 10) / 10;
        data = canvas.toDataURL('image/jpeg', quality);
      }
      if (!paymentProofSrc(data) || data.length > 900000) {
        reject(new Error('La capture est trop lourde. Choisissez une image plus petite.'));
        return;
      }
      resolve(data);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible.'));
    };
    image.src = url;
  });
}

function canProlongSubscription(cache) {
  const plan = String(cache?.plan || '').trim().toLowerCase();
  if (!plan || plan === 'essai' || plan === 'fondateur') return false;
  const status = String(cache?.status || 'active').toLowerCase();
  return status !== 'revoked' && status !== 'suspended';
}

function subscriptionLicenseRecord() {
  const cache = readLicenseCache() || {};
  const shared = typeof readSharedWorkspaceLicense === 'function' ? (readSharedWorkspaceLicense() || {}) : {};
  return {
    ...shared,
    ...cache,
    code: cache.code || shared.code || '',
    plan: cache.plan || shared.plan || '',
    status: cache.status || shared.status || '',
    endsAt: cache.endsAt || shared.endsAt || '',
    clientName: cache.clientName || shared.clientName || '',
  };
}

function formatUpgradeDue(amount) {
  return typeof money === 'function' ? money(amount) : String(amount);
}

function upgradeChoiceText(cache, plan, plans, extraMonths) {
  const quote = licenseUpgradeQuote(cache, plan, plans, extraMonths);
  if (!quote) return '';
  const fromName = licensePlanLabel(quote.fromPlan);
  const until = formatLicenseDate(quote.endsAt);
  if (quote.partialDays && quote.extra) {
    return `Passage de ${fromName} à ${plan.name} aujourd’hui. ${quote.partialDays} jours restants : complément ${formatUpgradeDue(quote.complement)}. Plus ${periodLabel(quote.extra)} : ${formatUpgradeDue(quote.extraAmount)}. À payer : ${formatUpgradeDue(quote.due)}. La liaison continue jusqu’au ${until}.`;
  }
  if (quote.partialDays) {
    return `Passage de ${fromName} à ${plan.name}. Complément des ${quote.partialDays} jours restants : ${formatUpgradeDue(quote.due)}. Fin le ${until}. Ajoutez un mois pour continuer sans coupure.`;
  }
  if (quote.extra) {
    return `Passage de ${fromName} à ${plan.name}. Complément ${formatUpgradeDue(quote.complement)}, plus ${periodLabel(quote.extra)} à ${formatUpgradeDue(quote.extraAmount)}. À payer : ${formatUpgradeDue(quote.due)}. La liaison continue jusqu’au ${until}.`;
  }
  return `Passage de ${fromName} à ${plan.name}. À payer : ${formatUpgradeDue(quote.due)}. Fin inchangée le ${until}.`;
}

function pendingUpgradeLabel(cache, pending, plans) {
  const next = (plans || []).find((item) => item.id === pending?.plan);
  const extra = pending?.extraMonths === '' || pending?.extraMonths == null ? 0 : Number(pending.extraMonths);
  const text = upgradeChoiceText(cache, next, plans, extra);
  return text || periodLabel(pending?.months);
}

function offerAskView(cache, plan, plans) {
  const quote = licenseUpgradeQuote(cache, plan, plans, 0);
  if (!quote) {
    return {
      price: `${planPeriodPriceLabel(plan, 1)} / mois`,
      meta: plan.blurb || LICENSE_RIGHTS[plan.id]?.blurb || '',
    };
  }
  if (quote.partialDays) {
    return {
      price: `${planPeriodPriceLabel(plan, 1)} / mois`,
      meta: plan.blurb || LICENSE_RIGHTS[plan.id]?.blurb || '',
    };
  }
  return {
    price: `Complément ${formatUpgradeDue(quote.due)}`,
    meta: `Passage depuis ${licensePlanLabel(quote.fromPlan)} · fin le ${formatLicenseDate(quote.endsAt)}`,
  };
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
  const list = [...merged.values()].filter((item) => item.id !== 'paiements');
  rememberPlanQuotas(list);
  rememberPlanNames(list);
  return list.filter((item) => (
    item.active !== '0' && item.id && item.id !== 'essai' && item.id !== 'fondateur' && item.id !== 'paiements'
  ));
}

function parsePaymentMethods(raw) {
  let list = [];
  try { list = JSON.parse(String(raw || '[]')); } catch { list = []; }
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    name: String(item?.name || '').trim(),
    phone: String(item?.phone || '').trim(),
    kind: ['agent', 'marchand', 'simple'].includes(item?.kind) ? item.kind : 'simple',
    guide: String(item?.guide || '').trim(),
  })).filter((item) => item.name && item.phone).slice(0, 8);
}

const PAYMENT_KINDS = [
  { id: 'simple', label: 'Compte simple' },
  { id: 'agent', label: 'Code agent' },
  { id: 'marchand', label: 'SIM marchand' },
];

function paymentKindLabel(kind) {
  return PAYMENT_KINDS.find((item) => item.id === kind)?.label || 'Compte simple';
}

function paymentGuideHtml(item) {
  if (!item) return '';
  const steps = String(item.guide || '').trim();
  return `
    <p><strong>${esc(item.name)}</strong> · ${esc(paymentKindLabel(item.kind))}</p>
    <p class="pay-mean"><span>${esc(item.phone)}</span> <button type="button" class="btn-quiet" data-copy-pay="${esc(item.phone)}">Copier</button></p>
    ${steps ? `<p class="pay-guide-steps">${esc(steps)}</p>` : '<p class="meta">Payez vers ce numéro.</p>'}
    <p class="meta">Faites le paiement, puis revenez ici avec la capture. La demande part seulement après cette confirmation.</p>
  `;
}

function contactDigits(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

let publicContactCache = null;

function clearPublicContactCache() {
  publicContactCache = null;
}

async function loadPublicContact() {
  if (publicContactCache) return publicContactCache;
  const empty = { payments: [], contactPhone: '', contactWhatsapp: '' };
  try {
    const project = encodeURIComponent(FIREBASE_PROJECT_ID);
    const key = encodeURIComponent(FIREBASE_API_KEY);
    const response = await firestoreRequest(
      `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/plans/paiements?key=${key}`,
    );
    if (!response.ok) return empty;
    const doc = await response.json();
    const fields = doc.fields || {};
    publicContactCache = {
      payments: parsePaymentMethods(firestoreString(fields, 'payments')),
      contactPhone: firestoreString(fields, 'contactPhone').trim(),
      contactWhatsapp: firestoreString(fields, 'contactWhatsapp').trim(),
    };
    return publicContactCache;
  } catch {
    return empty;
  }
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
          months: { stringValue: String(payload.upgrade === '1' ? Number(payload.extraMonths || 0) : normalizePeriodMonths(payload.months)) },
          extraMonths: { stringValue: payload.upgrade === '1' ? String(Number(payload.extraMonths || 0)) : '' },
          status: { stringValue: 'pending' },
          createdAt: { stringValue: new Date().toISOString() },
          deviceId: { stringValue: licenseDeviceId() },
          currentCode: { stringValue: payload.currentCode || cache?.code || '' },
          upgrade: { stringValue: payload.upgrade === '1' ? '1' : '0' },
          upgradeDue: { stringValue: String(payload.upgradeDue || '') },
          upgradeEndsAt: { stringValue: String(payload.upgradeEndsAt || '') },
          proof: { stringValue: String(payload.proof || '') },
          payName: { stringValue: String(payload.payName || '') },
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
    upgrade: firestoreString(fields, 'upgrade'),
    upgradeDue: firestoreString(fields, 'upgradeDue'),
    upgradeEndsAt: firestoreString(fields, 'upgradeEndsAt'),
    extraMonths: firestoreString(fields, 'extraMonths'),
    proof: firestoreString(fields, 'proof'),
    payName: firestoreString(fields, 'payName'),
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
    if (pending?.status === 'rejected') {
      localStorage.removeItem(licenseRequestKey);
      pending = null;
      showToast('Demande rejetée. Vous pouvez en envoyer une autre.', 'err', 7000);
    }
  }
  const plans = await loadPublicPlans();
  const contact = await loadPublicContact();
  const cache = subscriptionLicenseRecord();
  const prolong = canProlongSubscription(cache);
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
      ${prolong && !(pending && pending.status === 'pending') ? `
        <div class="actions">
          <button type="button" class="btn-sell" data-prolong>Prolonger mon abonnement</button>
        </div>
        <p class="meta">Reconduit ${esc(licensePlanLabel(cache.plan))} au tarif plein, à la suite de la période déjà payée. La liaison ne s’interrompt pas.</p>
      ` : ''}
      ${pending && pending.status === 'pending'
        ? `<p class="meta">Demande <strong>${esc(licensePlanLabel(pending.plan))}</strong> · ${esc(pendingUpgradeLabel(cache, pending, plans))} envoyée. Elle s’activera dès validation du paiement.</p>`
        : `
      <div class="license-offers" data-license-offers>
        ${plans.map((plan) => {
          const ask = offerAskView(cache, plan, plans);
          return `
          <button type="button" class="license-offer" data-pick-plan="${esc(plan.id)}">
            <strong>${esc(plan.name)}</strong>
            <span>${esc(ask.price)}</span>
            <span class="meta">${esc(ask.meta)}</span>
          </button>
        `;
        }).join('')}
      </div>
      <form data-license-request-form class="stack" hidden>
        <input type="hidden" name="plan" value="">
        <input type="hidden" name="months" value="1">
        <div data-request-duration>
          <p class="meta" data-duration-label>Durée</p>
          <div class="license-periods">
            <button type="button" class="license-period" data-pick-period="0" hidden>Le reste</button>
            ${SUBSCRIPTION_PERIODS.map((period) => `
              <button type="button" class="license-period${period.months === 1 ? ' is-on' : ''}" data-pick-period="${period.months}">${esc(period.label)}</button>
            `).join('')}
          </div>
        </div>
        <p><strong data-request-choice></strong></p>
        <div data-pay-step ${contact.payments.length ? '' : 'hidden'}>
          <p class="meta">Moyen de paiement</p>
          <div class="license-periods">
            ${contact.payments.map((item, index) => `
              <button type="button" class="license-period" data-pick-pay="${index}">${esc(item.name)}</button>
            `).join('')}
          </div>
          <div class="pay-guide" data-pay-guide hidden></div>
        </div>
        <input type="hidden" name="payMethod" value="">
        <div data-pay-confirm hidden>
        <label>Nom et prénom</label>
        <input name="clientName" required value="${esc(cache?.clientName || '')}" placeholder="Nom et prénom" autocomplete="name">
        <label>Téléphone</label>
        <input name="phone" required placeholder="Téléphone" inputmode="tel" autocomplete="tel">
        <label>Capture du paiement</label>
        <input name="proof" type="file" accept="image/*" required>
        <p class="meta">Photo ou capture du reçu. Elle est vérifiée avant l’activation.</p>
        <img data-proof-preview hidden alt="Aperçu de la capture" class="payment-proof">
        <p class="meta" data-request-status hidden></p>
        <button class="btn-sell" type="submit">Confirmer et envoyer</button>
        </div>
      </form>`}
      <form data-license-form class="license-code-row">
        <label>Code déjà reçu</label>
        <div class="license-code-line">
          <input name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="HT-XXXX-000">
          <button type="submit">Activer</button>
        </div>
        <p class="meta" data-license-status hidden></p>
        <p class="meta">Collez le code qui vous a été remis.</p>
      </form>
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
  bindLicenseCodeForm(root);
  root.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-copy-pay]');
    if (!copy || !root.contains(copy)) return;
    event.preventDefault();
    const phone = copy.dataset.copyPay || '';
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      showToast('Numéro copié.', 'ok');
    } catch {
      showToast(phone, 'ok');
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
    const picked = Number(form.elements.months.value);
    const quote = licenseUpgradeQuote(cache, plan, plans, [0, 1, 3, 12].includes(picked) ? picked : 0);
    const duration = form.querySelector('[data-request-duration]');
    const label = form.querySelector('[data-duration-label]');
    const rest = form.querySelector('[data-pick-period="0"]');
    if (duration) duration.hidden = false;
    if (label) label.textContent = quote ? 'Mois en plus' : 'Durée';
    if (rest) rest.hidden = !quote;
    const choice = form.querySelector('[data-request-choice]');
    if (quote) {
      choice.textContent = upgradeChoiceText(cache, plan, plans, quote.extra);
    } else {
      const months = normalizePeriodMonths(form.elements.months.value);
      const samePlan = String(cache?.plan || '').trim().toLowerCase() === plan.id && canProlongSubscription(cache);
      const anchor = cache?.endsAt && cache.endsAt >= licenseToday() ? cache.endsAt : licenseToday();
      const renewedEnd = samePlan ? licenseAddMonths(anchor, months) : '';
      choice.textContent = samePlan
        ? `Prolongation de ${plan.name}. ${periodLabel(months)} : ${planPeriodPriceLabel(plan, months)}. La liaison continue jusqu’au ${formatLicenseDate(renewedEnd)}.`
        : `${plan.name} · ${periodLabel(months)} · ${planPeriodPriceLabel(plan, months)}`;
    }
    form.querySelectorAll('[data-pick-period]').forEach((item) => {
      item.classList.toggle('is-on', Number(item.dataset.pickPeriod) === Number(form.elements.months.value));
    });
  };
  const revealPayment = () => {
    if (!form) return;
    const step = form.querySelector('[data-pay-step]');
    const confirmBox = form.querySelector('[data-pay-confirm]');
    const hasMeans = contact.payments.length > 0;
    if (step) step.hidden = !hasMeans;
    if (confirmBox) confirmBox.hidden = hasMeans && !form.elements.payMethod.value;
  };
  root.querySelector('[data-prolong]')?.addEventListener('click', () => {
    const planId = String(cache?.plan || '').trim().toLowerCase();
    const plan = plans.find((item) => item.id === planId);
    if (!plan || !form) {
      showToast('Cette offre n’est plus au catalogue.', 'err');
      return;
    }
    root.querySelectorAll('.license-offer').forEach((item) => {
      item.classList.toggle('is-on', item.dataset.pickPlan === plan.id);
    });
    form.hidden = false;
    form.elements.plan.value = plan.id;
    form.elements.months.value = '1';
    paintChoice();
    revealPayment();
  });
  root.querySelectorAll('[data-pick-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      const plan = plans.find((item) => item.id === button.dataset.pickPlan);
      if (!plan || !form) return;
      root.querySelectorAll('.license-offer').forEach((item) => item.classList.toggle('is-on', item === button));
      form.hidden = false;
      form.elements.plan.value = plan.id;
      const base = licenseUpgradeQuote(cache, plan, plans, 0);
      form.elements.months.value = base?.partialDays ? '1' : (base ? '0' : '1');
      paintChoice();
      revealPayment();
    });
  });
  root.querySelectorAll('[data-pick-pay]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!form) return;
      const item = contact.payments[Number(button.dataset.pickPay)];
      if (!item) return;
      form.elements.payMethod.value = `${item.name} · ${paymentKindLabel(item.kind)}`;
      root.querySelectorAll('[data-pick-pay]').forEach((other) => other.classList.toggle('is-on', other === button));
      const guide = form.querySelector('[data-pay-guide]');
      if (guide) {
        guide.innerHTML = paymentGuideHtml(item);
        guide.hidden = false;
      }
      const confirmBox = form.querySelector('[data-pay-confirm]');
      if (confirmBox) confirmBox.hidden = false;
    });
  });
  root.querySelectorAll('[data-pick-period]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!form) return;
      form.elements.months.value = button.dataset.pickPeriod;
      paintChoice();
    });
  });
  form?.elements.proof?.addEventListener('change', () => {
    const file = form.elements.proof.files[0];
    const preview = form.querySelector('[data-proof-preview]');
    if (!file || !preview) return;
    readPaymentProof(file).then((src) => {
      preview.src = src;
      preview.hidden = false;
    }).catch((error) => {
      preview.hidden = true;
      preview.removeAttribute('src');
      showToast(error.message, 'err');
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
      if (contact.payments.length && !String(data.payMethod || '').trim()) {
        throw new Error('Choisissez un moyen de paiement.');
      }
      const paid = subscriptionLicenseRecord();
      const plan = plans.find((item) => item.id === String(data.plan || ''));
      const picked = [0, 1, 3, 12].includes(Number(data.months)) ? Number(data.months) : 0;
      const quote = licenseUpgradeQuote(paid, plan, plans, picked);
      const proof = await readPaymentProof(form.elements.proof.files[0]);
      await sendLicenseRequest({
        clientName: String(data.clientName || '').trim(),
        phone: String(data.phone || '').trim(),
        plan: String(data.plan || ''),
        months: quote ? quote.extra : data.months,
        extraMonths: quote ? quote.extra : '',
        currentCode: paid.code,
        proof,
        payName: String(data.payMethod || ''),
        upgrade: quote ? '1' : '0',
        upgradeDue: quote ? String(quote.due) : '',
        upgradeEndsAt: quote ? quote.endsAt : '',
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
      if (pending?.status === 'rejected') {
        localStorage.removeItem(licenseRequestKey);
        showToast('Demande rejetée. Vous pouvez en envoyer une autre.', 'err', 7000);
        refreshSubscriptionModal(document.getElementById('subscription-modal')).catch(() => {});
        return;
      }
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
  remote.code = code;
  if (code === 'HT-FONDATEUR-001') remote.plan = 'fondateur';
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

function essaiDayCount() {
  const days = Number(licenseRights('essai').days);
  return Number.isInteger(days) && days >= 1 ? days : 5;
}

function startLocalEssai() {
  const start = licenseToday();
  writeLicenseCache({
    code: `HT-ESSAI-${licenseDeviceId().replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase() || '000'}`,
    plan: 'essai',
    status: 'active',
    startsAt: start,
    endsAt: licenseAddDays(start, essaiDayCount()),
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
    try { await loadPublicPlans(); } catch { /* durée d’essai locale */ }
    startLocalEssai();
    clearLicenseGate();
    return false;
  }
  try {
    const remote = await fetchLicenseRemote(cache.code);
    remote.code = cache.code;
    if (normalizeLicenseCode(cache.code) === 'HT-FONDATEUR-001') remote.plan = 'fondateur';
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

const planNameById = {
  fondateur: 'Fondateur',
  essai: 'Essai',
  basique: 'Basique',
  standard: 'Standard',
  pro: 'Pro',
};

function rememberPlanNames(plans) {
  (plans || []).forEach((plan) => {
    if (plan?.id && plan.name) planNameById[plan.id] = plan.name;
  });
}

function licensePlanLabel(plan) {
  return planNameById[plan] || plan || 'Licence';
}

function paintLicenseBadge() {
  document.getElementById('license-badge')?.remove();
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
          quotaKeep: fields.quotaKeep
            ? firestoreString(fields, 'quotaKeep')
            : (workspaceLicenseRecord()?.quotaKeep || ''),
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
