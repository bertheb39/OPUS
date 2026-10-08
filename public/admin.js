const app = document.getElementById('app');
const logoutButton = document.getElementById('logout');
const saleLink = document.getElementById('to-sale');
const clientsLink = document.getElementById('to-clients');
const scopeRouterSelect = document.getElementById('scope-router');
const scopeRouterWrap = document.getElementById('scope-router-wrap');
const scopeRouterKey = 'opus.scopeRouter';

const state = {
  needsSetup: false,
  resettingPassword: false,
  authed: false,
  tab: 'routers',
  routers: [],
  scopeRouterId: 0,
  profilesRouterId: 0,
  profiles: [],
  resellers: [],
  resellerMonth: '',
  salesFrom: '',
  salesTo: '',
  periodKind: 'today',
  salesRouterId: 0,
  salesResellerId: 0,
  actifsRouterId: 0,
  actifs: null,
  actifsWarning: '',
  usage: {},
  usageWarning: '',
  sales: null,
  recettes: null,
  recettesView: 'resellers',
  moneySyncing: false,
  licenseClients: [],
  licensePlans: [],
  licenseRequests: [],
  message: '',
  error: '',
  busy: false,
  busyAction: '',
  loading: false,
  editingRouterId: 0,
  lotOpen: 0,
  lotName: '',
  lot: null,
  resellerQuery: '',
};

function routerOptions(selected) {
  if (!state.routers.length) return '<option value="">Aucun routeur</option>';
  return state.routers.map((router) => (
    `<option value="${router.id}" ${Number(selected) === router.id ? 'selected' : ''}>${esc(router.name)}</option>`
  )).join('');
}

function readStoredScopeRouter() {
  const n = Number(localStorage.getItem(scopeRouterKey) || 0);
  return Number.isFinite(n) ? n : 0;
}

function scopedResellers() {
  if (!state.scopeRouterId) return state.resellers;
  return state.resellers.filter((reseller) => Number(reseller.routerId) === Number(state.scopeRouterId));
}

function resellerFilterOptions() {
  const list = scopedResellers();
  const selected = list.some((item) => item.id === state.salesResellerId) ? state.salesResellerId : 0;
  return ['<option value="0">Tous les revendeurs</option>'].concat(list.map((reseller) => (
    `<option value="${reseller.id}" ${selected === reseller.id ? 'selected' : ''}>${esc(reseller.hmpName)}</option>`
  ))).join('');
}

function applyScopeRouter(id, options = {}) {
  const next = Number(id) || 0;
  const known = state.routers.some((router) => router.id === next);
  const resolved = known ? next : (state.routers[0]?.id || 0);
  const changed = resolved !== state.scopeRouterId;
  state.scopeRouterId = resolved;
  if (options.persist !== false) {
    try { localStorage.setItem(scopeRouterKey, String(state.scopeRouterId)); } catch { /* ignore */ }
  }
  state.salesRouterId = state.scopeRouterId;
  state.actifsRouterId = state.scopeRouterId;
  if (state.scopeRouterId) state.profilesRouterId = state.scopeRouterId;
  if (changed) state.profiles = [];
  if (state.salesResellerId) {
    const stays = scopedResellers().some((item) => item.id === state.salesResellerId);
    if (!stays) state.salesResellerId = 0;
  }
}

function syncScopeFromRouters() {
  const saved = state.scopeRouterId || readStoredScopeRouter();
  const exists = state.routers.some((router) => router.id === saved);
  if (exists) applyScopeRouter(saved);
  else if (state.routers[0]) applyScopeRouter(state.routers[0].id);
  else applyScopeRouter(0);
}

function paintHeaderScope() {
  if (!scopeRouterSelect || !scopeRouterWrap) return;
  const show = state.authed && !state.needsSetup && state.routers.length > 0;
  scopeRouterWrap.hidden = !show;
  if (!show) return;
  const current = state.scopeRouterId;
  scopeRouterSelect.innerHTML = state.routers.map((router) => (
    `<option value="${router.id}" ${Number(current) === router.id ? 'selected' : ''}>${esc(router.name)}</option>`
  )).join('');
}

function scopedRouterField(selected) {
  if (state.scopeRouterId) {
    const name = state.routers.find((item) => item.id === state.scopeRouterId)?.name || '—';
    return `<p class="meta">Routeur : <strong>${esc(name)}</strong></p><input type="hidden" name="routerId" value="${esc(state.scopeRouterId)}">`;
  }
  return `<label>Routeur</label><select name="routerId" required>${routerOptions(selected)}</select>`;
}

function renderSetup() {
  app.innerHTML = `
    <section class="card">
      <h1>Compte administrateur</h1>
      <form data-form="setup">
        <label for="password">Mot de passe</label>
        ${passwordField({ id: 'password', name: 'password', autocomplete: 'new-password', required: true, minlength: 8 })}
        <label for="confirm">Confirmer</label>
        ${passwordField({ id: 'confirm', name: 'confirm', autocomplete: 'new-password', required: true, minlength: 8 })}
        <button type="submit" ${state.busy ? 'disabled' : ''}>Créer</button>
      </form>
    </section>
  `;
}

function renderLogin() {
  app.innerHTML = `
    <section class="card card-auth">
      <h1>Administration</h1>
      <form data-form="login">
        <label for="password">Mot de passe</label>
        ${passwordField({ id: 'password', name: 'password', autocomplete: 'current-password', required: true })}
        <button class="btn-block" type="submit" ${state.busy ? 'disabled' : ''}>Entrer</button>
      </form>
      <button class="btn-quiet btn-block" type="button" data-action="reset-admin" ${state.busy ? 'disabled' : ''}>Mot de passe oublié</button>
    </section>
  `;
}

function renderPasswordReset() {
  app.innerHTML = `
    <section class="card card-auth">
      <h1>Mot de passe oublié</h1>
      <p class="help">Contactez d’abord HORIZON TEAM. Quand la réinit est autorisée (24 h), le même nom et le même numéro qu’à l’abonnement suffisent.</p>
      <form data-form="reset-admin">
        <label>Nom et prénom</label>
        <input name="clientName" required placeholder="Nom et prénom" autocomplete="name">
        <label>Téléphone</label>
        <input name="phone" required placeholder="Téléphone" inputmode="tel" autocomplete="tel">
        <label>Nouveau mot de passe</label>
        ${passwordField({ name: 'password', autocomplete: 'new-password', required: true, minlength: 8 })}
        <label>Confirmer</label>
        ${passwordField({ name: 'confirm', autocomplete: 'new-password', required: true, minlength: 8 })}
        <button class="btn-block" type="submit" ${state.busy ? 'disabled' : ''}>Enregistrer</button>
      </form>
      <button class="btn-quiet btn-block" type="button" data-action="back-login" ${state.busy ? 'disabled' : ''}>Retour</button>
    </section>
  `;
}


function reachMode() {
  try {
    const mode = localStorage.getItem('opus.reach') || 'auto';
    if (mode === 'local' || mode === 'distant' || mode === 'auto') return mode;
  } catch {
    // stockage indisponible
  }
  return 'auto';
}

function renderRouters() {
  const mode = reachMode();
  const listed = state.scopeRouterId
    ? state.routers.filter((router) => router.id === state.scopeRouterId)
    : state.routers;
  const cards = listed.map((router) => {
    const editing = state.editingRouterId === router.id;
    return `
      <article class="card">
        <h2>${esc(router.name)}</h2>
        ${routerParked(router.id) ? '<p class="meta">Hors offre — communication coupée. La configuration reste.</p>' : ''}
        <p class="meta">${esc(router.host)}${router.admin_host ? ` · VPN ${esc(router.admin_host)}` : ''} · ${esc(router.username)}</p>
        <div class="actions">
          <button type="button" data-action="test-router" data-id="${router.id}" ${state.busy || routerParked(router.id) ? 'disabled' : ''}>${state.busy && state.busyAction === `test-${router.id}` ? 'Test…' : 'Tester'}</button>
          <button type="button" data-action="sync-router" data-id="${router.id}" ${state.busy || routerParked(router.id) ? 'disabled' : ''}>Forfaits</button>
          <button type="button" class="btn-quiet" data-action="edit-router" data-id="${router.id}" ${state.busy ? 'disabled' : ''}>Modifier</button>
          <button type="button" class="btn-danger" data-action="delete-router" data-id="${router.id}" ${state.busy ? 'disabled' : ''}>Supprimer</button>
        </div>
        ${editing ? `
          <form data-form="edit-router" data-id="${router.id}" class="stack">
            <label>Nom</label>
            <input name="name" value="${esc(router.name)}" required>
            <label>Adresse locale (Wi-Fi)</label>
            <input name="host" value="${esc(router.host)}" required>
            <label>Adresse VPN (admin)</label>
            <input name="admin_host" value="${esc(router.admin_host || '')}" placeholder="Facultatif">
            <label>Utilisateur API</label>
            <input name="username" value="${esc(router.username)}" required>
            <label>Mot de passe API</label>
            ${passwordField({ name: 'password', autocomplete: 'new-password', placeholder: 'Inchangé si vide' })}
            <input name="port" type="hidden" value="${esc(router.port)}">
            <div class="actions">
              <button type="submit">Enregistrer</button>
              <button type="button" class="btn-quiet" data-action="cancel-edit">Annuler</button>
            </div>
          </form>
        ` : ''}
      </article>
    `;
  }).join('');

  return `
    <section class="card">
      <h2>Ma connexion</h2>
      <form data-form="reach" class="stack">
        <label>Joindre via</label>
        <select name="mode">
          <option value="auto" ${mode === 'auto' ? 'selected' : ''}>Auto (local puis VPN)</option>
          <option value="local" ${mode === 'local' ? 'selected' : ''}>Adresse locale seulement</option>
          <option value="distant" ${mode === 'distant' ? 'selected' : ''}>VPN seulement</option>
        </select>
        <p class="help">Auto essaie le Wi‑Fi puis le VPN. À distance, choisissez « VPN seulement » si le local reste lent à échouer.</p>
        <button type="submit">Enregistrer</button>
      </form>
    </section>
    <section class="card">
      <h2>Routeur</h2>
      ${typeof licenseRights === 'function' && state.routers.length >= licenseRights().maxRouters
        ? `<p class="meta">Plafond atteint : ${esc(licenseRights().maxRouters)} routeur(s) sur cette offre.</p>`
        : `<form data-form="router" class="stack">
        <label>Nom</label>
        <input name="name" required placeholder="HORIZON TEAM">
        <label>Adresse locale (Wi-Fi)</label>
        <input name="host" required placeholder="192.168.88.1" inputmode="decimal">
        <label>Adresse VPN (admin)</label>
        <input name="admin_host" placeholder="Facultatif">
        <label>Utilisateur API</label>
        <input name="username" required autocomplete="off">
        <label>Mot de passe API</label>
        ${passwordField({ name: 'password', autocomplete: 'new-password', required: true })}
        <button type="submit">Enregistrer</button>
      </form>`}
    </section>
    ${renderAdminPassword()}
    ${renderCurrency()}
    ${renderBackup()}
    ${cards || '<p class="meta">Aucun routeur.</p>'}
  `;
}

