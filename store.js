import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { progressFromVTokens, progressFromMcSol, mcSolFromReserves } from './curve.js';
import { LAUNCHPADS, launchpadFrom, CURVE_DEX, AMM_DEX } from './launchpads.js';

/**
 * In-memory list of coins the board knows about.
 * Every coin lands in exactly one column:
 *   new      - launched, bonding curve below FINAL_STRETCH_MIN_PROGRESS
 *   final    - bonding curve at or above that %, not migrated yet
 *   migrated - bonding curve completed and liquidity moved to an AMM
 */
export const bus = new EventEmitter();
const tokens = new Map();

const MAX_TOKENS = 4000;
const NEW_TTL = 45 * 60e3;       // drop quiet New Pairs after 45 min
const FINAL_TTL = 3 * 3600e3;    // drop stalled Final Stretch after 3 h
const MIGRATED_TTL = 6 * 3600e3; // keep migrated coins 6 h

export let solUsd = 0;
export function setSolUsd(v) { if (isFinite(v) && v > 0) solUsd = v; }

function blank(mint) {
  return {
    mint, name: '', symbol: '', uri: '', image: '', description: '',
    twitter: '', telegram: '', website: '',
    creator: '', createdAt: Date.now(), devBuySol: 0,
    vSol: 0, vTokens: 0, mcSol: 0, mcUsd: 0, progress: 0,
    buys: 0, sells: 0, volSol: 0, volUsd: 0, change5m: null,
    lastTradeAt: 0, status: 'new', migratedAt: 0, pool: '', pairAddress: '',
    metaTried: false, dexAt: 0,
    launchpad: 'pump', holders: null, holdersCapped: false, top10Pct: null, devPct: null, devSold: false,
    snipers: 0, safetyAt: 0, _sn: new Map(), _dev: 0,
  };
}

/** Holder stats from lib/safety.js */
export function onSafety(mint, s) {
  const t = tokens.get(mint); if (!t || !s) return;
  t.safetyAt = Date.now();
  if (s.holders !== undefined) { t.holders = s.holders; t.holdersCapped = !!s.holdersCapped; }
  if (s.top10Pct !== undefined) t.top10Pct = s.top10Pct;
  if (s.devPct !== undefined) t.devPct = s.devPct;
}

export function get(mint) { return tokens.get(mint); }
export function all() { return tokens.values(); }

function classify(t) {
  if (t.status === 'migrated') return;
  t.status = t.progress >= config.finalMin ? 'final' : 'new';
}

function recompute(t) {
  if (t.vSol && t.vTokens && (LAUNCHPADS[t.launchpad] || {}).exactCurve) {
    t.mcSol = mcSolFromReserves(t.vSol, t.vTokens);
    t.progress = progressFromVTokens(t.vTokens);
  } else if (t.mcSol) {
    t.progress = progressFromMcSol(t.mcSol);
  }
  if (t.status === 'migrated') t.progress = 100;
  if (solUsd && t.mcSol && !t.mcUsdFromDex) t.mcUsd = t.mcSol * solUsd;
  classify(t);
}

/** A coin was just created on pump.fun. */
export function onCreate(ev) {
  if (!ev || !ev.mint) return;
  const t = tokens.get(ev.mint) || blank(ev.mint);
  t.name = str(ev.name, 64); t.symbol = str(ev.symbol, 20); t.uri = str(ev.uri, 300);
  t.creator = str(ev.traderPublicKey, 64);
  t.devBuySol = +ev.solAmount || 0;
  t.vSol = +ev.vSolInBondingCurve || t.vSol; t.vTokens = +ev.vTokensInBondingCurve || t.vTokens;
  t.mcSol = +ev.marketCapSol || t.mcSol;
  if (ev.pool) t.pool = str(ev.pool, 20);
  t.launchpad = launchpadFrom(ev.pool, ev.mint);
  t._dev = +ev.initialBuy || 0;
  if (ev.devBuy !== false && t.devBuySol > 0) { t.buys += 1; t.volSol += t.devBuySol; }
  t.createdAt = Date.now(); t.lastTradeAt = t.createdAt;
  if (ev.image) t.image = safeUrl(ev.image);
  ['twitter', 'telegram', 'website', 'description'].forEach(k => { if (ev[k]) t[k] = k === 'description' ? str(ev[k], 280) : safeUrl(ev[k]); });
  recompute(t);
  tokens.set(t.mint, t);
  bus.emit('created', t);
  prune();
}

