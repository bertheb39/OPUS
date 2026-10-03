import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { runCommands } from './mikrotik.js';

function assertGoogleUrl(value) {
  const url = new URL(String(value || ''));
  if (!/(^|\.)googleapis\.com$/i.test(url.hostname)) {
    throw new Error('Adresse Google non autorisée.');
  }
  return url.toString();
}

function freePort(preferred) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => {
      const fallback = createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const { port } = fallback.address();
        fallback.close(() => resolve(port));
      });
    });
    probe.listen(preferred, '127.0.0.1', () => {
      probe.close(() => resolve(preferred));
    });
  });
}

export async function startPcServer(options = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = options.root || join(here, '..', 'public');
  const port = await freePort(Number(options.port) || 4173);
  const app = express();

  app.post('/api/router', express.json({ limit: '1mb' }), async (request, response) => {
    const body = request.body || {};
    const host = String(body.host || '').trim();
    const commands = body.commands;
    if (!host || !Array.isArray(commands)) {
      response.status(400).json({ error: 'Indiquez l\'adresse du routeur.' });
      return;
    }
    try {
      const results = await runCommands({
        host,
        port: Number(body.port) || 8728,
        username: String(body.username || ''),
        password: String(body.password || ''),
      }, commands, Number(body.timeout) || 15000);
      response.json({ results });
    } catch (error) {
      response.status(502).json({ error: error.message || 'Impossible de joindre le routeur.' });
    }
  });

  app.post('/api/google/fetch', express.json({ limit: '25mb' }), async (request, response) => {
    try {
      const target = assertGoogleUrl(request.body && request.body.url);
      const method = String((request.body && request.body.method) || 'GET').toUpperCase();
      const headers = { ...((request.body && request.body.headers) || {}) };
      delete headers.host;
      delete headers.Host;
      const upstream = await fetch(target, {
        method,
        headers,
        body: request.body && request.body.body != null ? String(request.body.body) : undefined,
      });
      const buffer = Buffer.from(await upstream.arrayBuffer());
      response.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) response.setHeader('content-type', contentType);
      response.send(buffer);
    } catch (error) {
      response.status(502).json({ error: error.message || 'Google Drive n\'a pas répondu depuis le PC.' });
    }
  });

  app.use(express.static(root));

  const server = await new Promise((resolve, reject) => {
    const httpServer = app.listen(port, '127.0.0.1', () => resolve(httpServer));
    httpServer.on('error', reject);
  });

  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
  };
}