function renderProfiles() {
  const cards = state.profiles.map((profile) => {
    const inApp = profile.sellable !== false;
    const ready = profile.limit_uptime && profile.price != null && profile.active && inApp;
    return `
      <article class="card">
        <div class="profile-head">
          <h2>${esc(profile.name)}</h2>
          <div class="price">${profile.price == null ? '—' : esc(profile.price)}</div>
        </div>
        <p class="meta">Valable ${esc(profile.validity || '—')}${profile.active ? '' : ' · absent'}${inApp ? '' : ' · hors app'}${ready ? '' : ' · vente bloquée'}</p>
        <label class="check-line">
          <input type="checkbox" data-action="toggle-sellable" data-id="${profile.id}" ${inApp ? 'checked' : ''}>
          Vente sur place
        </label>
        <form data-form="uptime" data-id="${profile.id}" class="inline-save">
          <label>Durée</label>
          <div class="field-row">
            <input name="limitUptime" value="${esc(profile.limit_uptime || '')}" placeholder="${esc((profile.uptime_hint || '3h').toLowerCase())}">
            <button type="submit">OK</button>
          </div>
        </form>
      </article>
    `;
  }).join('');

  const scoped = Boolean(state.scopeRouterId);
  const routerPick = scoped
    ? `<p class="meta">Routeur : <strong>${esc(state.routers.find((item) => item.id === state.scopeRouterId)?.name || '—')}</strong></p>`
    : `<label for="profile-router">Routeur</label>
      <select id="profile-router">${routerOptions(state.profilesRouterId)}</select>`;
  return `
    <section class="card">
      ${routerPick}
    </section>
    ${state.profilesRouterId ? (cards || '<section class="card"><p class="meta">Aucun forfait.</p></section>') : ''}
  `;
}

function resellerMatchesQuery(reseller, query) {
  const q = String(query || '').trim().toLocaleLowerCase('fr');
  if (!q) return true;
  const hay = [
    reseller.hmpName,
    reseller.routerName,
    reseller.reachHost,
    reseller.host,
    ...(reseller.saleKeywords || []),
  ].join(' ').toLocaleLowerCase('fr');
  return hay.includes(q);
}

function renderResellers() {
  const pool = scopedResellers();
  const filtered = pool.filter((reseller) => resellerMatchesQuery(reseller, state.resellerQuery));
  const cards = filtered.map((reseller) => {
    const stock = reseller.stock.length
      ? `<p class="meta">Stock : ${reseller.stock.map((item) => `${esc(item.name)} ${esc(item.remaining)}`).join(' · ')}</p>`
      : '';
    const codes = (reseller.monthCodes || []).length
      ? reseller.monthCodes.map((item) => `${esc(item.profile)} ${esc(item.code)}`).join(' · ')
      : '';
    return `
      <article class="card" data-reseller-card="${reseller.id}">
        <div class="profile-head">
          <h2>${esc(reseller.hmpName)}</h2>
          <span class="meta">${resellerParked(reseller.id) ? 'hors offre' : (reseller.active ? 'actif' : 'off')}</span>
        </div>
        ${resellerParked(reseller.id) ? '<p class="meta">Hors offre — communication coupée. Le compte reste enregistré.</p>' : ''}
        <p class="meta">${esc(reseller.routerName)} · ${esc(reseller.reachHost || reseller.host || '—')}</p>
        <p class="meta">Mois : ${esc(reseller.soldCount)} · ${esc(money(reseller.soldAmount))}${reseller.ratePercent == null ? '' : ` · ${esc(reseller.ratePercent)} %`}</p>
        ${reseller.ratePercent != null ? `<p class="meta"><strong>Part ${esc(reseller.hmpName)}</strong> ${esc(money(reseller.resellerShare || 0))} · <strong>À ${esc(reseller.routerName || 'réseau')}</strong> ${esc(money(reseller.networkShare || 0))}</p>` : ''}
        <p class="meta">Mots-clés : ${esc((reseller.saleKeywords || []).join(', ') || reseller.hmpName)} · Tickets ${esc(reseller.assignedCount || 0)}${reseller.handedCount ? ` (${esc(reseller.handedCount)} att.)` : ''}</p>
        ${codes ? `<p class="meta">Codes ${esc(reseller.monthKey || '')} : ${codes}</p>` : ''}
        ${stock}
        <div class="actions">
          <button type="button" class="btn-sell" data-action="invite-reseller" data-id="${reseller.id}" ${state.busy || resellerParked(reseller.id) ? 'disabled' : ''}>
            Inviter
          </button>
          <button type="button" class="btn-quiet" data-action="toggle-lot" data-id="${reseller.id}" ${resellerParked(reseller.id) ? 'disabled' : ''}>
            ${state.lotOpen === reseller.id ? 'Fermer' : 'Attribuer'}
          </button>
          <button type="button" class="${reseller.active ? 'btn-danger' : 'btn-quiet'}" data-action="toggle-reseller" data-id="${reseller.id}" data-active="${reseller.active ? '0' : '1'}">
            ${reseller.active ? 'Désactiver' : 'Réactiver'}
          </button>
        </div>
        ${state.lotOpen === reseller.id ? renderLot(reseller) : ''}
        <form data-form="reseller-update" data-id="${reseller.id}" data-active="${reseller.active ? '1' : '0'}" class="stack">
          <label>Nom sur le ticket</label>
          <input name="hmpName" value="${esc(reseller.hmpName)}" required autocapitalize="characters" maxlength="40">
          <label>Mots-clés des ventes</label>
          <input name="saleKeywords" value="${esc((reseller.saleKeywords || []).join(', '))}" placeholder="HOME, voisin" autocapitalize="characters">
          <label>Taux à reverser (%)</label>
          <input name="ratePercent" type="number" min="0" max="100" step="0.01" value="${reseller.ratePercent == null ? '' : esc(reseller.ratePercent)}" placeholder="Ex. 75" inputmode="decimal">
          ${scopedRouterField(reseller.routerId)}
          <label>Adresse routeur</label>
          <input name="host" value="${esc(reseller.host || reseller.reachHost || '')}" placeholder="IP locale ou VPN" required>
          <label>Nouveau mot de passe</label>
          ${passwordField({ name: 'password', autocomplete: 'new-password', placeholder: 'Inchangé si vide' })}
          <button type="submit">Enregistrer</button>
        </form>
      </article>
    `;
  }).join('');

  return `
    <section class="card">
      <h2>Chercher un revendeur</h2>
      <label for="reseller-search">Nom, mots-clés, routeur ou adresse</label>
      <input
        id="reseller-search"
        name="resellerQuery"
        type="search"
        value="${esc(state.resellerQuery)}"
        placeholder="Ex. HOME"
        autocomplete="off"
        autocapitalize="characters"
        data-reseller-search
      >
      <p class="meta">${esc(filtered.length)} / ${esc(pool.length)} affiché${filtered.length > 1 ? 's' : ''}${state.scopeRouterId ? ' sur ce routeur' : ''}</p>
    </section>
    <section class="card">
      <h2>Revendeur</h2>
      ${(() => {
        const rights = typeof licenseRights === 'function' ? licenseRights() : null;
        if (!rights) return '';
        const total = state.resellers.length;
        const onRouter = state.scopeRouterId
          ? state.resellers.filter((item) => Number(item.routerId) === Number(state.scopeRouterId)).length
          : total;
        if (total >= rights.maxResellers || onRouter >= rights.maxResellersPerRouter) {
          return `<p class="meta">Plafond atteint : ${esc(rights.maxResellers)} revendeurs au total, ${esc(rights.maxResellersPerRouter)} par routeur.</p>`;
        }
        return '';
      })()}
      ${(() => {
        const rights = typeof licenseRights === 'function' ? licenseRights() : null;
        const total = state.resellers.length;
        const onRouter = state.scopeRouterId
          ? state.resellers.filter((item) => Number(item.routerId) === Number(state.scopeRouterId)).length
          : total;
        if (rights && (total >= rights.maxResellers || onRouter >= rights.maxResellersPerRouter)) return '';
        return `<form data-form="reseller" class="stack">
        <label>Nom sur le ticket</label>
        <input name="hmpName" required placeholder="HORIZON TEAM" autocapitalize="characters" maxlength="40">
        <label>Mots-clés des ventes</label>
        <input name="saleKeywords" placeholder="HOME, voisin" autocapitalize="characters">
        <label>Taux à reverser (%)</label>
        <input name="ratePercent" type="number" min="0" max="100" step="0.01" placeholder="Ex. 75" inputmode="decimal" required>
        <label>Mot de passe</label>
        ${passwordField({ name: 'password', autocomplete: 'new-password', required: true, minlength: 4 })}
        ${scopedRouterField(state.scopeRouterId || '')}
        <label>Adresse routeur</label>
        <input name="host" required placeholder="Ex. 192.168.196.196">
        <div class="actions">
          <button type="submit">Créer</button>
          <button type="button" class="btn-quiet" data-action="add-stock">Stock</button>
        </div>
      </form>`;
      })()}
    </section>
    ${cards || `<p class="meta">${pool.length ? 'Aucun revendeur ne correspond à la recherche.' : 'Aucun revendeur sur ce routeur.'}</p>`}
  `;
}