/** A buy or sell on a coin we track (PumpPortal trade feed or the demo feed). */
export function onTrade(ev) {
  const t = tokens.get(ev && ev.mint);
  if (!t) return;
  const sol = +ev.solAmount || 0;
  const who = ev.traderPublicKey, amt = +ev.tokenAmount || 0;
  if (who && who === t.creator) {
    if (ev.txType === 'sell') { t.devSold = true; t._dev = Math.max(0, t._dev - amt); } else t._dev += amt;
  } else if (who) {
    // snipers: wallets that bought within 3 seconds of launch; track what they still hold
    if (ev.txType === 'buy' && Date.now() - t.createdAt < 3000) t._sn.set(who, (t._sn.get(who) || 0) + amt);
    else if (ev.txType === 'sell' && t._sn.has(who)) t._sn.set(who, Math.max(0, t._sn.get(who) - amt));
  }
  if (ev.txType === 'buy') t.buys++; else if (ev.txType === 'sell') t.sells++;
  t.volSol += sol;
  if (ev.vSolInBondingCurve) t.vSol = +ev.vSolInBondingCurve;
  if (ev.vTokensInBondingCurve) t.vTokens = +ev.vTokensInBondingCurve;
  if (ev.marketCapSol) t.mcSol = +ev.marketCapSol;
  t.mcUsdFromDex = false;
  t.lastTradeAt = Date.now();
  recompute(t);
}

/** Bonding curve finished and the coin moved to an AMM pool. */
export function onMigration(ev) {
  if (!ev || !ev.mint) return;
  let t = tokens.get(ev.mint);
  if (!t) { t = blank(ev.mint); t.createdAt = 0; tokens.set(ev.mint, t); }
  t.status = 'migrated'; t.migratedAt = Date.now(); t.progress = 100;
  if (ev.pool) t.pool = str(ev.pool, 20);
  t.lastTradeAt = Date.now();
  bus.emit('migrated', t);
}

/** Market data from DexScreener (used when there is no trade feed, and for migrated coins). */
export function onDex(mint, pair) {
  const t = tokens.get(mint);
  if (!t || !pair) return;
  t.dexAt = Date.now();
  const mcUsd = +(pair.marketCap || pair.fdv) || 0;
  const hasLiveTrades = !!config.pumpPortalKey && t.status !== 'migrated';
  if (mcUsd && !hasLiveTrades) {
    t.mcUsd = mcUsd; t.mcUsdFromDex = true;
    if (solUsd) t.mcSol = mcUsd / solUsd;
    t.vSol = 0; t.vTokens = 0; // fall back to market-cap based progress
  }
  if (pair.volume && !hasLiveTrades) t.volUsd = +pair.volume.h24 || 0;
  if (pair.txns && pair.txns.h24 && !hasLiveTrades) { t.buys = +pair.txns.h24.buys || t.buys; t.sells = +pair.txns.h24.sells || t.sells; }
  if (pair.priceChange && pair.priceChange.m5 !== undefined) t.change5m = +pair.priceChange.m5;
  if (pair.pairAddress) t.pairAddress = str(pair.pairAddress, 64);
  const info = pair.info || {};
  if (!t.image && info.imageUrl) t.image = safeUrl(info.imageUrl);
  for (const s of info.socials || []) {
    if (s.type === 'twitter' && !t.twitter) t.twitter = safeUrl(s.url);
    if (s.type === 'telegram' && !t.telegram) t.telegram = safeUrl(s.url);
  }
  if (!t.website && info.websites && info.websites[0]) t.website = safeUrl(info.websites[0].url);
  if (!t.name && pair.baseToken) { t.name = str(pair.baseToken.name, 64); t.symbol = str(pair.baseToken.symbol, 20); }
  if (pair.pairCreatedAt && !t.createdAt) t.createdAt = +pair.pairCreatedAt;
  const dexId = String(pair.dexId || '');
  if (t.status !== 'migrated' && dexId && !CURVE_DEX.test(dexId) && AMM_DEX.test(dexId)) {
    t.status = 'migrated'; t.migratedAt = t.migratedAt || Date.now();
  }
  recompute(t);
}

