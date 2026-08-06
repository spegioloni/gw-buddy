#!/usr/bin/env node
/**
 * GigraWars Flotten-Kommandozentrale - lokaler Server + API-Bruecke
 *
 * Die GigraWars-API sendet keine CORS-Header, deshalb kann eine per file://
 * geoeffnete HTML-Datei sie nicht direkt aufrufen. Dieses Skript liefert die
 * HTML-Datei aus und reicht Anfragen unter /gw/* an
 * https://<universum>.gigrawars.de/api/* weiter.
 *
 *   node gw-server.mjs
 *   node gw-server.mjs --port 9000 --token uni5-xxxxx
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

/** Token-Quellen in dieser Reihenfolge: --token, GW_TOKEN, gw-token.txt */
function readTokenFile() {
  try {
    return readFileSync(join(HERE, 'gw-token.txt'), 'utf8')
      .split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#')) || '';
  } catch { return ''; }
}

const PORT = Number(argOf('port', process.env.GW_PORT || 8787));
const DEFAULT_TOKEN = argOf('token', process.env.GW_TOKEN || readTokenFile());
const PAGE = 'flotten_analysator.html';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'x-auth-token, content-type, accept',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-expose-headers':
    'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-retry-after, x-gw-server-date',
};

function universeFromToken(token) {
  const m = /^([a-z0-9]+)-/i.exec(token || '');
  return m ? m[1].toLowerCase() : 'uni5';
}

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, Object.assign({}, CORS, headers));
  res.end(body);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (url.pathname === '/gw/health') {
    return send(res, 200, JSON.stringify({ ok: true, hasDefaultToken: !!DEFAULT_TOKEN }), {
      'content-type': 'application/json',
    });
  }

  if (url.pathname.indexOf('/gw/') === 0) {
    const token = req.headers['x-auth-token'] || DEFAULT_TOKEN;
    if (!token) {
      return send(res, 401, JSON.stringify({ detail: 'Kein API-Token uebergeben.' }), {
        'content-type': 'application/json',
      });
    }
    const target =
      'https://' + universeFromToken(token) + '.gigrawars.de/api/' +
      url.pathname.slice('/gw/'.length) + url.search;
    try {
      const upstream = await fetch(target, {
        headers: { accept: 'application/json', 'x-auth-token': token },
      });
      const text = await upstream.text();
      const pass = {};
      for (const h of ['content-type', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-retry-after', 'date']) {
        const v = upstream.headers.get(h);
        if (v) pass[h === 'date' ? 'x-gw-server-date' : h] = v;
      }
      console.log('[api] ' + upstream.status + '  ' + target);
      return send(res, upstream.status, text, pass);
    } catch (err) {
      console.error('[api] Fehler:', err);
      return send(res, 502, JSON.stringify({ detail: String(err) }), {
        'content-type': 'application/json',
      });
    }
  }

  if (url.pathname === '/' || url.pathname === '/' + PAGE) {
    try {
      const html = await readFile(join(HERE, PAGE));
      return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8' });
    } catch {
      return send(res, 404, PAGE + ' nicht gefunden in ' + HERE, {
        'content-type': 'text/plain; charset=utf-8',
      });
    }
  }

  send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
});

server.listen(PORT, () => {
  console.log('\n  GigraWars Kommandozentrale:  http://localhost:' + PORT + '\n');
  console.log('  API-Bruecke:  http://localhost:' + PORT + '/gw/accounts/me');
  console.log('  Token:        ' + (DEFAULT_TOKEN ? DEFAULT_TOKEN.slice(0, 9) + '... (gesetzt)' : 'wird in der Weboberflaeche eingegeben'));
  console.log('\n  Beenden mit Strg+C\n');
});
