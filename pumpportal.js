import { config } from './config.js';
import * as store from './store.js';

/**
 * Live pump.fun feed from PumpPortal (wss://pumpportal.fun/api/data).
 * Free:   subscribeNewToken, subscribeMigration
 * Metered (needs PUMPPORTAL_API_KEY): subscribeTokenTrade for every coin on the board
 */
const URL_BASE = 'wss://pumpportal.fun/api/data';
let ws = null, backoff = 1000, pendingSub = new Set(), pendingUnsub = new Set();
export const status = { connected: false, lastMessageAt: 0, reconnects: 0 };

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function connect() {
  const url = config.pumpPortalKey ? `${URL_BASE}?api-key=${encodeURIComponent(config.pumpPortalKey)}` : URL_BASE;
  ws = new WebSocket(url);
  ws.addEventListener('open', () => {
    status.connected = true; backoff = 1000;
    console.log('[pumpportal] connected' + (config.pumpPortalKey ? ' (live trades on)' : ''));
    send({ method: 'subscribeNewToken' });
    send({ method: 'subscribeMigration' });
    if (config.pumpPortalKey) {
      const keys = [...store.all()].filter(t => t.status !== 'migrated').map(t => t.mint);
      for (let i = 0; i < keys.length; i += 1000) send({ method: 'subscribeTokenTrade', keys: keys.slice(i, i + 1000) });
    }
  });
  ws.addEventListener('message', e => {
    status.lastMessageAt = Date.now();
    let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString()); } catch { return; }
    if (!m || typeof m !== 'object' || m.message || m.errors) { if (m && m.errors) console.warn('[pumpportal]', m.errors); return; }
    const tx = m.txType;
    if (tx === 'create') store.onCreate(m);
    else if (tx === 'buy' || tx === 'sell') store.onTrade(m);
    else if (tx === 'migrate' || (!tx && m.mint)) store.onMigration(m);
  });
  ws.addEventListener('close', () => {
    status.connected = false; status.reconnects++;
    console.warn(`[pumpportal] disconnected, retrying in ${Math.round(backoff / 1000)}s`);
    setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000);
  });
  ws.addEventListener('error', () => { try { ws.close(); } catch {} });
}

export function start() {
  connect();
  if (config.pumpPortalKey) {
    store.bus.on('created', t => { pendingSub.add(t.mint); });
    store.bus.on('migrated', t => { pendingUnsub.add(t.mint); });
    store.bus.on('removed', mint => { pendingUnsub.add(mint); pendingSub.delete(mint); });
    setInterval(() => {
      if (pendingSub.size) { send({ method: 'subscribeTokenTrade', keys: [...pendingSub] }); pendingSub.clear(); }
      if (pendingUnsub.size) { send({ method: 'unsubscribeTokenTrade', keys: [...pendingUnsub] }); pendingUnsub.clear(); }
    }, 1000).unref();
  }
}
