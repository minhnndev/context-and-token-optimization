// Deterministic fake metrics: same seed → same stream on every machine.
// (Seeded PRNG instead of Math.random so the workshop looks identical on 300 laptops.)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createMetrics(seed = 42) {
  const rand = mulberry32(seed);
  let t = 0;
  return {
    next() {
      t++;
      const spike = rand() < 0.06 ? 25 + rand() * 20 : 0;
      return {
        t,
        cpu: clamp(38 + 18 * Math.sin(t / 7) + rand() * 14 + spike, 1, 100),
        mem: clamp(44 + 9 * Math.sin(t / 23) + rand() * 6, 1, 100),
        reqs: Math.round(clamp(140 + 70 * Math.sin(t / 11) + rand() * 50, 10, 400)),
        latMs: Math.round(clamp(190 + 95 * Math.sin(t / 13) + rand() * 70 + spike * 4, 40, 900)),
      };
    },
  };
}
