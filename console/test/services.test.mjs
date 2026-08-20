import test from 'node:test';
import assert from 'node:assert/strict';
import { createServices, SERVICE_ERR_THRESHOLDS, SERVICES } from '../src/services.mjs';
import { statusFor } from '../src/thresholds.mjs';
import { renderServices } from '../src/svcpanel.mjs';

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const atTick = (n, seed = 42) => {
  const s = createServices(seed);
  let out;
  for (let i = 0; i < n; i++) out = s.next();
  return out;
};

test('same seed produces the identical service stream on every machine', () => {
  assert.deepEqual(atTick(30), atTick(30));
});

test('error-rate status boundaries: <2 ok, ≥2 warn, ≥5 crit', () => {
  assert.equal(statusFor(1.9, SERVICE_ERR_THRESHOLDS), 'ok');
  assert.equal(statusFor(2, SERVICE_ERR_THRESHOLDS), 'warn');
  assert.equal(statusFor(4.9, SERVICE_ERR_THRESHOLDS), 'warn');
  assert.equal(statusFor(5, SERVICE_ERR_THRESHOLDS), 'crit');
});

test('every tick reports every service, with sane values', () => {
  for (const tick of [1, 15, 60]) {
    const sample = atTick(tick);
    assert.equal(sample.length, SERVICES.length);
    for (const s of sample) {
      assert.ok(s.lat >= 1 && s.lat <= 5000, `${s.name} lat ${s.lat}`);
      assert.ok(s.rps >= 0 && s.rps <= 2000, `${s.name} rps ${s.rps}`);
      assert.ok(s.errPct >= 0 && s.errPct <= 100, `${s.name} err ${s.errPct}`);
    }
  }
});

test('seed 42 tick 30: the demo incidents are live (api-gw and queue crit)', () => {
  const byName = Object.fromEntries(atTick(30).map((s) => [s.name, s]));
  assert.equal(byName['api-gw'].status, 'crit');
  assert.equal(byName['queue'].status, 'crit');
  assert.equal(byName['search'].status, 'warn');
  assert.equal(byName['web-fe'].status, 'ok');
});

test('panel renders worst first, one fixed-width row per service under a header', () => {
  const sample = atTick(30);
  const lines = renderServices(sample).map(stripAnsi);
  assert.equal(lines.length, SERVICES.length + 1);
  assert.match(lines[0], /SERVICE\s+LAT\s+RPS\s+ERR%/);
  assert.match(lines[1], /^ {2}api-gw {6}\d{1,4}ms {1,5}\d+ {1,5}[\d.]+ ●$/);
  const statusOf = (line) => sample.find((s) => s.name === line.trim().split(/\s+/)[0]).status;
  const order = lines.slice(1).map((l) => ({ crit: 0, warn: 1, ok: 2 })[statusOf(l)]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});
