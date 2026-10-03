const app = document.getElementById('app');
let needsSetup = false;
let busy = false;

function renderWelcome() {
  app.innerHTML = `
    <section class="card">
      <h1>Tickets</h1>
      <button class="btn-sell btn-block" type="button" data-action="invite" ${busy ? 'disabled' : ''}>Rejoindre avec un code</button>
      <p class="help">Revendeurs : collez l’invitation envoyée par l’administration (WhatsApp, SMS…), puis entrez votre mot de passe.</p>
      <button class="btn-quiet btn-block" type="button" data-action="nouveau" ${busy ? 'disabled' : ''}>Première installation</button>
      <p class="help">Uniquement pour créer le tout premier administrateur sur un téléphone encore vide.</p>
      <button class="btn-quiet btn-block" type="button" data-action="restore" ${busy ? 'disabled' : ''}>Restaurer (admin / Gmail)</button>
      <p class="help">Réservé à l’administration pour récupérer une copie Drive. Ne partagez pas ce Gmail aux revendeurs.</p>
    </section>
  `;
}

function renderInvite() {
  app.innerHTML = `
    <section class="card card-auth">
      <h1>Invitation</h1>
      <p class="help">Collez le message reçu de l’administration (le code qui commence par OPUS1).</p>
      <form data-form="invite">
        <label for="invite-code">Code d’invitation</label>
        <textarea id="invite-code" name="token" rows="6" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Tickets — invitation…&#10;OPUS1.gz.…"></textarea>
        <button class="btn-sell btn-block" type="submit" ${busy ? 'disabled' : ''}>Valider l’invitation</button>
      </form>
      <button class="btn-quiet btn-block" type="button" data-action="welcome">Retour</button>
    </section>
  `;
}

function renderEnter(options = {}) {
  const setup = Boolean(options.setup);
  app.innerHTML = `
    <section class="card card-auth">
      <h1>Tickets</h1>
      <p class="help">${setup
        ? 'Mot de passe d’administration pour créer ce téléphone à zéro.'
        : 'Mot de passe administration ou revendeur.'}</p>
      <form data-form="enter">
        <label for="password">Mot de passe</label>
        ${passwordField({ id: 'password', name: 'password', autocomplete: 'current-password', required: true })}
        <button class="btn-sell btn-block" type="submit" ${busy ? 'disabled' : ''}>Entrer</button>
      </form>
      <button class="btn-quiet btn-block" type="button" data-action="welcome">Retour</button>
    </section>
  `;
}

function extractInviteToken(raw) {
  const text = String(raw || '');
  const match = text.match(/OPUS1(?:\.gz)?\.[A-Za-z0-9_-]+/);
  return match ? match[0] : text.trim();
}

async function finishRestoreAfterGoogle() {
  busy = true;
  renderWelcome();
  try {
    if (typeof adoptGoogleBackup !== 'function') throw new Error('Module Drive manquant.');
    const outcome = await adoptGoogleBackup();
    if (outcome !== 'restored') {
      showToast('Restauration incomplète. Réessayez.', 'err');
      busy = false;
      renderWelcome();
      return;
    }
    await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
    clearActivity();
    clearOwner();
    needsSetup = false;
    busy = false;
    renderEnter({ setup: false });
    showToast('Entrez votre mot de passe (admin ou revendeur).', 'ok', 4000);
  } catch (error) {
    showToast(error.message, 'err');
    busy = false;
    renderWelcome();
  }
}

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || busy) return;
  const action = button.dataset.action;
  if (action === 'welcome') {
    renderWelcome();
    return;
  }
  if (action === 'invite') {
    renderInvite();
    return;
  }
  if (action === 'nouveau') {
    const agreed = await showConfirm({
      title: 'Première installation ?',
      text: 'À utiliser seulement pour créer le premier administrateur.\n\nSi vous êtes revendeur, annulez et choisissez « Rejoindre avec un code ».',
      confirmLabel: 'Continuer',
    });
    if (!agreed) return;
    renderEnter({ setup: true });
    return;
  }
  if (action === 'restore') {
    if (typeof connectGoogle !== 'function') {
      showToast('Module Drive manquant.', 'err');
      return;
    }
    busy = true;
    renderWelcome();
    try {
      const mode = await connectGoogle({ next: 'index.html', restore: true });
      if (mode === 'redirect') return;
      await finishRestoreAfterGoogle();
    } catch (error) {
      showToast(error.message, 'err');
      busy = false;
      renderWelcome();
    }
  }
});

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  busy = true;
  try {
    if (form.dataset.form === 'invite') {
      const token = extractInviteToken(data.token);
      const result = await api('/api/invite/accept', { method: 'POST', body: { token } });
      needsSetup = false;
      busy = false;
      renderEnter({ setup: false });
      showToast(`Compte ${result.name || 'revendeur'} prêt. Entrez votre mot de passe.`, 'ok', 4500);
      return;
    }
    const result = await api('/api/enter', { method: 'POST', body: data });
    markActivity();
    if (result.role === 'admin') {
      markOwner();
      location.replace('admin.html');
    } else {
      clearOwner();
      location.replace('vendeur.html');
    }
  } catch (error) {
    showToast(error.message, 'err', 4500);
    busy = false;
    if (button) button.disabled = false;
  }
});

async function boot() {
  document.body.classList.add('gate');

  const pendingRestore = sessionStorage.getItem('opus.google.justLinked') === '1'
    && sessionStorage.getItem('opus.restoreIntent') === '1';
  if (pendingRestore) {
    await showBrandSplash({ minMs: 900 });
    renderWelcome();
    await finishRestoreAfterGoogle();
    return;
  }

  if (activityExpired()) {
    await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
    clearActivity();
    clearOwner();
  }

  let statusNeedsSetup = true;
  try {
    const status = await api('/api/status');
    statusNeedsSetup = Boolean(status.needsSetup);
  } catch {
    statusNeedsSetup = true;
  }
  needsSetup = statusNeedsSetup;

  if (!needsSetup) {
    try {
      await api('/api/admin/me');
      markOwner();
      location.replace('admin.html');
      return;
    } catch { /* session vendeur ou absente */ }
    try {
      await api('/api/vendeur/me');
      location.replace('vendeur.html');
      return;
    } catch { /* écran de mot de passe */ }
  }

  await showBrandSplash({ minMs: 1600 });

  if (!needsSetup) {
    renderEnter({ setup: false });
    const notice = consumeNotice();
    if (notice) showToast(notice, 'err');
    setTimeout(() => { checkForUpdate(); }, 1200);
    return;
  }

  renderWelcome();
  const notice = consumeNotice();
  if (notice) showToast(notice, 'err');
  setTimeout(() => { checkForUpdate(); }, 1200);
}

boot();
