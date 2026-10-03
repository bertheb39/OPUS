const app = document.getElementById('app');
const logoutButton = document.getElementById('logout');
const saleLink = document.getElementById('to-sale');

const state = {
  needsSetup: false,
  authed: false,
  tab: 'routers',
  routers: [],
  profilesRouterId: 0,
  profiles: [],
  resellers: [],
  resellerMonth: '',
  salesFrom: '',
  salesTo: '',
  periodKind: '',
  salesRouterId: 0,
  salesResellerId: 0,
  actifsRouterId: 0,
  actifs: null,
  actifsWarning: '',
  usage: {},
  usageWarning: '',
  sales: null,
  message: '',
  error: '',
  busy: false,
  busyAction: '',
  loading: false,
  editingRouterId: 0,
  lotOpen: 0,
  lotName: '',
  lot: null,
};

function routerOptions(selected) {
  if (!state.routers.length) return '<option value="">Aucun routeur</option>';
  return state.routers.map((router) => (
    `<option value="${router.id}" ${Number(selected) === router.id ? 'selected' : ''}>${esc(router.name)}</option>`
  )).join('');
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
  const cards = state.routers.map((router) => {
    const editing = state.editingRouterId === router.id;
    return `
      <article class="card">
        <h2>${esc(router.name)}</h2>
        <p class="meta">${esc(router.host)}${router.admin_host ? ` · VPN ${esc(router.admin_host)}` : ''} · ${esc(router.username)}</p>
        <div class="actions">
          <button type="button" data-action="test-router" data-id="${router.id}" ${state.busy ? 'disabled' : ''}>${state.busy && state.busyAction === `test-${router.id}` ? 'Test…' : 'Tester'}</button>
          <button type="button" data-action="sync-router" data-id="${router.id}" ${state.busy ? 'disabled' : ''}>Forfaits</button>
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
      <form data-form="router" class="stack">
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
      </form>
    </section>
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

  return `
    <section class="card">
      <label for="profile-router">Routeur</label>
      <select id="profile-router">${routerOptions(state.profilesRouterId)}</select>
    </section>
    ${state.profilesRouterId ? (cards || '<section class="card"><p class="meta">Aucun forfait.</p></section>') : ''}
  `;
}

function renderResellers() {
  const cards = state.resellers.map((reseller) => {
    const stock = reseller.stock.length
      ? `<p class="meta">Stock : ${reseller.stock.map((item) => `${esc(item.name)} ${esc(item.remaining)}`).join(' · ')}</p>`
      : '';
    const codes = (reseller.monthCodes || []).length
      ? reseller.monthCodes.map((item) => `${esc(item.profile)} ${esc(item.code)}`).join(' · ')
      : '';
    return `
      <article class="card">
        <div class="profile-head">
          <h2>${esc(reseller.hmpName)}</h2>
          <span class="meta">${reseller.active ? 'actif' : 'off'}</span>
        </div>
        <p class="meta">${esc(reseller.routerName)} · ${esc(reseller.reachHost || reseller.host || '—')}</p>
        <p class="meta">Mois : ${esc(reseller.soldCount)} · ${esc(money(reseller.soldAmount))}${reseller.ratePercent == null ? '' : ` · ${esc(reseller.ratePercent)} %`}</p>
        ${reseller.ratePercent != null ? `<p class="meta"><strong>Part ${esc(reseller.hmpName)}</strong> ${esc(money(reseller.resellerShare || 0))} · <strong>À ${esc(reseller.routerName || 'réseau')}</strong> ${esc(money(reseller.networkShare || 0))}</p>` : ''}
        <p class="meta">Mots-clés : ${esc((reseller.saleKeywords || []).join(', ') || reseller.hmpName)} · Tickets ${esc(reseller.assignedCount || 0)}${reseller.handedCount ? ` (${esc(reseller.handedCount)} att.)` : ''}</p>
        ${codes ? `<p class="meta">Codes ${esc(reseller.monthKey || '')} : ${codes}</p>` : ''}
        ${stock}
        <div class="actions">
          <button type="button" class="btn-sell" data-action="invite-reseller" data-id="${reseller.id}" ${state.busy ? 'disabled' : ''}>
            Inviter
          </button>
          <button type="button" class="btn-quiet" data-action="toggle-lot" data-id="${reseller.id}">
            ${state.lotOpen === reseller.id ? 'Fermer' : 'Attribuer'}
          </button>
          <button type="button" class="${reseller.active ? 'btn-danger' : 'btn-quiet'}" data-action="toggle-reseller" data-id="${reseller.id}" data-active="${reseller.active ? '0' : '1'}">
            ${reseller.active ? 'Désactiver' : 'Réactiver'}
          </button>
        </div>
        ${state.lotOpen === reseller.id ? renderLot(reseller) : ''}
        <form data-form="reseller-update" data-id="${reseller.id}" data-active="${reseller.active ? '1' : '0'}" class="stack">
          <label>Nom sur le ticket</label>
          <input name="hmpName" value="${esc(reseller.hmpName)}" required autocapitalize="characters">
          <label>Mots-clés des ventes</label>
          <input name="saleKeywords" value="${esc((reseller.saleKeywords || []).join(', '))}" placeholder="HOME, voisin" autocapitalize="characters">
          <label>Taux à reverser (%)</label>
          <input name="ratePercent" type="number" min="0" max="100" step="0.01" value="${reseller.ratePercent == null ? '' : esc(reseller.ratePercent)}" placeholder="Ex. 75" inputmode="decimal">
          <label>Routeur</label>
          <select name="routerId" required>${routerOptions(reseller.routerId)}</select>
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
      <h2>Revendeur</h2>
      <form data-form="reseller" class="stack">
        <label>Nom sur le ticket</label>
        <input name="hmpName" required placeholder="HOME" autocapitalize="characters">
        <label>Mots-clés des ventes</label>
        <input name="saleKeywords" placeholder="HOME, voisin" autocapitalize="characters">
        <label>Taux à reverser (%)</label>
        <input name="ratePercent" type="number" min="0" max="100" step="0.01" placeholder="Ex. 75" inputmode="decimal" required>
        <label>Mot de passe</label>
        ${passwordField({ name: 'password', autocomplete: 'new-password', required: true, minlength: 4 })}
        <label>Routeur</label>
        <select name="routerId" required>${routerOptions('')}</select>
        <label>Adresse routeur</label>
        <input name="host" required placeholder="Ex. 192.168.196.196">
        <div class="actions">
          <button type="submit">Créer</button>
          <button type="button" class="btn-quiet" data-action="add-stock">Stock</button>
        </div>
      </form>
    </section>
    ${cards || '<p class="meta">Aucun revendeur.</p>'}
  `;
}

function renderLot(reseller) {
  const lot = state.lot && state.lot.resellerId === reseller.id ? state.lot : null;
  const name = lot ? lot.commentName : (state.lotName || reseller.hmpName);
  const lots = lot ? lot.lots : [];
  const rows = lots.map((item) => {
    const profiles = (item.profiles || []).join(', ') || '—';
    let detail = `${profiles} · ${item.count} ticket${item.count > 1 ? 's' : ''}`;
    if (item.blocked) detail = `Déjà attribué à ${item.owner}`;
    else if (!item.count && item.used) detail = `${profiles} · ${item.used} connecté${item.used > 1 ? 's' : ''}`;
    else if (!item.count) detail = 'Déjà attribué';
    else if (item.used) detail += ` · ${item.used} connecté${item.used > 1 ? 's' : ''}`;
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
  if (!state.resellers.length) {
    showToast('Aucun revendeur.', 'err');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const resellerOptions = state.resellers.map((reseller) => (
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

function renderBackup() {
  const account = readGoogleAccount();
  const gmail = account.email
    ? `<p class="meta" data-drive-status>${esc(driveStatusText())}</p>
       <div class="actions">
         <button type="button" data-action="drive-upload">Drive</button>
         <button type="button" class="btn-quiet" data-action="unlink-google">Retirer</button>
       </div>`
    : `<button type="button" data-action="link-google">Lier mon Gmail</button>`;
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
  const resellerOptions = ['<option value="0">Tous les revendeurs</option>'].concat(state.resellers.map((reseller) => (
    `<option value="${reseller.id}" ${state.salesResellerId === reseller.id ? 'selected' : ''}>${esc(reseller.hmpName)}</option>`
  ))).join('');
  const routerOptionsHtml = ['<option value="0">Tous les PTP</option>'].concat(state.routers.map((router) => (
    `<option value="${router.id}" ${state.salesRouterId === router.id ? 'selected' : ''}>${esc(router.name)}</option>`
  ))).join('');
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
        <label>PTP</label>
        <select name="routerId">${routerOptionsHtml}</select>
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
      ${rows || '<p class="meta">Aucune connexion sur cette période.</p>'}
    </section>
  `;
}

function renderActifs() {
  const routerOptionsHtml = ['<option value="0">Tous les PTP</option>'].concat(state.routers.map((router) => (
    `<option value="${router.id}" ${Number(state.actifsRouterId) === router.id ? 'selected' : ''}>${esc(router.name)}</option>`
  ))).join('');
  const list = state.actifs?.sessions || [];
  const clock = state.actifs?.at ? formatClock(state.actifs.at) : '';
  return `
    <section class="card">
      <div class="actifs-head">
        <h2>Actifs</h2>
        <span class="actifs-live" title="Sessions en ligne">
          <span class="actifs-live-count">${esc(list.length)} en ligne</span>
          ${clock ? `<span class="actifs-live-clock">${esc(clock)}</span>` : ''}
        </span>
      </div>
      <form data-form="actifs-filter" class="field-row">
        <select name="routerId" aria-label="PTP">${routerOptionsHtml}</select>
        <button type="submit">OK</button>
      </form>
      ${state.actifsWarning ? `<p class="meta">${esc(state.actifsWarning)}</p>` : ''}
      <div data-actifs-body>${actifsTableHtml(list, { admin: true })}</div>
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
      </div>${dock()}`;
    return;
  }
  const body = {
    routers: renderRouters,
    profiles: renderProfiles,
    resellers: renderResellers,
    actifs: renderActifs,
    sales: renderSales,
  }[state.tab]();
  app.innerHTML = `<div class="sheet">${body}</div>${dock()}`;
}

function render(options = {}) {
  const paint = () => {
    document.body.classList.toggle('gate', !state.authed);
    document.body.classList.toggle('has-dock', state.authed);
    logoutButton.hidden = !state.authed;
    if (saleLink) saleLink.hidden = !state.authed && !isOwner();
    if (state.needsSetup) renderSetup();
    else if (!state.authed) renderLogin();
    else renderApp();
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
  if (!state.profilesRouterId && state.routers[0]) state.profilesRouterId = state.routers[0].id;
  if (state.loading) {
    state.loading = false;
    render();
  }

  const resellerQs = new URLSearchParams();
  if (state.resellerMonth) resellerQs.set('month', state.resellerMonth);
  if (light) resellerQs.set('light', '1');
  const resellerUrl = `/api/admin/resellers${resellerQs.toString() ? `?${resellerQs}` : ''}`;
  const salesQs = salesQuery();
  const salesUrl = `/api/admin/sales?${salesQs}${salesQs ? '&' : ''}sync=${light ? '0' : '1'}`;

  const jobs = [
    api(resellerUrl).then((resellers) => {
      state.resellers = resellers.resellers || [];
      state.resellerMonth = resellers.month;
    }),
    api(salesUrl).then((sales) => {
      state.sales = sales;
      state.salesFrom = sales.period.from;
      state.salesTo = sales.period.to;
      state.usage = {};
      state.usageWarning = '';
    }),
  ];
  if (state.profilesRouterId) {
    jobs.push(
      api(`/api/admin/profiles?routerId=${state.profilesRouterId}`).then((profiles) => {
        state.profiles = profiles.profiles || [];
      }),
    );
  }
  await Promise.all(jobs);
  if (state.tab === 'sales') loadUsage();
  if (state.tab === 'actifs') loadActifs();
}

async function warmWorkspaceInBackground() {
  try {
    const resellerQs = new URLSearchParams();
    if (state.resellerMonth) resellerQs.set('month', state.resellerMonth);
    const [resellers, sales] = await Promise.all([
      api(`/api/admin/resellers${resellerQs.toString() ? `?${resellerQs}` : ''}`),
      api(`/api/admin/sales?${salesQuery()}&sync=1`),
    ]);
    state.resellers = resellers.resellers || [];
    state.resellerMonth = resellers.month;
    state.sales = sales;
    state.salesFrom = sales.period.from;
    state.salesTo = sales.period.to;
    if (state.tab === 'resellers' || state.tab === 'sales') render();
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
  await runBusyRender(render, async () => {
    await loadWorkspace({ light });
    if (message) showToast(message, 'ok');
  }, {
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
  state.busy = true;
  render();
  restoreSheetScroll(savedTop);
  try {
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
      await api('/api/admin/routers', { method: 'POST', body: data });
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
    if (form.dataset.form === 'sales-filter') {
      state.salesFrom = data.from;
      state.salesTo = data.to;
      state.periodKind = '';
      state.salesRouterId = Number(data.routerId) || 0;
      state.salesResellerId = Number(data.resellerId) || 0;
      await refresh('', { fromSubmit: true });
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
  } catch (error) {
    showToast(error.message, 'err');
  } finally {
    state.busy = false;
    render();
    restoreSheetScroll(savedTop);
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

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'backup') {
    try {
      await saveBackupFile();
    } catch (error) {
      showToast(error.message, 'err');
    }
    return;
  }
  if (action === 'drive-upload') {
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
    if (state.tab === 'sales' && state.sales?.todayDate) {
      state.periodKind = 'today';
      state.salesFrom = state.sales.todayDate;
      state.salesTo = state.sales.todayDate;
    }
    render({ resetScroll: true });
    if (state.tab === 'sales') {
      loadWorkspace({ light: false })
        .then(() => { render(); })
        .catch((error) => showToast(error.message, 'err'));
    }
    if (state.tab === 'actifs') loadActifs();
    return;
  }
  if (action === 'period') {
    if (!state.sales) return;
    state.periodKind = button.dataset.period === 'month' ? 'month' : 'today';
    if (state.periodKind === 'today') {
      state.salesFrom = state.sales.todayDate;
      state.salesTo = state.sales.todayDate;
    } else {
      state.salesFrom = state.sales.monthFrom;
      state.salesTo = state.sales.todayDate;
    }
    await refresh('');
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
      render();
      const invite = await api(`/api/admin/resellers/${resellerId}/invite`, { method: 'POST', body: {} });
      state.busy = false;
      state.busyAction = '';
      render();
      await showResellerInvite(invite);
    } catch (error) {
      state.busy = false;
      state.busyAction = '';
      render();
      showToast(error.message, 'err');
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
        state.profilesRouterId = routerId;
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
    before: () => { state.busy = true; },
    after: () => { state.busy = false; },
  });
});

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

async function boot() {
  watchIdle(idleLogout);
  if (await enforceAppUpdate()) return;
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
    await loadWorkspace({ light: true });
  } catch (error) {
    showToast(error.message, 'err');
  } finally {
    state.loading = false;
    render();
  }

  setTimeout(() => { warmWorkspaceInBackground(); }, 4000);

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
