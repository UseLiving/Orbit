// Launchpads Radar understands. Program IDs are mainnet; double-check them if a launchpad upgrades.
export const LAUNCHPADS = {
  pump:    { label: 'Pump',    short: 'PUMP', exactCurve: true },
  bonk:    { label: 'LetsBonk', short: 'BONK', exactCurve: false },
  launchlab: { label: 'LaunchLab', short: 'LLAB', exactCurve: false },
  bags:    { label: 'Bags',    short: 'BAGS', exactCurve: false },
  meteora: { label: 'Meteora', short: 'MET',  exactCurve: false },
};

// Programs watched on-chain when EXTRA_LAUNCHPADS is on.
export const PROGRAMS = [
  // Meteora Dynamic Bonding Curve: used by Bags, Believe and many other launchpads
  { id: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN', launchpad: 'meteora', create: /Instruction: InitializeVirtualPool/i },
  // Raydium LaunchLab: used by LetsBonk and other launchpads
  { id: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj', launchpad: 'launchlab', create: /Instruction: Initialize(V2|WithToken2022)?$/i },
];

/** Normalise PumpPortal's `pool` field / our own tags to a launchpad key. */
export function launchpadFrom(pool, mint) {
  const p = String(pool || '').toLowerCase();
  if (p.includes('bonk')) return 'bonk';
  if (p === 'pump' || p === '' ) return 'pump';
  if (p === 'launchlab') return 'launchlab';
  if (p === 'meteora') return /BAGS$/.test(mint || '') ? 'bags' : 'meteora';
  return LAUNCHPADS[p] ? p : 'pump';
}

/** DexScreener dexIds that are still a bonding curve (not migrated yet). */
export const CURVE_DEX = /pumpfun|pump\.fun|launchlab|dbc|moonshot|bonk|bags|believe|boop/i;
export const AMM_DEX = /pumpswap|raydium|meteora|orca/i;
