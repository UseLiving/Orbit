import { config } from './config.js';

let id = 0;
/** Plain JSON-RPC call to the configured Solana RPC. Throws on RPC errors. */
export async function rpc(method, params, ms = 10000) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(config.rpcUrl, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    if (r.status === 429) throw Object.assign(new Error('RPC rate limit'), { rateLimited: true });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'RPC error');
    return j.result;
  } finally { clearTimeout(timer); }
}

/** Simple request budget: at most `rps` calls per second, shared by everyone who awaits it. */
export function budget(rps) {
  let tokens = rps, waiting = [];
  setInterval(() => { tokens = rps; while (tokens > 0 && waiting.length) { tokens--; waiting.shift()(); } }, 1000).unref();
  return () => new Promise(res => { if (tokens > 0) { tokens--; res(); } else waiting.push(res); });
}