function renderLot(reseller) {
  const lot = state.lot && state.lot.resellerId === reseller.id ? state.lot : null;
  const name = lot ? lot.commentName : (state.lotName || reseller.hmpName);
  const lots = lot ? lot.lots : [];
  const rows = lots.map((item) => {
    const profiles = (item.profiles || []).join(', ') || '—';
    let detail = `${profiles} · ${item.count} ticket${item.count > 1 ? 's' : ''}`;
    if (item.blocked && item.owner) {
      detail = `Déjà attribué à ${item.owner}`;
    } else if (!item.count && item.mine && item.ownerMine) {
      detail = `Déjà attribué à ${item.ownerMine}`;
    } else if (!item.count && item.owner) {
      detail = `Déjà attribué à ${item.owner}`;
    } else if (!item.count && item.used) {
      detail = `${profiles} · ${item.used} connecté${item.used > 1 ? 's' : ''}`;
    } else if (!item.count) {
      detail = 'Déjà attribué';
    } else if (item.used) {
      detail += ` · ${item.used} connecté${item.used > 1 ? 's' : ''}`;
    }
    if (item.mine && item.count > 0 && item.ownerMine) {
      detail += ` · déjà chez ${item.ownerMine}`;
    }
    if (item.blocked || !item.count) {
      return `<div class="lot-line"><span>${esc(item.comment)}</span><span class="meta">${esc(detail)}</span></div>`;
    }
    return `
      <label class="lot-line">
        <span><input type="checkbox" name="comments" value="${esc(item.comment)}"> ${esc(item.comment)}</span>
        <span class="meta">${esc(detail)}</span>
      </label>
    `;
  }).join('');
  const ready = lots.filter((item) => item.count && !item.blocked).length;
  const held = reseller.assignedLots || [];
  const heldRows = held.map((item) => `
    <label class="lot-line">
      <span><input type="checkbox" name="comments" value="${esc(item.comment)}"> ${esc(item.comment || '—')}</span>
      <span class="meta">${esc((item.profiles || []).join(', ') || '—')} · ${esc(item.count)}</span>
    </label>
  `).join('');
  return `
    ${held.length ? `
      <form data-form="lot-remove" data-reseller="${reseller.id}">
        <p class="meta">Attribués à ${esc(reseller.hmpName)}</p>
        <div class="lot-scroll">${heldRows}</div>
        <p class="meta" data-lot-count>Aucun coché.</p>
        <button class="btn-quiet" type="submit">Retirer</button>
      </form>
    ` : ''}
    <form data-form="lot-search" data-reseller="${reseller.id}" class="stack">
      <label>Nom dans le commentaire</label>
      <div class="field-row">
        <input name="commentName" value="${esc(name)}" required autocomplete="off">
        <button type="submit">Chercher</button>
      </div>
    </form>
    ${lot ? `
      <form data-form="lot-assign" data-reseller="${reseller.id}" data-comment="${esc(lot.commentName)}">
        <p class="meta">${ready ? `${ready} dispo pour ${esc(lot.commentName)}` : (lots.length ? 'Déjà attribués ou connectés.' : 'Aucun commentaire.')}</p>
        ${rows ? `<div class="lot-scroll">${rows}</div>` : ''}
        ${ready ? '<p class="meta" data-lot-count>Aucun coché.</p><button type="submit">Attribuer</button>' : ''}
      </form>
    ` : ''}
  `;
}

function openStockModal() {
  const stockResellers = scopedResellers();
  if (!stockResellers.length) {
    showToast('Aucun revendeur.', 'err');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const resellerOptions = stockResellers.map((reseller) => (
    `<option value="${reseller.id}">${esc(reseller.hmpName)}</option>`
  )).join('');
  overlay.innerHTML = `
    <section class="modal modal-form" role="dialog" aria-modal="true">
      <h2>Ajouter du stock</h2>
      <form data-stock-modal>
        <label>Revendeur</label>
        <select name="resellerId">${resellerOptions}</select>
        <label>Profil</label>
        <select name="profileId"></select>
        <label>Nombre de tickets</label>
        <input name="quantity" type="number" min="1" max="10000" value="10" required>
        <div class="modal-actions">
          <button type="button" class="btn-quiet" data-cancel>Annuler</button>
          <button type="submit">Ajouter</button>
        </div>
      </form>
    </section>
  `;
  const form = overlay.querySelector('form');
  const resellerSelect = form.elements.resellerId;
  const profileSelect = form.elements.profileId;
  const fillProfiles = () => {
    const reseller = state.resellers.find((item) => item.id === Number(resellerSelect.value));
    const options = reseller ? reseller.stock : [];
    profileSelect.innerHTML = options.length
      ? options.map((item) => `<option value="${item.profileId}">${esc(item.name)}</option>`).join('')
      : '<option value="">Aucun forfait</option>';
    profileSelect.disabled = !options.length;
  };
  resellerSelect.addEventListener('change', fillProfiles);
  fillProfiles();
  overlay.querySelector('[data-cancel]').addEventListener('click', () => overlay.remove());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const quantity = Number(form.elements.quantity.value);
    if (!profileSelect.value) {
      showToast('Chargez les forfaits du routeur.', 'err');
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      showToast('Indiquez un nombre de tickets entre 1 et 10000.', 'err');
      return;
    }
    overlay.remove();
    try {
      await api('/api/admin/stock', {
        method: 'POST',
        body: {
          resellerId: Number(resellerSelect.value),
          profileId: Number(profileSelect.value),
          quantity,
        },
      });
      await refresh('Stock ajouté.');
    } catch (error) {
      showToast(error.message, 'err');
    }
  });
  document.body.appendChild(overlay);
}

function renderCurrency() {
  const options = CURRENCIES.map(([code, label]) => (
    `<option value="${code}" ${readCurrency() === code ? 'selected' : ''}>${esc(label)}</option>`
  )).join('');
  return `
    <section class="card">
      <h2>Devise</h2>
      <form data-form="currency" class="field-row">
        <select name="currency">${options}</select>
        <button type="submit">OK</button>
      </form>
    </section>
  `;
}

function renderAdminPassword() {
  return `
    <section class="card">
      <h2>Mot de passe admin</h2>
      <p class="meta">Changez le mot de passe utilisé pour ouvrir l’administration.</p>
      <form data-form="admin-password" class="stack">
        <label>Mot de passe actuel</label>
        ${passwordField({ name: 'currentPassword', autocomplete: 'current-password', required: true })}
        <label>Nouveau mot de passe</label>
        ${passwordField({ name: 'password', autocomplete: 'new-password', required: true, minlength: 8 })}
        <label>Confirmer</label>
        ${passwordField({ name: 'confirm', autocomplete: 'new-password', required: true, minlength: 8 })}
        <button type="submit">Enregistrer</button>
      </form>
    </section>
  `;
}

function renderBackup() {
  const canDrive = typeof licenseAllowsDrive !== 'function' || licenseAllowsDrive();
  const account = readGoogleAccount();
  const gmail = !canDrive
    ? '<p class="meta">Votre offre utilise la copie fichier, sans Drive.</p>'
    : (account.email
      ? `<p class="meta" data-drive-status>${esc(driveStatusText())}</p>
       <div class="actions">
         <button type="button" data-action="drive-upload">Drive</button>
         <button type="button" class="btn-quiet" data-action="unlink-google">Retirer</button>
       </div>`
      : `<button type="button" data-action="link-google">Lier mon Gmail</button>`);
  return `
    <section class="card">
      <h2>Copie</h2>
      ${gmail}
      <div class="actions">
        <button type="button" data-action="backup">Enregistrer</button>
        <label class="btn btn-quiet" for="backup-file">Reprendre</label>
      </div>
      <input id="backup-file" type="file" accept="application/json,.json" hidden>
    </section>
  `;
}

function renderSales() {
  const sales = state.sales;
  const rows = (sales?.sales || []).map((sale) => `
    <article class="sale-card">
      <div class="sale-top">
        <strong>${esc(sale.code)}</strong>
        <span class="badge badge-price">${esc(money(sale.price ?? 0))}</span>
      </div>
      <div class="sale-status">
        ${sourceBadge(sale.source)}
        ${usageBadge(state.usage[sale.id])}
      </div>
      <div class="meta">${esc(sale.when)} · ${esc(sale.comment || sale.keyword || sale.reseller || '—')} · ${esc(sale.router)} · ${esc(sale.profile)}</div>
    </article>
  `).join('');
  const resellerOptions = resellerFilterOptions();
  const kind = state.periodKind || (
    sales && state.salesFrom === sales.todayDate && state.salesTo === sales.todayDate
      ? 'today'
      : (sales && state.salesFrom === sales.monthFrom && state.salesTo === sales.todayDate ? 'month' : '')
  );
  const list = sales?.sales || [];
  const pending = sales?.pending;
  const settlement = sales?.settlement;
  const periodLabel = sales?.period
    ? (sales.period.from === sales.period.to
      ? sales.period.from
      : `${sales.period.from} → ${sales.period.to}`)
    : '';
  const rateLabel = settlement?.rate == null ? '' : `${settlement.rate} %`;
  const resellerPartLabel = settlement?.resellerName
    ? `Part de <strong>${esc(settlement.resellerName)}</strong>`
    : 'Part revendeur';
  const networkPartLabel = settlement?.networkName
    ? `À reverser à <strong>${esc(settlement.networkName)}</strong>`
    : 'À reverser au réseau';

  return `
    <div class="stat-grid">
      ${statCard("Aujourd'hui", sales ? sales.today.count : null, sales ? sales.today.amount : null, { period: 'today', selected: kind === 'today' })}
      ${statCard('Ce mois', sales ? sales.month.count : null, sales ? sales.month.amount : null, { period: 'month', selected: kind === 'month' })}
    </div>
    <section class="card">
      <h2>Période</h2>
      <div class="presets">
        <button type="button" data-action="period" data-period="today" aria-selected="${kind === 'today' ? 'true' : 'false'}">Aujourd'hui</button>
        <button type="button" data-action="period" data-period="month" aria-selected="${kind === 'month' ? 'true' : 'false'}">Ce mois</button>
      </div>
      <form data-form="sales-filter" class="stack">
        <div class="date-pair">
          <div>
            <label>Du</label>
            <input name="from" type="date" value="${esc(state.salesFrom || sales?.period.from || '')}" required>
          </div>
          <div>
            <label>Au</label>
            <input name="to" type="date" value="${esc(state.salesTo || sales?.period.to || '')}" required>
          </div>
        </div>
        <input type="hidden" name="routerId" value="${esc(state.scopeRouterId || 0)}">
        <label>Revendeur</label>
        <select name="resellerId">${resellerOptions}</select>
        <button type="submit">Afficher</button>
      </form>
      ${sales ? `
        <div class="report-line"><span>Comptabilisé${periodLabel ? ` (${esc(periodLabel)})` : ''}<span class="report-tickets">${esc(sales.period.count)} ticket${sales.period.count === 1 ? '' : 's'}</span></span><strong>${esc(money(sales.period.amount))}</strong></div>
        ${settlement?.rate != null ? `<div class="report-line"><span>Taux à reverser</span><strong>${esc(rateLabel)}</strong></div>` : ''}
        ${settlement?.resellerShare != null ? `<div class="report-line report-line-ok"><span>${resellerPartLabel}</span><strong>${esc(money(settlement.resellerShare))}</strong></div>` : ''}
        ${settlement?.networkShare != null ? `<div class="report-line report-line-due"><span>${networkPartLabel}</span><strong>${esc(money(settlement.networkShare))}</strong></div>` : ''}
        ${settlement?.missingRate ? '<p class="meta">Taux manquant sur un ou plusieurs revendeurs.</p>' : ''}
        <div class="report-line"><span>Remis en attente<span class="report-tickets">${esc(pending?.count || 0)} ticket${(pending?.count || 0) === 1 ? '' : 's'}</span></span><strong>${esc(money(pending?.amount || 0))}</strong></div>
      ` : ''}
      ${sales?.syncWarning ? `<p class="meta">${esc(sales.syncWarning)}</p>` : ''}
      ${state.moneySyncing ? '<p class="meta">Mise à jour depuis le routeur…</p>' : ''}
      ${rows || '<p class="meta">Aucune connexion sur cette période.</p>'}
    </section>
  `;
}

