// Acceptance tests for "Add latency panel with p99 sparkline" (open lab task).
// Pre-written on purpose — implement until this file passes:
//   node --test console/test/pending/latency.test.mjs
// then move it into console/test/ so it runs with the main suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, basename } from 'node:path';

// Resolve console/src whether this file lives in test/pending/ or test/,
// so "move it into console/test/" needs no edits.
const HERE = dirname(fileURLToPath(import.meta.url));
const CONSOLE = basename(HERE) === 'pending' ? join(HERE, '../..') : join(HERE, '..');
const src = (file) => pathToFileURL(join(CONSOLE, 'src', file)).href;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const renderOnce = () =>
  spawnSync(process.execPath, [join(CONSOLE, 'src/dash.mjs'), '--once'], { encoding: 'utf8' });

// latMs stream for seed 42, ticks 1–30 — what --once has seen at its last frame.
const LAT_SEED42 = [210, 238, 226, 252, 244, 234, 261, 287, 302, 277, 326, 275, 313, 293, 285,
  320, 302, 346, 333, 318, 335, 330, 306, 307, 453, 326, 275, 281, 295, 323];

// ── console/src/percentile.mjs ────────────────────────────────────────────────

test('percentile: nearest-rank (ceil(p/100·n)-th sorted value)', async () => {
  const { percentile } = await import(src('percentile.mjs'));
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([5, 1, 9, 3], 75), 5);
  assert.equal(percentile([1, 2, 3, 4], 99), 4);
  assert.equal(percentile([7], 50), 7);
  assert.equal(percentile([6, 6, 6], 99), 6);
});

test('percentile: empty input is null; input array is never mutated', async () => {
  const { percentile } = await import(src('percentile.mjs'));
  assert.equal(percentile([], 99), null);
  const values = [9, 1, 5];
  percentile(values, 50);
  assert.deepEqual(values, [9, 1, 5]);
});

test('windowStats: last/p50/p99 over the trailing window', async () => {
  const { windowStats } = await import(src('percentile.mjs'));
  assert.deepEqual(windowStats(LAT_SEED42, 24), { last: 323, p50: 306, p99: 453 });
  assert.deepEqual(windowStats([100], 24), { last: 100, p50: 100, p99: 100 });
});

// ── console/src/thresholds.mjs ────────────────────────────────────────────────

test('latency thresholds: warn 400 / crit 650 (ms), same statusFor semantics', async () => {
  const { THRESHOLDS, statusFor } = await import(src('thresholds.mjs'));
  assert.deepEqual(THRESHOLDS.lat, { warn: 400, crit: 650 });
  assert.equal(statusFor(399, THRESHOLDS.lat), 'ok');
  assert.equal(statusFor(453, THRESHOLDS.lat), 'warn');
  assert.equal(statusFor(651, THRESHOLDS.lat), 'crit');
});

// ── console/src/latalert.mjs ──────────────────────────────────────────────────

test('latency alerts fire on p99 status transitions only — no per-tick spam', async () => {
  const { createLatencyAlert } = await import(src('latalert.mjs'));
  const alert = createLatencyAlert({ warn: 400, crit: 650 });
  assert.equal(alert.observe(300), null); // starts ok: nothing to announce
  assert.deepEqual(alert.observe(420), ['WARN', 'latency p99 420ms elevated']);
  assert.equal(alert.observe(430), null); // still warn: quiet
  assert.deepEqual(alert.observe(700), ['ALERT', 'latency p99 700ms critical']);
  assert.equal(alert.observe(680), null); // still crit: quiet
  assert.deepEqual(alert.observe(420), ['WARN', 'latency p99 420ms elevated']); // crit→warn re-announces
  assert.deepEqual(alert.observe(300), ['INFO', 'latency recovered']);
  assert.equal(alert.observe(280), null); // still ok: quiet
});

// ── dashboard integration ─────────────────────────────────────────────────────

test('dash --once renders the LAT line directly under REQ/S, exactly', () => {
  const res = renderOnce();
  assert.equal(res.status, 0, res.stderr);
  const plain = stripAnsi(res.stdout).split('\n');
  const reqIdx = plain.findIndex((l) => l.includes('REQ/S'));
  assert.notEqual(reqIdx, -1, 'REQ/S line missing');
  assert.equal(plain[reqIdx + 1], '  LAT   ▁▂▂▁▃▁▃▂▂▃▂▄▄▃▄▃▂▂█▃▁▁▂▃  323ms  p99 453ms ●');
});

test('LAT status dot is yellow at tick 30 (p99 453ms is warn)', () => {
  const res = renderOnce();
  const latLine = res.stdout.split('\n').find((l) => stripAnsi(l).includes('p99'));
  assert.ok(latLine, 'no line mentioning p99 found');
  assert.ok(latLine.includes('\x1b[33m●'), 'expected a yellow (warn) dot on the LAT line');
});
