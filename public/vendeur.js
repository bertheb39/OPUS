const app = document.getElementById('app');
const logoutButton = document.getElementById('logout');
const adminLink = document.getElementById('to-admin');

const state = {
  authed: false,
  me: null,
  screen: 'list',
  forfaits: [],
  report: null,
  salesFrom: '',
  salesTo: '',
  periodKind: '',
  usage: {},
  usageWarning: '',
  actifs: null,
  actifsWarning: '',
  selected: null,
  ticket: null,
  verifyResult: null,
  lots: [],
  pending: [],
  busy: false,
};

function renderLogin() {
  app.innerHTML = `
    <section class="card card-auth">
      <h1>Vente</h1>
      <form data-form="login">
        <label for="password">Mot de passe</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <button class="btn-sell btn-block" type="submit" ${state.busy ? 'disabled' : ''}>Entrer</button>
      </form>
    </section>
  `;
}

function dock(screen) {
  const items = [
    ['list', 'Vendre', '<path d="M5 7h14l-1.2 12H6.2L5 7z"/><path d="M9 7V5h6v2"/>'],
    ['actifs', 'Actifs', '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>'],
    ['history', 'Rapport', '<path d="M6 7h12M6 12h12M6 17h8"/>'],
  ];
  return `
    <nav class="dock" aria-label="Navigation">
      ${items.map(([id, label, icon]) => `
        <button type="button" data-action="screen" data-screen="${id}" aria-selected="${screen === id ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
          <span>${label}</span>
        </button>
      `).join('')}
    </nav>
  `;
}

function renderList() {
  const cards = state.forfaits.map((forfait) => `
    <article class="card">
      <div class="profile-head">
        <h2>${esc(forfait.name)}</h2>
        <div class="price">${esc(money(forfait.price))}</div>
      </div>
      <p class="meta">Valable ${esc(forfait.validity || '—')} · ${esc(forfait.limitUptime)}</p>
      <p class="meta">Stock ${esc(forfait.remaining)}</p>
      <button
        class="btn-sell btn-block"
        type="button"
        data-action="choose"
        data-id="${forfait.id}"
        ${forfait.remaining < 1 || state.busy ? 'disabled' : ''}
      >${forfait.remaining < 1 ? 'Stock épuisé' : 'Remettre'}</button>
    </article>
  `).join('');
  const lots = state.lots.map((lot) => `
    <article class="card">
      <div class="profile-head">
        <h2>${esc(lot.profile || 'Sans forfait')}</h2>
        <div class="price">${lot.price == null ? '—' : esc(money(lot.price))}</div>
      </div>
      <p class="meta">Déjà sur le routeur · ${esc(lot.remaining)} à remettre${lot.pending ? ` · ${esc(lot.pending)} en attente` : ''}</p>
      <button
        class="btn-sell btn-block"
        type="button"
        data-action="sell-lot"
        data-profile="${esc(lot.profile)}"
        ${!lot.ready || lot.remaining < 1 || state.busy ? 'disabled' : ''}
      >${lot.ready ? 'Remettre' : 'Prix manquant'}</button>
    </article>
  `).join('');
  const pendingCards = (state.pending || []).map((item) => `
    <article class="sale-card">
      <div class="sale-top">
        <strong>${esc(item.code)}</strong>
        <span class="badge badge-price">${item.price == null ? '—' : esc(money(item.price))}</span>
      </div>
      <div class="sale-status">
        <span class="badge badge-wait">En attente</span>
        ${item.channel === 'AP' ? sourceBadge('AP') : '<span class="badge badge-hap">LOT</span>'}
      </div>
      <div class="meta">${esc(item.profile || '—')} · ${esc(item.when || '')}</div>
      <button type="button" class="btn-danger" data-action="cancel-pending" data-code="${esc(item.code)}" ${state.busy ? 'disabled' : ''}>Annuler</button>
    </article>
  `).join('');
  app.innerHTML = `
    <div class="sheet">
      <p class="meta">${esc(state.me.name)} · ${esc(state.me.routerName)}</p>
      <section class="card">
        <h2>Retrouver un ticket</h2>
        <form data-form="verifier" class="field-row">
          <input id="verify-code" name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Code" aria-label="Code">
          <button type="submit" ${state.busy ? 'disabled' : ''}>OK</button>
        </form>
      </section>
      ${pendingCards ? `
        <section class="card">
          <h2>Remis en attente</h2>
          ${pendingCards}
        </section>
      ` : ''}
      ${cards}
      ${lots}
      ${cards || lots ? '' : '<section class="card"><p class="meta">Aucun forfait.</p></section>'}
    </div>
    ${dock('list')}
  `;
}