function renderActifs() {
  const list = state.actifs?.sessions || [];
  const clock = state.actifs?.at ? formatClock(state.actifs.at) : '';
  const routerName = state.scopeRouterId
    ? (state.routers.find((item) => item.id === state.scopeRouterId)?.name || '—')
    : 'Tous les routeurs';
  return `
    <section class="card">
      <div class="actifs-head">
        <h2>Actifs</h2>
        <span class="actifs-live" title="Sessions en ligne">
          <span class="actifs-live-count">${esc(list.length)} en ligne</span>
          ${clock ? `<span class="actifs-live-clock">${esc(clock)}</span>` : ''}
        </span>
      </div>
      <p class="meta">Routeur : <strong>${esc(routerName)}</strong></p>
      ${state.actifsWarning ? `<p class="meta">${esc(state.actifsWarning)}</p>` : ''}
      <div data-actifs-body>${actifsTableHtml(list, { admin: true })}</div>
    </section>
  `;
}

function pctLabel(part, total) {
  const t = Number(total) || 0;
  const p = Number(part) || 0;
  if (!t) return '0 %';
  return `${Math.round((p * 100) / t)} %`;
}

function renderRecettes() {
  const data = state.recettes;
  const kind = state.periodKind || (
    data && state.salesFrom === data.todayDate && state.salesTo === data.todayDate
      ? 'today'
      : (data && state.salesFrom === data.monthFrom && state.salesTo === data.todayDate ? 'month' : '')
  );
  const resellerOptions = resellerFilterOptions();
  const period = data?.period;
  const periodLabel = period
    ? (period.from === period.to ? period.from : `${period.from} → ${period.to}`)
    : '';
  const total = period ? Number(period.total) || 0 : 0;
  const view = state.recettesView === 'profiles' ? 'profiles' : 'resellers';

  const byReseller = (data?.byReseller || []).map((row) => {
    const profiles = (row.profiles || []).map((item) => `
      <div class="recettes-sub">
        <span>${esc(item.profile)} · ${esc(item.count)} tkt</span>
        <span>${esc(money(item.amount))}</span>
        <span class="ok">${esc(money(item.resellerShare))}</span>
        <span class="due">${esc(money(item.networkShare))}</span>
      </div>
    `).join('');
    return `
      <article class="recettes-block">
        <div class="recettes-head">
          <div>
            <strong>${esc(row.name)}</strong>
            <p class="meta">${esc(row.routerName || '—')}${row.rate == null ? '' : ` · taux ${esc(row.rate)} %`} · ${esc(row.count)} ticket${row.count > 1 ? 's' : ''}</p>
          </div>
          <strong>${esc(money(row.amount))}</strong>
        </div>
        <div class="recettes-grid">
          <span>Part revendeur</span><strong class="ok">${esc(money(row.resellerShare))}</strong>
          <span>Part réseau</span><strong class="due">${esc(money(row.networkShare))}</strong>
        </div>
        ${profiles ? `
          <div class="recettes-sub-head"><span>Forfait</span><span>Ventes</span><span>Revendeur</span><span>Réseau</span></div>
          ${profiles}
        ` : ''}
        ${row.missingRate ? '<p class="meta">Taux manquant sur une partie des ventes.</p>' : ''}
      </article>
    `;
  }).join('');

  const byProfile = (data?.byProfile || []).map((row) => `
    <article class="recettes-block">
      <div class="recettes-head">
        <div>
          <strong>${esc(row.profile)}</strong>
          <p class="meta">${esc(row.count)} ticket${row.count > 1 ? 's' : ''} · ${esc(pctLabel(row.amount, total))} du CA</p>
        </div>
        <strong>${esc(money(row.amount))}</strong>
      </div>
      <div class="recettes-grid">
        <span>Parts revendeurs</span><strong class="ok">${esc(money(row.resellerShare))}</strong>
        <span>Part réseau</span><strong class="due">${esc(money(row.networkShare))}</strong>
      </div>
    </article>
  `).join('');

  return `
    <section class="card">
      <h2>Recettes</h2>
      <p class="meta">Synthèse des gains (scripts MikroTik) : total, parts revendeurs et part réseau.</p>
      <div class="presets">
        <button type="button" data-action="period" data-period="today" aria-selected="${kind === 'today' ? 'true' : 'false'}">Aujourd'hui</button>
        <button type="button" data-action="period" data-period="month" aria-selected="${kind === 'month' ? 'true' : 'false'}">Ce mois</button>
      </div>
      <form data-form="recettes-filter" class="stack">
        <div class="date-pair">
          <div>
            <label>Du</label>
            <input name="from" type="date" value="${esc(state.salesFrom || data?.period?.from || '')}" required>
          </div>
          <div>
            <label>Au</label>
            <input name="to" type="date" value="${esc(state.salesTo || data?.period?.to || '')}" required>
          </div>
        </div>
        <input type="hidden" name="routerId" value="${esc(state.scopeRouterId || 0)}">
        <label>Revendeur</label>
        <select name="resellerId">${resellerOptions}</select>
        <button type="submit">Actualiser</button>
      </form>
      ${data?.syncWarning ? `<p class="meta">${esc(data.syncWarning)}</p>` : ''}
      ${state.moneySyncing ? '<p class="meta">Mise à jour depuis le routeur…</p>' : ''}
    </section>

    ${period ? `
      <div class="recettes-summary">
        <article class="recettes-kpi">
          <span>Total ventes${periodLabel ? ` · ${esc(periodLabel)}` : ''}</span>
          <strong>${esc(money(period.total))}</strong>
          <em>${esc(period.count)} ticket${period.count === 1 ? '' : 's'}</em>
        </article>
        <article class="recettes-kpi recettes-kpi-ok">
          <span>Parts revendeurs</span>
          <strong>${esc(money(period.resellerShare))}</strong>
          <em>${esc(pctLabel(period.resellerShare, period.total))}</em>
        </article>
        <article class="recettes-kpi recettes-kpi-due">
          <span>Part réseau</span>
          <strong>${esc(money(period.networkShare))}</strong>
          <em>${esc(pctLabel(period.networkShare, period.total))}</em>
        </article>
      </div>
      ${period.missingRate ? `<p class="meta">${esc(period.missingRate)} vente${period.missingRate > 1 ? 's' : ''} sans taux (${esc(money(period.missingAmount || 0))})</p>` : ''}
    ` : '<section class="card"><p class="meta">Chargement des recettes…</p></section>'}

    <section class="card">
      <div class="presets">
        <button type="button" data-action="recettes-view" data-view="resellers" aria-selected="${view === 'resellers' ? 'true' : 'false'}">Par revendeur</button>
        <button type="button" data-action="recettes-view" data-view="profiles" aria-selected="${view === 'profiles' ? 'true' : 'false'}">Par forfait</button>
      </div>
      ${view === 'resellers'
        ? (byReseller || '<p class="meta">Aucune vente sur cette période.</p>')
        : (byProfile || '<p class="meta">Aucune vente sur cette période.</p>')}
    </section>
  `;
}

function dock() {
  const items = [
    ['routers', 'Routeurs', '<rect x="4" y="8" width="16" height="10" rx="2"/><path d="M8 8V6M12 8V5M16 8V6"/>'],
    ['profiles', 'Forfaits', '<path d="M6 7h12M6 12h12M6 17h7"/>'],
    ['resellers', 'Vendeurs', '<circle cx="12" cy="8" r="3"/><path d="M6 19c1.2-3 3.2-4.5 6-4.5S16.8 16 18 19"/>'],
    ['actifs', 'Actifs', '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>'],
    ['sales', 'Rapport', '<path d="M5 19V10M10 19V6M15 19v-6M20 19V8"/>'],
    ['recettes', 'Recettes', '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/>'],
  ];
  return `
    <nav class="dock" aria-label="Navigation">
      ${items.map(([id, label, icon]) => `
        <button type="button" data-action="tab" data-tab="${id}" aria-selected="${state.tab === id ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
          <span>${label}</span>
        </button>
      `).join('')}
    </nav>
  `;
}

function renderApp() {
  if (state.loading && !state.routers.length) {
    app.innerHTML = `
      <div class="sheet">
        <section class="card">
          <h2>Chargement…</h2>
          <p class="meta">Préparation des données locales.</p>
        </section>
      </div>`;
    if (typeof placeAppDock === 'function') placeAppDock(dock());
    return;
  }
  const body = {
    routers: renderRouters,
    profiles: renderProfiles,
    resellers: renderResellers,
    actifs: renderActifs,
    sales: renderSales,
    recettes: renderRecettes,
    clients: typeof renderClients === 'function' ? renderClients : () => '',
  }[state.tab]();
  const licenseCard = typeof licenseStatusCardHtml === 'function' ? licenseStatusCardHtml() : '';
  app.innerHTML = `<div class="sheet">${licenseCard}${body}</div>`;
  if (typeof placeAppDock === 'function') placeAppDock(dock());
}

function render(options = {}) {
  const paint = () => {
    document.body.classList.toggle('gate', !state.authed);
    document.body.classList.toggle('has-dock', state.authed);
    logoutButton.hidden = !state.authed;
    if (saleLink) saleLink.hidden = !state.authed && !isOwner();
    if (clientsLink) {
      const founder = state.authed && typeof isFounderLicense === 'function' && isFounderLicense();
      clientsLink.hidden = !founder;
      if (!founder && state.tab === 'clients') state.tab = 'routers';
      clientsLink.setAttribute('aria-current', state.tab === 'clients' ? 'page' : 'false');
      clientsLink.classList.toggle('is-current', state.tab === 'clients');
    }
    paintHeaderScope();
    if (typeof paintLicenseBadge === 'function') paintLicenseBadge();
    if (state.needsSetup) renderSetup();
    else if (state.resettingPassword && !state.authed) renderPasswordReset();
    else if (!state.authed) renderLogin();
    else renderApp();
    if (!state.authed && typeof placeAppDock === 'function') placeAppDock('');
    if (state.authed && typeof paintLicenseExpiryNotice === 'function') paintLicenseExpiryNotice();
  };
  if (state.authed && typeof preserveSheetScroll === 'function') {
    preserveSheetScroll(paint, Boolean(options.resetScroll));
    return;
  }
  paint();
}

