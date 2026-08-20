import { paint, statusDot, STATUS_COLOR } from './ansi.mjs';

// Render one metric gauge, e.g.  CPU ▓▓▓▓▓▓▓▓░░░░░░░░░░░░  42% ●
export function renderGauge(label, value, status, width = 20) {
  const filled = Math.round((value / 100) * width);
  const bar =
    paint('▓'.repeat(filled), STATUS_COLOR[status]) +
    paint('░'.repeat(width - filled), 'gray');
  const pct = `${String(Math.round(value)).padStart(3)}%`;
  return `${paint(label.padEnd(4), 'bold')} ${bar} ${pct} ${statusDot(status)}`;
}
