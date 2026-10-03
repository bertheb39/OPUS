function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function passwordField(options = {}) {
  const {
    id = '',
    name = 'password',
    autocomplete = 'current-password',
    required = false,
    minlength = '',
    placeholder = '',
    value = '',
  } = options;
  const attrs = [
    id ? `id="${esc(id)}"` : '',
    `name="${esc(name)}"`,
    'type="password"',
    `autocomplete="${esc(autocomplete)}"`,
    required ? 'required' : '',
    minlength !== '' && minlength != null ? `minlength="${esc(String(minlength))}"` : '',
    placeholder ? `placeholder="${esc(placeholder)}"` : '',
    value !== '' && value != null ? `value="${esc(value)}"` : '',
  ].filter(Boolean).join(' ');
  return `<div class="password-field">
    <input ${attrs}>
    <button type="button" class="password-toggle" data-toggle-password aria-label="Afficher le mot de passe" title="Afficher le mot de passe">
      <svg class="password-icon-show" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
      <svg class="password-icon-hide" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 102.8 2.8"/><path d="M9.9 5.1A10.5 10.5 0 0112 5c6.5 0 10 7 10 7a18.5 18.5 0 01-2.2 3.2"/><path d="M6.1 6.1C3.1 8.2 2 12 2 12s3.5 7 10 7a10.8 10.8 0 004.2-.8"/></svg>
    </button>
  </div>`;
}

if (!window.__opusPasswordToggleBound) {
  window.__opusPasswordToggleBound = true;
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-toggle-password]');
    if (!button) return;
    event.preventDefault();
    const wrap = button.closest('.password-field');
    const input = wrap && wrap.querySelector('input');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.classList.toggle('is-visible', show);
    const label = show ? 'Masquer le mot de passe' : 'Afficher le mot de passe';
    button.setAttribute('aria-label', label);
    button.title = label;
  });
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

const APP_VERSION = '2.4';
const UPDATE_REPO = 'bertheb39/OPUS';
const activityKey = 'opus.activity';
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

function versionFromReleaseName(name) {
  const match = String(name || '').match(/(\d+\.\d+(?:\.\d+)?)(?=\.(?:apk|exe)\b)/i);
  return match ? match[1] : '';
}

function versionFromApkUrl(url) {
  return versionFromReleaseName(url);
}

function isAndroidApp() {
  return Boolean(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RouterOs);
}

function pickReleaseAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  if (isAndroidApp()) {
    return list.find((item) => /Tickets-.*\.apk$/i.test(item.name || ''))
      || list.find((item) => /\.apk$/i.test(item.name || ''))
      || null;
  }
  return list.find((item) => /Tickets-.*\.exe$/i.test(item.name || ''))
    || list.find((item) => /\.exe$/i.test(item.name || ''))
    || list.find((item) => /Tickets-.*\.apk$/i.test(item.name || ''))
    || null;
}

async function resolveLatestReleaseUpdate() {
  const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error('Impossible de vérifier la mise à jour.');
  }
  const release = await response.json();
  const asset = pickReleaseAsset(release.assets);
  if (!asset || !asset.browser_download_url) return null;
  const version = versionFromReleaseName(asset.name)
    || String(release.tag_name || '').replace(/^v/i, '').trim();
  if (!version) return null;
  return {
    version,
    downloadUrl: asset.browser_download_url,
    fileName: asset.name || '',
    repo: UPDATE_REPO,
  };
}

function showMandatoryUpdate(target) {
  let overlay = document.getElementById('update-gate');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'update-gate';
    overlay.className = 'update-gate';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
  }
  document.body.classList.add('update-locked');
  overlay.innerHTML = `
    <section class="update-gate-card">
      <h1>Mise à jour obligatoire</h1>
      <p>La version <strong>${esc(target.version)}</strong> est disponible.</p>
      <p class="meta">Version installée : ${esc(APP_VERSION)}</p>
      <p>Téléchargez et installez cette version pour continuer. L’application reste bloquée tant que la mise à jour n’est pas installée.</p>
      <button type="button" class="btn-sell btn-block" data-update-download>Télécharger ${esc(target.fileName || 'la mise à jour')}</button>
      <p class="help" data-update-hint hidden>Téléchargement lancé. Installez le fichier puis rouvrez Tickets.</p>
    </section>
  `;
  const button = overlay.querySelector('[data-update-download]');
  const hint = overlay.querySelector('[data-update-hint]');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await openExternal(target.downloadUrl);
      if (hint) hint.hidden = false;
    } catch (error) {
      showToast(error.message || 'Téléchargement impossible.', 'err');
    } finally {
      button.disabled = false;
    }
  });
}

