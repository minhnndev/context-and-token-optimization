import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../src/metrics.mjs';

test('same seed produces the identical stream (deterministic on every machine)', () => {
  const a = createMetrics(42);
  const b = createMetrics(42);
  for (let i = 0; i < 50; i++) {
    assert.deepEqual(a.next(), b.next());
  }
});

test('values stay in range', () => {
  const m = createMetrics(7);
  for (let i = 0; i < 200; i++) {
    const s = m.next();
    assert.ok(s.cpu >= 1 && s.cpu <= 100, `cpu ${s.cpu}`);
    assert.ok(s.mem >= 1 && s.mem <= 100, `mem ${s.mem}`);
    assert.ok(s.latMs >= 40 && s.latMs <= 900, `latMs ${s.latMs}`);
  }
});
