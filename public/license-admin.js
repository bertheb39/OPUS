const operatorTokenKey = 'opus.operatorAuth';

function isFounderOperator() {
  return typeof isFounderLicense === 'function' && isFounderLicense();
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00`);
  const base = Number.isNaN(date.getTime()) ? new Date() : date;
  base.setDate(base.getDate() + Number(days || 0));
  const month = String(base.getMonth() + 1).padStart(2, '0');
  const day = String(base.getDate()).padStart(2, '0');
  return `${base.getFullYear()}-${month}-${day}`;
}

function defaultEndForPlan(plan, months = 1) {
  if (plan === 'fondateur') return '2099-12-31';
  const add = typeof licenseAddMonths === 'function' ? licenseAddMonths : addDays;
  const span = typeof normalizePeriodMonths === 'function' ? normalizePeriodMonths(months) : Number(months) || 1;
  return add(licenseToday(), typeof licenseAddMonths === 'function' ? span : span * 30);
}

function suggestLicenseCode() {
  const chunk = Math.random().toString(36).slice(2, 6).toUpperCase();
  const num = String(Math.floor(Math.random() * 900) + 100);
  return `HT-${chunk}-${num}`;
}

function readOperatorAuth() {
  try {
    const data = JSON.parse(sessionStorage.getItem(operatorTokenKey) || 'null');
    if (!data?.idToken || !data.exp || Date.now() > Number(data.exp)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeOperatorAuth(payload) {
  sessionStorage.setItem(operatorTokenKey, JSON.stringify(payload));
}

function clearOperatorAuth() {
  sessionStorage.removeItem(operatorTokenKey);
}

async function signInOperator(email, password) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await response.json();
  if (!response.ok) {
    const raw = String(data?.error?.message || '');
    if (/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/i.test(raw)) {
      throw new Error('E-mail ou mot de passe opérateur incorrect.');
    }
    if (/USER_DISABLED/i.test(raw)) throw new Error('Ce compte opérateur est désactivé.');
    throw new Error('Connexion opérateur impossible. Activez Authentication → E-mail/mot de passe dans Firebase.');
  }
  writeOperatorAuth({
    idToken: data.idToken,
    email: data.email,
    exp: Date.now() + (Number(data.expiresIn || 3600) * 1000) - 15000,
  });
}

function licenseFieldsPayload(record) {
  const fields = {};
  Object.entries(record).forEach(([key, value]) => {
    fields[key] = { stringValue: String(value ?? '') };
  });
  return { fields };
}

function parseListedLicense(doc) {
  const name = String(doc.name || '');
  const code = decodeURIComponent(name.split('/').pop() || '');
  return { code, ...parseLicenseDoc(doc) };
}

async function operatorFirestore(path, options = {}) {
  const auth = readOperatorAuth();
  if (!auth) throw new Error('Reconnectez l’opérateur.');
  const project = encodeURIComponent(FIREBASE_PROJECT_ID);
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/%28default%29/documents/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.idToken}`,
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    clearOperatorAuth();
    throw new Error('Session opérateur expirée. Reconnectez-vous.');
  }
  return response;
}

