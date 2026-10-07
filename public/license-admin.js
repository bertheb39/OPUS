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

async function loadLicenseClients() {
  const response = await operatorFirestore('licenses');
  if (response.status === 403) {
    throw new Error('Les règles Firestore refusent la liste. Publiez les règles opérateur (request.auth != null).');
  }
  if (!response.ok) throw new Error('Impossible de lire les clients.');
  const data = await response.json();
  return (data.documents || []).map(parseListedLicense).sort((a, b) => (
    a.clientName.localeCompare(b.clientName, 'fr') || a.code.localeCompare(b.code)
  ));
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
  const rows = (state.licenseClients || []).map((item) => `
    <article class="card">
      <div class="profile-head">
        <h2>${esc(item.clientName || item.code)}</h2>
        <span class="meta">${esc(item.plan)} · ${esc(item.status)}</span>
      </div>
      <p class="meta"><strong>${esc(item.code)}</strong> · fin ${esc(item.endsAt || '—')} · ${item.deviceId ? 'téléphone lié' : 'pas encore lié'}</p>
      <p class="meta">${esc(item.phone || '—')}${item.notes ? ` · ${esc(item.notes)}` : ''}</p>
      <div class="actions">
        <button type="button" data-action="client-extend" data-months="1" data-code="${esc(item.code)}">+1 mois</button>
        <button type="button" data-action="client-extend" data-months="3" data-code="${esc(item.code)}">+3 mois</button>
        <button type="button" class="btn-quiet" data-action="client-detach" data-code="${esc(item.code)}">Détacher</button>
        <button type="button" class="btn-quiet" data-action="client-reset-password" data-code="${esc(item.code)}">Autoriser réinit. mot de passe</button>
        ${item.status === 'active'
          ? `<button type="button" class="btn-quiet" data-action="client-suspend" data-code="${esc(item.code)}">Suspendre</button>`
          : `<button type="button" class="btn-quiet" data-action="client-activate" data-code="${esc(item.code)}">Réactiver</button>`}
        <button type="button" class="btn-danger" data-action="client-revoke" data-code="${esc(item.code)}">Révoquer</button>
      </div>
    </article>
  `).join('');
  const plans = state.licensePlans || defaultSubscriptionPlans();
  const pending = (state.licenseRequests || []).filter((item) => item.status === 'pending');
  const planFields = plans.map((plan) => `
    <article class="card">
      <h3>${esc(plan.name || plan.id)}</h3>
      <p class="meta">${esc((typeof LICENSE_RIGHTS !== 'undefined' && LICENSE_RIGHTS[plan.id]?.blurb) || '')}</p>
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
  const requestRows = pending.map((item) => `
    <article class="card">
      <p><strong>${esc(item.clientName)}</strong> · ${esc(item.phone)} · ${esc(item.plan)} · ${esc(typeof periodLabel === 'function' ? periodLabel(item.months) : `${item.months || 1} mois`)}</p>
      <button type="button" data-action="request-accept" data-id="${esc(item.id)}">Paiement reçu — activer</button>
    </article>
  `).join('');
  return `
    <section class="card">
      <h2>Tarifs des abonnements</h2>
      <p class="meta">Les clients voient ces offres avant de demander un code.</p>
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
          <option value="basique">Basique</option>
          <option value="standard">Standard</option>
          <option value="pro">Pro</option>
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
    ${rows || '<section class="card"><p class="meta">Aucun client pour l’instant.</p></section>'}
  `;
}

async function loadLicensePlans() {
  const response = await operatorFirestore('plans');
  if (response.status === 403) return defaultSubscriptionPlans();
  if (!response.ok) return defaultSubscriptionPlans();
  const data = await response.json();
  const remote = new Map((data.documents || []).map((doc) => {
    const plan = parsePlanDoc(doc);
    return [plan.id, plan];
  }));
  return defaultSubscriptionPlans().map((item) => ({ ...item, ...(remote.get(item.id) || {}) }));
}

async function saveLicensePlans(form) {
  const rows = ['basique', 'standard', 'pro'];
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
    };
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function acceptLicenseRequest(id) {
  const request = (state.licenseRequests || []).find((item) => item.id === id);
  if (!request) throw new Error('Demande introuvable.');
  const months = typeof normalizePeriodMonths === 'function' ? normalizePeriodMonths(request.months) : Number(request.months) || 1;
  let start = licenseToday();
  let code = normalizeLicenseCode(request.currentCode);
  const fromEssai = !code || code.startsWith('HT-ESSAI');
  const current = fromEssai
    ? null
    : (state.licenseClients || []).find((item) => item.code === code);
  if (current && current.plan !== 'essai' && current.endsAt && current.endsAt >= start) {
    start = current.endsAt;
  }
  const endsAt = typeof licenseAddMonths === 'function'
    ? licenseAddMonths(start, months)
    : defaultEndForPlan(request.plan, months);
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

async function refreshLicenseClients() {
  if (!isFounderOperator() || !readOperatorAuth()) {
    state.licenseClients = [];
    state.licensePlans = defaultSubscriptionPlans();
    state.licenseRequests = [];
    return;
  }
  const [clients, plans, requests] = await Promise.all([
    loadLicenseClients(),
    loadLicensePlans(),
    loadLicenseRequests(),
  ]);
  state.licenseClients = clients;
  state.licensePlans = plans;
  state.licenseRequests = requests;
  if (typeof publishLicenseLookup === 'function') {
    clients.forEach((item) => {
      if (item.phone && item.code && item.plan !== 'fondateur') {
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
    const button = event.target.closest('[data-action^="client-"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const code = button.dataset.code;
    const action = button.dataset.action;
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
      render();
    }
  }, true);

  app.addEventListener('change', (event) => {
    const field = event.target.closest('form[data-form="client-create"] [name="plan"], form[data-form="client-create"] [name="months"]');
    if (!field) return;
    const end = field.form?.elements.endsAt;
    if (end) end.value = defaultEndForPlan(field.form.elements.plan.value, field.form.elements.months.value);
  });
}