function renderTicket() {
  const ticket = state.ticket;
  const svg = typeof qrSvg === 'function' ? qrSvg(ticket.loginUrl || ticket.code) : '';
  const reused = Boolean(ticket.reused);
  app.innerHTML = `
    <div class="sheet">
    <section class="card">
      <h1>${reused ? 'Ticket trouvé' : 'Code du client'}</h1>
      ${reused ? '<p class="meta">Pas encore connecté — photo, scan ou relevez le code.</p>' : ''}
      <div class="qr-wrap">${svg}</div>
      <div class="ticket-code" id="ticket-code">${esc(ticket.code)}</div>
      <p class="meta">${esc(ticket.profile)} · ${esc(money(ticket.price))} · ${esc(ticket.limitUptime)}</p>
      <div class="actions">
        <button class="btn-quiet" type="button" data-action="copy">Copier</button>
        <button class="btn-sell" type="button" data-action="share-ticket" ${state.busy ? 'disabled' : ''}>Partager</button>
      </div>
      <div class="actions">
        <button class="btn-danger" type="button" data-action="cancel-remise" ${state.busy ? 'disabled' : ''}>Annuler</button>
        <button class="btn-quiet" type="button" data-action="close-ticket">Fermer</button>
      </div>
    </section>
    </div>
    ${dock('list')}
  `;
}

function renderVerifySold() {
  const result = state.verifyResult || {};
  app.innerHTML = `
    <div class="sheet">
      <section class="card">
        <h1>Résultat</h1>
        <p class="verify-sold">${esc(result.message || 'Ce ticket a déjà été vendu.')}</p>
        ${result.code ? `<div class="ticket-code ticket-code-sm">${esc(result.code)}</div>` : ''}
        <p class="meta">Ne remettez rien : le paiement est déjà soldé.</p>
        <button class="btn-block" type="button" data-action="close-ticket">Fermer</button>
      </section>
    </div>
    ${dock('list')}
  `;
}