async function listOperatorCollection(collectionId) {
  const documents = [];
  let pageToken = '';
  let status = 200;
  do {
    const query = `pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const response = await operatorFirestore(`${collectionId}?${query}`);
    status = response.status;
    if (!response.ok) return { ok: false, status, documents };
    const data = await response.json();
    documents.push(...(data.documents || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return { ok: true, status, documents };
}

async function loadLicenseClients() {
  const listed = await listOperatorCollection('licenses');
  if (listed.status === 403) {
    throw new Error('Les règles Firestore refusent la liste. Publiez les règles opérateur (request.auth != null).');
  }
  if (!listed.ok) throw new Error('Impossible de lire les clients.');
  return listed.documents.map(parseListedLicense).sort((a, b) => (
    a.clientName.localeCompare(b.clientName, 'fr') || a.code.localeCompare(b.code)
  ));
}

function parseListedWorkspace(doc) {
  const name = String(doc.name || '');
  const id = decodeURIComponent(name.split('/').pop() || '');
  const fields = doc.fields || {};
  return {
    id,
    code: typeof firestoreString === 'function' ? firestoreString(fields, 'code') : '',
    clientName: typeof firestoreString === 'function' ? firestoreString(fields, 'clientName') : '',
    phone: typeof firestoreString === 'function' ? firestoreString(fields, 'phone') : '',
    plan: typeof firestoreString === 'function' ? firestoreString(fields, 'plan').trim().toLowerCase() : '',
    status: typeof firestoreString === 'function' ? firestoreString(fields, 'status').toLowerCase() : '',
    endsAt: typeof firestoreString === 'function' ? firestoreString(fields, 'endsAt') : '',
    seenAt: typeof firestoreString === 'function' ? firestoreString(fields, 'seenAt') : '',
    removed: typeof firestoreString === 'function' ? firestoreString(fields, 'removed') : '',
  };
}

async function loadAppUsers() {
  const listed = await listOperatorCollection('workspaces');
  if (listed.status === 403) {
    throw new Error('Liste des téléphones refusée. Dans Firestore → Règles, autorisez workspaces : lecture si request.auth != null, création et mise à jour publiques.');
  }
  if (!listed.ok) throw new Error('Impossible de lire les téléphones qui ont ouvert l’application.');
  return listed.documents.map(parseListedWorkspace).filter((item) => item.code);
}

function formatSeenAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (typeof formatDateTime === 'function') return formatDateTime(date.toISOString());
  return value.slice(0, 16).replace('T', ' ');
}

const clientListUi = { query: '', kind: 'all', state: 'all' };

function isEssaiClient(item) {
  return item?.plan === 'essai' || String(item?.code || '').startsWith('HT-ESSAI');
}

function isFounderClient(item) {
  if (!item?.code || item.plan === 'fondateur') return true;
  const code = typeof normalizeLicenseCode === 'function' ? normalizeLicenseCode(item.code) : String(item.code).toUpperCase();
  return code === 'HT-FONDATEUR-001';
}

function clientRows() {
  const licenses = state.licenseClients || [];
  const byCode = new Map(licenses.map((item) => [item.code, item]));
  const rows = new Map();
  (state.appUsers || []).forEach((user) => {
    if (!user.code || user.removed === '1' || isFounderClient(user)) return;
    const license = byCode.get(user.code);
    if (license?.removed === '1' || (license && isFounderClient(license))) return;
    const existing = rows.get(user.code);
    if (existing) {
      if (user.id) existing.workspaceIds.push(user.id);
      if (String(user.seenAt) > String(existing.seenAt)) existing.seenAt = user.seenAt;
      return;
    }
    rows.set(user.code, {
      code: user.code,
      clientName: user.clientName || license?.clientName || '',
      phone: user.phone || license?.phone || '',
      plan: user.plan || license?.plan || '',
      status: license?.status || user.status || '',
      endsAt: license?.endsAt || user.endsAt || '',
      seenAt: user.seenAt || '',
      opened: true,
      hasLicense: Boolean(license) && !isEssaiClient(license),
      workspaceIds: user.id ? [user.id] : [],
    });
  });
  licenses.forEach((license) => {
    if (!license.code || license.removed === '1' || isFounderClient(license) || rows.has(license.code)) return;
    rows.set(license.code, {
      code: license.code,
      clientName: license.clientName || '',
      phone: license.phone || '',
      plan: license.plan || '',
      status: license.status || '',
      endsAt: license.endsAt || '',
      seenAt: '',
      opened: false,
      hasLicense: !isEssaiClient(license),
      workspaceIds: [],
    });
  });
  return [...rows.values()].sort((a, b) => (
    String(b.seenAt).localeCompare(String(a.seenAt)) || a.clientName.localeCompare(b.clientName, 'fr')
  ));
}

function clientIsLive(item) {
  if (item.status === 'suspended' || item.status === 'revoked') return false;
  if (item.endsAt && typeof licenseToday === 'function' && item.endsAt < licenseToday()) return false;
  return item.status === 'active' || item.status === '';
}

function clientMatches(item) {
  const essai = isEssaiClient(item);
  if (clientListUi.kind === 'essai' && !essai) return false;
  if (clientListUi.kind === 'licence' && (essai || !item.hasLicense)) return false;
  if (clientListUi.kind === 'pending' && item.opened) return false;
  if (clientListUi.state === 'live' && !clientIsLive(item)) return false;
  if (clientListUi.state === 'stopped' && clientIsLive(item)) return false;
  const query = clientListUi.query.trim().toLowerCase();
  if (!query) return true;
  const plan = typeof licensePlanLabel === 'function' ? licensePlanLabel(item.plan) : item.plan;
  return [item.clientName, item.phone, item.code, plan].join(' ').toLowerCase().includes(query);
}

function clientCardHtml(item) {
  const plan = typeof licensePlanLabel === 'function' ? licensePlanLabel(item.plan) : (item.plan || '—');
  const title = item.clientName || (isEssaiClient(item) ? 'Essai' : 'Client');
  const seenAt = formatSeenAt(item.seenAt);
  const expired = item.endsAt && typeof licenseToday === 'function' && item.endsAt < licenseToday();
  const stateLabel = item.status === 'suspended'
    ? 'suspendu'
    : item.status === 'revoked'
      ? 'révoqué'
      : (expired ? 'expiré' : (item.status || 'actif'));
  const where = item.opened
    ? (seenAt ? `vu ${seenAt}` : 'application ouverte')
    : 'code pas encore ouvert';
  const manage = item.hasLicense ? `
        <button type="button" data-action="client-extend" data-months="1" data-code="${esc(item.code)}">+1 mois</button>
        <button type="button" data-action="client-extend" data-months="3" data-code="${esc(item.code)}">+3 mois</button>
        <button type="button" class="btn-quiet" data-action="client-detach" data-code="${esc(item.code)}">Détacher</button>
        <button type="button" class="btn-quiet" data-action="client-reset-password" data-code="${esc(item.code)}">Réinit. mot de passe</button>
        ${item.status === 'active' && !expired
          ? `<button type="button" class="btn-quiet" data-action="client-suspend" data-code="${esc(item.code)}">Suspendre</button>`
          : `<button type="button" class="btn-quiet" data-action="client-activate" data-code="${esc(item.code)}">Réactiver</button>`}
  ` : '';
  return `
    <article class="card">
      <div class="profile-head">
        <h2>${esc(title)}</h2>
        <span class="meta">${esc(plan)} · ${esc(stateLabel)}</span>
      </div>
      <p class="meta"><strong>${esc(item.code)}</strong> · fin ${esc(item.endsAt || '—')}</p>
      <p class="meta">${esc(item.phone || 'Téléphone non renseigné')} · ${esc(where)}</p>
      <div class="actions">
        ${manage}
        <button type="button" class="btn-danger client-delete" data-action="client-delete" data-code="${esc(item.code)}">Supprimer</button>
      </div>
    </article>
  `;
}

function paintClientList() {
  const host = document.querySelector('#clients-modal [data-client-list]');
  const count = document.querySelector('#clients-modal [data-client-count]');
  if (!host) return;
  const rows = clientRows().filter(clientMatches);
  if (count) count.textContent = rows.length > 1 ? `${rows.length} clients` : `${rows.length} client`;
  host.innerHTML = rows.map(clientCardHtml).join('') || '<p class="meta">Aucun client pour ce filtre.</p>';
}

function openClientsModal() {
  let overlay = document.getElementById('clients-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'clients-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <section class="modal modal-form clients-modal" role="dialog" aria-modal="true" aria-labelledby="clients-modal-title">
        <h2 id="clients-modal-title">Clients</h2>
        <input data-client-query type="search" placeholder="Nom, téléphone ou code" autocomplete="off" value="${esc(clientListUi.query)}">
        <div class="client-filters" data-client-kind>
          <button type="button" data-kind="all" class="${clientListUi.kind === 'all' ? 'is-on' : ''}">Tous</button>
          <button type="button" data-kind="essai" class="${clientListUi.kind === 'essai' ? 'is-on' : ''}">Essai</button>
          <button type="button" data-kind="licence" class="${clientListUi.kind === 'licence' ? 'is-on' : ''}">Licence</button>
          <button type="button" data-kind="pending" class="${clientListUi.kind === 'pending' ? 'is-on' : ''}">Pas ouvert</button>
        </div>
        <select data-client-state class="client-state">
          <option value="all" ${clientListUi.state === 'all' ? 'selected' : ''}>Tous les états</option>
          <option value="live" ${clientListUi.state === 'live' ? 'selected' : ''}>En cours</option>
          <option value="stopped" ${clientListUi.state === 'stopped' ? 'selected' : ''}>Coupés ou expirés</option>
        </select>
        <p class="meta" data-client-count></p>
        ${state.appUsersError ? `<p class="meta">${esc(state.appUsersError)}</p>` : ''}
        <div class="clients-list" data-client-list></div>
        <div class="modal-actions">
          <button type="button" class="btn-quiet" data-close-clients>Fermer</button>
        </div>
      </section>
    `;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    overlay.querySelector('[data-close-clients]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-client-query]').addEventListener('input', (event) => {
      clientListUi.query = event.target.value;
      paintClientList();
    });
    overlay.querySelector('[data-client-kind]').addEventListener('click', (event) => {
      const button = event.target.closest('[data-kind]');
      if (!button) return;
      clientListUi.kind = button.dataset.kind || 'all';
      overlay.querySelectorAll('[data-kind]').forEach((el) => el.classList.toggle('is-on', el === button));
      paintClientList();
    });
    overlay.querySelector('[data-client-state]').addEventListener('change', (event) => {
      clientListUi.state = event.target.value || 'all';
      paintClientList();
    });
    (document.querySelector('body.has-dock main') || document.body).appendChild(overlay);
  }
  paintClientList();
}

