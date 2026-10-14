import { readFileSync, existsSync } from 'node:fs';

// Minimal .env loader (no dependencies). Real environment variables win.
const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);

const heliusKey = process.env.HELIUS_API_KEY || '';
const rpcUrl = process.env.SOLANA_RPC_URL || (heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : 'https://api.mainnet-beta.solana.com');
const flag = (v, d) => (v === undefined || v === '' ? d : v === '1' || v === 'true');

export const config = {
  port: num(process.env.PORT, 3000),
  mock: process.env.MOCK === '1' || process.env.MOCK === 'true',
  pumpPortalKey: process.env.PUMPPORTAL_API_KEY || '',
  heliusKey,
  rpcUrl,
  // websocket endpoint of the same RPC (used to watch other launchpads)
  wsUrl: process.env.SOLANA_WS_URL || rpcUrl.replace(/^http/, 'ws'),
  ipfsGateway: (process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/').replace(/\/?$/, '/'),
  finalMin: num(process.env.FINAL_STRETCH_MIN_PROGRESS, 50),
  // watch Meteora (Bags, Believe and other DBC launchpads) and Raydium LaunchLab directly on-chain
  extraLaunchpads: flag(process.env.EXTRA_LAUNCHPADS, !!heliusKey),
  // safety stats (holders, top 10, dev holdings): RPC requests per second to spend on them
  safetyRps: num(process.env.SAFETY_RPS, heliusKey ? 8 : 2),
  // how many coins each column sends to the browser
  columnSize: 60,
};
