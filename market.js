import { config } from './config.js';
import { setSolUsd } from './store.js';

// Major coins for the Market section, priced by Crypto.com Exchange's public API.
export const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'LTC', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'BCH', 'SHIB'];
const API = 'https://api.crypto.com/exchange/v1/public';

let tickers = { at: 0, list: [] };
const candleCache = new Map();

async function getJson(url) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(timer); }
}

// Shapes match what the page expects: last, change (fraction), high, low, volume_value, best_bid, best_ask, timestamp
async function refreshTickers() {
  if (config.mock) { tickers = { at: Date.now(), list: mockTickers() }; return; }
  const j = await getJson(`${API}/get-tickers`);
  const rows = (j && j.result && j.result.data) || [];
  const want = new Set(COINS.map(c => c + '_USD'));
  const list = rows.filter(r => want.has(r.i)).map(r => ({
    s: r.i.split('_')[0], last: r.a, change: r.c, high: r.h, low: r.l,
    volume_value: r.vv, best_bid: r.b, best_ask: r.k, timestamp: r.t ? new Date(+r.t).toISOString() : null,
  }));
  if (list.length) tickers = { at: Date.now(), list };
}

export async function getTickers() {
  if (Date.now() - tickers.at > 15e3) { try { await refreshTickers(); } catch (e) { if (!tickers.list.length) throw e; } }
  const sol = tickers.list.find(t => t.s === 'SOL');
  if (sol) setSolUsd(+sol.last);
  return tickers;
}

export async function getCandles(sym) {
  if (!COINS.includes(sym)) throw new Error('unknown coin');
  const hit = candleCache.get(sym);
  if (hit && Date.now() - hit.at < 60e3) return hit;
  let data;
  if (config.mock) data = mockCandles(sym);
  else {
    const j = await getJson(`${API}/get-candlestick?instrument_name=${sym}_USD&timeframe=1h&count=48`);
    data = ((j && j.result && j.result.data) || []).map(k => ({ open: k.o, high: k.h, low: k.l, close: k.c, timestamp: new Date(+k.t).toISOString() }));
  }
  const out = { at: Date.now(), data };
  candleCache.set(sym, out);
  return out;
}

export function start() {
  const tick = () => getTickers().catch(e => console.warn('[market]', e.message));
  tick(); setInterval(tick, 20e3).unref();
}

/* ---------- demo-mode prices (clearly fake) ---------- */
const BASE = { BTC: 80000, ETH: 3000, SOL: 150, XRP: 1.2, LTC: 70, DOGE: 0.1, ADA: 0.3, AVAX: 12, LINK: 13, DOT: 1.5, BCH: 300, SHIB: 0.0000055 };
const walk = {};
function mockTickers() {
  return COINS.map(s => {
    walk[s] = (walk[s] || 1) * (1 + (Math.random() - 0.5) * 0.004);
    const last = BASE[s] * walk[s];
    return { s, last: last.toPrecision(6), change: ((walk[s] - 1)).toFixed(4), high: (last * 1.03).toPrecision(6), low: (last * 0.97).toPrecision(6), volume_value: String(Math.round(1e6 + Math.random() * 5e7)), best_bid: (last * 0.9999).toPrecision(6), best_ask: (last * 1.0001).toPrecision(6), timestamp: new Date().toISOString() };
  });
}
function mockCandles(sym) {
  let p = BASE[sym]; const out = []; const now = Date.now();
  for (let i = 47; i >= 0; i--) { const o = p; p = p * (1 + (Math.random() - 0.5) * 0.02); out.push({ open: o, high: Math.max(o, p) * 1.004, low: Math.min(o, p) * 0.996, close: p, timestamp: new Date(now - i * 36e5).toISOString() }); }
  return out;
}
