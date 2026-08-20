const TICKS = '▁▂▃▄▅▆▇█';

// Values → unicode sparkline, scaled to the window's own min/max.
export function sparkline(values, width = 24) {
  const window = values.slice(-width);
  if (window.length === 0) return ''.padEnd(width);
  const min = Math.min(...window);
  const max = Math.max(...window);
  const span = max - min || 1;
  return window
    .map((v) => TICKS[Math.min(TICKS.length - 1, Math.floor(((v - min) / span) * TICKS.length))])
    .join('')
    .padStart(width);
}
