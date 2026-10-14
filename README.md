# Orbit

Pixel crypto arcade with 3D mini-games, a live market for the major coins, weekly SOL payouts, and **Radar**: a live board of brand-new Solana meme coins split into **New Pairs**, **Final Stretch** and **Migrated**, with one-click buys from the visitor's own wallet.

No dependencies. One Node.js process serves the site and the live data.

## Run it

You need **Node.js 22 or newer**.

```bash
# 1. Demo mode: simulated coins, trading switched off. Works with no internet.
npm run demo            # then open http://localhost:3000/radar

# 2. Live mode: real pump.fun launches
cp .env.example .env    # optional, edit settings
npm start               # open http://localhost:3000
```

Pages:

- `/` is the Orbit home page (arcade, market, Proof-of-Play, payouts)
- `/radar` is the live meme-coin board

## Where the data comes from

| What | Source | Cost |
|---|---|---|
| New launches and migrations, the moment they happen | PumpPortal WebSocket (`subscribeNewToken`, `subscribeMigration`) | Free |
| Every buy and sell, live progress and volume (optional) | PumpPortal `subscribeTokenTrade`, turned on by `PUMPPORTAL_API_KEY` | About 0.01 SOL per 10,000 trade messages |
| Market cap, volume, 5-minute change, images and socials | DexScreener `tokens/v1` API, polled every 2 seconds in batches of 30 | Free |
| Name, image, socials for brand-new coins | The coin's own metadata file (IPFS) | Free |
| LetsBonk launches | PumpPortal stream (same as pump.fun) | Free |
| Meteora launches (Bags, Believe and other DBC launchpads) and Raydium LaunchLab | Watched on-chain through your RPC (`EXTRA_LAUNCHPADS`) | Free with a Helius key |
| Holders, top 10 holders %, dev holdings % | Solana RPC (`getTokenLargestAccounts`) or Helius (`getTokenAccounts`, adds holder counts) | Free tier is enough to start |
| Snipers and "dev sold" | Worked out from the live trade feed | Needs `PUMPPORTAL_API_KEY` |
| BTC, ETH, SOL and other major coin prices | Crypto.com Exchange public API | Free |

Without an API key the board still shows every launch instantly. Market cap, bonding-curve progress and volume then refresh every few seconds instead of on every trade.

### Launchpads

Each card has a badge: **PUMP** (pump.fun), **BONK** (LetsBonk), **LLAB** (Raydium LaunchLab), **BAGS** (Bags) and **MET** (other Meteora launchpads). Visitors can switch launchpads on and off in the toolbar.

- pump.fun and LetsBonk come from PumpPortal and work with no extra setup. (If LetsBonk coins never show up, PumpPortal has stopped including them in its free stream; turn on `EXTRA_LAUNCHPADS` to catch them on-chain through LaunchLab.)
- Meteora and LaunchLab need `EXTRA_LAUNCHPADS=1` and a good RPC. A free Helius key turns this on automatically.
- Bonding-curve progress is exact for pump.fun. For other launchpads it's estimated from market cap and shown with a **≈**.
- One-click trades work for pump.fun, LetsBonk/LaunchLab and every migrated coin. PumpPortal doesn't trade Meteora coins before they migrate, so the server returns an error for those.

### Safety stats

Cards and the coin panel show:

- **HOLD**: wallets holding the coin (needs `HELIUS_API_KEY`).
- **TOP10**: share of supply held by the 10 biggest wallets, not counting the bonding curve or pool. Turns red above 30%.
- **DEV**: share the creator still holds; turns red above 10%. Becomes **DEV SOLD** once the creator sells (needs the trade feed).
- **SNIPE**: wallets that bought in the first 3 seconds after launch, and the share they still hold (needs the trade feed).

Stats refresh every 20 seconds for Final Stretch coins and every 45 to 60 seconds for the rest, within the `SAFETY_RPS` budget. Column filters can hide coins by holders, top 10 %, dev % and dev sold.