function renderHistory() {
  const report = state.report;
  const kind = state.periodKind || (
    report && state.salesFrom === report.todayDate && state.salesTo === report.todayDate
      ? 'today'
      : (report && state.salesFrom === report.monthFrom && state.salesTo === report.todayDate ? 'month' : '')
  );
  const list = report?.sales || [];
  const pending = report?.pending;
  const settlement = report?.settlement;
  const periodLabel = report?.period
    ? (report.period.from === report.period.to
      ? report.period.from
      : `${report.period.from} → ${report.period.to}`)
    : '';
  const items = list.map((sale) => `
    <article class="sale-card">
      <div class="sale-top">
        <strong>${esc(sale.code)}</strong>
        <span class="badge badge-price">${esc(money(sale.price))}</span>
      </div>
      <div class="sale-status">
        ${sourceBadge(sale.source)}
        ${usageBadge(state.usage[sale.id])}
      </div>
      <div class="meta">${esc(sale.comment || sale.keyword || '—')} · ${esc(sale.when)}${sale.profile ? ` · ${esc(sale.profile)}` : ''}</div>
    </article>
  `).join('');
  const rateLabel = settlement?.rate == null ? '' : `${settlement.rate} %`;
  const resellerName = settlement?.resellerName || state.me?.name || '';
  const networkName = settlement?.networkName || state.me?.routerName || '';
  const resellerPartLabel = resellerName
    ? `Part de <strong>${esc(resellerName)}</strong>`
    : 'Votre part';
  const networkPartLabel = networkName
    ? `À reverser à <strong>${esc(networkName)}</strong>`
    : 'À reverser';
  app.innerHTML = `
    <div class="sheet">
    <div class="stat-grid">
      ${statCard("Aujourd'hui", report ? report.today.count : null, report ? report.today.amount : null, { period: 'today', selected: kind === 'today' })}
      ${statCard('Ce mois', report ? report.month.count : null, report ? report.month.amount : null, { period: 'month', selected: kind === 'month' })}
    </div>
    <section class="card">
      <h2>Période</h2>
      <div class="presets">
        <button type="button" data-action="period" data-period="today" aria-selected="${kind === 'today' ? 'true' : 'false'}">Aujourd'hui</button>
        <button type="button" data-action="period" data-period="month" aria-selected="${kind === 'month' ? 'true' : 'false'}">Ce mois</button>
      </div>
      <form data-form="report-filter" class="stack">
        <div class="date-pair">
          <div>
            <label>Du</label>
            <input name="from" type="date" value="${esc(state.salesFrom || report?.period.from || '')}" required>
          </div>
          <div>
            <label>Au</label>
            <input name="to" type="date" value="${esc(state.salesTo || report?.period.to || '')}" required>
          </div>
        </div>
        <button type="submit">Afficher</button>
      </form>
      ${report ? `
        <div class="report-line"><span>Comptabilisé${periodLabel ? ` (${esc(periodLabel)})` : ''}<span class="report-tickets">${esc(report.period.count)} ticket${report.period.count === 1 ? '' : 's'}</span></span><strong>${esc(money(report.period.amount))}</strong></div>
        ${settlement?.rate != null ? `<div class="report-line"><span>Taux à reverser</span><strong>${esc(rateLabel)}</strong></div>` : ''}
        ${settlement?.resellerShare != null ? `<div class="report-line report-line-ok"><span>${resellerPartLabel}</span><strong>${esc(money(settlement.resellerShare))}</strong></div>` : ''}
        ${settlement?.networkShare != null ? `<div class="report-line report-line-due"><span>${networkPartLabel}</span><strong>${esc(money(settlement.networkShare))}</strong></div>` : ''}
        <div class="report-line"><span>Remis en attente<span class="report-tickets">${esc(pending?.count || 0)} ticket${(pending?.count || 0) === 1 ? '' : 's'}</span></span><strong>${esc(money(pending?.amount || 0))}</strong></div>
      ` : ''}
      ${report?.syncWarning ? `<p class="meta">${esc(report.syncWarning)}</p>` : ''}
      ${state.busy && !report ? '<p class="meta">Chargement…</p>' : (items || '<p class="meta">Aucune connexion sur cette période.</p>')}
    </section>
    </div>
    ${dock('history')}
  `;
}

function renderActifs() {
  const list = state.actifs?.sessions || [];
  const clock = state.actifs?.at ? formatClock(state.actifs.at) : '';
  app.innerHTML = `
    <div class="sheet">
    <section class="card">
      <div class="actifs-head">
        <h2>Actifs</h2>
        <span class="actifs-live" title="Sessions en ligne">
          <span class="actifs-live-count">${esc(list.length)} en ligne</span>
          ${clock ? `<span class="actifs-live-clock">${esc(clock)}</span>` : ''}
        </span>
      </div>
      ${state.actifsWarning ? `<p class="meta">${esc(state.actifsWarning)}</p>` : ''}
      <div data-actifs-body>${state.busy && !state.actifs ? '<p class="meta">Chargement…</p>' : actifsTableHtml(list, { admin: false })}</div>
    </section>
    </div>
    ${dock('actifs')}
  `;
}

