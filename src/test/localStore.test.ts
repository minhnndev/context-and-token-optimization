import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TaskRecord } from '../core/types';
import { LocalStore } from '../services/localStore';

test('TokenLens persists and reloads an active task', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tokenlens-store-'));
  const storePath = join(root, 'tokenlens.json');
  const task: TaskRecord = {
    id: 'task-1',
    description: 'Verify TokenLens local storage',
    status: 'active',
    estimate: {
      bucket: 'S',
      min: 10,
      max: 25,
      expectedCredits: 17.5,
      confidence: 0.8,
      drivers: [],
      analogues: [],
    },
    startedAt: '2026-08-25T00:00:00.000Z',
    startGit: {
      branch: 'main',
      changedFiles: 0,
      addedFiles: 0,
      deletedFiles: 0,
      insertions: 0,
      deletions: 0,
      modules: [],
      files: [],
    },
  };

  const first = new LocalStore(storePath);
  await first.initialize();
  await first.startTask(task);

  const reloaded = new LocalStore(storePath);
  await reloaded.initialize();
  assert.deepEqual(reloaded.activeTask(), task);
  assert.deepEqual(reloaded.allTasks(), [task]);
});