### How coins move between columns

- **New Pairs**: just launched, bonding curve below `FINAL_STRETCH_MIN_PROGRESS` (default 50%).
- **Final Stretch**: bonding curve at or above that %, not migrated yet.
- **Migrated**: the curve finished and liquidity moved to PumpSwap or another pool.

Progress uses pump.fun's curve: 30 SOL and 1,073,000,000 tokens of virtual reserves, complete after 793,100,000 tokens are sold. If pump.fun changes these numbers, update `lib/curve.js`.

Quiet coins drop off: New Pairs after 45 minutes without a trade, Final Stretch after 3 hours, Migrated after 6 hours.

## How trading works

1. The visitor connects a Solana wallet (Phantom, Solflare or Backpack are detected).
2. When they hit Buy or Sell, the browser asks this server for a transaction (`POST /api/trade-tx`).
3. The server asks PumpPortal's **local transaction API** to build it and returns it **unsigned**.
4. The visitor's wallet shows the trade and they approve or cancel it. The wallet signs and sends it.

The server never holds or sees a private key. PumpPortal charges **0.5% per trade** on trades built through it. Slippage and priority fee come from the Radar toolbar.

## Hosting

Radar needs a server that stays running (it keeps a WebSocket open and streams updates to browsers), so use a host that runs a normal Node process:

- **Render / Railway / Fly.io**: create a web service from this folder, start command `npm start`, add your `.env` values as environment variables.
- **Any VPS**: `npm start` behind a reverse proxy such as Caddy or nginx. If you use nginx, turn off buffering for `/api/radar/stream`.

Serverless hosts such as Vercel or Netlify Functions won't work for the live feed.

## Settings (`.env`)

| Name | Default | What it does |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `PUMPPORTAL_API_KEY` | empty | Turns on per-trade updates (paid by PumpPortal usage) |
| `HELIUS_API_KEY` | empty | Holder counts, on-chain launchpad watching, faster safety stats |
| `SOLANA_RPC_URL` | Helius if keyed, else public mainnet RPC | Safety stats, and sending trades for wallets that can sign but not send |
| `SOLANA_WS_URL` | derived from `SOLANA_RPC_URL` | Websocket for on-chain launchpad watching |
| `EXTRA_LAUNCHPADS` | on with Helius | Watch Meteora DBC and Raydium LaunchLab |
| `SAFETY_RPS` | 8 with Helius, 2 without | RPC calls per second for safety stats |
| `IPFS_GATEWAY` | `https://ipfs.io/ipfs/` | Gateway for coin metadata |
| `FINAL_STRETCH_MIN_PROGRESS` | 50 | Bonding-curve % that moves a coin into Final Stretch |
| `MOCK` | 0 | `1` runs the simulated demo feed |

## Before you launch publicly

- **Weekly SOL payouts**: arcade scores are still saved in each player's browser, so they can be edited. Record and verify runs on the server before paying anyone.
- **Prize contests and trading features** can carry legal and licensing requirements depending on where your players are. Check with a lawyer.
- **Meme coins are high risk.** The Radar page shows a risk notice; keep it.
- Third-party APIs (PumpPortal, DexScreener, Crypto.com) can change their formats or limits. The code is written defensively, but check the server log if a column stops updating.

## Files

```
server.js          HTTP server, API routes, live stream, trade endpoints
lib/config.js      settings and .env loader
lib/store.js       coin list and column logic
lib/curve.js       bonding-curve math
lib/pumpportal.js  PumpPortal WebSocket client
lib/enrich.js      metadata and DexScreener polling
lib/safety.js      holders, top 10, dev holdings
lib/chainwatch.js  Meteora / LaunchLab launches on-chain
lib/launchpads.js  launchpad list and program IDs
lib/rpc.js         Solana RPC helper
lib/market.js      major coin prices
lib/mock.js        simulated demo feed
public/index.html  Orbit home page
public/radar.*   Radar board
```