/** Name, image and socials from the coin's metadata file. */
export function onMeta(mint, meta) {
  const t = tokens.get(mint);
  if (!t || !meta || typeof meta !== 'object') return;
  if (meta.image) t.image = safeUrl(meta.image);
  if (meta.twitter) t.twitter = safeUrl(meta.twitter);
  if (meta.telegram) t.telegram = safeUrl(meta.telegram);
  if (meta.website) t.website = safeUrl(meta.website);
  if (meta.description) t.description = str(meta.description, 280);
  if (!t.name && meta.name) t.name = str(meta.name, 64);
  if (!t.symbol && meta.symbol) t.symbol = str(meta.symbol, 20);
}

function prune() {
  const now = Date.now();
  for (const [mint, t] of tokens) {
    const quiet = now - (t.lastTradeAt || t.createdAt);
    if ((t.status === 'new' && quiet > NEW_TTL) || (t.status === 'final' && quiet > FINAL_TTL) || (t.status === 'migrated' && now - t.migratedAt > MIGRATED_TTL)) {
      tokens.delete(mint); bus.emit('removed', mint);
    }
  }
  if (tokens.size > MAX_TOKENS) {
    const sorted = [...tokens.values()].filter(t => t.status === 'new').sort((a, b) => a.createdAt - b.createdAt);
    for (const t of sorted.slice(0, tokens.size - MAX_TOKENS)) { tokens.delete(t.mint); bus.emit('removed', t.mint); }
  }
}
setInterval(prune, 30e3).unref();

const pub = t => ({
  mint: t.mint, name: t.name, symbol: t.symbol, image: t.image, description: t.description,
  twitter: t.twitter, telegram: t.telegram, website: t.website, creator: t.creator,
  createdAt: t.createdAt, migratedAt: t.migratedAt, devBuySol: round(t.devBuySol, 3),
  mcSol: round(t.mcSol, 2), mcUsd: Math.round(t.mcUsd || (solUsd ? t.mcSol * solUsd : 0)),
  volUsd: Math.round(t.volUsd || (solUsd ? t.volSol * solUsd : 0)), volSol: round(t.volSol, 2),
  buys: t.buys, sells: t.sells, progress: round(t.progress, 1), change5m: t.change5m,
  status: t.status, pool: t.pool, pairAddress: t.pairAddress,
  launchpad: t.launchpad, progressApprox: !(LAUNCHPADS[t.launchpad] || {}).exactCurve || !(t.vSol && t.vTokens),
  holders: t.holders, holdersCapped: t.holdersCapped,
  top10Pct: t.top10Pct === null ? null : round(t.top10Pct, 1),
  devPct: t.devPct !== null ? round(t.devPct, 1) : (t._dev && t.launchpad === 'pump' ? round(t._dev / 1e7, 1) : null),
  devSold: t.devSold, snipers: t._sn.size,
  sniperPct: t._sn.size ? round([...t._sn.values()].reduce((a, v) => a + v, 0) / 1e7, 1) : null,
});

/** What the browser receives: the three columns. */
export function snapshot() {
  const list = [...tokens.values()];
  const n = config.columnSize;
  const named = t => t.name || t.symbol;
  return {
    at: Date.now(), solUsd: round(solUsd, 2), mock: config.mock, liveTrades: !!config.pumpPortalKey || config.mock,
    finalMin: config.finalMin,
    new: list.filter(t => t.status === 'new' && named(t)).sort((a, b) => b.createdAt - a.createdAt).slice(0, n).map(pub),
    final: list.filter(t => t.status === 'final' && named(t)).sort((a, b) => b.progress - a.progress || b.lastTradeAt - a.lastTradeAt).slice(0, n).map(pub),
    migrated: list.filter(t => t.status === 'migrated').sort((a, b) => b.migratedAt - a.migratedAt).slice(0, n).map(pub),
  };
}

export function publicToken(mint) { const t = tokens.get(mint); return t ? pub(t) : null; }

function round(v, d) { const f = 10 ** d; return Math.round((+v || 0) * f) / f; }
function str(v, max) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : ''; }
export function safeUrl(u) {
  if (typeof u !== 'string') return '';
  u = u.trim();
  if (u.startsWith('ipfs://')) u = config.ipfsGateway + u.slice(7);
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href.slice(0, 400) : ''; } catch { return ''; }
}
