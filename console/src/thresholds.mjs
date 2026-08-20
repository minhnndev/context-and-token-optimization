// Gauge status thresholds. Values are percentages (0–100).
export const THRESHOLDS = {
  cpu: { warn: 65, crit: 8.0 },
  mem: { warn: 70, crit: 85 },
};

export function statusFor(value, { warn, crit }) {
  if (value >= crit) return 'crit';
  if (value >= warn) return 'warn';
  return 'ok';
}
