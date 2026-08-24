import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarker, calibrationSummary, extractMarker, verdictFor } from '../core/calibration';
import { CacheTurnObserver, formatCacheTurn } from '../core/cache';
import { bucketForCredits, estimateTask } from '../core/sizing';
import { GitSnapshot, TaskRecord, UsageSnapshot } from '../core/types';

const emptyGit: GitSnapshot = {
  branch: 'main', changedFiles: 0, addedFiles: 0, deletedFiles: 0,
  insertions: 0, deletions: 0, modules: [], files: [],
};

test('bucket boundaries remain compatible with the workshop rubric', () => {
  assert.equal(bucketForCredits(10), 'XS');
  assert.equal(bucketForCredits(11), 'S');
  assert.equal(bucketForCredits(30), 'S');
  assert.equal(bucketForCredits(31), 'M');
  assert.equal(bucketForCredits(150), 'L');
  assert.equal(bucketForCredits(151), 'XL');
});

test('estimator uses Git scope and complexity signals', () => {
  const estimate = estimateTask('Add offline synchronization across the editor', {
    ...emptyGit,
    changedFiles: 8,
    addedFiles: 2,
    insertions: 842,
    deletions: 213,
    modules: ['src', 'test'],
    files: [
      { path: 'src/sync.ts', status: 'added', insertions: 600, deletions: 0 },
      { path: 'test/sync.test.ts', status: 'added', insertions: 242, deletions: 0 },
    ],
  }, []);
  assert.ok(['M', 'L', 'XL'].includes(estimate.bucket));
  assert.ok(estimate.drivers.some((driver) => driver.includes('offline')));
  assert.ok(estimate.confidence > 0.55);
});

test('similar completed tasks influence the estimate and appear as analogues', () => {
  const history = [completedTask('Add offline sync to the editor', 44)];
  const estimate = estimateTask('Implement offline synchronization for editor documents', emptyGit, history);
  assert.equal(estimate.analogues.length, 1);
  assert.ok(estimate.expectedCredits > 20);
});

test('usage markers stay backward compatible', () => {
  const marker = buildMarker({ bucket: 'M', actual: 42.7, verdict: 'on-target' });
  assert.deepEqual(extractMarker(marker), { bucket: 'M', actual: 42.7, verdict: 'on-target' });
  assert.equal(extractMarker(buildMarker({ size: 'S' }, 'ai-estimate')), null);
});

test('verdict and calibration summary use exact bucket boundaries', () => {
  const onTarget = completedTask('On target', 42);
  const over = completedTask('Over', 90);
  assert.equal(verdictFor('M', 75), 'on-target');
  assert.equal(verdictFor('M', 76), 'over');
  const summary = calibrationSummary([onTarget, over]);
  assert.equal(summary.recorded, 2);
  assert.equal(summary.hits, 1);
  assert.equal(summary.rate, 0.5);
});

test('cache observer reports factual configuration changes and significant deltas', () => {
  const observer = new CacheTurnObserver();
  observer.observe({
    rowId: 1, model: 'claude-sonnet-4.5', reasoningEffort: 'medium',
    inputTokens: 20_000, cacheReadTokens: 15_000, outputTokens: 100, credits: 1,
  });
  const turn = observer.observe({
    rowId: 2, model: 'claude-sonnet-4.5', reasoningEffort: 'high',
    inputTokens: 20_000, cacheReadTokens: 5_000, outputTokens: 100, credits: 1,
  });
  assert.equal(turn.transition, 'reasoning changed');
  assert.equal(turn.previousModel, 'claude-sonnet-4.5');
  assert.equal(turn.previousReasoningEffort, 'medium');
  assert.equal(turn.credits, 1);
  assert.equal(turn.cacheDelta, -10_000);
  assert.equal(turn.significant, true);
  assert.match(formatCacheTurn(turn), /cache change -10,000/);
});

function completedTask(description: string, credits: number): TaskRecord {
  const usage: UsageSnapshot = {
    sessionId: 'session', lastRowId: 1, lastFileId: 0, credits, apiDurationMs: 0,
    totals: { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    perModel: [], files: [], events: [],
  };
  return {
    id: description,
    description,
    status: 'completed',
    estimate: {
      bucket: 'M', min: 31, max: 75, expectedCredits: 50,
      confidence: 0.8, drivers: [], analogues: [],
    },
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T01:00:00.000Z',
    startGit: emptyGit,
    usage,
    verdict: verdictFor('M', credits),
  };
}
