// Render the services table: one row per service, fixed columns, worst first.
import { paint, statusDot } from './ansi.mjs';

const SEVERITY = { crit: 0, warn: 1, ok: 2 };

export function renderServices(samples) {
  const rows = [...samples].sort(
    (a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.name.localeCompare(b.name)
  );
  const header = paint(`  ${'SERVICE'.padEnd(11)}${'LAT'.padStart(6)} ${'RPS'.padStart(5)} ${'ERR%'.padStart(5)}`, 'dim');
  return [
    header,
    ...rows.map((s) => {
      const lat = `${String(s.lat).padStart(4)}ms`;
      const rps = String(s.rps).padStart(5);
      const err = String(s.errPct.toFixed(1)).padStart(5);
      const line = `  ${s.name.padEnd(11)}${lat} ${rps} ${err}`;
      const painted = s.status === 'ok' ? line : paint(line, s.status === 'crit' ? 'red' : 'yellow');
      return `${painted} ${statusDot(s.status)}`;
    }),
  ];
}