async function deleteOrHideLicense(code) {
  const deleted = await operatorFirestore(`licenses/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if (deleted.ok || deleted.status === 404) return;
  const patched = await operatorFirestore(
    `licenses/${encodeURIComponent(code)}?updateMask.fieldPaths=status&updateMask.fieldPaths=removed`,
    { method: 'PATCH', body: JSON.stringify(licenseFieldsPayload({ status: 'revoked', removed: '1' })) },
  );
  if (!patched.ok) {
    throw new Error('Suppression refusée. Dans Firestore → Règles, autorisez la suppression des licences pour l’opérateur.');
  }
}

async function hideWorkspace(id) {
  const response = await operatorFirestore(
    `workspaces/${encodeURIComponent(id)}?updateMask.fieldPaths=removed`,
    { method: 'PATCH', body: JSON.stringify(licenseFieldsPayload({ removed: '1' })) },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error('Le téléphone reste visible. Autorisez la mise à jour de workspaces dans les règles Firestore.');
  }
}

async function deleteListedClient(row) {
  if (!row?.code || isFounderClient(row)) throw new Error('Le fondateur ne se supprime pas.');
  const license = (state.licenseClients || []).find((item) => item.code === row.code && !isFounderClient(item));
  if (license) await deleteOrHideLicense(row.code);
  const ids = new Set(row.workspaceIds || []);
  (state.appUsers || []).forEach((user) => {
    if (user.code === row.code && user.id && user.removed !== '1') ids.add(user.id);
  });
  if (!license && ids.size === 0) throw new Error('Client introuvable.');
  await Promise.all([...ids].map((id) => hideWorkspace(id)));
  const phoneKey = typeof licensePhoneKey === 'function' ? licensePhoneKey(row.phone) : '';
  if (phoneKey && license) {
    await operatorFirestore(`license_lookups/${encodeURIComponent(phoneKey)}`, { method: 'DELETE' });
  }
}

async function createLicenseClient(data) {
  const code = normalizeLicenseCode(data.code);
  if (!/^HT-[A-Z0-9]+-[A-Z0-9]+$/.test(code)) {
    throw new Error('Le code doit ressembler à HT-AB12-345.');
  }
  const plan = String(data.plan || 'basique');
  const record = {
    clientName: String(data.clientName || '').trim() || 'Client',
    phone: String(data.phone || '').trim(),
    plan,
    status: 'active',
    startsAt: licenseToday(),
    endsAt: String(data.endsAt || defaultEndForPlan(plan)),
    deviceId: String(data.deviceId || ''),
    notes: String(data.notes || '').trim(),
  };
  const response = await operatorFirestore(`licenses?documentId=${encodeURIComponent(code)}`, {
    method: 'POST',
    body: JSON.stringify(licenseFieldsPayload(record)),
  });
  if (response.status === 409) throw new Error('Ce code existe déjà.');
  if (!response.ok) throw new Error('Création refusée. Vérifiez les règles opérateur.');
  if (typeof publishLicenseLookup === 'function') {
    publishLicenseLookup({ code, ...record }).catch(() => {});
  }
  return { code, ...record };
}

async function patchLicenseClient(code, patch) {
  const current = (state.licenseClients || []).find((item) => item.code === code);
  if (!current) throw new Error('Client introuvable.');
  const masks = Object.keys(patch).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
  const response = await operatorFirestore(`licenses/${encodeURIComponent(code)}?${masks}`, {
    method: 'PATCH',
    body: JSON.stringify(licenseFieldsPayload(patch)),
  });
  if (!response.ok) throw new Error('Mise à jour refusée.');
}

function clientForLicenseRequest(item) {
  const clients = state.licenseClients || [];
  const code = typeof normalizeLicenseCode === 'function' ? normalizeLicenseCode(item.currentCode) : String(item.currentCode || '');
  if (code && !code.startsWith('HT-ESSAI')) {
    const found = clients.find((client) => client.code === code);
    if (found) return found;
  }
  const digits = (value) => String(value || '').replace(/\D/g, '');
  const wanted = digits(item.phone);
  if (wanted.length >= 8) {
    const byPhone = clients.find((client) => {
      const phone = digits(client.phone);
      return phone.length >= 8
        && phone.slice(-8) === wanted.slice(-8)
        && client.plan
        && client.plan !== 'essai'
        && client.plan !== 'fondateur'
        && client.status !== 'revoked'
        && client.status !== 'suspended';
    });
    if (byPhone) return byPhone;
  }
  return null;
}

function requestOfferLine(item) {
  const plans = state.licensePlans || [];
  const next = plans.find((plan) => plan.id === item.plan);
  const current = clientForLicenseRequest(item);
  const extra = item.extraMonths === '' || item.extraMonths == null ? 0 : Number(item.extraMonths);
  const quote = current && next && typeof licenseUpgradeQuote === 'function'
    ? licenseUpgradeQuote(current, next, plans, extra)
    : null;
  if (quote) {
    const due = typeof money === 'function' ? money(quote.due) : String(quote.due);
    const until = typeof formatLicenseDate === 'function' ? formatLicenseDate(quote.endsAt) : quote.endsAt;
    const fromName = typeof licensePlanLabel === 'function' ? licensePlanLabel(quote.fromPlan) : quote.fromPlan;
    const toName = next?.name || item.plan;
    if (quote.partialDays && quote.extra) {
      const complement = typeof money === 'function' ? money(quote.complement) : String(quote.complement);
      const added = typeof money === 'function' ? money(quote.extraAmount) : String(quote.extraAmount);
      return `Passage ${fromName} → ${toName}. ${quote.partialDays} jours : ${complement}. + ${quote.extra} mois : ${added}. À encaisser : ${due}. Liaison jusqu’au ${until}.`;
    }
    if (quote.extra) {
      return `Passage ${fromName} → ${toName}. À encaisser : ${due}. La liaison continue jusqu’au ${until}.`;
    }
    return `Passage ${fromName} → ${toName}. Complément à encaisser : ${due}. Fin inchangée le ${until}.`;
  }
  if (item.upgrade === '1' && item.upgradeEndsAt) {
    const due = typeof money === 'function' ? money(Number(item.upgradeDue)) : String(item.upgradeDue || '');
    const until = typeof formatLicenseDate === 'function' ? formatLicenseDate(item.upgradeEndsAt) : item.upgradeEndsAt;
    return `Passage vers ${next?.name || item.plan}. Complément à encaisser : ${due}. Fin inchangée le ${until}.`;
  }
  const price = next && typeof planPeriodPriceLabel === 'function' ? planPeriodPriceLabel(next, item.months) : '';
  const period = typeof periodLabel === 'function' ? periodLabel(item.months) : `${item.months || 1} mois`;
  return `${next?.name || item.plan} · ${period}${price ? ` · ${price}` : ''}`;
}

function renderClients() {
  if (!isFounderOperator()) {
    return `
      <section class="card">
        <h2>Clients</h2>
        <p class="meta">Réservé à la licence Fondateur.</p>
      </section>
    `;
  }
  const auth = readOperatorAuth();
  if (!auth) {
    return `
      <section class="card">
        <h2>Opérateur licences</h2>
        <p class="help">Une seule fois dans Firebase : Authentication → Connexion → E-mail/mot de passe → activer, puis Ajouter un utilisateur (votre Gmail + un mot de passe).</p>
        <form data-form="operator-login" class="stack">
          <label>E-mail Firebase</label>
          <input name="email" type="email" required autocomplete="username">
          <label>Mot de passe</label>
          ${passwordField({ name: 'password', autocomplete: 'current-password', required: true })}
          <button type="submit">Ouvrir les clients</button>
        </form>
      </section>
    `;
  }
  const plans = state.licensePlans || defaultSubscriptionPlans();
  const pending = (state.licenseRequests || []).filter((item) => item.status === 'pending');
  const planFields = plans.map((plan) => `
    <article class="card">
      <h3>${esc(plan.name || plan.id)}</h3>
      <p class="meta">${esc(plan.blurb || (typeof LICENSE_RIGHTS !== 'undefined' && LICENSE_RIGHTS[plan.id]?.blurb) || '')}</p>
      <p class="meta">${esc(offerQuotaLabel(plan))}</p>
      <label>Nom affiché</label>
      <input name="name_${esc(plan.id)}" value="${esc(plan.name || '')}">
      <label>Prix / mois</label>
      <input name="price_${esc(plan.id)}" value="${esc(plan.price || '')}" inputmode="decimal" placeholder="Laisser vide = sur demande">
      <label>Prix 3 mois (facultatif)</label>
      <input name="price3_${esc(plan.id)}" value="${esc(plan.price3 || '')}" inputmode="decimal" placeholder="Sinon 3 × le mois">
      <label>Prix 12 mois (facultatif)</label>
      <input name="price12_${esc(plan.id)}" value="${esc(plan.price12 || '')}" inputmode="decimal" placeholder="Sinon 12 × le mois">
      <label>Texte</label>
      <input name="blurb_${esc(plan.id)}" value="${esc(plan.blurb || '')}">
      <label class="check-line"><input type="checkbox" name="active_${esc(plan.id)}" ${plan.active !== '0' ? 'checked' : ''}> Visible pour les clients</label>
    </article>
  `).join('');
  const requestRows = pending.map((item) => {
    const proof = typeof paymentProofSrc === 'function' ? paymentProofSrc(item.proof) : '';
    return `
    <article class="card">
      <p><strong>${esc(item.clientName)}</strong> · ${esc(item.phone)}</p>
      <p>${esc(requestOfferLine(item))}</p>
      ${item.payName ? `<p class="meta">Payé via ${esc(item.payName)}</p>` : ''}
      ${proof
        ? `<button type="button" class="proof-open" data-action="request-proof" data-id="${esc(item.id)}"><img class="payment-proof" src="${proof}" alt="Capture du paiement"></button>`
        : '<p class="meta">Aucune capture jointe.</p>'}
      <div class="actions">
        <button type="button" data-action="request-accept" data-id="${esc(item.id)}">Paiement reçu — activer</button>
        <button type="button" class="btn-danger" data-action="request-reject" data-id="${esc(item.id)}">Rejeter</button>
      </div>
    </article>
  `;
  }).join('');
  const clientCount = clientRows().length;
  return `
    <section class="card">
      <h2>Clients</h2>
      <p class="meta">Essais et licences, avec recherche et filtres. ${clientCount > 1 ? `${clientCount} clients` : `${clientCount} client`}.</p>
      ${state.appUsersError ? `<p class="meta">${esc(state.appUsersError)}</p>` : ''}
      <button type="button" data-action="open-clients">Voir les clients</button>
    </section>
    <section class="card">
      <h2>Tarifs des abonnements</h2>
      <p class="meta">Les clients voient ces offres avant de demander un code.</p>
      <div class="actions">
        <button type="button" data-action="plan-quotas">Routeurs et revendeurs</button>
        <button type="button" data-action="plan-add">Ajouter une offre</button>
        <button type="button" data-action="pay-means">Moyens de paiement</button>
      </div>
      <form data-form="plan-save" class="stack">
        ${planFields}
        <button type="submit">Enregistrer les tarifs</button>
      </form>
    </section>
    <section class="card">
      <h2>Demandes</h2>
      ${requestRows || '<p class="meta">Aucune demande en attente.</p>'}
    </section>
    <section class="card">
      <h2>Nouveau client</h2>
      <p class="meta">Connecté : ${esc(auth.email)}</p>
      <form data-form="client-create" class="stack">
        <label>Nom et prénom</label>
        <input name="clientName" required placeholder="Nom et prénom" autocomplete="name">
        <label>Téléphone</label>
        <input name="phone" placeholder="Téléphone" inputmode="tel">
        <label>Offre</label>
        <select name="plan">
          ${(state.licensePlans || defaultSubscriptionPlans()).filter((plan) => plan.active !== '0' && plan.id !== 'essai').map((plan) => (
            `<option value="${esc(plan.id)}">${esc(plan.name || plan.id)}</option>`
          )).join('')}
        </select>
        <label>Durée</label>
        <select name="months">
          <option value="1">1 mois</option>
          <option value="3">3 mois</option>
          <option value="12">12 mois</option>
        </select>
        <label>Fin</label>
        <input name="endsAt" type="date" value="${esc(defaultEndForPlan('basique', 1))}">
        <label>Code licence</label>
        <input name="code" required value="${esc(suggestLicenseCode())}" autocapitalize="characters">
        <label>Notes</label>
        <input name="notes" placeholder="Facultatif">
        <button type="submit">Créer et afficher le code</button>
      </form>
    </section>
  `;
}

async function loadLicensePlans() {
  const response = await operatorFirestore('plans');
  if (!response.ok) {
    state.essaiPlan = state.essaiPlan || defaultEssaiPlan();
    return defaultSubscriptionPlans();
  }
  const data = await response.json();
  const remote = new Map((data.documents || []).map((doc) => {
    const plan = parsePlanDoc(doc);
    return [plan.id, plan];
  }));
  const sellable = defaultSubscriptionPlans().map((item) => ({ ...item, ...(remote.get(item.id) || {}) }));
  remote.forEach((plan, id) => {
    if (!id || reservedPlanId(id)) return;
    sellable.push({
      id,
      name: plan.name || id,
      price: plan.price || '',
      price3: plan.price3 || '',
      price12: plan.price12 || '',
      blurb: plan.blurb || '',
      active: plan.active || '1',
      maxRouters: plan.maxRouters || '',
      maxResellers: plan.maxResellers || '',
      maxResellersPerRouter: plan.maxResellersPerRouter || '',
      days: plan.days || '',
    });
  });
  state.essaiPlan = { ...defaultEssaiPlan(), ...(remote.get('essai') || {}) };
  const known = [...sellable, state.essaiPlan];
  if (typeof rememberPlanQuotas === 'function') rememberPlanQuotas(known);
  if (typeof rememberPlanNames === 'function') rememberPlanNames(known);
  return sellable;
}

function defaultEssaiPlan() {
  return {
    id: 'essai',
    name: 'Essai',
    price: '',
    price3: '',
    price12: '',
    days: '5',
    blurb: typeof LICENSE_RIGHTS !== 'undefined' ? LICENSE_RIGHTS.essai.blurb : '',
    active: '1',
    maxRouters: '',
    maxResellers: '',
    maxResellersPerRouter: '',
  };
}

function reservedPlanId(id) {
  return ['basique', 'standard', 'pro', 'essai', 'fondateur', 'paiements'].includes(id);
}

function planIdFromName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function offerQuotaLabel(plan) {
  const quota = typeof readPlanQuota === 'function' ? readPlanQuota(plan) : null;
  if (!quota) return '';
  const routers = `${quota.maxRouters} routeur${quota.maxRouters > 1 ? 's' : ''}`;
  const resellers = `${quota.maxResellers} revendeur${quota.maxResellers > 1 ? 's' : ''}`;
  if (quota.maxResellersPerRouter < quota.maxResellers) {
    return `${routers} · ${resellers} au total · ${quota.maxResellersPerRouter} par routeur`;
  }
  return `${routers} · ${resellers}`;
}

function offerQuotaBlurb(id, routers, resellers, days = 0) {
  const routerLabel = `${routers} routeur${routers > 1 ? 's' : ''}`;
  const resellerLabel = `${resellers} revendeur${resellers > 1 ? 's' : ''}`;
  if (id === 'basique') return `${routerLabel} · ${resellerLabel} · sauvegarde fichier · pas de Drive`;
  if (id === 'standard') return `${routerLabel} · ${resellerLabel} · Drive · formation`;
  if (id === 'pro') return `Jusqu’à ${routers} routeur${routers > 1 ? 's' : ''} · ${resellerLabel} · Drive`;
  if (id === 'essai') return `${days} jours · ${routerLabel} · ${resellerLabel}`;
  return `${routerLabel} · ${resellerLabel} · Drive`;
}

function openPlanQuotaModal() {
  const sellable = (state.licensePlans || defaultSubscriptionPlans()).filter((plan) => plan.id !== 'essai');
  const plans = [state.essaiPlan || defaultEssaiPlan(), ...sellable];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const fields = plans.map((plan) => {
    const quota = typeof readPlanQuota === 'function' ? readPlanQuota(plan) : null;
    const routers = quota ? quota.maxRouters : 1;
    const resellers = quota ? quota.maxResellers : 1;
    const storedDays = Number(plan.days || quota?.days);
    const days = Number.isInteger(storedDays) && storedDays >= 1 ? storedDays : 5;
    return `
      <h3>${esc(plan.name || plan.id)}</h3>
      ${plan.id === 'essai' ? `
        <label>Jours</label>
        <input name="days_essai" type="number" min="1" max="365" step="1" value="${days}" required>
        <p class="meta">L’essai n’est pas vendu. Il démarre seul sur un téléphone sans licence, pendant ce nombre de jours.</p>
      ` : ''}
      <div class="quota-pair">
        <div>
          <label>Routeurs</label>
          <input name="routers_${esc(plan.id)}" type="number" min="1" max="99" step="1" value="${routers}" required>
        </div>
        <div>
          <label>Revendeurs</label>
          <input name="resellers_${esc(plan.id)}" type="number" min="1" max="999" step="1" value="${resellers}" required>
        </div>
      </div>
    `;
  }).join('');
  overlay.innerHTML = `
    <section class="modal modal-form" role="dialog" aria-modal="true">
      <h2>Plafonds des offres</h2>
      <p class="meta">Le nombre de revendeurs est le total du client. Si vous changez ce nombre, il peut tous les créer sur un seul routeur. L’essai se règle à part. Vous pouvez modifier ces plafonds quand vous voulez.</p>
      <form class="stack" data-plan-quotas>
        ${fields}
        <div class="modal-actions">
          <button type="button" class="btn-quiet" data-cancel>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </section>
  `;
  overlay.querySelector('[data-cancel]').addEventListener('click', () => overlay.remove());
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await savePlanQuotas(form);
      overlay.remove();
      await refreshLicenseClients();
      showToast('Plafonds enregistrés.', 'ok');
      render();
    } catch (error) {
      showToast(error.message, 'err', 5000);
      submit.disabled = false;
    }
  });
  (document.querySelector('body.has-dock main') || document.body).appendChild(overlay);
}

function payMeanEditRow(item = { name: '', phone: '', kind: 'simple', guide: '' }) {
  const kind = ['agent', 'marchand', 'simple'].includes(item.kind) ? item.kind : 'simple';
  const kinds = typeof PAYMENT_KINDS !== 'undefined'
    ? PAYMENT_KINDS
    : [
      { id: 'simple', label: 'Compte simple' },
      { id: 'agent', label: 'Code agent' },
      { id: 'marchand', label: 'SIM marchand' },
    ];
  return `
    <div class="pay-mean-edit">
      <input name="payName" placeholder="Ex. Orange Money" value="${esc(item.name || '')}" autocomplete="off">
      <input name="payPhone" placeholder="Numéro" value="${esc(item.phone || '')}" inputmode="tel" autocomplete="off">
      <select name="payKind">
        ${kinds.map((entry) => `<option value="${esc(entry.id)}"${entry.id === kind ? ' selected' : ''}>${esc(entry.label)}</option>`).join('')}
      </select>
      <textarea name="payGuide" rows="2" placeholder="Ex. Composez *144*1*numéro*montant#">${esc(item.guide || '')}</textarea>
    </div>
  `;
}

async function openPayMeansModal() {
  const current = typeof loadPublicContact === 'function'
    ? await loadPublicContact()
    : { payments: [], contactPhone: '' };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const rows = current.payments.length ? current.payments : [{ name: '', phone: '' }, { name: '', phone: '' }];
  overlay.innerHTML = `
    <section class="modal modal-form" role="dialog" aria-modal="true">
      <h2>Moyens de paiement</h2>
      <p class="meta">Le client choisit d’abord sa formule, puis un moyen. Le guide s’affiche avant la capture. Appel et WhatsApp peuvent être deux numéros. Si WhatsApp est vide, le numéro d’appel est utilisé.</p>
      <form class="stack" data-pay-means>
        <div data-pay-rows>
          ${rows.map((item) => payMeanEditRow(item)).join('')}
        </div>
        <button type="button" class="btn-quiet" data-add-pay>Ajouter un moyen</button>
        <label>Numéro d’appel</label>
        <input name="contactPhone" value="${esc(current.contactPhone || '')}" inputmode="tel" placeholder="Indicatif + numéro, ex. 22670000000" autocomplete="off">
        <label>Numéro WhatsApp</label>
        <input name="contactWhatsapp" value="${esc(current.contactWhatsapp || '')}" inputmode="tel" placeholder="Laisser vide = même numéro que l’appel" autocomplete="off">
        <label>Playlist de présentation</label>
        <input name="tutorialUrl" type="url" inputmode="url" value="${esc(current.tutorialUrl || '')}" placeholder="https://youtube.com/playlist?list=…" autocomplete="off">
        <p class="meta">Ce lien s’ouvre avec le bouton Tuto dans À propos. Laissez vide pour masquer le bouton.</p>
        <div class="modal-actions">
          <button type="button" class="btn-quiet" data-cancel>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </section>
  `;
  overlay.querySelector('[data-cancel]').addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-add-pay]').addEventListener('click', () => {
    const host = overlay.querySelector('[data-pay-rows]');
    if (!host || host.querySelectorAll('.pay-mean-edit').length >= 8) return;
    host.insertAdjacentHTML('beforeend', payMeanEditRow());
  });
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await savePublicContact(form);
      if (typeof clearPublicContactCache === 'function') clearPublicContactCache();
      overlay.remove();
      showToast('Moyens de paiement enregistrés.', 'ok');
    } catch (error) {
      showToast(error.message, 'err', 7000);
      submit.disabled = false;
    }
  });
  (document.querySelector('body.has-dock main') || document.body).appendChild(overlay);
}

async function savePublicContact(form) {
  const names = [...form.querySelectorAll('[name="payName"]')];
  const phones = [...form.querySelectorAll('[name="payPhone"]')];
  const kinds = [...form.querySelectorAll('[name="payKind"]')];
  const guides = [...form.querySelectorAll('[name="payGuide"]')];
  const payments = names.map((input, index) => ({
    name: String(input.value || '').trim(),
    phone: String(phones[index]?.value || '').trim(),
    kind: ['agent', 'marchand', 'simple'].includes(kinds[index]?.value) ? kinds[index].value : 'simple',
    guide: String(guides[index]?.value || '').trim(),
  })).filter((item) => item.name && item.phone).slice(0, 8);
  const contactPhone = String(form.elements.contactPhone.value || '').trim();
  const contactWhatsapp = String(form.elements.contactWhatsapp.value || '').trim();
  const tutorialRaw = String(form.elements.tutorialUrl?.value || '').trim();
  const tutorialUrl = typeof tutorialHref === 'function' ? tutorialHref(tutorialRaw) : tutorialRaw;
  if (tutorialRaw && !tutorialUrl) throw new Error('Le lien du tuto doit être une adresse http ou https.');
  const record = {
    payments: JSON.stringify(payments),
    contactPhone,
    contactWhatsapp,
    tutorialUrl,
    active: '0',
    name: 'Paiements',
  };
  const payload = licenseFieldsPayload(record);
  const masks = ['payments', 'contactPhone', 'contactWhatsapp', 'tutorialUrl', 'active', 'name']
    .map((key) => `updateMask.fieldPaths=${key}`)
    .join('&');
  let response = await operatorFirestore(`plans/paiements?${masks}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (response.status === 404) {
    response = await operatorFirestore('plans?documentId=paiements', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
  if (!response.ok) {
    throw new Error('Enregistrement refusé. Publiez les règles plans, comme pour les tarifs.');
  }
}

async function saveTutorialLink(url) {
  const tutorialUrl = typeof tutorialHref === 'function' ? tutorialHref(url) : String(url || '').trim();
  if (String(url || '').trim() && !tutorialUrl) {
    throw new Error('Le lien du tuto doit être une adresse http ou https.');
  }
  const record = { tutorialUrl };
  const payload = licenseFieldsPayload(record);
  let response = await operatorFirestore('plans/paiements?updateMask.fieldPaths=tutorialUrl', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (response.status === 404) {
    response = await operatorFirestore('plans?documentId=paiements', {
      method: 'POST',
      body: JSON.stringify(licenseFieldsPayload({
        tutorialUrl,
        payments: '[]',
        contactPhone: '',
        contactWhatsapp: '',
        active: '0',
        name: 'Paiements',
      })),
    });
  }
  if (!response.ok) {
    throw new Error('Enregistrement refusé. Publiez les règles plans, comme pour les tarifs.');
  }
}

async function savePlanQuotas(form) {
  const rows = [...form.querySelectorAll('input[name^="routers_"]')].map((input) => input.name.slice('routers_'.length));
  await Promise.all(rows.map(async (id) => {
    const plan = [...(state.licensePlans || []), state.essaiPlan].find((item) => item?.id === id) || { id, name: id };
    const routers = Number(form.elements[`routers_${id}`].value);
    const resellers = Number(form.elements[`resellers_${id}`].value);
    if (!Number.isInteger(routers) || routers < 1 || routers > 99) {
      throw new Error(`Indiquez entre 1 et 99 routeurs pour ${plan.name || id}.`);
    }
    if (!Number.isInteger(resellers) || resellers < 1 || resellers > 999) {
      throw new Error(`Indiquez entre 1 et 999 revendeurs pour ${plan.name || id}.`);
    }
    let days = 0;
    if (id === 'essai') {
      days = Number(form.elements.days_essai.value);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new Error('Indiquez entre 1 et 365 jours pour l’essai.');
      }
    }
    const previous = typeof readPlanQuota === 'function' ? readPlanQuota(plan) : null;
    const perRouter = previous && resellers === previous.maxResellers
      ? previous.maxResellersPerRouter
      : resellers;
    const builtin = typeof LICENSE_RIGHTS !== 'undefined' ? (LICENSE_RIGHTS[id]?.blurb || '') : '';
    const currentBlurb = String(plan.blurb || '');
    const generated = offerQuotaBlurb(id, routers, resellers, days);
    const record = {
      maxRouters: String(routers),
      maxResellers: String(resellers),
      maxResellersPerRouter: String(perRouter),
      blurb: (id === 'essai' || !currentBlurb || currentBlurb === builtin) ? generated : currentBlurb,
    };
    if (id === 'essai') record.days = String(days);
    const masks = Object.keys(record).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
    let response = await operatorFirestore(`plans/${encodeURIComponent(id)}?${masks}`, {
      method: 'PATCH',
      body: JSON.stringify(licenseFieldsPayload(record)),
    });
    if (response.status === 404) {
      response = await operatorFirestore(`plans?documentId=${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify(licenseFieldsPayload({
          name: plan.name || id,
          price: plan.price || '',
          price3: plan.price3 || '',
          price12: plan.price12 || '',
          active: plan.active === '0' ? '0' : '1',
          ...record,
        })),
      });
    }
    if (!response.ok) throw new Error('Enregistrement des plafonds refusé. Publiez les règles plans.');
  }));
}

function openPlanAddModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <section class="modal modal-form" role="dialog" aria-modal="true">
      <h2>Nouvelle offre</h2>
      <p class="meta">Elle apparaît chez les clients et dans la liste quand vous créez une licence. Le prix se règle ensuite dans Tarifs.</p>
      <form class="stack">
        <label>Nom</label>
        <input name="name" required maxlength="40" placeholder="Exemple : Entreprise">
        <label>Routeurs</label>
        <input name="routers" type="number" min="1" max="99" step="1" value="1" required>
        <label>Revendeurs</label>
        <input name="resellers" type="number" min="1" max="999" step="1" value="5" required>
        <div class="modal-actions">
          <button type="button" class="btn-quiet" data-cancel>Annuler</button>
          <button type="submit">Créer</button>
        </div>
      </form>
    </section>
  `;
  overlay.querySelector('[data-cancel]').addEventListener('click', () => overlay.remove());
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await createCustomPlan(form);
      overlay.remove();
      await refreshLicenseClients();
      showToast('Offre créée.', 'ok');
      render();
    } catch (error) {
      showToast(error.message, 'err', 5000);
      submit.disabled = false;
    }
  });
  (document.querySelector('body.has-dock main') || document.body).appendChild(overlay);
}

async function createCustomPlan(form) {
  const name = String(form.elements.name.value || '').trim();
  const id = planIdFromName(name);
  const routers = Number(form.elements.routers.value);
  const resellers = Number(form.elements.resellers.value);
  if (name.length < 2) throw new Error('Indiquez le nom de l’offre.');
  if (!/^[a-z0-9-]{2,24}$/.test(id) || reservedPlanId(id)) {
    throw new Error('Ce nom ne peut pas servir d’offre. Choisissez-en un autre.');
  }
  const known = [...(state.licensePlans || []), state.essaiPlan].some((plan) => plan?.id === id);
  if (known) throw new Error('Une offre porte déjà ce nom.');
  if (!Number.isInteger(routers) || routers < 1 || routers > 99) {
    throw new Error('Indiquez entre 1 et 99 routeurs.');
  }
  if (!Number.isInteger(resellers) || resellers < 1 || resellers > 999) {
    throw new Error('Indiquez entre 1 et 999 revendeurs.');
  }
  const record = {
    name,
    price: '',
    price3: '',
    price12: '',
    active: '1',
    maxRouters: String(routers),
    maxResellers: String(resellers),
    maxResellersPerRouter: String(resellers),
    blurb: offerQuotaBlurb(id, routers, resellers),
  };
  const response = await operatorFirestore(`plans?documentId=${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(licenseFieldsPayload(record)),
  });
  if (response.status === 409) throw new Error('Une offre porte déjà ce nom.');
  if (!response.ok) throw new Error('Création de l’offre refusée. Publiez les règles plans.');
}

async function saveLicensePlans(form) {
  const rows = [...form.querySelectorAll('input[name^="name_"]')].map((input) => input.name.slice('name_'.length));
  await Promise.all(rows.map(async (id) => {
    const record = {
      name: String(form.elements[`name_${id}`].value || id),
      price: String(form.elements[`price_${id}`].value || ''),
      price3: String(form.elements[`price3_${id}`].value || ''),
      price12: String(form.elements[`price12_${id}`].value || ''),
      blurb: String(form.elements[`blurb_${id}`].value || ''),
      active: form.elements[`active_${id}`].checked ? '1' : '0',
    };
    const masks = Object.keys(record).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
    let response = await operatorFirestore(`plans/${encodeURIComponent(id)}?${masks}`, {
      method: 'PATCH',
      body: JSON.stringify(licenseFieldsPayload(record)),
    });
    if (response.status === 404) {
      response = await operatorFirestore(`plans?documentId=${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify(licenseFieldsPayload(record)),
      });
    }
    if (!response.ok) throw new Error('Enregistrement des tarifs refusé. Publiez les règles plans.');
  }));
}

async function loadLicenseRequests() {
  const response = await operatorFirestore('license_requests');
  if (!response.ok) return [];
  const data = await response.json();
  return (data.documents || []).map((doc) => {
    const id = decodeURIComponent(String(doc.name || '').split('/').pop() || '');
    const fields = doc.fields || {};
    return {
      id,
      clientName: firestoreString(fields, 'clientName'),
      phone: firestoreString(fields, 'phone'),
      plan: firestoreString(fields, 'plan'),
      months: firestoreString(fields, 'months') || '1',
      status: firestoreString(fields, 'status') || 'pending',
      createdAt: firestoreString(fields, 'createdAt'),
      code: firestoreString(fields, 'code'),
      deviceId: firestoreString(fields, 'deviceId'),
      currentCode: firestoreString(fields, 'currentCode'),
      upgrade: firestoreString(fields, 'upgrade'),
      upgradeDue: firestoreString(fields, 'upgradeDue'),
      upgradeEndsAt: firestoreString(fields, 'upgradeEndsAt'),
      extraMonths: firestoreString(fields, 'extraMonths'),
      proof: firestoreString(fields, 'proof'),
      payName: firestoreString(fields, 'payName'),
    };
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function acceptLicenseRequest(id) {
  const request = (state.licenseRequests || []).find((item) => item.id === id);
  if (!request) throw new Error('Demande introuvable.');
  const months = typeof normalizePeriodMonths === 'function' ? normalizePeriodMonths(request.months) : Number(request.months) || 1;
  let start = licenseToday();
  let code = normalizeLicenseCode(request.currentCode);
  const named = typeof clientForLicenseRequest === 'function' ? clientForLicenseRequest(request) : null;
  if (!code && named?.code) code = normalizeLicenseCode(named.code);
  const fromEssai = !code || code.startsWith('HT-ESSAI');
  const current = fromEssai
    ? null
    : (named || (state.licenseClients || []).find((item) => item.code === code));
  const nextPlan = (state.licensePlans || []).find((item) => item.id === request.plan);
  const extra = request.extraMonths === '' || request.extraMonths == null ? 0 : Number(request.extraMonths);
  const quote = current && typeof licenseUpgradeQuote === 'function'
    ? licenseUpgradeQuote(current, nextPlan, state.licensePlans || [], extra)
    : null;
  const keptEnd = request.upgrade === '1' && request.upgradeEndsAt
    ? request.upgradeEndsAt
    : (quote ? quote.endsAt : '');
  if (!keptEnd && current && current.plan !== 'essai' && current.endsAt && current.endsAt >= start) {
    start = current.endsAt;
  }
  const endsAt = keptEnd
    ? keptEnd
    : (typeof licenseAddMonths === 'function'
      ? licenseAddMonths(start, months)
      : defaultEndForPlan(request.plan, months));
  if (fromEssai) code = '';
  if (code && (state.licenseClients || []).some((item) => item.code === code)) {
    await patchLicenseClient(code, {
      plan: request.plan,
      status: 'active',
      endsAt,
      clientName: request.clientName,
      phone: request.phone,
      deviceId: request.deviceId || '',
    });
  } else {
    const created = await createLicenseClient({
      clientName: request.clientName,
      phone: request.phone,
      plan: request.plan,
      endsAt,
      code: suggestLicenseCode(),
      deviceId: request.deviceId || '',
      notes: 'Depuis une demande client',
    });
    code = created.code;
  }
  const response = await operatorFirestore(`license_requests/${encodeURIComponent(id)}?updateMask.fieldPaths=status&updateMask.fieldPaths=code`, {
    method: 'PATCH',
    body: JSON.stringify(licenseFieldsPayload({ status: 'accepted', code })),
  });
  if (!response.ok) throw new Error('Licence activée, mais la demande n’a pas été marquée.');
  if (typeof publishLicenseLookup === 'function') {
    publishLicenseLookup({
      code,
      clientName: request.clientName,
      phone: request.phone,
      plan: request.plan,
    }).catch(() => {});
  }
  return { code };
}

async function rejectLicenseRequest(id) {
  const response = await operatorFirestore(`license_requests/${encodeURIComponent(id)}?updateMask.fieldPaths=status`, {
    method: 'PATCH',
    body: JSON.stringify(licenseFieldsPayload({ status: 'rejected' })),
  });
  if (!response.ok) throw new Error('Rejet impossible.');
}

async function refreshLicenseClients() {
  if (!isFounderOperator() || !readOperatorAuth()) {
    state.licenseClients = [];
    state.appUsers = [];
    state.appUsersError = '';
    state.licensePlans = defaultSubscriptionPlans();
    state.essaiPlan = defaultEssaiPlan();
    state.licenseRequests = [];
    return;
  }
  const [clients, plans, requests] = await Promise.all([
    loadLicenseClients(),
    loadLicensePlans(),
    loadLicenseRequests(),
  ]);
  let users = [];
  let usersError = '';
  try {
    users = await loadAppUsers();
  } catch (error) {
    usersError = error.message || 'Impossible de lire les téléphones.';
  }
  state.licenseClients = clients;
  state.appUsers = users;
  state.appUsersError = usersError;
  state.licensePlans = plans;
  state.licenseRequests = requests;
  if (typeof publishLicenseLookup === 'function') {
    clients.forEach((item) => {
      if (item.phone && item.code && item.plan !== 'fondateur' && item.removed !== '1') {
        publishLicenseLookup(item).catch(() => {});
      }
    });
  }
}

if (app) {
  app.addEventListener('submit', async (event) => {
    const form = event.target.closest('form');
    const kind = form?.dataset.form;
    if (kind !== 'operator-login' && kind !== 'client-create' && kind !== 'plan-save') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const data = Object.fromEntries(new FormData(form).entries());
    state.busy = true;
    showAppBusy(kind === 'operator-login' ? 'Connexion opérateur…' : (kind === 'plan-save' ? 'Enregistrement des tarifs…' : 'Création du client…'));
    render();
    try {
      if (kind === 'operator-login') {
        await signInOperator(data.email, data.password);
        await refreshLicenseClients();
        showToast('Opérateur connecté.', 'ok');
      } else if (kind === 'plan-save') {
        await saveLicensePlans(form);
        await refreshLicenseClients();
        showToast('Tarifs enregistrés.', 'ok');
      } else {
        const created = await createLicenseClient(data);
        await refreshLicenseClients();
        showToast(`Code à envoyer : ${created.code}`, 'ok', 8000);
      }
    } catch (error) {
      showToast(error.message, 'err', 5000);
    } finally {
      state.busy = false;
      hideAppBusy();
      render();
    }
  }, true);

  app.addEventListener('click', async (event) => {
    const accept = event.target.closest('[data-action="request-accept"]');
    if (event.target.closest('[data-action="plan-quotas"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPlanQuotaModal();
      return;
    }
    if (event.target.closest('[data-action="pay-means"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPayMeansModal().catch((error) => showToast(error.message, 'err'));
      return;
    }
    if (event.target.closest('[data-action="open-clients"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openClientsModal();
      return;
    }
    if (event.target.closest('[data-action="plan-add"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPlanAddModal();
      return;
    }
    if (accept) {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.busy = true;
      showAppBusy('Activation…');
      try {
        const created = await acceptLicenseRequest(accept.dataset.id);
        await refreshLicenseClients();
        showToast(`Licence activée (${created.code}).`, 'ok', 6000);
      } catch (error) {
        showToast(error.message, 'err');
      } finally {
        state.busy = false;
        hideAppBusy();
        render();
      }
      return;
    }
    const reject = event.target.closest('[data-action="request-reject"]');
    if (reject) {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.busy = true;
      showAppBusy('Rejet…');
      try {
        await rejectLicenseRequest(reject.dataset.id);
        await refreshLicenseClients();
        showToast('Demande rejetée.', 'ok');
      } catch (error) {
        showToast(error.message, 'err');
      } finally {
        state.busy = false;
        hideAppBusy();
        render();
      }
      return;
    }
    const proofButton = event.target.closest('[data-action="request-proof"]');
    if (proofButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const item = (state.licenseRequests || []).find((request) => request.id === proofButton.dataset.id);
      const src = item && typeof paymentProofSrc === 'function' ? paymentProofSrc(item.proof) : '';
      if (!src) return;
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `<section class="modal modal-form"><img class="payment-proof payment-proof-full" src="${src}" alt="Capture du paiement"><div class="modal-actions"><button type="button" class="btn-quiet" data-close-proof>Fermer</button></div></section>`;
      overlay.addEventListener('click', (click) => {
        if (click.target === overlay || click.target.closest('[data-close-proof]')) overlay.remove();
      });
      document.body.appendChild(overlay);
      return;
    }
    const button = event.target.closest('[data-action^="client-"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const code = button.dataset.code;
    const action = button.dataset.action;
    if (action === 'client-delete') {
      const row = clientRows().find((item) => item.code === code);
      if (!row) return;
      const who = row.clientName || row.code;
      if (!window.confirm(`Supprimer ${who} ?\n\nCe client disparaît de la liste. Son essai ou sa licence s’arrête sur le téléphone.`)) return;
      state.busy = true;
      showAppBusy('Suppression…');
      try {
        await deleteListedClient(row);
        await refreshLicenseClients();
        showToast('Client supprimé.', 'ok');
      } catch (error) {
        showToast(error.message, 'err', 6000);
      } finally {
        state.busy = false;
        hideAppBusy();
        if (document.getElementById('clients-modal')) paintClientList();
        else render();
      }
      return;
    }
    const current = (state.licenseClients || []).find((item) => item.code === code);
    if (!current) return;
    state.busy = true;
    showAppBusy('Mise à jour…');
    try {
      if (action === 'client-extend') {
        const months = Number(button.dataset.months) || 1;
        const start = current.endsAt && current.endsAt >= licenseToday() ? current.endsAt : licenseToday();
        const endsAt = typeof licenseAddMonths === 'function'
          ? licenseAddMonths(start, months)
          : addDays(start, months * 30);
        await patchLicenseClient(code, { endsAt, status: 'active' });
      }
      if (action === 'client-reset-password') {
        if (typeof authorizePasswordReset !== 'function') throw new Error('Module licence manquant.');
        const until = await authorizePasswordReset(code);
        const when = until ? new Date(until).toLocaleString('fr-FR') : '';
        showToast(when ? `Réinit. autorisée jusqu’au ${when}.` : 'Réinit. autorisée pour 24 h.', 'ok', 6000);
      }
      if (action === 'client-detach') await patchLicenseClient(code, { deviceId: '' });
      if (action === 'client-suspend') await patchLicenseClient(code, { status: 'suspended' });
      if (action === 'client-activate') await patchLicenseClient(code, { status: 'active' });
      if (action === 'client-revoke') await patchLicenseClient(code, { status: 'revoked' });
      await refreshLicenseClients();
      if (action !== 'client-reset-password') showToast('Client mis à jour.', 'ok');
    } catch (error) {
      showToast(error.message, 'err');
    } finally {
      state.busy = false;
      hideAppBusy();
      if (document.getElementById('clients-modal')) paintClientList();
      else render();
    }
  }, true);

  app.addEventListener('change', (event) => {
    const field = event.target.closest('form[data-form="client-create"] [name="plan"], form[data-form="client-create"] [name="months"]');
    if (!field) return;
    const end = field.form?.elements.endsAt;
    if (end) end.value = defaultEndForPlan(field.form.elements.plan.value, field.form.elements.months.value);
  });
}
