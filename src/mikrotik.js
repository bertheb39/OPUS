import net from 'node:net';
import { encodeSentence, takeSentence, wordsToRecord } from './protocol.js';

function networkMessage(error) {
  if (error?.code === 'ECONNREFUSED') {
    return 'Impossible de joindre le routeur : le port API est fermé.';
  }
  if (error?.code === 'ETIMEDOUT' || error?.code === 'EHOSTUNREACH' || error?.code === 'ENETUNREACH') {
    return 'Impossible de joindre le routeur. Vérifiez l\'adresse (Wi-Fi ou VPN) et la connexion.';
  }
  if (error?.code === 'ENOTFOUND') return 'Adresse du routeur introuvable.';
  return 'Impossible de joindre le routeur.';
}

export function runCommands(router, commands, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const port = Number(router.port) || 8728;
    const socket = net.connect({ host: router.host, port });
    socket.setNoDelay(true);
    const state = { buf: Buffer.alloc(0) };
    const queue = [
      ['/login', `=name=${router.username}`, `=password=${router.password}`],
      ...commands,
    ];
    const results = [];
    let step = 0;
    let current = null;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      const error = new Error('Le routeur ne répond pas.');
      error.code = 'TIMEOUT';
      finish(error);
    }, timeoutMs);

    const sendNext = () => {
      if (step >= queue.length) {
        finish(null, results.slice(1));
        return;
      }
      current = { rows: [] };
      socket.write(encodeSentence(queue[step]));
    };

    socket.on('connect', sendNext);
    socket.on('error', (error) => {
      const wrapped = new Error(networkMessage(error));
      wrapped.code = 'NETWORK';
      finish(wrapped);
    });
    socket.on('close', () => {
      if (settled) return;
      const error = new Error('La connexion au routeur a été coupée.');
      error.code = 'NETWORK';
      finish(error);
    });
    socket.on('data', (chunk) => {
      try {
        state.buf = Buffer.concat([state.buf, chunk]);
        let words = takeSentence(state);
        while (words) {
          const kind = words[0];
          if (kind === '!re') {
            current?.rows.push(wordsToRecord(words));
          } else if (kind === '!done') {
            results.push({ rows: current?.rows || [], done: wordsToRecord(words) });
            current = null;
            step += 1;
            sendNext();
          } else if (kind === '!trap' || kind === '!fatal') {
            const info = wordsToRecord(words);
            const message = /invalid user name or password/i.test(info.message || '')
              ? 'Connexion au routeur refusée. Vérifiez l\'utilisateur API et le mot de passe.'
              : (info.message || 'Le routeur a refusé la commande.');
            const error = new Error(message);
            error.code = 'TRAP';
            finish(error);
            return;
          }
          words = takeSentence(state);
        }
      } catch (error) {
        finish(error);
      }
    });
  });
}

export async function testRouter(router) {
  const results = await runCommands(router, [['/system/identity/print']]);
  return { identity: results[0]?.rows?.[0]?.name || '' };
}

export async function fetchProfiles(router) {
  const results = await runCommands(router, [['/ip/hotspot/user/profile/print']]);
  return (results[0]?.rows || [])
    .filter((row) => row.name)
    .map((row) => ({
      name: row.name,
      onLogin: row['on-login'] || '',
      rateLimit: row['rate-limit'] || '',
    }));
}

export async function hotspotUserExists(router, name) {
  const results = await runCommands(router, [[
    '/ip/hotspot/user/print',
    `?name=${name}`,
    '=.proplist=name',
  ]]);
  return (results[0]?.rows || []).length > 0;
}

export async function createHotspotUser(router, user) {
  await runCommands(router, [[
    '/ip/hotspot/user/add',
    `=name=${user.name}`,
    `=password=${user.password}`,
    `=profile=${user.profile}`,
    `=limit-uptime=${user.limitUptime}`,
    `=comment=${user.comment}`,
  ]]);
}

export async function removeHotspotUser(router, name) {
  const results = await runCommands(router, [[
    '/ip/hotspot/user/print',
    `?name=${name}`,
    '=.proplist=.id',
  ]]);
  const id = results[0]?.rows?.[0]?.['.id'];
  if (!id) return;
  await runCommands(router, [[
    '/ip/hotspot/user/remove',
    `=.id=${id}`,
  ]]);
}
