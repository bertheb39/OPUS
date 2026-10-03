function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

let sheetScrollToken = 0;

function restoreSheetScroll(top) {
  const token = ++sheetScrollToken;
  const apply = () => {
    if (token !== sheetScrollToken) return;
    const sheet = document.querySelector('.sheet');
    if (sheet) sheet.scrollTop = top;
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
  setTimeout(apply, 0);
  setTimeout(apply, 80);
  setTimeout(apply, 160);
}

function preserveSheetScroll(run, resetScroll = false) {
  const root = document.querySelector('.sheet');
  const top = resetScroll ? 0 : (root ? root.scrollTop : 0);
  run();
  restoreSheetScroll(top);
}

function rememberSheetScroll() {
  const root = document.querySelector('.sheet');
  return root ? root.scrollTop : 0;
}

async function runBusyRender(renderFn, task, options = {}) {
  const reset = Boolean(options.resetScroll);
  const top = reset ? 0 : rememberSheetScroll();
  if (typeof options.before === 'function') options.before();
  renderFn(reset ? { resetScroll: true } : {});
  if (!reset) restoreSheetScroll(top);
  try {
    return await task();
  } finally {
    if (typeof options.after === 'function') options.after();
    renderFn(reset ? { resetScroll: true } : {});
    if (!reset) restoreSheetScroll(top);
  }
}

function dismissBrandSplash() {
  const root = document.getElementById('brand-splash');
  if (!root) return Promise.resolve();
  return new Promise((resolve) => {
    root.classList.add('is-leaving');
    const finish = () => {
      root.remove();
      resolve();
    };
    root.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 500);
  });
}

function showBrandSplash({ minMs = 2600 } = {}) {
  if (sessionStorage.getItem('opus.brandSplashSeen') === '1') {
    const existing = document.getElementById('brand-splash');
    if (existing) existing.remove();
    return Promise.resolve();
  }
  sessionStorage.setItem('opus.brandSplashSeen', '1');

  let root = document.getElementById('brand-splash');
  if (!root) {
    root = document.createElement('div');
    root.id = 'brand-splash';
    root.className = 'brand-splash';
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', 'HORIZON TEAM');
    root.innerHTML = `
      <div class="brand-splash-stage">
        <span class="brand-splash-ring brand-splash-ring-a" aria-hidden="true"></span>
        <span class="brand-splash-ring brand-splash-ring-b" aria-hidden="true"></span>
        <span class="brand-splash-glow" aria-hidden="true"></span>
        <img class="brand-splash-logo" src="Logo.png" alt="HORIZON TEAM" width="168" height="168" decoding="async">
      </div>
      <p class="brand-splash-copy"><strong>Cette application est la propriété de HORIZON TEAM</strong></p>
    `;
    document.body.appendChild(root);
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = reduced ? 400 : minMs;
  return new Promise((resolve) => {
    setTimeout(async () => {
      await dismissBrandSplash();
      resolve();
    }, wait);
  });
}

function showToast(message, kind = 'ok', durationMs = 2200) {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  root.replaceChildren();
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  root.appendChild(toast);
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => {
      if (toast.isConnected) toast.remove();
    }, 240);
  }, durationMs);
}

