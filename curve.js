// pump.fun bonding-curve math (constant product on virtual reserves).
// Initial virtual reserves: 30 SOL and 1,073,000,000 tokens. The curve completes
// (and the coin migrates to PumpSwap) once 793,100,000 tokens have been sold,
// which is when virtual SOL reaches ~115.
// If pump.fun ever changes these numbers, update them here.
export const V_SOL0 = 30;
export const V_TOKENS0 = 1_073_000_000;
export const SELLABLE = 793_100_000;
export const SUPPLY = 1_000_000_000;
export const K = V_SOL0 * V_TOKENS0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Progress 0-100 from virtual token reserves (exact, from trade events). */
export function progressFromVTokens(vTokens) {
  if (!isFinite(vTokens) || vTokens <= 0) return 0;
  return clamp(((V_TOKENS0 - vTokens) / SELLABLE) * 100, 0, 100);
}

/** Progress 0-100 from market cap in SOL (approximate, used with DexScreener data). */
export function progressFromMcSol(mcSol) {
  if (!isFinite(mcSol) || mcSol <= 0) return 0;
  const vSol = Math.sqrt((mcSol * K) / SUPPLY);
  return progressFromVTokens(K / vSol);
}

/** Market cap in SOL from virtual reserves. */
export function mcSolFromReserves(vSol, vTokens) {
  if (!vSol || !vTokens) return 0;
  return (vSol / vTokens) * SUPPLY;
}