function clearMandatoryUpdate() {
  const overlay = document.getElementById('update-gate');
  if (overlay) overlay.remove();
  document.body.classList.remove('update-locked');
  enforceAppUpdate.locked = false;
}

async function enforceAppUpdate() {
  let target = null;
  try {
    target = await resolveLatestReleaseUpdate();
  } catch {
    return Boolean(enforceAppUpdate.locked);
  }
  if (!target || !target.version || !target.downloadUrl || !versionIsNewer(target.version, APP_VERSION)) {
    clearMandatoryUpdate();
    return false;
  }
  enforceAppUpdate.locked = true;
  showMandatoryUpdate(target);
  return true;
}

async function checkForUpdate() {
  return enforceAppUpdate();
}

if (!window.__opusUpdateWatchBound) {
  window.__opusUpdateWatchBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') enforceAppUpdate();
  });
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

async function sharePlainText(text, title = 'Partager') {
  const payload = String(text || '').trim();
  if (!payload) throw new Error('Rien à partager.');
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RouterOs;
  if (plugin && plugin.shareText) {
    await plugin.shareText({ text: payload, title });
    return 'shared';
  }
  if (navigator.share) {
    await navigator.share({ title, text: payload });
    return 'shared';
  }
  throw new Error('Partage indisponible sur cet appareil.');
}

async function copyPlainText(text) {
  const payload = String(text || '');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(payload);
    return;
  }
  const area = document.createElement('textarea');
  area.value = payload;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

async function showResellerInvite(invite) {
  const token = String((invite && invite.token) || '').trim();
  const guideText = String((invite && invite.guideText) || (invite && invite.shareText) || '').trim();
  const name = String((invite && invite.name) || 'revendeur');
  if (!token) throw new Error('Invitation vide.');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <section class="modal modal-form" role="dialog" aria-modal="true">
      <h2>Inviter ${esc(name)}</h2>
      <p>Envoyez d’abord le guide, puis le code seul (plus simple à coller).</p>
      <label>Guide</label>
      <textarea class="invite-share" data-invite-guide readonly rows="6">${esc(guideText)}</textarea>
      <label>Code à coller</label>
      <textarea class="invite-share invite-code" data-invite-token readonly rows="4">${esc(token)}</textarea>
      <div class="modal-actions">
        <button type="button" class="btn-sell" data-share>Partager (2 messages)</button>
        <button type="button" data-copy-code>Copier le code</button>
        <button type="button" class="btn-quiet" data-copy-guide>Copier le guide</button>
        <button type="button" class="btn-quiet" data-ok>Fermer</button>
      </div>
    </section>
  `;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('[data-ok]').addEventListener('click', close);
  overlay.querySelector('[data-copy-code]').addEventListener('click', async () => {
    try {
      await copyPlainText(token);
      showToast('Code copié.', 'ok');
    } catch (error) {
      showToast(error.message || 'Copie impossible.', 'err');
    }
  });
  overlay.querySelector('[data-copy-guide]').addEventListener('click', async () => {
    try {
      await copyPlainText(guideText || token);
      showToast('Guide copié.', 'ok');
    } catch (error) {
      showToast(error.message || 'Copie impossible.', 'err');
    }
  });
  overlay.querySelector('[data-share]').addEventListener('click', async () => {
    const button = overlay.querySelector('[data-share]');
    button.disabled = true;
    try {
      if (guideText) {
        await sharePlainText(guideText, `Tickets — guide ${name}`);
        showToast('Envoyez maintenant le code…', 'ok', 2500);
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      await sharePlainText(token, `Tickets — code ${name}`);
      showToast('Code prêt à envoyer.', 'ok');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      showToast(error.message || 'Partage impossible.', 'err');
    } finally {
      button.disabled = false;
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
