const googleKey = 'opus.google';
const googleVerifierKey = 'opus.google.verifier';
const googleLinkedKey = 'opus.google.justLinked';
const oauthNextKey = 'opus.oauthNext';
const restoreIntentKey = 'opus.restoreIntent';
const snapshotAtKey = 'opus.snapshotAt';
const driveFileName = 'Tickets-sauvegarde.json';

function readSnapshotAt() {
  return localStorage.getItem(snapshotAtKey) || '';
}

function writeSnapshotAt(iso) {
  if (iso) localStorage.setItem(snapshotAtKey, String(iso));
}

function markLocalSnapshotDirty() {
  writeSnapshotAt(new Date().toISOString());
}

function googleReady() {
  return typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com');
}

function useGoogleProxy() {
  return !(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RouterOs);
}

async function googleFetch(url, options = {}) {
  if (!useGoogleProxy()) {
    return fetch(url, options);
  }
  const response = await fetch('/api/google/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body == null ? null : String(options.body),
    }),
  });
  if (response.status === 502) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Google Drive n\'a pas répondu depuis le PC.');
  }
  return response;
}

function readGoogleAccount() {
  try {
    const account = JSON.parse(localStorage.getItem(googleKey) || 'null');
    if (!account || !account.email) return {};
    if (account.driveError && /failed to fetch|pas d'accès à internet/i.test(account.driveError)) {
      account.driveError = 'Dernier envoi impossible : Google Drive n\'a pas répondu.';
      localStorage.setItem(googleKey, JSON.stringify(account));
    }
    return account;
  } catch {
    return {};
  }
}

function writeGoogleAccount(account) {
  localStorage.setItem(googleKey, JSON.stringify(account));
}

function clearGoogleAccount() {
  localStorage.removeItem(googleKey);
}

function formatDriveTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function isNetworkError(error) {
  const message = String((error && error.message) || error || '');
  return /failed to fetch|networkerror|load failed|network request failed|internet disconnected|the internet connection appears to be offline/i.test(message);
}

function driveErrorMessage(error) {
  if (isNetworkError(error)) {
    return 'Dernier envoi impossible : Google Drive n\'a pas répondu.';
  }
  const message = String((error && error.message) || '').trim();
  return message || 'La copie Drive n\'a pas abouti.';
}

function driveStatusText() {
  const account = readGoogleAccount();
  if (!account.email) return '';
  const when = account.savedAt
    ? `Dernière synchro : ${formatDriveTime(account.savedAt)}.`
    : 'Aucune synchro encore.';
  const problem = account.driveError ? ` ${account.driveError}` : '';
  return `Lié à ${account.email}. ${when}${problem} Réservé à l’administration : ne partagez pas ce Gmail aux revendeurs (utilisez « Inviter »).`;
}

function paintDriveStatus() {
  const line = document.querySelector('[data-drive-status]');
  if (!line) return;
  line.textContent = driveStatusText();
}

function base64url(bytes) {
  let text = '';
  bytes.forEach((value) => { text += String.fromCharCode(value); });
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomVerifier() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function googleFailure(payload, fallback) {
  const err = payload && payload.error;
  let detail = '';
  if (typeof (payload && payload.error_description) === 'string') detail = payload.error_description;
  else if (typeof err === 'string') detail = err;
  else if (err && typeof err === 'object') {
    detail = err.message || err.status || '';
    if (!detail && Array.isArray(err.errors) && err.errors[0]) {
      detail = err.errors[0].message || err.errors[0].reason || '';
    }
  }
  detail = String(detail || '').trim();
  if (/invalid_grant|expired|revoked|invalid_token/i.test(detail)) return 'Reliez votre Gmail.';
  return detail ? `${fallback} ${detail}` : fallback;
}

async function throwIfGoogleFailed(response, fallback) {
  if (response.ok) return;
  const text = await response.text().catch(() => '');
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text.slice(0, 160) };
  }
  throw new Error(googleFailure(payload, `${fallback} (${response.status})`));
}