async function loadWorkspace(options = {}) {
  const light = Boolean(options.light);
  const routers = await api('/api/admin/routers');
  state.routers = routers.routers || [];
  syncScopeFromRouters();
  if (typeof loadPublicPlans === 'function' && !state.licensePlansLoaded) {
    state.licensePlansLoaded = true;
    loadPublicPlans().then((plans) => {
      state.licensePlans = plans;
    }).catch(() => {});
  }
  if (state.loading) {
    state.loading = false;
    render();
  }

  // Sync MikroTik seulement sur Rapport / Recettes (évite double lecture routeur).
  const syncSales = !light && state.tab === 'sales';
  const syncRecettes = !light && state.tab === 'recettes';
  // rematch scripts : uniquement onglet Vendeurs (pas à chaque navigation).
  const resellerLight = light || state.tab !== 'resellers';

  const resellerQs = new URLSearchParams();
  if (state.resellerMonth) resellerQs.set('month', state.resellerMonth);
  if (resellerLight) resellerQs.set('light', '1');
  const resellerUrl = `/api/admin/resellers${resellerQs.toString() ? `?${resellerQs}` : ''}`;
  const salesQs = salesQuery();
  const salesUrl = `/api/admin/sales?${salesQs}${salesQs ? '&' : ''}sync=${syncSales ? '1' : '0'}`;

  const jobs = [
    api(resellerUrl).then((resellers) => {
      state.resellers = resellers.resellers || [];
      state.resellerMonth = resellers.month;
    }),
  ];
  // Sur Recettes : pas besoin de recharger toute la liste Rapport (sync déjà dans recettes).
  if (state.tab === 'sales') {
    jobs.push(
      api(salesUrl).then((sales) => {
        state.sales = sales;
        state.salesFrom = sales.period.from;
        state.salesTo = sales.period.to;
        state.usage = {};
        state.usageWarning = '';
      }),
    );
  }
  if (state.profilesRouterId && (state.tab === 'profiles' || !state.profiles.length)) {
    jobs.push(
      api(`/api/admin/profiles?routerId=${state.profilesRouterId}`).then((profiles) => {
        state.profiles = profiles.profiles || [];
      }),
    );
  }
  await Promise.all(jobs);
  if (state.tab === 'sales') loadUsage();
  if (state.tab === 'recettes') await loadRecettes({ sync: syncRecettes });
  if (state.tab === 'actifs') loadActifs();
  enforceQuotaChoice();
}

async function loadRecettes(options = {}) {
  const sync = options.sync !== false;
  const params = new URLSearchParams();
  if (state.salesFrom) params.set('from', state.salesFrom);
  if (state.salesTo) params.set('to', state.salesTo);
  params.set('routerId', String(state.salesRouterId || 0));
  params.set('resellerId', String(state.salesResellerId || 0));
  params.set('sync', sync ? '1' : '0');
  const data = await api(`/api/admin/recettes?${params.toString()}`);
  state.recettes = data;
  if (data?.period) {
    state.salesFrom = data.period.from;
    state.salesTo = data.period.to;
  }
}

let moneySyncToken = 0;

function refreshMoneyView() {
  const token = ++moneySyncToken;
  const tab = state.tab;
  state.moneySyncing = true;
  render();
  loadWorkspace({ light: true })
    .then(() => {
      if (token !== moneySyncToken || state.tab !== tab) return null;
      render();
      if (tab === 'recettes') return loadRecettes({ sync: true });
      return api(`/api/admin/sales?${salesQuery()}&sync=1`).then((sales) => {
        if (token !== moneySyncToken || state.tab !== 'sales') return;
        state.sales = sales;
        state.salesFrom = sales.period.from;
        state.salesTo = sales.period.to;
        state.usage = {};
        loadUsage();
      });
    })
    .catch((error) => {
      if (token === moneySyncToken) showToast(error.message, 'err');
    })
    .finally(() => {
      if (token !== moneySyncToken) return;
      state.moneySyncing = false;
      if (state.tab === 'sales' || state.tab === 'recettes') render();
    });
}

function prefetchSales() {
  api('/api/admin/sales?sync=1').then((sales) => {
    if (!state.sales) state.sales = sales;
    if (state.tab === 'sales' && !state.moneySyncing) {
      state.sales = sales;
      render();
    }
  }).catch(() => {});
}

async function warmWorkspaceInBackground() {
  try {
    const resellerQs = new URLSearchParams();
    if (state.resellerMonth) resellerQs.set('month', state.resellerMonth);
    const warmSync = state.tab === 'sales' || state.tab === 'recettes';
    const jobs = [
      api(`/api/admin/resellers?${resellerQs.toString()}${resellerQs.toString() ? '&' : ''}light=1`),
    ];
    if (state.tab === 'recettes') {
      jobs.push(loadRecettes({ sync: warmSync }));
    } else {
      jobs.push(
        api(`/api/admin/sales?${salesQuery()}&sync=${warmSync ? '1' : '0'}`).then((sales) => {
          state.sales = sales;
          state.salesFrom = sales.period.from;
          state.salesTo = sales.period.to;
        }),
      );
    }
    const [resellers] = await Promise.all(jobs);
    if (resellers && resellers.resellers) {
      state.resellers = resellers.resellers || [];
      state.resellerMonth = resellers.month;
    }
    if (state.tab === 'resellers' || state.tab === 'sales' || state.tab === 'recettes') render();
  } catch {
    /* warm optionnel */
  }
}

function salesQuery() {
  const params = new URLSearchParams();
  if (state.salesFrom) params.set('from', state.salesFrom);
  if (state.salesTo) params.set('to', state.salesTo);
  params.set('routerId', String(state.salesRouterId || 0));
  params.set('resellerId', String(state.salesResellerId || 0));
  return params.toString();
}

let usageToken = 0;
async function loadUsage() {
  const token = ++usageToken;
  const query = salesQuery();
  try {
    const usage = await api(`/api/admin/usage?${query}`);
    if (token !== usageToken) return;
    state.usage = usage.statuses || {};
    state.usageWarning = usage.warning || '';
  } catch (error) {
    if (token !== usageToken) return;
    state.usageWarning = error.message;
  }
  const active = document.activeElement;
  const typing = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT');
  if (state.tab === 'sales' && state.authed && !typing) render();
}

let actifsToken = 0;
let actifsTimer = 0;
function stopActifsPoll() {
  clearTimeout(actifsTimer);
  actifsTimer = 0;
}

async function loadActifs() {
  const token = ++actifsToken;
  const params = new URLSearchParams();
  params.set('routerId', String(state.actifsRouterId || 0));
  try {
    const data = await api(`/api/admin/actifs?${params.toString()}`);
    if (token !== actifsToken) return;
    state.actifs = data;
    state.actifsWarning = data.warning || '';
  } catch (error) {
    if (token !== actifsToken) return;
    state.actifsWarning = error.message;
  }
  const active = document.activeElement;
  const typing = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
  if (state.tab === 'actifs' && state.authed && !typing) {
    const list = state.actifs?.sessions || [];
    const clock = state.actifs?.at ? formatClock(state.actifs.at) : '';
    const live = document.querySelector('.actifs-live');
    const body = document.querySelector('[data-actifs-body]');
    if (live && body) {
      live.innerHTML = `<span class="actifs-live-count">${esc(list.length)} en ligne</span>${clock ? `<span class="actifs-live-clock">${esc(clock)}</span>` : ''}`;
      body.innerHTML = actifsTableHtml(list, { admin: true });
      const warn = document.querySelector('[data-actifs-warning]');
      if (warn) warn.textContent = state.actifsWarning || '';
    } else {
      render();
    }
  }
  stopActifsPoll();
  if (state.tab === 'actifs' && state.authed) {
    actifsTimer = setTimeout(() => { loadActifs(); }, 20000);
  }
}

