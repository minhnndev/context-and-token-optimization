import { paint } from './ansi.mjs';

const LEVEL_STYLE = { INFO: 'gray', WARN: 'yellow', ALERT: 'red' };

export function createLog(capacity = 50) {
  const lines = [];
  return {
    push(t, level, message) {
      lines.push({ t, level, message });
      if (lines.length > capacity) lines.shift();
    },
    render(rows = 6, width = 52) {
      return lines.slice(-rows).map(({ t, level, message }) => {
        const stamp = paint(`t+${String(t).padStart(4)}`, 'dim');
        const lvl = paint(level.padEnd(5), LEVEL_STYLE[level]);
        const msg = message.slice(0, width - 14); // truncate plain text BEFORE painting
        return ` ${stamp} ${lvl} ${msg}`;
      });
    },
  };
}

// Derive log events from a metrics sample and its gauge statuses.
export function eventsFor(sample, statuses) {
  const events = [];
  if (statuses.cpu === 'crit') events.push(['ALERT', `cpu ${Math.round(sample.cpu)}% over critical threshold`]);
  else if (statuses.cpu === 'warn') events.push(['WARN', `cpu ${Math.round(sample.cpu)}% approaching limit`]);
  if (statuses.mem === 'crit') events.push(['ALERT', `memory ${Math.round(sample.mem)}% over critical threshold`]);
  else if (statuses.mem === 'warn') events.push(['WARN', `memory pressure ${Math.round(sample.mem)}%`]);
  if (sample.latMs > 600) events.push(['WARN', `p50 latency ${sample.latMs}ms`]);
  if (sample.t % 15 === 0) events.push(['INFO', `heartbeat ok · ${sample.reqs} req/s`]);
  return events;
}