async function createDriveFile(text) {
  const boundary = `tickets${Date.now()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify({ name: driveFileName, mimeType: 'application/json' }),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    text,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return driveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

function googleAuthUrl(redirect, challenge) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', 'tickets');
  return url.toString();
}

async function googleEmail(accessToken) {
  const response = await googleFetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) await throwIfGoogleFailed(response, 'La liaison Gmail a échoué.');
  const profile = await response.json().catch(() => ({}));
  if (!profile.email) throw new Error('La liaison Gmail a échoué.');
  return profile.email;
}

async function exchangeCode(code, redirect, verifier) {
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  });
  if (typeof GOOGLE_CLIENT_SECRET === 'string' && GOOGLE_CLIENT_SECRET) body.set('client_secret', GOOGLE_CLIENT_SECRET);
  const response = await googleFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) await throwIfGoogleFailed(response, 'La liaison Gmail a échoué.');
  const payload = await response.json().catch(() => ({}));
  if (!payload.access_token) throw new Error('La liaison Gmail a échoué.');
  const previous = readGoogleAccount();
  const account = {
    email: await googleEmail(payload.access_token),
    refreshToken: payload.refresh_token || previous.refreshToken || '',
    accessToken: payload.access_token,
    expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000 - 60000,
    fileId: previous.fileId || '',
    savedAt: previous.savedAt || '',
  };
  writeGoogleAccount(account);
  return account;
}

async function googleAccessToken() {
  const account = readGoogleAccount();
  if (!account.email) throw new Error('Aucune adresse Gmail liée.');
  if (account.accessToken && account.expiresAt > Date.now()) return account.accessToken;
  if (!account.refreshToken) throw new Error('Reliez votre Gmail.');
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    refresh_token: account.refreshToken,
    grant_type: 'refresh_token',
  });
  if (typeof GOOGLE_CLIENT_SECRET === 'string' && GOOGLE_CLIENT_SECRET) body.set('client_secret', GOOGLE_CLIENT_SECRET);
  const response = await googleFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) await throwIfGoogleFailed(response, 'La copie Drive n\'a pas abouti.');
  const payload = await response.json().catch(() => ({}));
  if (!payload.access_token) throw new Error('Reliez votre Gmail.');
  account.accessToken = payload.access_token;
  account.expiresAt = Date.now() + (Number(payload.expires_in) || 3600) * 1000 - 60000;
  writeGoogleAccount(account);
  return account.accessToken;
}

async function driveRequest(url, options = {}) {
  const token = await googleAccessToken();
  const response = await googleFetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new Error('Reliez votre Gmail.');
  return response;
}

async function findDriveFile() {
  const account = readGoogleAccount();
  if (account.fileId) return account.fileId;
  const query = encodeURIComponent(`name = '${driveFileName}' and trashed = false`);
  const response = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,modifiedTime)`);
  await throwIfGoogleFailed(response, 'La copie Drive n\'a pas abouti.');
  const payload = await response.json();
  const files = payload.files || [];
  files.sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
  if (!files[0]) return '';
  account.fileId = files[0].id;
  writeGoogleAccount(account);
  return files[0].id;
}

async function downloadDriveBackup() {
  const fileId = await findDriveFile();
  if (!fileId) return null;
  const response = await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  await throwIfGoogleFailed(response, 'La copie Drive n\'a pas abouti.');
  const snapshot = await response.json();
  if (!snapshot || snapshot.opus !== 1) return null;
  return snapshot;
}

function snapshotHasData(snapshot) {
  return Boolean(snapshot && (snapshot.routers.length || snapshot.resellers.length || snapshot.sales.length));
}

function snapshotIsAdminBackup(snapshot) {
  return Boolean(snapshot && Array.isArray(snapshot.admins) && snapshot.admins.length);
}

async function uploadDriveBackup() {
  if (typeof licenseAllowsDrive === 'function' && !licenseAllowsDrive()) return 'forbidden';
  if (uploadDriveBackup.running) return 'busy';
  const account = readGoogleAccount();
  if (!account.refreshToken && !account.accessToken) return 'nolink';
  if (typeof exportSnapshot !== 'function') return 'nolink';
  const snapshot = await exportSnapshot();
  if (!snapshotIsAdminBackup(snapshot)) return 'empty';
  if (!snapshotHasData(snapshot)) return 'empty';
  uploadDriveBackup.running = true;
  try {
    if (account.driveError) {
      account.driveError = '';
      writeGoogleAccount(account);
      paintDriveStatus();
    }
    const text = JSON.stringify(snapshot);
    let fileId = await findDriveFile();
    let response;
    if (fileId) {
      response = await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      if (response.status === 404 || response.status === 403) {
        const cleared = readGoogleAccount();
        cleared.fileId = '';
        writeGoogleAccount(cleared);
        fileId = '';
        response = await createDriveFile(text);
      }
    } else {
      response = await createDriveFile(text);
    }
    await throwIfGoogleFailed(response, 'La copie Drive n\'a pas abouti.');
    const saved = await response.json().catch(() => ({}));
    const next = readGoogleAccount();
    if (saved.id) next.fileId = saved.id;
    next.savedAt = new Date().toISOString();
    next.driveError = '';
    writeGoogleAccount(next);
    writeSnapshotAt(snapshot.savedAt || next.savedAt);
    paintDriveStatus();
    return 'ok';
  } catch (error) {
    const next = readGoogleAccount();
    if (next.email) {
      next.driveError = driveErrorMessage(error);
      writeGoogleAccount(next);
      paintDriveStatus();
    }
    throw error;
  } finally {
    uploadDriveBackup.running = false;
  }
}

function scheduleDriveBackup() {
  if (typeof licenseAllowsDrive === 'function' && !licenseAllowsDrive()) return;
  if (scheduleDriveBackup.paused) return;
  const account = readGoogleAccount();
  if (!account.refreshToken && !account.accessToken) return;
  markLocalSnapshotDirty();
  clearTimeout(scheduleDriveBackup.timer);
  scheduleDriveBackup.timer = setTimeout(() => {
    uploadDriveBackup().catch((error) => {
      if (typeof showToast !== 'function' || isNetworkError(error)) return;
      showToast(driveErrorMessage(error), 'err');
    });
  }, 4000);
}