async function refresh(message, options = {}) {
  const light = Boolean(options.light) || Boolean(options.fromSubmit);
  if (options.fromSubmit) {
    await loadWorkspace({ light: true });
    if (message) showToast(message, 'ok');
    return;
  }
  const quiet = Boolean(options.quiet) || (light && state.routers.length > 0);
  await runBusyRender(render, async () => {
    await loadWorkspace({ light });
    if (message) showToast(message, 'ok');
  }, {
    quiet,
    busyLabel: light ? 'Mise à jour…' : 'Chargement…',
    before: () => { state.busy = true; },
    after: () => { state.busy = false; },
  });
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form');
  if (!form) return;
  event.preventDefault();
  const data = formData(form);
  const savedTop = rememberSheetScroll();
  const busyLabels = {
    'lot-search': 'Recherche des tickets sur le routeur…',
    'lot-assign': 'Attribution des tickets…',
    'lot-remove': 'Retrait des commentaires…',
    login: 'Connexion…',
    setup: 'Création du compte…',
    router: 'Enregistrement du routeur…',
    'edit-router': 'Mise à jour du routeur…',
    reseller: 'Enregistrement du revendeur…',
    'reseller-update': 'Mise à jour du revendeur…',
    stock: 'Ajout du stock…',
    reach: 'Enregistrement…',
    uptime: 'Enregistrement…',
    currency: 'Enregistrement…',
    'sales-filter': 'Chargement du rapport…',
    'recettes-filter': 'Calcul des recettes…',
    'actifs-filter': 'Lecture des sessions…',
    'admin-password': 'Enregistrement du mot de passe…',
    'reset-admin': 'Réinitialisation…',
  };
  state.busy = true;
  showAppBusy(busyLabels[form.dataset.form] || 'Traitement en cours…');
  render();
  restoreSheetScroll(savedTop);
  try {
    if (form.dataset.form === 'reset-admin') {
      await api('/api/admin/password/reset', { method: 'POST', body: data });
      state.resettingPassword = false;
      state.authed = false;
      clearActivity();
      showToast('Mot de passe enregistré. Connectez-vous avec le nouveau.', 'ok', 5000);
      return;
    }
    if (form.dataset.form === 'setup') {
      await api('/api/setup', { method: 'POST', body: data });
      state.needsSetup = false;
      state.authed = true;
      markActivity();
      markOwner();
      idleLogout.done = false;
      await refresh('Compte créé.', { fromSubmit: true });
      return;
    }
    if (form.dataset.form === 'login') {
      await api('/api/admin/login', { method: 'POST', body: data });
      state.authed = true;
      markActivity();
      markOwner();
      idleLogout.done = false;
      await refresh('', { fromSubmit: true });
      return;
    }
    if (form.dataset.form === 'router') {
      const created = await api('/api/admin/routers', { method: 'POST', body: data });
      if (created?.router?.id) applyScopeRouter(created.router.id);
      await refresh('Routeur enregistré.', { fromSubmit: true });
      return;
    }
    if (form.dataset.form === 'edit-router') {
      await api(`/api/admin/routers/${form.dataset.id}`, { method: 'PATCH', body: data });
      state.editingRouterId = 0;
      await refresh('Routeur mis à jour.', { fromSubmit: true });
      return;
    }
    if (form.dataset.form === 'uptime') {
      await api(`/api/admin/profiles/${form.dataset.id}`, {
        method: 'PATCH',
        body: { limitUptime: data.limitUptime },
      });
      await refresh('Durée enregistrée.', { fromSubmit: true });
      return;
    }
    if (form.dataset.form === 'reseller') {
      await api('/api/admin/resellers', { method: 'POST', body: data });
      await refresh('Revendeur créé.', { fromSubmit: true });
      return;
    }
    if (form.dataset.form === 'reach') {
      await api('/api/admin/reach', { method: 'POST', body: { mode: data.mode } });
      localStorage.setItem('opus.reach', data.mode === 'local' || data.mode === 'distant' ? data.mode : 'auto');
      showToast('Connexion enregistrée.', 'ok');
      return;
    }
    if (form.dataset.form === 'reseller-update') {
      if (!data.hmpName || !data.routerId || !data.host) {
        showToast('Nom, routeur et adresse sont requis.', 'err');
        return;
      }
      const body = {
        hmpName: data.hmpName,
        saleKeywords: data.saleKeywords || '',
        ratePercent: data.ratePercent,
        routerId: Number(data.routerId),
        host: data.host,
        active: form.dataset.active === '1',
      };
      if (data.password) body.password = data.password;
      await api(`/api/admin/resellers/${form.dataset.id}`, {
        method: 'PATCH',
        body,
      });
      await refresh('Revendeur mis à jour.', { fromSubmit: true });
      return;
    }
    if (form.dataset.form === 'lot-search') {
      const result = await api(`/api/admin/lots?resellerId=${encodeURIComponent(form.dataset.reseller)}&commentName=${encodeURIComponent(data.commentName)}`);
      state.lotName = result.commentName;
      const lots = result.lots || [];
      state.lot = {
        resellerId: Number(form.dataset.reseller),
        commentName: result.commentName,
        lots,
      };
      const ready = lots.filter((item) => item.count && !item.blocked).length;
      showToast(ready ? `${ready} commentaire${ready > 1 ? 's' : ''} trouvé${ready > 1 ? 's' : ''}.` : 'Aucun commentaire pour ce nom.', ready ? 'ok' : 'err');
      return;
    }
    if (form.dataset.form === 'lot-assign') {
      const comments = [...new FormData(form).getAll('comments')];
      if (!comments.length) {
        showToast('Cochez au moins un commentaire.', 'err');
        return;
      }
      const result = await api('/api/admin/lots', {
        method: 'POST',
        body: {
          resellerId: Number(form.dataset.reseller),
          commentName: form.dataset.comment,
          comments,
        },
      });
      state.lot = null;
      await refresh(`${result.count} ticket${result.count > 1 ? 's' : ''} attribué${result.count > 1 ? 's' : ''}.`, { fromSubmit: true });
      return;
    }
    if (form.dataset.form === 'lot-remove') {
      const comments = [...new FormData(form).getAll('comments')];
      if (!comments.length) {
        showToast('Cochez au moins un commentaire.', 'err');
        return;
      }
      const agreed = await showConfirm({
        title: 'Retirer ces commentaires ?',
        text: 'Ils redeviennent disponibles pour une autre attribution. Les tickets déjà vendus restent comptés.',
        confirmLabel: 'Retirer',
        danger: true,
      });
      if (!agreed) return;
      const result = await api('/api/admin/lots/retrait', {
        method: 'POST',
        body: { resellerId: Number(form.dataset.reseller), comments },
      });
      state.lot = null;
      await refresh(`${result.count} ticket${result.count > 1 ? 's' : ''} retiré${result.count > 1 ? 's' : ''}.`, { fromSubmit: true });
      return;
    }
    if (form.dataset.form === 'stock') {
      await api('/api/admin/stock', {
        method: 'POST',
        body: {
          resellerId: Number(form.dataset.reseller),
          profileId: Number(form.dataset.profile),
          quantity: Number(data.quantity),
        },
      });
      await refresh('Stock ajouté.', { fromSubmit: true });
      return;
    }
    if (form.dataset.form === 'sales-filter' || form.dataset.form === 'recettes-filter') {
      state.salesFrom = data.from;
      state.salesTo = data.to;
      state.periodKind = '';
      state.salesRouterId = state.scopeRouterId;
      state.salesResellerId = Number(data.resellerId) || 0;
      refreshMoneyView();
      return;
    }
    if (form.dataset.form === 'actifs-filter') {
      state.actifsRouterId = Number(data.routerId) || 0;
      await loadActifs();
      return;
    }
    if (form.dataset.form === 'currency') {
      saveCurrency(data.currency);
      showToast('Devise enregistrée.', 'ok');
      return;
    }
    if (form.dataset.form === 'admin-password') {
      if (data.password !== data.confirm) {
        showToast('Les deux nouveaux mots de passe ne correspondent pas.', 'err');
        return;
      }
      await api('/api/admin/password', {
        method: 'POST',
        body: {
          currentPassword: data.currentPassword,
          password: data.password,
          confirm: data.confirm,
        },
      });
      showToast('Mot de passe admin enregistré.', 'ok');
      form.reset();
      return;
    }
  } catch (error) {
    showToast(error.message, 'err');
  } finally {
    state.busy = false;
    hideAppBusy();
    render();
    restoreSheetScroll(savedTop);
  }
});

app.addEventListener('input', (event) => {
  const input = event.target.closest('[data-reseller-search]');
  if (!input) return;
  state.resellerQuery = input.value || '';
  const start = input.selectionStart;
  const end = input.selectionEnd;
  render();
  const next = app.querySelector('[data-reseller-search]');
  if (!next) return;
  next.focus();
  try {
    if (typeof start === 'number' && typeof end === 'number') next.setSelectionRange(start, end);
  } catch {
    // ignore
  }
});

app.addEventListener('change', async (event) => {
  const input = event.target;
  if (input && input.name === 'comments' && input.form && (input.form.dataset.form === 'lot-assign' || input.form.dataset.form === 'lot-remove')) {
    const count = input.form.querySelectorAll('input[name="comments"]:checked').length;
    const line = input.form.querySelector('[data-lot-count]');
    if (line) line.textContent = count ? `${count} commentaire${count > 1 ? 's' : ''} coché${count > 1 ? 's' : ''}.` : 'Aucun commentaire coché.';
    return;
  }
  if (!input || input.id !== 'backup-file') return;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const agreed = await showConfirm({
    title: 'Reprendre cette copie ?',
    text: 'Elle remplace les routeurs, les revendeurs, les stocks et les ventes de cet appareil.',
    confirmLabel: 'Reprendre',
    danger: true,
  });
  if (!agreed) return;
  let snapshot;
  try {
    snapshot = JSON.parse(await file.text());
  } catch {
    showToast('Ce fichier n\'est pas une copie Tickets.', 'err');
    return;
  }
  try {
    await api('/api/admin/restore', { method: 'POST', body: snapshot });
    markOwner();
    await refresh('Copie reprise.');
  } catch (error) {
    showToast(error.message, 'err');
  }
});