function render(options = {}) {
  const paint = () => {
    document.body.classList.toggle('gate', !state.authed);
    document.body.classList.toggle('has-dock', state.authed);
    logoutButton.hidden = !state.authed;
    if (adminLink) adminLink.hidden = !isOwner();
    if (!state.authed) {
      renderLogin();
      return;
    }
    if (state.screen === 'verify' && state.verifyResult) renderVerifySold();
    else if (state.screen === 'ticket' && state.ticket) renderTicket();
    else if (state.screen === 'history') renderHistory();
    else if (state.screen === 'actifs') renderActifs();
    else renderList();
  };
  if (state.authed && typeof preserveSheetScroll === 'function') {
    preserveSheetScroll(paint, Boolean(options.resetScroll));
    return;
  }
  paint();
}

async function loadForfaits() {
  const data = await api('/api/vendeur/forfaits');
  state.lots = data.lots || [];
  state.forfaits = data.forfaits;
  state.pending = data.pending || [];
}

function refreshForfaitsSoon() {
  loadForfaits().catch(() => {});
}

async function loadSales() {
  const params = new URLSearchParams();
  if (state.salesFrom) params.set('from', state.salesFrom);
  if (state.salesTo) params.set('to', state.salesTo);
  const data = await api(`/api/vendeur/ventes?${params.toString()}`);
  state.report = data;
  state.salesFrom = data.period.from;
  state.salesTo = data.period.to;
  state.usage = {};
  state.usageWarning = '';
  loadUsage();
}

let usageToken = 0;
async function loadUsage() {
  const token = ++usageToken;
  const params = new URLSearchParams();
  if (state.salesFrom) params.set('from', state.salesFrom);
  if (state.salesTo) params.set('to', state.salesTo);
  try {
    const usage = await api(`/api/vendeur/usage?${params.toString()}`);
    if (token !== usageToken) return;
    state.usage = usage.statuses || {};
    state.usageWarning = usage.warning || '';
  } catch (error) {
    if (token !== usageToken) return;
    state.usageWarning = error.message;
  }
  const active = document.activeElement;
  const typing = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT');
  if (state.screen === 'history' && state.authed && !typing) render();
}

let actifsToken = 0;
let actifsTimer = 0;
function stopActifsPoll() {
  clearTimeout(actifsTimer);
  actifsTimer = 0;
}

