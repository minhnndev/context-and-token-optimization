// Per-service seeded metrics for the services panel. A separate generator
// from createMetrics on purpose: the host stream (cpu/mem/reqs/latMs) feeds
// the gauges and their seed-42 goldens — this file must never disturb it.
import { mulberry32 } from './metrics.mjs';
import { statusFor } from './thresholds.mjs';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// name · steady-state latency (ms) · steady-state throughput (rps)
export const SERVICES = [
  { name: 'web-fe', baseLat: 120, baseRps: 220 },
  { name: 'api-gw', baseLat: 95, baseRps: 310 },
  { name: 'auth', baseLat: 60, baseRps: 80 },
  { name: 'orders', baseLat: 180, baseRps: 140 },
  { name: 'payments', baseLat: 210, baseRps: 60 },
  { name: 'inventory', baseLat: 150, baseRps: 90 },
  { name: 'search', baseLat: 130, baseRps: 170 },
  { name: 'cache', baseLat: 8, baseRps: 950 },
  { name: 'db-primary', baseLat: 22, baseRps: 480 },
  { name: 'queue', baseLat: 35, baseRps: 260 },
];

// Error-rate status: the incident signal operators actually page on.
// Same statusFor semantics as the gauges — one status rule everywhere.
export const SERVICE_ERR_THRESHOLDS = { warn: 2, crit: 5 };

// Each service degrades in seeded windows (start tick + duration derived from
// its own PRNG), so every run of a given seed shows the same incidents —
// deterministic drama for 300 identical screens.
function degradeWindows(rand) {
  const windows = [];
  for (let i = 0; i < 3; i++) {
    const start = Math.floor(rand() * 600) + 10;
    windows.push({ start, end: start + 8 + Math.floor(rand() * 25) });
  }
  return windows;
}

export function createServices(seed = 42) {
  const state = SERVICES.map((svc, i) => {
    const rand = mulberry32(seed + (i + 1) * 7919);
    return { ...svc, rand, windows: degradeWindows(rand) };
  });
  let t = 0;
  return {
    next() {
      t++;
      return state.map(({ name, baseLat, baseRps, rand, windows }) => {
        const degraded = windows.some((w) => t >= w.start && t <= w.end);
        const spike = degraded ? 2.5 + rand() * 2 : 1;
        const lat = Math.round(clamp(baseLat * spike * (0.85 + rand() * 0.3), 1, 5000));
        const rps = Math.round(clamp(baseRps * (degraded ? 0.6 : 1) * (0.9 + rand() * 0.2), 0, 2000));
        const errPct = Math.round(clamp(degraded ? 3 + rand() * 6 : rand() * 1.2, 0, 100) * 10) / 10;
        return { t, name, lat, rps, errPct, status: statusFor(errPct, SERVICE_ERR_THRESHOLDS) };
      });
    },
  };
}