async function saveBackupFile() {
  const snapshot = await api('/api/admin/backup');
  const text = JSON.stringify(snapshot);
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RouterOs;
  if (plugin && plugin.saveTextFile) {
    await plugin.saveTextFile({ name: 'Tickets-sauvegarde.json', text });
    showToast('Choisissez où envoyer la copie.', 'ok');
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  link.download = 'Tickets-sauvegarde.json';
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Copie enregistrée.', 'ok');
}

async function onAdminClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'reset-admin') {
    state.resettingPassword = true;
    render();
    return;
  }
  if (action === 'back-login') {
    state.resettingPassword = false;
    render();
    return;
  }
  if (action === 'backup') {
    try {
      await saveBackupFile();
    } catch (error) {
      showToast(error.message, 'err');
    }
    return;
  }
  if (action === 'drive-upload') {
    if (typeof licenseAllowsDrive === 'function' && !licenseAllowsDrive()) {
      showToast('Votre offre n’inclut pas Drive.', 'err');
      return;
    }
    try {
      const result = await uploadDriveBackup();
      if (result === 'ok') showToast('Copie envoyée dans Drive.', 'ok');
      else if (result === 'empty') showToast('Rien à envoyer pour le moment.', 'err');
      else if (result === 'nolink') showToast('Liez d\'abord votre Gmail.', 'err');
      else if (result === 'busy') showToast('Envoi déjà en cours.', 'err');
      render();
    } catch (error) {
      showToast(typeof driveErrorMessage === 'function' ? driveErrorMessage(error) : error.message, 'err');
      render();
    }
    return;
  }
  if (action === 'link-google') {
    if (typeof licenseAllowsDrive === 'function' && !licenseAllowsDrive()) {
      showToast('Votre offre n’inclut pas Drive.', 'err');
      return;
    }
    try {
      const mode = await connectGoogle();
      if (mode === 'redirect') return;
      const outcome = await adoptGoogleBackup();
      if (outcome === 'restored') await refresh('');
      else render();
    } catch (error) {
      showToast(error.message, 'err');
      render();
    }
    return;
  }
  if (action === 'unlink-google') {
    const agreed = await showConfirm({
      title: 'Retirer cette adresse ?',
      text: 'La copie déjà dans Drive reste en place. Cet appareil n\'enverra plus de copie.',
      confirmLabel: 'Retirer',
    });
    if (!agreed) return;
    clearGoogleAccount();
    render();
    return;
  }
  if (action === 'tab') {
    state.tab = button.dataset.tab;
    if (state.tab !== 'actifs') stopActifsPoll();
    if (state.tab === 'sales' || state.tab === 'recettes') {
      const periodSource = state.tab === 'recettes' ? state.recettes : state.sales;
      const today = periodSource?.todayDate || localDateISO(new Date());
      state.periodKind = 'today';
      state.salesFrom = today;
      state.salesTo = today;
    }
    render({ resetScroll: true });
    if (state.tab === 'sales' || state.tab === 'recettes') {
      refreshMoneyView();
    } else if (state.tab === 'profiles') {
      loadWorkspace({ light: true })
        .then(() => { render(); })
        .catch((error) => showToast(error.message, 'err'));
    }
    if (state.tab === 'actifs') loadActifs();
    if (state.tab === 'clients' && typeof refreshLicenseClients === 'function') {
      refreshLicenseClients()
        .then(() => { render(); })
        .catch((error) => showToast(error.message, 'err'));
    }
    return;
  }
  if (action === 'recettes-view') {
    state.recettesView = button.dataset.view === 'profiles' ? 'profiles' : 'resellers';
    render();
    return;
  }
  if (action === 'period') {
    const periodSource = state.tab === 'recettes' ? state.recettes : state.sales;
    state.periodKind = button.dataset.period === 'month' ? 'month' : 'today';
    const today = periodSource?.todayDate || localDateISO(new Date());
    if (state.periodKind === 'today') {
      state.salesFrom = today;
      state.salesTo = today;
    } else {
      state.salesFrom = periodSource?.monthFrom || monthRange(currentMonthKey()).start;
      state.salesTo = today;
    }
    refreshMoneyView();
    return;
  }
  if (action === 'qr') {
    const sale = (state.sales?.sales || []).find((item) => item.id === Number(button.dataset.id));
    if (sale) showQr(sale.code, sale.loginUrl);
    return;
  }
  if (action === 'edit-router') {
    state.editingRouterId = Number(button.dataset.id);
    render();
    return;
  }
  if (action === 'cancel-edit') {
    state.editingRouterId = 0;
    render();
    return;
  }
  if (action === 'add-stock') {
    openStockModal();
    return;
  }
  if (action === 'toggle-lot') {
    const id = Number(button.dataset.id);
    if (state.lotOpen === id) {
      state.lotOpen = 0;
      state.lotName = '';
      state.lot = null;
    } else {
      state.lotOpen = id;
      state.lotName = '';
      state.lot = null;
    }
    render();
    return;
  }
  if (action === 'invite-reseller') {
    if (state.busy) return;
    const resellerId = Number(button.dataset.id);
    try {
      state.busy = true;
      state.busyAction = `invite-${resellerId}`;
      showAppBusy('Préparation de l’invitation…');
      render();
      const invite = await api(`/api/admin/resellers/${resellerId}/invite`, { method: 'POST', body: {} });
      hideAppBusy(true);
      state.busy = false;
      state.busyAction = '';
      render();
      await showResellerInvite(invite);
    } catch (error) {
      hideAppBusy(true);
      state.busy = false;
      state.busyAction = '';
      render();
      showToast(error.message || 'Invitation impossible.', 'err');
    }
    return;
  }
  if (!['test-router', 'sync-router', 'delete-router', 'toggle-reseller'].includes(action)) return;
  if (state.busy) return;
  if (action === 'delete-router') {
    const agreed = await showConfirm({
      title: 'Supprimer ce routeur ?',
      text: 'Ses forfaits seront retirés de l\'application.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!agreed) return;
  }
  if (action === 'toggle-reseller') {
    const disable = button.dataset.active !== '1';
    const agreed = await showConfirm({
      title: disable ? 'Désactiver ce revendeur ?' : 'Réactiver ce revendeur ?',
      text: disable ? 'Il ne pourra plus vendre.' : 'Il pourra à nouveau vendre.',
      confirmLabel: disable ? 'Désactiver' : 'Réactiver',
      danger: disable,
    });
    if (!agreed) return;
  }
  const leavePage = action === 'sync-router';
  const routerId = Number(button.dataset.id) || 0;
  try {
    await runBusyRender(render, async () => {
      if (action === 'test-router') {
        showToast('Test du routeur…', 'ok', 12000);
        const result = await api(`/api/admin/routers/${routerId}/test`, { method: 'POST', body: {} });
        showToast(result.identity ? `Routeur joignable : ${result.identity}` : 'Routeur joignable.', 'ok');
        return;
      }
      if (action === 'sync-router') {
        showToast('Chargement des forfaits…', 'ok');
        const result = await api(`/api/admin/routers/${routerId}/sync`, { method: 'POST', body: {} });
        applyScopeRouter(routerId);
        state.tab = 'profiles';
        showToast(`${result.count} forfait(s) chargé(s).`, 'ok');
        await loadWorkspace();
        return;
      }
      if (action === 'delete-router') {
        await api(`/api/admin/routers/${routerId}`, { method: 'DELETE' });
        if (state.profilesRouterId === routerId) state.profilesRouterId = 0;
        showToast('Routeur supprimé.', 'ok');
        await loadWorkspace();
        return;
      }
      if (action === 'toggle-reseller') {
        await api(`/api/admin/resellers/${routerId}`, {
          method: 'PATCH',
          body: { active: button.dataset.active === '1' },
        });
        showToast(button.dataset.active === '1' ? 'Revendeur réactivé.' : 'Revendeur désactivé.', 'ok');
        await loadWorkspace();
      }
    }, {
      resetScroll: leavePage,
      busyLabel: action === 'test-router'
        ? 'Test du routeur…'
        : action === 'sync-router'
          ? 'Chargement des forfaits…'
          : 'Traitement en cours…',
      before: () => {
        state.busy = true;
        state.busyAction = action === 'test-router' ? `test-${routerId}` : action;
      },
      after: () => {
        state.busy = false;
        state.busyAction = '';
      },
    });
  } catch (error) {
    showToast(error.message || 'Échec du test.', 'err');
  }
}

app.addEventListener('click', onAdminClick);
document.addEventListener('click', (event) => {
  if (event.target.closest('#app-dock')) onAdminClick(event);
});

app.addEventListener('change', async (event) => {
  const sellableBox = event.target.closest('[data-action="toggle-sellable"]');
  if (sellableBox) {
    const id = Number(sellableBox.dataset.id);
    const sellable = sellableBox.checked;
    try {
      const result = await api(`/api/admin/profiles/${id}`, {
        method: 'PATCH',
        body: { sellable },
      });
      state.profiles = state.profiles.map((profile) => (
        profile.id === id ? { ...profile, ...result.profile } : profile
      ));
      const meta = sellableBox.closest('.card')?.querySelector('.meta');
      if (meta && result.profile) {
        const profile = result.profile;
        const ready = profile.limit_uptime && profile.price != null && profile.active && profile.sellable;
        meta.textContent = `Valable ${profile.validity || '—'}${profile.active ? '' : ' · absent'}${profile.sellable ? '' : ' · hors app'}${ready ? '' : ' · vente bloquée'}`;
      }
      showToast(sellable ? 'Forfait disponible dans l\'app.' : 'Forfait retiré de l\'app.', 'ok');
    } catch (error) {
      sellableBox.checked = !sellable;
      showToast(error.message, 'err');
    }
    return;
  }
  if (event.target.id !== 'profile-router') return;
  state.profilesRouterId = Number(event.target.value) || 0;
  await runBusyRender(render, async () => {
    const profiles = await api(`/api/admin/profiles?routerId=${state.profilesRouterId}`);
    state.profiles = profiles.profiles;
  }, {
    busyLabel: 'Chargement des forfaits…',
    before: () => { state.busy = true; },
    after: () => { state.busy = false; },
  });
});

if (scopeRouterSelect) {
  scopeRouterSelect.addEventListener('change', async () => {
    applyScopeRouter(scopeRouterSelect.value);
    try {
      await refresh('', { light: true });
    } catch (error) {
      showToast(error.message, 'err');
    }
  });
}

if (clientsLink) {
  clientsLink.addEventListener('click', () => {
    if (typeof isFounderLicense !== 'function' || !isFounderLicense()) return;
    if (state.tab === 'clients') return;
    state.tab = 'clients';
    if (typeof stopActifsPoll === 'function') stopActifsPoll();
    render({ resetScroll: true });
    if (typeof refreshLicenseClients === 'function') {
      refreshLicenseClients()
        .then(() => { render(); })
        .catch((error) => showToast(error.message, 'err'));
    }
  });
}

logoutButton.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
  clearActivity();
  clearOwner();
  location.replace('index.html');
});

async function idleLogout() {
  if (!state.authed || idleLogout.done) return;
  idleLogout.done = true;
  await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
  clearActivity();
  clearOwner();
  sessionStorage.setItem('opus.notice', 'Session fermée après 15 minutes sans utilisation.');
  location.replace('index.html');
}

function quotaRights() {
  if (typeof currentLicensePlan !== 'function' || typeof licenseRights !== 'function') return null;
  const plan = currentLicensePlan();
  if (!plan || plan === 'essai' || plan === 'fondateur') return null;
  if (typeof licenseFrozen === 'function' && licenseFrozen()) return null;
  return licenseRights();
}

let quotaSuggest = null;

function routerParked(routerId) {
  return typeof routerParkedByPlan === 'function' && routerParkedByPlan(routerId);
}

function resellerParked(resellerId) {
  return typeof resellerDroppedByPlan === 'function' && resellerDroppedByPlan(resellerId);
}

function quotaChoiceNeeded() {
  const rights = quotaRights();
  if (!rights || typeof workspaceExceedsRights !== 'function' || typeof quotaHoldFitsPlan !== 'function') return false;
  const routers = state.routers || [];
  const resellers = state.resellers || [];
  if (!workspaceExceedsRights(routers, resellers, rights)) return false;
  return !quotaHoldFitsPlan(currentLicensePlan(), rights, routers, resellers);
}

async function enforceQuotaChoice() {
  if (typeof loadPublicPlans === 'function') {
    try { await loadPublicPlans(); } catch { /* plafonds locaux */ }
  }
  const closeGate = () => {
    document.getElementById('quota-gate')?.remove();
    document.body.classList.remove('quota-locked');
  };
  if (!state.authed || typeof currentLicensePlan !== 'function') {
    closeGate();
    return;
  }
  const plan = currentLicensePlan();
  const hold = typeof quotaHoldRecord === 'function' ? quotaHoldRecord() : null;
  if (typeof licenseFrozen === 'function' && licenseFrozen()) {
    closeGate();
    return;
  }
  const rights = quotaRights();
  const routers = state.routers || [];
  const resellers = state.resellers || [];
  const exceeds = rights && typeof workspaceExceedsRights === 'function'
    && workspaceExceedsRights(routers, resellers, rights);
  if (!exceeds) {
    if (hold && typeof clearQuotaHold === 'function') await clearQuotaHold().catch(() => {});
    quotaSuggest = null;
    closeGate();
    return;
  }
  if (hold && !hold.pending && typeof quotaHoldFitsPlan === 'function' && quotaHoldFitsPlan(plan, rights, routers, resellers)) {
    quotaSuggest = null;
    closeGate();
    return;
  }
  if (hold && !hold.pending) quotaSuggest = hold;
  if (typeof ensureQuotaPending === 'function') await ensureQuotaPending(plan).catch(() => {});
  const gate = document.getElementById('quota-gate');
  if (gate && gate.dataset.plan === plan) return;
  gate?.remove();
  openQuotaChoiceGate();
}