async function loadActifs() {
  const token = ++actifsToken;
  try {
    const data = await api('/api/vendeur/actifs');
    if (token !== actifsToken) return;
    state.actifs = data;
    state.actifsWarning = data.warning || '';
  } catch (error) {
    if (token !== actifsToken) return;
    state.actifsWarning = error.message;
  }
  const active = document.activeElement;
  const typing = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
  if (state.screen === 'actifs' && state.authed && !typing) {
    const list = state.actifs?.sessions || [];
    const clock = state.actifs?.at ? formatClock(state.actifs.at) : '';
    const live = document.querySelector('.actifs-live');
    const body = document.querySelector('[data-actifs-body]');
    if (live && body) {
      live.innerHTML = `<span class="actifs-live-count">${esc(list.length)} en ligne</span>${clock ? `<span class="actifs-live-clock">${esc(clock)}</span>` : ''}`;
      body.innerHTML = actifsTableHtml(list, { admin: false });
    } else {
      render();
    }
  }
  stopActifsPoll();
  if (state.screen === 'actifs' && state.authed) {
    actifsTimer = setTimeout(() => { loadActifs(); }, 12000);
  }
}

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.form === 'report-filter') {
    state.salesFrom = data.from;
    state.salesTo = data.to;
    state.periodKind = '';
    await runBusyRender(render, () => loadSales(), {
      before: () => { state.busy = true; },
      after: () => { state.busy = false; },
    });
    return;
  }
  if (form.dataset.form === 'verifier') {
    await runBusyRender(render, async () => {
      try {
        const result = await api('/api/vendeur/verifier', {
          method: 'POST',
          body: { code: data.code },
        });
        if (result.status === 'sold') {
          state.verifyResult = result;
          state.ticket = null;
          state.screen = 'verify';
          return;
        }
        state.verifyResult = null;
        state.ticket = result;
        state.screen = 'ticket';
        refreshForfaitsSoon();
      } catch (error) {
        showToast(error.message, 'err');
      }
    }, {
      resetScroll: true,
      before: () => { state.busy = true; },
      after: () => { state.busy = false; },
    });
    return;
  }
  if (form.dataset.form !== 'login') return;
  state.busy = true;
  render();
  try {
    await api('/api/vendeur/login', { method: 'POST', body: data });
    state.me = await api('/api/vendeur/me');
    await loadForfaits();
    state.authed = true;
    state.screen = 'list';
    markActivity();
    idleLogout.done = false;
  } catch (error) {
    showToast(error.message, 'err');
  } finally {
    state.busy = false;
    render({ resetScroll: true });
  }
});

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || state.busy) return;
  const action = button.dataset.action;
  if (action === 'close-ticket') {
    state.ticket = null;
    state.verifyResult = null;
    state.screen = 'list';
    await runBusyRender(render, () => loadForfaits().catch(() => {}), {
      resetScroll: true,
      before: () => { state.busy = true; },
      after: () => { state.busy = false; },
    });
    return;
  }
  if (action === 'screen') {
    state.screen = button.dataset.screen;
    if (state.screen === 'list') {
      state.ticket = null;
      state.verifyResult = null;
    }
    if (state.screen !== 'actifs') stopActifsPoll();
    const loader = state.screen === 'history'
      ? () => loadSales()
      : (state.screen === 'actifs' ? () => loadActifs() : () => loadForfaits());
    await runBusyRender(render, async () => {
      try { await loader(); } catch (error) { showToast(error.message, 'err'); }
    }, {
      resetScroll: true,
      before: () => { state.busy = true; },
      after: () => { state.busy = false; },
    });
    return;
  }
  if (action === 'choose') {
    const forfait = state.forfaits.find((item) => item.id === Number(button.dataset.id));
    if (!forfait) return;
    const agreed = await showConfirm({
      title: 'Remettre ce ticket ?',
      text: `${forfait.name} · ${money(forfait.price)}\nDurée ${forfait.limitUptime}, valable ${forfait.validity || '—'}.\nStock : ${forfait.remaining}\nCompté seulement quand le client se connecte.`,
      confirmLabel: 'Remettre',
    });
    if (!agreed) return;
    state.selected = forfait;
    await runBusyRender(render, async () => {
      try {
        state.ticket = await api('/api/vendeur/vendre', {
          method: 'POST',
          body: { profileId: forfait.id },
        });
        state.screen = 'ticket';
        if (forfait.remaining > 0) forfait.remaining -= 1;
        refreshForfaitsSoon();
        showToast('Ticket remis (pas encore compté).', 'ok');
      } catch (error) {
        showToast(error.message, 'err');
      }
    }, {
      resetScroll: true,
      before: () => { state.busy = true; },
      after: () => { state.busy = false; },
    });
    return;
  }
  if (action === 'sell-lot') {
    const lot = state.lots.find((item) => item.profile === button.dataset.profile);
    if (!lot || !lot.ready) return;
    const agreed = await showConfirm({
      title: 'Remettre ce ticket ?',
      text: `${lot.profile} · ${money(lot.price)}\nTicket déjà présent sur le routeur.\nÀ remettre : ${lot.remaining}\nCompté seulement à la connexion.`,
      confirmLabel: 'Remettre',
    });
    if (!agreed) return;
    await runBusyRender(render, async () => {
      try {
        state.ticket = await api('/api/vendeur/vendre-lot', {
          method: 'POST',
          body: { profile: lot.profile },
        });
        state.screen = 'ticket';
        if (lot.remaining > 0) lot.remaining -= 1;
        refreshForfaitsSoon();
        showToast('Ticket remis (pas encore compté).', 'ok');
      } catch (error) {
        showToast(error.message, 'err');
      }
    }, {
      resetScroll: true,
      before: () => { state.busy = true; },
      after: () => { state.busy = false; },
    });
    return;
  }
  if (action === 'period') {
    if (!state.report) return;
    state.periodKind = button.dataset.period === 'month' ? 'month' : 'today';
    if (state.periodKind === 'today') {
      state.salesFrom = state.report.todayDate;
      state.salesTo = state.report.todayDate;
    } else {
      state.salesFrom = state.report.monthFrom;
      state.salesTo = state.report.todayDate;
    }
    await runBusyRender(render, () => loadSales(), {
      before: () => { state.busy = true; },
      after: () => { state.busy = false; },
    });
    return;
  }
  if (action === 'qr') {
    const sale = (state.report?.sales || []).find((item) => item.id === Number(button.dataset.id));
    if (sale) showQr(sale.code, sale.loginUrl);
    return;
  }
  if (action === 'copy') {
    const code = state.ticket?.code || '';
    try {
      await navigator.clipboard.writeText(code);
      showToast('Code copié.', 'ok');
    } catch {
      showToast('Sélectionnez le code pour le copier.', 'err');
    }
    return;
  }
  if (action === 'share-ticket') {
    if (!state.ticket || state.busy) return;
    state.busy = true;
    try {
      const mode = await shareTicketQr(state.ticket);
      showToast(mode === 'copied' ? 'Lien du ticket copié.' : 'Ticket prêt à envoyer.', 'ok');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      showToast(error.message || 'Partage impossible.', 'err');
    } finally {
      state.busy = false;
      render();
    }
    return;
  }
  if (action === 'cancel-remise' || action === 'cancel-pending') {
    const code = action === 'cancel-pending'
      ? String(button.dataset.code || '').trim()
      : (state.ticket?.code || '');
    if (!code) return;
    const agreed = await showConfirm({
      title: 'Annuler cette remise ?',
      text: `Code ${code}\nPossible seulement si le client ne s'est pas encore connecté.`,
      confirmLabel: 'Annuler la remise',
      danger: true,
    });
    if (!agreed) return;
    await runBusyRender(render, async () => {
      try {
        const result = await api('/api/vendeur/annuler-remise', {
          method: 'POST',
          body: { code },
        });
        if (state.ticket?.code === code) state.ticket = null;
        state.screen = 'list';
        await loadForfaits();
        showToast(
          result.stockRestored
            ? 'Remise annulée. Ticket retiré et stock remis.'
            : 'Remise annulée. Le ticket est de nouveau disponible.',
          'ok',
        );
      } catch (error) {
        showToast(error.message, 'err');
      }
    }, {
      resetScroll: true,
      before: () => { state.busy = true; },
      after: () => { state.busy = false; },
    });
  }
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
  render();
  try {
    if (activityExpired()) {
      await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
      clearActivity();
      clearOwner();
      sessionStorage.setItem('opus.notice', 'Session fermée après 15 minutes sans utilisation.');
      location.replace('index.html');
      return;
    }
    state.busy = true;
    render();
    state.me = await api('/api/vendeur/me');
    state.authed = true;
    await loadForfaits();
    markActivity();
    idleLogout.done = false;
  } catch {
    state.authed = false;
  } finally {
    state.busy = false;
  }
  render({ resetScroll: true });
  setTimeout(() => { checkForUpdate(); }, 1500);
  if (state.authed && typeof scheduleDriveBackup === 'function') {
    setTimeout(() => { scheduleDriveBackup(); }, 10000);
  }
}

boot();
