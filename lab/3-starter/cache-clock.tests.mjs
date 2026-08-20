import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createCacheClock,
  createCacheClockTurnGate,
} from '../../plugins/cache-continuity/lib/cache-clock.mjs';

test('waits one second before the first live countdown tick', async () => {
  const time = createFakeTime();
  const messages = [];
  const clock = createClock(time, messages);

  clock.updateCheckpoint(checkpoint(['mini', 30_000, 30]));
  assert.equal(clock.startPreview(), true);

  await time.advance(999);
  assert.deepEqual(messages, []);

  await time.advance(1);
  assert.deepEqual(messages, ['Cache TTL: mini 00:29']);
});

test('ticks once per second and pauses after ten updates', async () => {
  const time = createFakeTime();
  const messages = [];
  const clock = createClock(time, messages);

  clock.updateCheckpoint(checkpoint(['mini', 60_000, 60]));
  clock.startPreview();
  await time.advance(10_000);

  assert.equal(messages.length, 10);
  assert.equal(
    messages.at(-1),
    'Cache TTL: mini 00:50 | live preview paused'
  );
  assert.equal(time.pending(), 0);

  await time.advance(10_000);
  assert.equal(messages.length, 10);
});

test('cancels a pending preview immediately', async () => {
  const time = createFakeTime();
  const messages = [];
  const clock = createClock(time, messages);

  clock.updateCheckpoint(checkpoint(['mini', 30_000, 30]));
  clock.startPreview();
  clock.cancelPreview();
  await time.advance(5_000);

  assert.deepEqual(messages, []);
  assert.equal(time.pending(), 0);
});

test('surfaces a failed tick and stops that preview', async () => {
  const time = createFakeTime();
  const errors = [];
  const clock = createCacheClock({
    now: time.now,
    schedule: time.schedule,
    cancel: time.cancel,
    emit() {
      throw new Error('timeline unavailable');
    },
    onError(error) {
      errors.push(error.message);
    },
  });

  clock.updateCheckpoint(checkpoint(['mini', 30_000, 30]));
  clock.startPreview();
  await time.advance(1_000);

  assert.deepEqual(errors, ['timeline unavailable']);
  assert.equal(time.pending(), 0);
});

