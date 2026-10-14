import { config } from './config.js';
import { PROGRAMS, launchpadFrom } from './launchpads.js';
import { rpc } from './rpc.js';
import * as store from './store.js';

/**
 * Watches launchpad programs on-chain (Meteora DBC, Raydium LaunchLab) for new coins.
 * Uses the RPC's websocket `logsSubscribe`, then reads each creation transaction to find
 * the new mint and its creator. Names and images arrive from Helius (if set) or DexScreener.
 */
const SKIP_MINTS = new Set(['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB']);
const seen = new Set();
export const status = { connected: false, creates: 0, errors: 0 };
let ws, backoff = 2000;

async function handleCreate(sig, prog) {
  if (seen.has(sig)) return; seen.add(sig); if (seen.size > 5000) seen.clear();
  let tx;
  for (let i = 0; i < 3 && !tx; i++) {
    try { tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]); } catch { status.errors++; }
    if (!tx) await new Promise(r => setTimeout(r, 1500));
  }
  if (!tx || !tx.meta || tx.meta.err) return;
  const counts = new Map();
  for (const b of tx.meta.postTokenBalances || []) if (!SKIP_MINTS.has(b.mint)) counts.set(b.mint, (counts.get(b.mint) || 0) + 1);
  const mint = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!mint || store.get(mint)) return;
  const keys = tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys || [];
  const creator = keys[0] && (keys[0].pubkey || keys[0]);
  status.creates++;
  store.onCreate({ mint, name: '', symbol: '', uri: '', traderPublicKey: String(creator || ''), solAmount: 0, pool: prog.launchpad === 'meteora' ? 'meteora' : prog.launchpad, devBuy: false });
  if (config.heliusKey) { // name / symbol / image straight away
    try {
      const a = await rpc('getAsset', { id: mint });
      const c = a && a.content || {};
      store.onMeta(mint, { name: c.metadata && c.metadata.name, symbol: c.metadata && c.metadata.symbol, image: (c.links && c.links.image) || (c.files && c.files[0] && c.files[0].uri) });
      const t = store.get(mint); if (t && c.json_uri && !t.uri) { t.uri = store.safeUrl(c.json_uri); store.bus.emit('created', t); }
    } catch {}
  }
}

function connect() {
  ws = new WebSocket(config.wsUrl);
  ws.addEventListener('open', () => {
    status.connected = true; backoff = 2000;
    console.log('[chainwatch] watching ' + PROGRAMS.map(p => p.launchpad).join(', '));
    PROGRAMS.forEach((p, i) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 100 + i, method: 'logsSubscribe', params: [{ mentions: [p.id] }, { commitment: 'confirmed' }] })));
  });
  const subs = new Map();
  ws.addEventListener('message', e => {
    let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString()); } catch { return; }
    if (m.id >= 100 && m.result !== undefined) { subs.set(m.result, PROGRAMS[m.id - 100]); return; }
    if (m.method !== 'logsNotification') return;
    const prog = subs.get(m.params && m.params.subscription); const v = m.params && m.params.result && m.params.result.value;
    if (!prog || !v || v.err) return;
    if ((v.logs || []).some(l => prog.create.test(l))) handleCreate(v.signature, prog).catch(() => { status.errors++; });
  });
  ws.addEventListener('close', () => { status.connected = false; setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000); });
  ws.addEventListener('error', () => { try { ws.close(); } catch {} });
}

export function start() {
  if (!config.extraLaunchpads) return;
  connect();
}
export { launchpadFrom };