function openQuotaChoiceGate() {
  const rights = quotaRights();
  if (!rights) return;
  const overlay = document.createElement('div');
  overlay.id = 'quota-gate';
  overlay.className = 'update-gate';
  overlay.dataset.plan = typeof currentLicensePlan === 'function' ? currentLicensePlan() : '';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  document.body.classList.add('quota-locked');
  document.body.appendChild(overlay);
  paintQuotaChoice(overlay, rights);
}

function paintQuotaChoice(overlay, rights) {
  const routers = state.routers || [];
  const resellers = state.resellers || [];
  const pickRouters = routers.length > rights.maxRouters;
  const suggestRouters = new Set((quotaSuggest && quotaSuggest.routers) || []);
  const suggestResellers = new Set((quotaSuggest && quotaSuggest.resellers) || []);
  const routerBoxes = routers.map((router) => `
    <label class="check-line">
      <input type="checkbox" name="keep-router" value="${router.id}" ${pickRouters ? (suggestRouters.has(Number(router.id)) ? 'checked' : '') : 'checked data-locked disabled'}>
      ${esc(router.name)}
    </label>
  `).join('');
  const resellerBoxes = resellers.map((reseller) => `
    <label class="check-line">
      <input type="checkbox" name="keep-reseller" value="${reseller.id}" data-router="${reseller.routerId}" ${suggestResellers.has(Number(reseller.id)) ? 'checked' : ''}>
      ${esc(reseller.hmpName)} <span class="meta">${esc(reseller.routerName || '')}</span>
    </label>
  `).join('');
  overlay.innerHTML = `
    <section class="quota-gate-card">
      <h1>Choisissez ce que l’offre inclut</h1>
      <p>Votre offre autorise ${esc(rights.maxRouters)} routeur(s) et ${esc(rights.maxResellers)} revendeur(s). Cochez ceux qui communiquent. Les autres restent enregistrés, avec leur configuration, mais ne communiquent plus. Une offre plus large pourra les reprendre sans les recréer.</p>
      <form class="stack">
        ${pickRouters ? `<h2>Routeurs</h2>${routerBoxes}` : routerBoxes}
        <h2>Revendeurs</h2>
        ${resellerBoxes || '<p class="meta">Aucun revendeur.</p>'}
        <p class="meta" data-quota-count></p>
        <p class="meta" data-quota-error hidden></p>
        <button type="submit" class="btn-sell btn-block">Continuer</button>
      </form>
    </section>
  `;
  const form = overlay.querySelector('form');
  const refreshLimits = () => {
    const trimChecked = (inputs, max) => {
      const chosen = inputs.filter((input) => input.checked);
      while (chosen.length > max) chosen.pop().checked = false;
    };
    trimChecked([...form.querySelectorAll('[name="keep-router"]:not([data-locked])')], rights.maxRouters);
    const routerOn = new Set([...form.querySelectorAll('[name="keep-router"]:checked')].map((input) => input.value));
    form.querySelectorAll('[name="keep-router"]:not([data-locked])').forEach((input) => {
      input.disabled = !input.checked && routerOn.size >= rights.maxRouters;
    });
    form.querySelectorAll('[name="keep-reseller"]').forEach((input) => {
      const routerKept = !pickRouters || routerOn.has(input.dataset.router);
      if (!routerKept) input.checked = false;
    });
    const byRouter = new Map();
    [...form.querySelectorAll('[name="keep-reseller"]')].forEach((input) => {
      const list = byRouter.get(input.dataset.router) || [];
      list.push(input);
      byRouter.set(input.dataset.router, list);
    });
    byRouter.forEach((inputs) => trimChecked(inputs, rights.maxResellersPerRouter));
    trimChecked([...form.querySelectorAll('[name="keep-reseller"]')], rights.maxResellers);
    const keptResellers = [...form.querySelectorAll('[name="keep-reseller"]:checked')];
    const perRouter = new Map();
    keptResellers.forEach((input) => {
      const routerId = input.dataset.router;
      perRouter.set(routerId, (perRouter.get(routerId) || 0) + 1);
    });
    form.querySelectorAll('[name="keep-reseller"]').forEach((input) => {
      const routerKept = !pickRouters || routerOn.has(input.dataset.router);
      const onThisRouter = perRouter.get(input.dataset.router) || 0;
      input.disabled = !routerKept || (!input.checked && (
        keptResellers.length >= rights.maxResellers
        || onThisRouter >= rights.maxResellersPerRouter
      ));
    });
    const count = overlay.querySelector('[data-quota-count]');
    const chosenRouters = pickRouters ? routerOn.size : routers.length;
    const chosenResellers = form.querySelectorAll('[name="keep-reseller"]:checked').length;
    if (count) count.textContent = `${chosenRouters} / ${rights.maxRouters} routeurs · ${chosenResellers} / ${rights.maxResellers} revendeurs`;
  };
  form.addEventListener('change', refreshLimits);
  refreshLimits();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const routerIds = [...form.querySelectorAll('[name="keep-router"]:checked')].map((input) => Number(input.value));
    const resellerIds = [...form.querySelectorAll('[name="keep-reseller"]:checked')].map((input) => Number(input.value));
    const error = overlay.querySelector('[data-quota-error]');
    if (routerIds.length > rights.maxRouters || resellerIds.length > rights.maxResellers) {
      error.hidden = false;
      error.textContent = 'Vous avez coché plus que l’offre ne le permet.';
      return;
    }
    const droppedRouters = routers.filter((router) => !routerIds.includes(Number(router.id)));
    const droppedResellers = resellers.filter((reseller) => !resellerIds.includes(Number(reseller.id)));
    const names = [
      ...droppedRouters.map((router) => `Routeur ${router.name}`),
      ...droppedResellers.map((reseller) => `Revendeur ${reseller.hmpName}`),
    ];
    overlay.innerHTML = `
      <section class="quota-gate-card">
        <h1>Couper la communication</h1>
        <p>Ces éléments restent enregistrés. Ils ne communiquent plus tant que l’offre ne les inclut pas :</p>
        <ul>${names.map((name) => `<li>${esc(name)}</li>`).join('') || '<li>Aucun</li>'}</ul>
        <p>Aucune reconfiguration ne sera nécessaire pour les reprendre avec une offre qui les couvre.</p>
        <div class="modal-actions">
          <button type="button" class="btn-quiet" data-quota-back>Revenir</button>
          <button type="button" class="btn-sell" data-quota-confirm>Couper la communication</button>
        </div>
      </section>
    `;
    overlay.querySelector('[data-quota-back]').addEventListener('click', () => paintQuotaChoice(overlay, rights));
    overlay.querySelector('[data-quota-confirm]').addEventListener('click', async () => {
      const button = overlay.querySelector('[data-quota-confirm]');
      button.disabled = true;
      try {
        await api('/api/admin/quota-trim', { method: 'POST', body: { routerIds, resellerIds } });
        if (typeof publishQuotaKeep === 'function') await publishQuotaKeep(currentLicensePlan(), routerIds, resellerIds);
        quotaSuggest = null;
        overlay.remove();
        document.body.classList.remove('quota-locked');
        showToast('Communication coupée pour les comptes non choisis. Ils restent enregistrés.', 'ok', 6000);
        await loadWorkspace({ light: true });
        render();
      } catch (err) {
        button.disabled = false;
        showToast(err.message || 'Suppression impossible.', 'err', 6000);
      }
    });
  });
}

async function boot() {
  watchIdle(idleLogout);
  if (await enforceAppUpdate()) return;
  if (typeof enforceLicense === 'function' && await enforceLicense()) return;
  try {
    const status = await api('/api/status');
    state.needsSetup = status.needsSetup;
    if (status.needsSetup) {
      location.replace('index.html');
      return;
    }
    if (activityExpired()) {
      await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
      clearActivity();
      clearOwner();
      sessionStorage.setItem('opus.notice', 'Session fermée après 15 minutes sans utilisation.');
      location.replace('index.html');
      return;
    }
    try {
      await api('/api/admin/me');
      state.authed = true;
      markOwner();
      markActivity();
      idleLogout.done = false;
    } catch {
      state.authed = false;
      if (!isOwner()) {
        location.replace('index.html');
        return;
      }
    }
  } catch {
    state.authed = false;
  }

  if (!state.authed) {
    render();
    return;
  }

  state.loading = true;
  render();
  try {
    const routers = await api('/api/admin/routers');
    state.routers = routers.routers || [];
    syncScopeFromRouters();
  } catch (error) {
    showToast(error.message, 'err');
  } finally {
    state.loading = false;
    hideAppBusy();
    render();
  }

  loadWorkspace({ light: true })
    .then(() => {
      if (state.authed && state.tab !== 'sales' && state.tab !== 'recettes') render();
      prefetchSales();
    })
    .catch((error) => showToast(error.message, 'err'));

  try {
    if (sessionStorage.getItem('opus.google.justLinked') === '1') {
      const outcome = await adoptGoogleBackup();
      if (outcome === 'restored' || outcome === 'pulled') await refresh('', { light: true });
      else if (outcome) render();
    } else if (typeof syncDriveNow === 'function') {
      const account = typeof readGoogleAccount === 'function' ? readGoogleAccount() : null;
      if (account && (account.refreshToken || account.accessToken)) {
        setTimeout(() => {
          syncDriveNow().then(async (outcome) => {
            if (outcome === 'pulled') {
              showToast('Données synchronisées depuis Drive.', 'ok');
              await refresh('', { light: true });
            }
          }).catch((error) => showToast(error.message, 'err'));
        }, 2500);
      }
    }
  } catch (error) {
    showToast(error.message, 'err');
  }
  if (typeof syncDriveNow === 'function') {
    clearInterval(boot.syncTimer);
    boot.syncTimer = setInterval(() => {
      if (!state.authed || document.hidden) return;
      syncDriveNow().then(async (outcome) => {
        if (outcome === 'pulled') {
          showToast('Données synchronisées depuis Drive.', 'ok');
          await refresh('', { light: true });
        }
      }).catch(() => {});
    }, 180000);
  }
}

boot();
