#!/usr/bin/env node
// Incident Console — a tiny terminal NOC dashboard. Zero dependencies, Node 22+.
//   node console/src/dash.mjs           live dashboard (q or Ctrl+C to quit)
//   node console/src/dash.mjs --once    print a single frame and exit (smoke test / screenshots)
import { altScreen, cursor, paint } from './ansi.mjs';
import { createMetrics } from './metrics.mjs';
import { THRESHOLDS, statusFor } from './thresholds.mjs';
import { renderGauge } from './gauges.mjs';
import { sparkline } from './sparkline.mjs';
import { createLog, eventsFor } from './logpanel.mjs';
import { createServices } from './services.mjs';
import { renderServices } from './svcpanel.mjs';

const WIDTH = 58;
const once = process.argv.includes('--once');

const metrics = createMetrics(42);
const services = createServices(42);
const log = createLog();
const reqHistory = [];

function frame(sample) {
  const statuses = {
    cpu: statusFor(sample.cpu, THRESHOLDS.cpu),
    mem: statusFor(sample.mem, THRESHOLDS.mem),
  };
  reqHistory.push(sample.reqs);
  if (reqHistory.length > 120) reqHistory.shift();
  const svcSamples = services.next();
  for (const [level, message] of eventsFor(sample, statuses)) log.push(sample.t, level, message);

  const hr = (title) => paint(`─ ${title} `.padEnd(WIDTH - 4, '─'), 'gray');
  const lines = [
    paint(`┌─ INCIDENT CONSOLE ${'─'.repeat(WIDTH - 21)}┐`, 'cyan'),
    '',
    `  ${renderGauge('CPU', sample.cpu, statuses.cpu)}`,
    `  ${renderGauge('MEM', sample.mem, statuses.mem)}`,
    '',
    `  ${paint('REQ/S', 'bold')} ${sparkline(reqHistory)} ${String(sample.reqs).padStart(4)}`,
    '',
    `  ${hr('services')}`,
    ...renderServices(svcSamples),
    '',
    `  ${hr('log')}`,
    ...log.render(),
    '',
    paint('└', 'cyan') + paint('─'.repeat(WIDTH - 2), 'cyan') + paint('┘', 'cyan'),
    paint(`  tick ${sample.t} · seed 42 · q to quit`, 'dim'),
  ];
  return lines.join('\n');
}

if (once) {
  // Advance through 30 frames so the sparkline and log have history, print the last.
  let out;
  for (let i = 0; i < 30; i++) out = frame(metrics.next());
  console.log(out);
  process.exit(0);
}

function cleanExit() {
  process.stdout.write(cursor.show + altScreen.exit);
  process.exit(0);
}
process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (key) => {
    if (key.toString() === 'q' || key[0] === 3) cleanExit();
  });
}

process.stdout.write(altScreen.enter + cursor.hide);
setInterval(() => {
  // \x1b[K after each line erases leftovers when a line gets shorter;
  // \x1b[J at the end erases anything below when the frame gets shorter.
  const painted = frame(metrics.next()).replaceAll('\n', '\x1b[K\n');
  process.stdout.write(cursor.home + painted + '\x1b[K\n\x1b[J');
}, 400);
