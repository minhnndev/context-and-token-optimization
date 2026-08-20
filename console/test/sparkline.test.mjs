import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparkline } from '../src/sparkline.mjs';

test('uses only the last `width` values', () => {
  const s = sparkline([1, 2, 3, 4, 5], 3);
  assert.equal(s.length, 3);
});

test('min maps to the lowest tick, max to the highest', () => {
  const s = sparkline([0, 100], 2);
  assert.equal(s[0], '▁');
  assert.equal(s[1], '█');
});

test('flat data does not divide by zero', () => {
  const s = sparkline([5, 5, 5], 3);
  assert.equal(s.length, 3);
});

test('empty input renders blank padding', () => {
  assert.equal(sparkline([], 4), '    ');
});
