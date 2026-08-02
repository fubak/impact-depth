/** Stateful mulberry32; returns a new state and a stable [0,1) sample. */
export function nextRandom(state: number): { state: number; value: number } {
  const t = (state + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), t | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { state: t, value: ((r ^ (r >>> 14)) >>> 0) / 4294967296 };
}
