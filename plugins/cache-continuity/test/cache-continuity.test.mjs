import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCacheTurnObserver,
  createTurnEntryGate,
  formatCacheTurn,
  SIGNIFICANT_CACHE_DELTA_TOKENS,
} from '../lib/cache-continuity.mjs';

test('keeps turn entry open until the first eligible usage event', () => {
  const gate = createTurnEntryGate();

  assert.equal(gate.take(true), false);
  gate.start(undefined);
  assert.equal(gate.take(false), false);
  assert.equal(gate.take(true), true);
  assert.equal(gate.take(true), false);
});

test('does not open the gate for a subagent turn', () => {
  const gate = createTurnEntryGate();

  gate.start('subagent-1');
  assert.equal(gate.take(true), false);
});

test('reports a factual baseline with cache percentage', () => {
  const observer = createCacheTurnObserver();
  const turn = observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    inputTokens: 21_172,
    cacheReadTokens: 0,
  });

  assert.equal(
    formatCacheTurn(turn),
    'Cache: gpt-5.4-mini / low | 0 of 21,172 reused (0%) | baseline'
  );
});

test('reports the same configuration and a significant cache gain', () => {
  const observer = createCacheTurnObserver();
  observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    inputTokens: 21_172,
    cacheReadTokens: 0,
  });
  const turn = observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    inputTokens: 21_231,
    cacheReadTokens: 20_992,
  });

  assert.equal(
    formatCacheTurn(turn),
    'Cache: gpt-5.4-mini / low | 20,992 of 21,231 reused (99%) | ' +
      'same configuration | cache change +20,992'
  );
});

test('reports a reasoning change and significant cache drop', () => {
  const observer = createCacheTurnObserver();
  observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    inputTokens: 21_231,
    cacheReadTokens: 20_992,
  });
  const turn = observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'high',
    inputTokens: 21_678,
    cacheReadTokens: 0,
  });

  assert.equal(
    formatCacheTurn(turn),
    'Cache: gpt-5.4-mini / high | 0 of 21,678 reused (0%) | ' +
      'reasoning changed | cache change -20,992'
  );
});

test('reports a model and reasoning change even without a large delta', () => {
  const observer = createCacheTurnObserver();
  observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'high',
    inputTokens: 21_678,
    cacheReadTokens: 0,
  });
  const turn = observer.observe({
    model: 'gpt-5.6-terra',
    reasoningEffort: 'low',
    inputTokens: 22_124,
    cacheReadTokens: 0,
  });

  assert.equal(
    formatCacheTurn(turn),
    'Cache: gpt-5.6-terra / low | 0 of 22,124 reused (0%) | ' +
      'model + reasoning changed'
  );
});

test('reports a return to a previously seen configuration', () => {
  const observer = createCacheTurnObserver();
  observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    inputTokens: 21_172,
    cacheReadTokens: 0,
  });
  observer.observe({
    model: 'gpt-5.6-terra',
    reasoningEffort: 'low',
    inputTokens: 22_124,
    cacheReadTokens: 0,
  });
  const turn = observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    inputTokens: 22_246,
    cacheReadTokens: 20_992,
  });

  assert.equal(
    formatCacheTurn(turn),
    'Cache: gpt-5.4-mini / low | 20,992 of 22,246 reused (94%) | ' +
      'returned to seen configuration | cache change +20,992'
  );
});

test('keeps small cache changes factual without a significance annotation', () => {
  const observer = createCacheTurnObserver(SIGNIFICANT_CACHE_DELTA_TOKENS);
  observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    inputTokens: 21_172,
    cacheReadTokens: 18_000,
  });
  const turn = observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    inputTokens: 21_231,
    cacheReadTokens: 20_000,
  });

  assert.equal(
    formatCacheTurn(turn),
    'Cache: gpt-5.4-mini / low | 20,000 of 21,231 reused (94%) | same configuration'
  );
});

test('reports unavailable counters instead of failing silently', () => {
  const observer = createCacheTurnObserver();
  const turn = observer.observe({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
  });

  assert.equal(
    formatCacheTurn(turn),
    'Cache: gpt-5.4-mini / low | cache data unavailable | baseline'
  );
});