test('restarts a fresh preview after cancellation', async () => {
  const time = createFakeTime();
  const messages = [];
  let releaseFirst;
  const clock = createCacheClock({
    now: time.now,
    schedule: time.schedule,
    cancel: time.cancel,
    emit(message) {
      messages.push(message);
      if (messages.length === 1) {
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
    },
  });

  clock.updateCheckpoint(checkpoint(['mini', 30_000, 30]));
  clock.startPreview();
  await time.advance(1_000);
  assert.deepEqual(messages, ['Cache TTL: mini 00:29']);

  clock.cancelPreview();
  clock.updateCheckpoint(checkpoint(['mini', 41_000, 40]));
  clock.startPreview();
  await time.advance(1_000);
  assert.deepEqual(messages, ['Cache TTL: mini 00:29']);

  releaseFirst();
  await flushMicrotasks();

  assert.deepEqual(messages, [
    'Cache TTL: mini 00:29',
    'Cache TTL: mini 00:39',
  ]);
});

test('shows only the two most recently refreshed models', async () => {
  const time = createFakeTime();
  const messages = [];
  const clock = createClock(time, messages);

  clock.updateCheckpoint(
    checkpoint(
      ['old', 200_000, 190],
      ['newest', 130_000, 80],
      ['middle', 80_000, 50]
    )
  );
  clock.startPreview();
  await time.advance(1_000);

  assert.deepEqual(messages, ['Cache TTL: newest 02:09 | middle 01:19']);
});

test('accepts a live entry whose refresh time is already in the past', async () => {
  const time = createFakeTime(5_000);
  const messages = [];
  const clock = createClock(time, messages);

  assert.equal(
    clock.updateCheckpoint(checkpoint(['mini', 30_000, 30])),
    true
  );
  assert.equal(clock.startPreview(), true);
  await time.advance(1_000);

  assert.deepEqual(messages, ['Cache TTL: mini 00:24']);
});

test('ignores malformed checkpoints and expired entries', async () => {
  const time = createFakeTime(10_000);
  const messages = [];
  const clock = createClock(time, messages);

  assert.equal(clock.updateCheckpoint({}), false);
  assert.equal(clock.startPreview(), false);

  assert.equal(
    clock.updateCheckpoint({
      modelCacheState: [
        {
          modelId: 'expired',
          cacheExpiresAt: new Date(9_000).toISOString(),
          cacheTtlSeconds: 30,
        },
        {
          modelId: '',
          cacheExpiresAt: new Date(40_000).toISOString(),
          cacheTtlSeconds: 30,
        },
        {
          modelId: 'live',
          cacheExpiresAt: new Date(40_000).toISOString(),
          cacheTtlSeconds: 30,
        },
      ],
    }),
    true
  );
  clock.startPreview();
  await time.advance(1_000);

  assert.deepEqual(messages, ['Cache TTL: live 00:29']);
});

test('main turns cancel once and restart on the first idle event', () => {
  const calls = [];
  const gate = createCacheClockTurnGate({
    cancelPreview() {
      calls.push('cancel');
    },
    startPreview() {
      calls.push('start');
      return true;
    },
  });

  assert.equal(gate.start('subagent-1'), false);
  assert.equal(gate.idle(), false);
  assert.equal(gate.start(undefined), true);
  assert.equal(gate.idle('subagent-1'), false);
  assert.equal(gate.idle(), true);
  assert.equal(gate.idle(), false);
  assert.deepEqual(calls, ['cancel', 'start']);
});

test('loads the extension with clock events wired through the SDK', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cache-clock-extension-'));
  const stateKey = `__cacheClockTest_${Date.now()}_${Math.random()}`;
  globalThis[stateKey] = { events: [], logs: [] };

  t.after(async () => {
    delete globalThis[stateKey];
    await rm(root, { recursive: true, force: true });
  });

  const sourcePlugin = fileURLToPath(
    new URL('../../plugins/cache-continuity', import.meta.url)
  );
  const copiedPlugin = join(root, 'plugins', 'cache-continuity');
  await mkdir(join(root, 'plugins'), { recursive: true });
  await cp(sourcePlugin, copiedPlugin, { recursive: true });

  const sdk = join(root, 'node_modules', '@github', 'copilot-sdk');
  await mkdir(sdk, { recursive: true });
  await writeFile(
    join(sdk, 'package.json'),
    JSON.stringify({
      name: '@github/copilot-sdk',
      type: 'module',
      exports: { './extension': './extension.mjs' },
    })
  );
  await writeFile(
    join(sdk, 'extension.mjs'),
    `export async function joinSession() {
  return {
    async log(message) {
      globalThis[${JSON.stringify(stateKey)}].logs.push(message);
    },
    on(name) {
      globalThis[${JSON.stringify(stateKey)}].events.push(name);
    },
  };
}
`
  );

  const extension = join(
    copiedPlugin,
    'extensions',
    'cache-continuity-notifier',
    'extension.mjs'
  );
  await import(pathToFileURL(extension).href);

  const state = globalThis[stateKey];
  assert.ok(state.logs.includes('Cache continuity notifier active.'));
  for (const event of [
    'session.usage_checkpoint',
    'session.idle',
    'assistant.idle',
  ]) {
    assert.ok(state.events.includes(event), `missing ${event} listener`);
  }
});

function createClock(time, messages) {
  return createCacheClock({
    now: time.now,
    schedule: time.schedule,
    cancel: time.cancel,
    emit(message) {
      messages.push(message);
    },
  });
}

function checkpoint(...entries) {
  return {
    modelCacheState: entries.map(([modelId, expiresAt, ttlSeconds]) => ({
      modelId,
      cacheExpiresAt: new Date(expiresAt).toISOString(),
      cacheTtlSeconds: ttlSeconds,
    })),
  };
}

function createFakeTime(start = 0) {
  let current = start;
  let nextId = 0;
  const tasks = new Map();

  return {
    now: () => current,
    schedule(callback, delay) {
      const id = ++nextId;
      tasks.set(id, { callback, due: current + delay });
      return id;
    },
    cancel(id) {
      tasks.delete(id);
    },
    pending: () => tasks.size,
    async advance(duration) {
      const target = current + duration;

      while (true) {
        await flushMicrotasks();
        const next = [...tasks.entries()]
          .filter(([, task]) => task.due <= target)
          .sort(
            ([leftId, left], [rightId, right]) =>
              left.due - right.due || leftId - rightId
          )[0];
        if (!next) break;

        const [id, task] = next;
        tasks.delete(id);
        current = task.due;
        task.callback();
        await flushMicrotasks();
      }

      current = target;
      await flushMicrotasks();
    },
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}
