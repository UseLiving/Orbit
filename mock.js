import * as store from './store.js';
import { K, V_SOL0, V_TOKENS0 } from './curve.js';

// Simulated launches for MOCK=1 (preview without internet). Every coin here is made up.
const A = ['Moon', 'Based', 'Tiny', 'Pixel', 'Giga', 'Sleepy', 'Turbo', 'Cosmic', 'Wet', 'Angry', 'Lucky', 'Frozen', 'Sir', 'Baby', 'Dark', 'Holy', 'Rich', 'Lazy', 'Orbit', 'Neon'];
const B = ['Frog', 'Cat', 'Dog', 'Pepe', 'Hamster', 'Goose', 'Banana', 'Rock', 'Whale', 'Duck', 'Otter', 'Toast', 'Wizard', 'Penguin', 'Capybara', 'Gremlin', 'Crab', 'Squid', 'Taco', 'Comet'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const rnd = n => Array.from({ length: n }, () => B58[Math.floor(Math.random() * 58)]).join('');
const pick = a => a[Math.floor(Math.random() * a.length)];
const live = new Map(); // mint -> {vSol, hype}

function launch() {
  const name = `${pick(A)} ${pick(B)}`;
  const symbol = name.split(' ').map(w => w.slice(0, Math.random() < .5 ? 2 : 3)).join('').toUpperCase();
  const mint0 = rnd(40) + 'pump';
  const dev = +(Math.random() * 2.5).toFixed(2);
  const vSol = V_SOL0 + dev, vTokens = K / vSol;
  let mint = mint0;
  const r = Math.random(); const pool = r < .7 ? 'pump' : r < .85 ? 'bonk' : r < .93 ? 'meteora' : 'launchlab';
  const creator = rnd(44);
  if (pool === 'bonk' || pool === 'launchlab') mint = rnd(40) + 'bonk';
  if (pool === 'meteora' && Math.random() < .5) mint = rnd(40) + 'BAGS';
  store.onCreate({ mint, name, symbol, uri: '', traderPublicKey: creator, solAmount: dev, initialBuy: V_TOKENS0 - vTokens, vSolInBondingCurve: vSol, vTokensInBondingCurve: vTokens, marketCapSol: vSol / vTokens * 1e9, pool });
  live.set(mint, { vSol, creator, hype: Math.random() < 0.12 ? 2 + Math.random() * 3 : Math.random(), wallets: Array.from({ length: 8 }, () => rnd(44)), rug: Math.random() < .15 });
}

function trade() {
  const keys = [...live.keys()];
  for (let i = 0; i < 6 && keys.length; i++) {
    const mint = pick(keys); const s = live.get(mint);
    if (!s) continue;
    if (!store.get(mint)) { live.delete(mint); continue; }
    const buy = Math.random() < 0.5 + s.hype * 0.08;
    const amt = +(0.05 + Math.random() * (buy ? 1.5 + s.hype : 1.2)).toFixed(3);
    s.vSol = Math.max(V_SOL0, s.vSol + (buy ? amt : -amt));
    s.hype *= 0.998;
    const vTokens = Math.min(V_TOKENS0, K / s.vSol);
    const t0 = store.get(mint); const early = t0 && Date.now() - t0.createdAt < 3000;
    const devSell = !buy && s.rug && Math.random() < .05;
    const trader = devSell ? s.creator : (early || Math.random() < .5) ? pick(s.wallets) : rnd(44);
    const price = s.vSol / (K / s.vSol);
    store.onTrade({ mint, traderPublicKey: trader, tokenAmount: amt / price, txType: buy ? 'buy' : 'sell', solAmount: amt, vSolInBondingCurve: s.vSol, vTokensInBondingCurve: vTokens, marketCapSol: s.vSol / vTokens * 1e9 });
    if (s.vSol >= 115) { live.delete(mint); store.onMigration({ mint, pool: 'pump-amm' }); }
  }
}

function safety() {
  for (const t of store.all()) {
    const holders = Math.max(1, Math.round(t.buys * 0.7 - t.sells * 0.3));
    store.onSafety(t.mint, { holders, top10Pct: Math.max(6, Math.min(60, 12 + (hash(t.mint) % 30) - holders / 10)), devPct: undefined });
  }
}
const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function start() {
  setInterval(safety, 3000).unref();
  console.log('[mock] demo feed running: every coin on the board is made up, and trading is off');
  for (let i = 0; i < 25; i++) launch();
  const loop = () => { launch(); setTimeout(loop, 400 + Math.random() * 1400); };
  loop();
  setInterval(trade, 150).unref();
}