function showConfirm({ title, text, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true">
        <h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
        <div class="modal-actions">
          <button type="button" class="btn-quiet" data-cancel>Annuler</button>
          <button type="button" class="${danger ? 'btn-danger' : 'btn-sell'}" data-ok>${esc(confirmLabel)}</button>
        </div>
      </section>
    `;
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('[data-cancel]').addEventListener('click', () => close(false));
    overlay.querySelector('[data-ok]').addEventListener('click', () => close(true));
    document.body.appendChild(overlay);
  });
}

async function api(url, options = {}) {
  if (typeof localApi !== 'function') throw new Error('Application incomplète.');
  return localApi(url, options);
}

const APP_VERSION = '2.0';
const activityKey = 'opus.activity';
const updateUrlKey = 'opus.updateUrl';
const currencyKey = 'opus.currency';
const ownerKey = 'opus.owner';
const noticeKey = 'opus.notice';
const IDLE_LIMIT = 15 * 60 * 1000;
const CURRENCIES = [
  ['XOF', 'FCFA'],
  ['CDF', 'Franc congolais'],
  ['EUR', 'Euro'],
  ['USD', 'Dollar'],
];

function markActivity() {
  localStorage.setItem(activityKey, String(Date.now()));
}

function clearActivity() {
  localStorage.removeItem(activityKey);
}

function activityExpired() {
  let session = null;
  try { session = JSON.parse(localStorage.getItem('opus.session') || 'null'); } catch { session = null; }
  const stamp = Number(localStorage.getItem(activityKey) || 0);
  if (!session) return false;
  if (!stamp) return true;
  return Date.now() - stamp >= IDLE_LIMIT;
}

function watchIdle(onIdle) {
  watchIdle.handler = onIdle;
  if (watchIdle.started) return;
  watchIdle.started = true;
  const poke = () => {
    if (activityExpired()) {
      if (watchIdle.handler) watchIdle.handler();
      return;
    }
    markActivity();
  };
  ['pointerdown', 'keydown'].forEach((name) => {
    document.addEventListener(name, poke, { passive: true });
  });
  setInterval(() => {
    if (activityExpired() && watchIdle.handler) watchIdle.handler();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && activityExpired() && watchIdle.handler) watchIdle.handler();
  });
}

function readUpdateUrl() {
  return localStorage.getItem(updateUrlKey) || '';
}

function saveUpdateUrl(url) {
  const value = String(url || '').trim();
  if (value) localStorage.setItem(updateUrlKey, value);
  else localStorage.removeItem(updateUrlKey);
}

function versionFromApkUrl(url) {
  const match = String(url || '').match(/(\d+\.\d+(?:\.\d+)?)(?=\.apk\b)/i);
  return match ? match[1] : '';
}

function parseGithubRepo(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  const short = text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (short) return `${short[1]}/${short[2]}`;
  const full = text.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (full) return `${full[1]}/${full[2]}`;
  return '';
}

function isDirectApkUrl(url) {
  return /^https?:\/\//i.test(String(url || '')) && /\.apk(\?|#|$)/i.test(String(url || ''));
}

async function resolveUpdateFromGithub(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error('Impossible de lire la dernière release GitHub.');
  }
  const release = await response.json();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const apk = assets.find((item) => /Tickets-.*\.apk$/i.test(item.name || ''))
    || assets.find((item) => /\.apk$/i.test(item.name || ''));
  if (!apk || !apk.browser_download_url) return null;
  const version = versionFromApkUrl(apk.name)
    || String(release.tag_name || '').replace(/^v/i, '').trim();
  if (!version) return null;
  return { version, downloadUrl: apk.browser_download_url, repo };
}

async function resolveUpdateTarget(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (isDirectApkUrl(value)) {
    const version = versionFromApkUrl(value);
    if (!version) return null;
    return { version, downloadUrl: value };
  }
  const repo = parseGithubRepo(value);
  if (!repo) return null;
  return resolveUpdateFromGithub(repo);
}

function readCurrency() {
  const value = localStorage.getItem(currencyKey) || 'XOF';
  return CURRENCIES.some(([code]) => code === value) ? value : 'XOF';
}

function saveCurrency(code) {
  if (CURRENCIES.some(([item]) => item === code)) localStorage.setItem(currencyKey, code);
}

function money(value) {
  const amount = Number(value) || 0;
  const digits = readCurrency() === 'XOF' || readCurrency() === 'CDF' ? 0 : 2;
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: readCurrency(),
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount} ${readCurrency()}`;
  }
}

function statCard(label, count, amount, options = {}) {
  const known = count !== null && count !== undefined && count !== '';
  const total = Number(count);
  const tickets = known && Number.isFinite(total)
    ? `${total} ticket${total > 1 ? 's' : ''}`
    : '—';
  const cash = known && amount != null && amount !== '' ? money(amount) : '—';
  const action = options.period
    ? ` role="button" tabindex="0" data-action="period" data-period="${esc(options.period)}" aria-selected="${options.selected ? 'true' : 'false'}"`
    : '';
  return `
    <article class="stat"${action}>
      <span>${esc(label)}</span>
      <strong>${esc(cash)}</strong>
      <em>${esc(tickets)}</em>
    </article>
  `;
}

function markOwner() {
  sessionStorage.setItem(ownerKey, '1');
}

function clearOwner() {
  sessionStorage.removeItem(ownerKey);
}

function isOwner() {
  return sessionStorage.getItem(ownerKey) === '1';
}

function consumeNotice() {
  const message = sessionStorage.getItem(noticeKey) || '';
  if (message) sessionStorage.removeItem(noticeKey);
  return message;
}