async function connectGoogle(options = {}) {
  if (!googleReady()) throw new Error('Le bouton est au bon endroit. Google doit encore accepter l\'application : dites-moi quand ce Gmail est ouvert dans le navigateur.');
  if (options.next) sessionStorage.setItem(oauthNextKey, options.next);
  if (options.restore) sessionStorage.setItem(restoreIntentKey, '1');
  const verifier = randomVerifier();
  sessionStorage.setItem(googleVerifierKey, verifier);
  const challenge = await codeChallenge(verifier);
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RouterOs;
  if (plugin && plugin.googleLogin) {
    const result = await plugin.googleLogin({
      clientId: GOOGLE_CLIENT_ID,
      challenge,
      state: 'tickets',
    });
    await exchangeCode(result.code, result.redirect, verifier);
    sessionStorage.setItem(googleLinkedKey, '1');
    return 'linked';
  }
  location.assign(googleAuthUrl(`${location.origin}/oauth.html`, challenge));
  return 'redirect';
}

async function finishOAuth() {
  const params = new URLSearchParams(location.search);
  const denied = params.get('error_description') || params.get('error') || '';
  if (denied) throw new Error(`La liaison Gmail a échoué. ${denied}`);
  if (params.get('state') && params.get('state') !== 'tickets') throw new Error('La liaison Gmail a échoué.');
  const code = params.get('code') || '';
  const verifier = sessionStorage.getItem(googleVerifierKey) || '';
  if (!code || !verifier) throw new Error('La liaison Gmail a été annulée.');
  sessionStorage.removeItem(googleVerifierKey);
  await exchangeCode(code, `${location.origin}/oauth.html`, verifier);
  sessionStorage.setItem(googleLinkedKey, '1');
}

async function syncDriveNow(options = {}) {
  if (typeof licenseAllowsDrive === 'function' && !licenseAllowsDrive()) return 'forbidden';
  const account = readGoogleAccount();
  if (!account.refreshToken && !account.accessToken) return 'nolink';
  if (syncDriveNow.running) return 'busy';
  syncDriveNow.running = true;
  const wasPaused = scheduleDriveBackup.paused;
  scheduleDriveBackup.paused = true;
  try {
    const remote = await downloadDriveBackup();
    const local = await exportSnapshot();
    const hasLocal = snapshotHasData(local);
    const localAt = readSnapshotAt();
    const remoteAt = remote && remote.savedAt ? String(remote.savedAt) : '';

    if (!remote && hasLocal) {
      await uploadDriveBackup();
      return 'pushed';
    }
    if (remote && !hasLocal) {
      await importSnapshot(remote);
      writeSnapshotAt(remoteAt || new Date().toISOString());
      return 'pulled';
    }
    if (!remote && !hasLocal) return 'empty';

    if (remoteAt && localAt && remoteAt === localAt) return 'same';
    if (remoteAt && (!localAt || remoteAt > localAt)) {
      await importSnapshot(remote);
      writeSnapshotAt(remoteAt);
      return 'pulled';
    }
    if (options.pullOnly) return 'same';
    await uploadDriveBackup();
    return 'pushed';
  } finally {
    scheduleDriveBackup.paused = wasPaused;
    syncDriveNow.running = false;
  }
}

async function restoreFromDriveAccount() {
  const account = readGoogleAccount();
  if (!account.refreshToken && !account.accessToken) {
    throw new Error('Liez d\'abord votre Gmail.');
  }
  const remote = await downloadDriveBackup();
  if (!remote) throw new Error('Aucune copie Tickets-sauvegarde.json trouvée dans ce Drive.');
  scheduleDriveBackup.paused = true;
  try {
    await importSnapshot(remote);
    writeSnapshotAt(remote.savedAt || new Date().toISOString());
  } finally {
    scheduleDriveBackup.paused = false;
  }
  return remote;
}

async function adoptGoogleBackup() {
  if (sessionStorage.getItem(googleLinkedKey) !== '1') {
    return '';
  }
  sessionStorage.removeItem(googleLinkedKey);
  const restoreIntent = sessionStorage.getItem(restoreIntentKey) === '1';
  sessionStorage.removeItem(restoreIntentKey);
  const account = readGoogleAccount();

  if (restoreIntent) {
    await restoreFromDriveAccount();
    showToast('Données restaurées depuis Drive.', 'ok');
    return 'restored';
  }

  const outcome = await syncDriveNow();
  if (outcome === 'pulled') {
    showToast('Données mises à jour depuis Drive.', 'ok');
    return 'restored';
  }
  if (outcome === 'pushed' || outcome === 'uploaded') {
    showToast(`Lié à ${account.email}.`, 'ok');
    return 'uploaded';
  }
  if (outcome === 'empty') {
    showToast(`Lié à ${account.email}. Aucune copie Drive pour l’instant.`, 'ok');
    return 'linked';
  }
  showToast(`Lié à ${account.email}.`, 'ok');
  return outcome || 'linked';
}
