import { config } from './config.js';
import { rpc, budget } from './rpc.js';
import * as store from './store.js';

/**
 * Safety stats for coins on the board:
 *   holders   - wallets holding the coin (needs HELIUS_API_KEY)
 *   top10Pct  - % of supply held by the 10 biggest wallets, not counting the bonding curve / pool
 *   devPct    - % of supply the creator's wallet still holds
 * Snipers and "dev sold" come from the live trade feed (see store.onTrade).
 *
 * Calls are spread out with a per-second budget (SAFETY_RPS) so a public RPC isn't flooded.
 */
const take = budget(Math.max(1, config.safetyRps));
const supplyCache = new Map(); // mint -> { raw: BigInt-ish number, decimals }
const HOLDER_PAGES = 3;        // Helius pages of 1000 accounts -> "3000+" cap
let running = 0;

async function supplyOf(mint) {
  if (supplyCache.has(mint)) return supplyCache.get(mint);
  await take();
  const r = await rpc('getTokenSupply', [mint]);
  const v = { raw: +r.value.amount, decimals: r.value.decimals };
  supplyCache.set(mint, v); if (supplyCache.size > 6000) supplyCache.clear();
  return v;
}

// Helius DAS: every token account with its owner, so one method gives holders, top 10 and dev share.
async function viaHelius(t) {
  const owners = new Map(); let capped = false;
  for (let page = 1; page <= HOLDER_PAGES; page++) {
    await take();
    const r = await rpc('getTokenAccounts', { mint: t.mint, page, limit: 1000 });
    const list = (r && r.token_accounts) || [];
    for (const a of list) if (+a.amount > 0) owners.set(a.owner, (owners.get(a.owner) || 0) + +a.amount);
    if (list.length < 1000) break;
    if (page === HOLDER_PAGES) capped = true;
  }
  const sup = await supplyOf(t.mint);
  const sorted = [...owners.entries()].sort((a, b) => b[1] - a[1]);
  // the biggest holder before migration is the bonding curve, after migration usually the pool
  const rest = sorted.slice(1);
  const top10 = rest.slice(0, 10).reduce((a, [, v]) => a + v, 0);
  const dev = t.creator ? owners.get(t.creator) || 0 : 0;
  return { holders: Math.max(0, owners.size - 1), holdersCapped: capped, top10Pct: sup.raw ? (top10 / sup.raw) * 100 : null, devPct: sup.raw ? (dev / sup.raw) * 100 : null };
}

// Any Solana RPC: largest 20 accounts + the creator's balance. No holder count.
async function viaRpc(t) {
  await take();
  const largest = await rpc('getTokenLargestAccounts', [t.mint, { commitment: 'confirmed' }]);
  const sup = await supplyOf(t.mint);
  const amounts = ((largest && largest.value) || []).map(a => +a.amount).sort((a, b) => b - a);
  const top10 = amounts.slice(1, 11).reduce((a, v) => a + v, 0);
  let devPct = null;
  if (t.creator) {
    await take();
    const acc = await rpc('getTokenAccountsByOwner', [t.creator, { mint: t.mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    const dev = ((acc && acc.value) || []).reduce((a, x) => a + (+(x.account.data.parsed.info.tokenAmount.amount) || 0), 0);
    devPct = sup.raw ? (dev / sup.raw) * 100 : null;
  }
  return { top10Pct: sup.raw ? (top10 / sup.raw) * 100 : null, devPct };
}

function due(t, now) {
  const age = now - (t.createdAt || 0);
  if (age < 10e3) return false; // let the coin settle first
  const every = t.status === 'final' ? 20e3 : t.status === 'migrated' ? 60e3 : 45e3;
  return now - t.safetyAt > every;
}

async function tick() {
  if (running >= Math.max(1, Math.floor(config.safetyRps / 2))) return;
  const now = Date.now();
  const rank = t => (t.status === 'final' ? 0 : t.status === 'migrated' ? 1 : 2);
  const next = [...store.all()].filter(t => (t.name || t.symbol) && due(t, now)).sort((a, b) => rank(a) - rank(b) || a.safetyAt - b.safetyAt)[0];
  if (!next) return;
  next.safetyAt = now; running++;
  try { store.onSafety(next.mint, config.heliusKey ? await viaHelius(next) : await viaRpc(next)); }
  catch (e) { if (e.rateLimited) next.safetyAt = now + 30e3; }
  finally { running--; }
}

export function start() {
  if (config.mock) return;
  setInterval(() => { tick().catch(() => {}); }, 250).unref();
}
