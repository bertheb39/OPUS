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
  const rows = (state.licenseClients || []).map((item) => `
    <article class="card">
      <div class="profile-head">
        <h2>${esc(item.clientName || item.code)}</h2>
        <span class="meta">${esc(item.plan)} · ${esc(item.status)}</span>
      </div>
      <p class="meta"><strong>${esc(item.code)}</strong> · fin ${esc(item.endsAt || '—')} · ${item.plan === 'fondateur' ? 'appareils illimités' : (item.deviceId ? 'téléphone lié' : 'pas encore lié')}</p>
      <p class="meta">${esc(item.phone || '—')}${item.notes ? ` · ${esc(item.notes)}` : ''}</p>
      <div class="actions">
        <button type="button" data-action="client-extend" data-months="1" data-code="${esc(item.code)}">+1 mois</button>
        <button type="button" data-action="client-extend" data-months="3" data-code="${esc(item.code)}">+3 mois</button>
        ${item.plan === 'fondateur' ? '' : `<button type="button" class="btn-quiet" data-action="client-detach" data-code="${esc(item.code)}">Détacher</button>`}
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
  return `
    <section class="card">
      <h2>Tarifs des abonnements</h2>
      <p class="meta">Les clients voient ces offres avant de demander un code.</p>
      <div class="actions">
        <button type="button" data-action="plan-quotas">Routeurs et revendeurs</button>
        <button type="button" data-action="plan-add">Ajouter une offre</button>
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
    ${rows || '<section class="card"><p class="meta">Aucun client pour l’instant.</p></section>'}
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
  return ['basique', 'standard', 'pro', 'essai', 'fondateur'].includes(id);
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
    if (event.target.closest('[data-action="plan-quotas"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPlanQuotaModal();
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