function versionIsNewer(remote, local) {
  const left = String(remote || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(local || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] || 0;
    const b = right[index] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

async function openExternal(url) {
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RouterOs;
  if (plugin && plugin.openExternal) {
    await plugin.openExternal({ url });
    return;
  }
  window.open(url, '_blank');
}

async function checkForUpdate() {
  const configured = readUpdateUrl();
  if (!configured || checkForUpdate.done) return;
  let target = null;
  try {
    target = await resolveUpdateTarget(configured);
  } catch {
    return;
  }
  if (!target || !target.version || !target.downloadUrl) return;
  if (!versionIsNewer(target.version, APP_VERSION)) return;
  checkForUpdate.done = true;
  const agreed = await showConfirm({
    title: 'Mise à jour disponible',
    text: `La version ${target.version} est prête.\nVersion installée : ${APP_VERSION}.`,
    confirmLabel: 'Télécharger',
  });
  if (agreed) await openExternal(target.downloadUrl);
}

function showQr(code, url) {
  const svg = typeof qrSvg === 'function' ? qrSvg(url || code) : '';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true">
      <h2>Connexion</h2>
      <div class="qr-wrap">${svg}</div>
      <div class="qr-code">${esc(code)}</div>
      <p>Le client scanne pour ouvrir la page du hotspot.</p>
      <button type="button" class="btn-block" data-ok>Fermer</button>
    </section>
  `;
  overlay.querySelector('[data-ok]').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

async function showResellerInvite(invite) {
  const shareText = String((invite && invite.shareText) || (invite && invite.token) || '').trim();
  const name = String((invite && invite.name) || 'revendeur');
  if (!shareText) throw new Error('Invitation vide.');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <section class="modal modal-form" role="dialog" aria-modal="true">
      <h2>Inviter ${esc(name)}</h2>
      <p>Envoyez ce message au revendeur (WhatsApp, SMS…). Il choisit « Rejoindre avec un code », colle le message, puis entre son mot de passe.</p>
      <textarea class="invite-share" readonly rows="8">${esc(shareText)}</textarea>
      <div class="modal-actions">
        <button type="button" class="btn-sell" data-share>Partager</button>
        <button type="button" data-copy>Copier</button>
        <button type="button" class="btn-quiet" data-ok>Fermer</button>
      </div>
    </section>
  `;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('[data-ok]').addEventListener('click', close);
  overlay.querySelector('[data-copy]').addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareText);
      } else {
        const area = overlay.querySelector('textarea');
        area.focus();
        area.select();
        document.execCommand('copy');
      }
      showToast('Invitation copiée.', 'ok');
    } catch (error) {
      showToast(error.message || 'Copie impossible.', 'err');
    }
  });
  overlay.querySelector('[data-share]').addEventListener('click', async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `Tickets — ${name}`, text: shareText });
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareText);
        showToast('Partage indisponible : invitation copiée.', 'ok');
        return;
      }
      showToast('Partage indisponible sur cet appareil.', 'err');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      showToast(error.message || 'Partage impossible.', 'err');
    }
  });
  document.body.appendChild(overlay);
}

async function shareTicketQr(ticket) {
  if (!ticket) throw new Error('Aucun ticket à partager.');
  const payload = ticket.loginUrl || ticket.code || '';
  if (!payload) throw new Error('Lien du ticket manquant.');
  if (typeof qrPngDataUrl !== 'function') throw new Error('Module QR manquant.');
  const dataUrl = qrPngDataUrl(payload, 10);
  if (!dataUrl) throw new Error('Impossible de créer le QR.');
  const fileName = `ticket-${String(ticket.code || 'wifi').replace(/[^\w.-]+/g, '_')}.png`;
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RouterOs;
  if (plugin && plugin.shareImage) {
    await plugin.shareImage({ base64: dataUrl, text: payload, name: fileName });
    return 'shared';
  }
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.share) {
    const shareData = { title: `Ticket ${ticket.code || ''}`.trim(), text: payload, files: [file] };
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      await navigator.share(shareData);
      return 'shared';
    }
    await navigator.share({ title: shareData.title, text: payload });
    return 'shared';
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(payload);
    return 'copied';
  }
  throw new Error('Partage indisponible sur cet appareil.');
}

function usageBadge(status) {
  if (status === 'connecte') return '<span class="badge badge-ok">Vendu</span>';
  if (status === 'attente') return '<span class="badge badge-wait">Non connecté</span>';
  if (status === 'absent') return '<span class="badge badge-miss">Introuvable</span>';
  if (status === 'inconnu') return '<span class="badge badge-unk">Non vérifié</span>';
  return '<span class="badge badge-unk">Vérification…</span>';
}

function sourceBadge(source) {
  if (source === 'HAP') return '<span class="badge badge-hap" title="Hors application">HAP</span>';
  if (source === 'AP') return '<span class="badge badge-ap" title="Application">AP</span>';
  return '<span class="badge badge-unk">—</span>';
}

function formatBytes(value) {
  const n = Number(value) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MiB`;
  return `${(n / 1073741824).toFixed(2)} GiB`;
}

function formatClock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function actifsTableHtml(sessions, { admin = false } = {}) {
  const rows = (sessions || []).map((session, index) => {
    const tag = session.comment || session.keyword || session.reseller || '—';
    return `
    <tr style="--i:${index}">
      <td class="col-user"><span class="user-dot" aria-hidden="true"></span><strong>${esc(session.code)}</strong></td>
      <td class="col-comment">${esc(tag)}</td>
      <td>${esc(session.profile || '—')}</td>
      <td class="mono">${esc(session.uptime || '—')}</td>
      <td class="mono">${esc(session.address || '—')}</td>
    </tr>`;
  }).join('');
  return `
    <div class="actifs-wrap">
      <table class="actifs-table actifs-table-compact">
        <thead>
          <tr>
            <th>User</th>
            <th>Commentaire</th>
            <th>Profil</th>
            <th>Uptime</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="5" class="empty-row">Aucun client payé connecté pour le moment.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}
