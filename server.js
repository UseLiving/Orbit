import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './lib/config.js';
import * as store from './lib/store.js';
import * as market from './lib/market.js';
import * as enrich from './lib/enrich.js';
import * as pumpportal from './lib/pumpportal.js';
import * as mock from './lib/mock.js';
import * as safety from './lib/safety.js';
import * as chainwatch from './lib/chainwatch.js';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https: http:",
  "connect-src 'self'",
  "frame-src https://dexscreener.com",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'content-type': type, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const fail = (res, code, error) => send(res, code, { error });

async function readBody(req, limit = 16384) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Request too large'), { code: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw Object.assign(new Error('Body must be JSON'), { code: 400 }); }
}

// small per-IP limiter for the trade endpoints
const hits = new Map();
function limited(req, max = 30, windowMs = 60e3) {
  const ip = req.socket.remoteAddress || 'x'; const now = Date.now();
  const h = (hits.get(ip) || []).filter(t => now - t < windowMs); h.push(now); hits.set(ip, h);
  return h.length > max;
}
setInterval(() => hits.clear(), 10 * 60e3).unref();

/* ---------- live Radar stream (Server-Sent Events) ---------- */
const clients = new Set();
setInterval(() => {
  if (!clients.size) return;
  const data = `data: ${JSON.stringify(store.snapshot())}\n\n`;
  for (const res of clients) res.write(data);
}, 1000).unref();
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20e3).unref();

/* ---------- trading: build an unsigned transaction for the user's wallet ---------- */
// The server never sees a private key. PumpPortal's local-transaction API returns a
// serialized transaction; the browser asks the user's wallet to sign and send it.
async function buildTradeTx(b) {
  const action = b.action === 'sell' ? 'sell' : b.action === 'buy' ? 'buy' : null;
  if (!action) throw Object.assign(new Error('action must be buy or sell'), { code: 400 });
  if (!B58.test(String(b.publicKey))) throw Object.assign(new Error('Connect a Solana wallet first'), { code: 400 });
  if (!B58.test(String(b.mint))) throw Object.assign(new Error('Unknown coin address'), { code: 400 });
  const denominatedInSol = action === 'buy';
  let amount;
  if (action === 'buy') {
    amount = +b.amount;
    if (!(amount > 0 && amount <= 100)) throw Object.assign(new Error('Buy amount must be between 0 and 100 SOL'), { code: 400 });
  } else {
    const pct = String(b.amount).match(/^(\d{1,3})%$/);
    if (!pct || +pct[1] < 1 || +pct[1] > 100) throw Object.assign(new Error('Sell amount must be a percent like 50%'), { code: 400 });
    amount = `${+pct[1]}%`;
  }
  const slippage = Math.min(50, Math.max(0.5, +b.slippage || 15));
  const priorityFee = Math.min(0.05, Math.max(0, +b.priorityFee || 0.0005));
  const pool = ['pump', 'pump-amm', 'raydium', 'bonk', 'launchlab', 'raydium-cpmm', 'auto'].includes(b.pool) ? b.pool : 'auto';
  const r = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: b.publicKey, action, mint: b.mint, amount, denominatedInSol: String(denominatedInSol), slippage, priorityFee, pool }),
  });
  if (!r.ok) { const t = (await r.text()).slice(0, 200); throw Object.assign(new Error(t || `Trade service error (${r.status})`), { code: 502 }); }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 100 || buf.length > 2000) throw Object.assign(new Error('Trade service returned an unexpected transaction'), { code: 502 });
  return buf.toString('base64');
}

async function sendSigned(b) {
  const tx = String(b.tx || '');
  if (!/^[A-Za-z0-9+/=]{100,3000}$/.test(tx)) throw Object.assign(new Error('Bad transaction'), { code: 400 });
  const r = await fetch(config.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [tx, { encoding: 'base64', maxRetries: 3 }] }) });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw Object.assign(new Error(j.error.message || 'RPC refused the transaction'), { code: 502 });
  if (!j.result) throw Object.assign(new Error('RPC did not return a signature'), { code: 502 });
  return j.result;
}

/* ---------- routes ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/api/status') {
      return send(res, 200, { mock: config.mock, liveTrades: !!config.pumpPortalKey || config.mock, feedConnected: config.mock || pumpportal.status.connected, dex: enrich.dexStatus, solUsd: store.solUsd, extraLaunchpads: config.extraLaunchpads ? chainwatch.status : 'off', holders: !!config.heliusKey });
    }
    if (req.method === 'GET' && p === '/api/pulse') return send(res, 200, store.snapshot());
    if (req.method === 'GET' && p === '/api/pulse/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`retry: 3000\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'GET' && p.startsWith('/api/token/')) {
      const mint = p.slice(11);
      if (!B58.test(mint)) return fail(res, 400, 'Unknown coin address');
      const t = store.publicToken(mint);
      return t ? send(res, 200, t) : fail(res, 404, 'This coin is no longer on the board');
    }
    if (req.method === 'GET' && p === '/api/market') {
      const t = await market.getTickers();
      return send(res, 200, { at: t.at, mock: config.mock, tickers: t.list });
    }
    if (req.method === 'GET' && p === '/api/candles') {
      const s = String(url.searchParams.get('s') || '').toUpperCase();
      if (!market.COINS.includes(s)) return fail(res, 400, 'Unknown coin');
      return send(res, 200, await market.getCandles(s));
    }
    if (req.method === 'POST' && p === '/api/trade-tx') {
      if (config.mock) return fail(res, 403, 'Trading is off in demo mode. Every coin on the board is made up.');
      if (limited(req)) return fail(res, 429, 'Too many trade requests. Wait a minute and try again.');
      return send(res, 200, { tx: await buildTradeTx(await readBody(req)) });
    }
    if (req.method === 'POST' && p === '/api/send') {
      if (config.mock) return fail(res, 403, 'Trading is off in demo mode.');
      if (limited(req)) return fail(res, 429, 'Too many requests. Wait a minute and try again.');
      return send(res, 200, { signature: await sendSigned(await readBody(req, 8192)) });
    }
    if (p.startsWith('/api/')) return fail(res, 404, 'Not found');

    // static files
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed');
    if (p === '/pulse' || p === '/liftoff') { res.writeHead(301, { location: '/radar' }); return res.end(); }
    let file = p === '/' ? 'index.html' : p === '/radar' ? 'radar.html' : decodeURIComponent(p.slice(1));
    const full = normalize(join(PUBLIC, file));
    if (!full.startsWith(PUBLIC.endsWith(sep) ? PUBLIC : PUBLIC + sep)) return fail(res, 403, 'Forbidden');
    const body = await readFile(full).catch(() => null);
    if (!body) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, body, TYPES[extname(full)] || 'application/octet-stream', { 'content-security-policy': CSP, 'cache-control': 'no-cache' });
  } catch (e) {
    const code = e.code >= 400 && e.code < 600 ? e.code : 500;
    if (code === 500) console.error(e);
    fail(res, code, code === 500 ? 'Something went wrong on the server' : e.message);
  }
});

market.start();
enrich.start();
safety.start();
if (config.mock) mock.start(); else { pumpportal.start(); chainwatch.start(); }
server.listen(config.port, () => {
  console.log(`Orbit running on http://localhost:${config.port}${config.mock ? '  (DEMO MODE: simulated coins, trading off)' : ''}`);
});
