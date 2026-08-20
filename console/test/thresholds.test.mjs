import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusFor } from '../src/thresholds.mjs';

test('below warn is ok', () => {
  assert.equal(statusFor(30, { warn: 65, crit: 80 }), 'ok');
});

test('between warn and crit is warn', () => {
  assert.equal(statusFor(70, { warn: 65, crit: 80 }), 'warn');
});

test('at or above crit is crit', () => {
  assert.equal(statusFor(80, { warn: 65, crit: 80 }), 'crit');
  assert.equal(statusFor(99, { warn: 65, crit: 80 }), 'crit');
});

test('boundary: exactly warn is warn', () => {
  assert.equal(statusFor(65, { warn: 65, crit: 80 }), 'warn');
});
