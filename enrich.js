import { config } from './config.js';
import * as store from './store.js';

/* ---------- token metadata (image, socials) ---------- */
const metaQueue = [];
let metaActive = 0;
const META_CONCURRENCY = 6;

function gatewayUrl(uri) {
  const u = store.safeUrl(uri);
  if (!u) return '';
  const i = u.indexOf('/ipfs/');
  return i >= 0 ? config.ipfsGateway + u.slice(i + 6) : u;
}

async function fetchJson(url, ms = 5000, maxBytes = 65536) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const text = await r.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text);
  } catch { return null; } finally { clearTimeout(timer); }
}

function pumpMeta() {
  while (metaActive < META_CONCURRENCY && metaQueue.length) {
    const mint = metaQueue.shift();
    const t = store.get(mint);
    if (!t || !t.uri) continue;
    metaActive++;
    fetchJson(gatewayUrl(t.uri)).then(meta => { if (meta) store.onMeta(mint, meta); })
      .finally(() => { metaActive--; pumpMeta(); });
  }
}

/* ---------- DexScreener market data ---------- */
// GET https://api.dexscreener.com/tokens/v1/solana/{up to 30 comma-separated mints}
const DEX_BATCH = 30;
export const dexStatus = { lastOkAt: 0, lastError: '' };

async function dexTick() {
  const now = Date.now();
  const live = !!config.pumpPortalKey;
  const candidates = [...store.all()].filter(t => {
    const age = now - (t.createdAt || 0);
    if (t.status === 'migrated') return now - t.dexAt > 15e3;
    if (live) return !t.image && age > 20e3 && now - t.dexAt > 60e3; // only fill in images/socials
    return age > 8e3 && now - t.dexAt > (t.status === 'final' ? 6e3 : 12e3);
  });
  if (!candidates.length) return;
  // final stretch + migrated first, then the freshest new pairs
  const rank = t => (t.status === 'final' ? 0 : t.status === 'migrated' ? 1 : 2);
  candidates.sort((a, b) => rank(a) - rank(b) || a.dexAt - b.dexAt);
  const batch = candidates.slice(0, DEX_BATCH);
  batch.forEach(t => { t.dexAt = now; });
  const data = await fetchJson(`https://api.dexscreener.com/tokens/v1/solana/${batch.map(t => t.mint).join(',')}`, 8000, 4_000_000);
  if (!Array.isArray(data)) { dexStatus.lastError = 'DexScreener did not answer'; return; }
  dexStatus.lastOkAt = Date.now(); dexStatus.lastError = '';
  const best = new Map();
  for (const p of data) {
    const mint = p && p.baseToken && p.baseToken.address;
    if (!mint) continue;
    const cur = best.get(mint);
    const liq = (p.liquidity && +p.liquidity.usd) || 0;
    if (!cur || liq > ((cur.liquidity && +cur.liquidity.usd) || 0)) best.set(mint, p);
  }
  for (const [mint, p] of best) store.onDex(mint, p);
}

export function start() {
  store.bus.on('created', t => { if (t.uri && !t.metaTried) { t.metaTried = true; metaQueue.push(t.mint); pumpMeta(); } });
  if (config.mock) return; // demo coins don't exist on DexScreener
  setInterval(() => { dexTick().catch(e => { dexStatus.lastError = String(e.message || e); }); }, 2000).unref();
}
