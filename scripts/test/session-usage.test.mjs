// Fixture-driven tests for session-usage.mjs: a fake ~/.copilot with the same
// schema Copilot CLI 1.0.76-5 writes, so the delta/cursor and session-picking
// logic is verified without a real session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  openSessionStore, pickSession, usageSince, filesSince,
  readCursor, writeCursor, collectSessionUsage, CURSOR_FILE,
} from '../session-usage.mjs';

const ROOT = '/work/repo';

function makeFixture({ sessions = [], events = [], files = [], locks = [] } = {}) {
  const copilotDir = mkdtempSync(join(tmpdir(), 'copilot-fixture-'));
  const db = new DatabaseSync(join(copilotDir, 'session-store.db'));
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, host_type TEXT,
      branch TEXT, summary TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE assistant_usage_events (session_id TEXT, turn_index INTEGER, model TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
      cache_write_tokens INTEGER, reasoning_tokens INTEGER, total_nano_aiu INTEGER,
      duration_ms INTEGER, created_at TEXT);
    CREATE TABLE session_files (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      file_path TEXT NOT NULL, tool_name TEXT, turn_index INTEGER,
      first_seen_at TEXT, UNIQUE(session_id, file_path));
  `);
  for (const s of sessions) {
    db.prepare('INSERT INTO sessions (id, cwd, repository, updated_at) VALUES (?, ?, ?, ?)')
      .run(s.id, s.cwd ?? ROOT, s.repository ?? 'o/r', s.updatedAt ?? '2026-07-12T10:00:00Z');
  }
  for (const e of events) {
    db.prepare(
      `INSERT INTO assistant_usage_events (session_id, turn_index, model, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_tokens, total_nano_aiu, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(e.sessionId, e.turn ?? 0, e.model, e.input ?? 0, e.output ?? 0, e.cached ?? 0,
      e.cacheWrite ?? 0, e.reasoning ?? 0, Math.round((e.credits ?? 0) * 1e9), e.durationMs ?? 0, '2026-07-12T10:00:00Z');
  }
  for (const f of files) {
    db.prepare('INSERT INTO session_files (session_id, file_path, tool_name, turn_index) VALUES (?, ?, ?, ?)')
      .run(f.sessionId, f.path, f.tool ?? 'edit', f.turn ?? 0);
  }
  db.close();
  for (const id of locks) {
    mkdirSync(join(copilotDir, 'session-state', id), { recursive: true });
    writeFileSync(join(copilotDir, 'session-state', id, 'inuse.12345.lock'), '');
  }
  return copilotDir;
}

test('nano-AIU sums convert to credits, grouped per model', async () => {
  const copilotDir = makeFixture({
    sessions: [{ id: 'a' }],
    events: [
      { sessionId: 'a', model: 'claude-sonnet-4.6', input: 20859, output: 105, credits: 7.976 },
      { sessionId: 'a', model: 'claude-sonnet-4.6', input: 21046, output: 166, cached: 20805, credits: 0.959 },
      { sessionId: 'a', model: 'gpt-5.6-luna', input: 17887, output: 123, reasoning: 40, credits: 2.31 },
    ],
  });
  const db = await openSessionStore(copilotDir);
  const usage = usageSince(db, 'a');
  db.close();
  assert.equal(Math.round(usage.credits * 1000) / 1000, 11.245);
  assert.equal(usage.totals.input, 59792);
  assert.equal(usage.totals.cached, 20805);
  assert.equal(usage.totals.reasoning, 40);
  assert.equal(usage.perModel.length, 2);
  assert.equal(usage.perModel[0].model, 'claude-sonnet-4.6'); // highest credits first
  assert.equal(usage.perModel[0].requests, 2);
  assert.equal(usage.maxRowId, 3);
});

test('a live inuse lock beats a more recently updated session', async () => {
  const copilotDir = makeFixture({
    sessions: [
      { id: 'old-but-live', updatedAt: '2026-07-12T09:00:00Z' },
      { id: 'newer-but-exited', updatedAt: '2026-07-12T11:00:00Z' },
    ],
    locks: ['old-but-live'],
  });
  const db = await openSessionStore(copilotDir);
  assert.equal(pickSession(db, { root: ROOT, copilotDir }).id, 'old-but-live');
  db.close();
});

test('sessions from other directories are ignored; subdirectory cwd matches', async () => {
  const copilotDir = makeFixture({
    sessions: [
      { id: 'other-repo', cwd: '/work/other', updatedAt: '2026-07-12T12:00:00Z' },
      { id: 'subdir', cwd: `${ROOT}/console`, updatedAt: '2026-07-12T10:00:00Z' },
    ],
  });
  const db = await openSessionStore(copilotDir);
  assert.equal(pickSession(db, { root: ROOT, copilotDir }).id, 'subdir');
  db.close();
});

test('cursor makes the second recording a delta, not the session total', async () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  const copilotDir = makeFixture({
    sessions: [{ id: 'a', cwd: root }],
    events: [
      { sessionId: 'a', model: 'm', input: 100, output: 10, credits: 4.46 },
      { sessionId: 'a', model: 'm', input: 200, output: 20, credits: 3.0 },
    ],
  });
  const first = await collectSessionUsage({ copilotDir, root });
  assert.equal(first.credits, 7.46); // whole session: no cursor yet
  writeCursor(root, { sessionId: first.sessionId, lastRowId: first.maxRowId });

  // /clear + a new task appends to the SAME session — only its rows count now.
  const db = new DatabaseSync(join(copilotDir, 'session-store.db'));
  db.prepare(
    `INSERT INTO assistant_usage_events (session_id, turn_index, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, total_nano_aiu, duration_ms, created_at)
     VALUES ('a', 1, 'm', 50, 5, 0, 0, 0, 2500000000, 0, '2026-07-12T11:00:00Z')`
  ).run();
  db.close();
  const second = await collectSessionUsage({ copilotDir, root });
  assert.equal(second.credits, 2.5);
  assert.equal(second.sinceRowId, first.maxRowId);
  rmSync(join(root, CURSOR_FILE));
});

test('a cursor from an exited session is ignored — fresh session counts in full', async () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  const copilotDir = makeFixture({
    sessions: [{ id: 'fresh', cwd: root }],
    events: [{ sessionId: 'fresh', model: 'm', input: 10, output: 1, credits: 1.5 }],
  });
  writeCursor(root, { sessionId: 'gone', lastRowId: 999 });
  const usage = await collectSessionUsage({ copilotDir, root });
  assert.equal(usage.credits, 1.5);
  assert.equal(usage.sinceRowId, 0);
  rmSync(join(root, CURSOR_FILE));
});

test('fails loudly, with the /usage fallback, when there is nothing to record', async () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  const copilotDir = makeFixture({ sessions: [{ id: 'a', cwd: root }] });
  await assert.rejects(collectSessionUsage({ copilotDir, root }), /no new usage.*\n.*--credits/s);
});

test('fails loudly when the store is missing or the schema drifted', async () => {
  await assert.rejects(
    openSessionStore(mkdtempSync(join(tmpdir(), 'empty-'))),
    /session store not found[\s\S]*--credits/
  );
  const copilotDir = mkdtempSync(join(tmpdir(), 'drift-'));
  const db = new DatabaseSync(join(copilotDir, 'session-store.db'));
  db.exec('CREATE TABLE sessions (id TEXT, cwd TEXT, repository TEXT, updated_at TEXT)');
  db.exec('CREATE TABLE assistant_usage_events (session_id TEXT, renamed_tokens INTEGER)');
  db.prepare("INSERT INTO sessions VALUES ('a', '/x', 'o/r', '2026-07-12T10:00:00Z')").run();
  db.close();
  await assert.rejects(collectSessionUsage({ copilotDir, root: '/x' })); // drifted columns must throw, not misreport
});

test('cursor file round-trips', () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  assert.equal(readCursor(root), null);
  writeCursor(root, { sessionId: 's', lastRowId: 7 });
  assert.deepEqual(readCursor(root), { sessionId: 's', lastRowId: 7 });
});

test('files created and edited are reported relative to the repo', async () => {
  const root = '/work/repo';
  const copilotDir = makeFixture({
    sessions: [{ id: 'a' }],
    files: [
      { sessionId: 'a', path: `${root}/console/src/latalert.mjs`, tool: 'create', turn: 1 },
      { sessionId: 'a', path: `${root}/console/src/dash.mjs`, tool: 'edit', turn: 1 },
      { sessionId: 'a', path: '/somewhere/else/notes.md', tool: 'edit', turn: 2 },
      { sessionId: 'other', path: `${root}/console/src/metrics.mjs`, tool: 'edit', turn: 0 },
    ],
  });
  const db = await openSessionStore(copilotDir);
  const { files, maxFileId } = filesSince(db, 'a', 0, root);
  db.close();
  assert.deepEqual(files, [
    { path: 'console/src/latalert.mjs', tool: 'create' },
    { path: 'console/src/dash.mjs', tool: 'edit' },
  ]); // outside the repo and other sessions are dropped
  assert.equal(maxFileId, 3);
});

test('the cursor scopes files to one task, like it scopes credits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  const copilotDir = makeFixture({
    sessions: [{ id: 'a', cwd: root }],
    events: [{ sessionId: 'a', model: 'm', input: 10, output: 1, credits: 4.5 }],
    files: [{ sessionId: 'a', path: `${root}/console/src/thresholds.mjs`, tool: 'edit' }],
  });
  const first = await collectSessionUsage({ copilotDir, root });
  assert.deepEqual(first.files.map((f) => f.path), ['console/src/thresholds.mjs']);
  writeCursor(root, { sessionId: first.sessionId, lastRowId: first.maxRowId, lastFileId: first.maxFileId });

  const db = new DatabaseSync(join(copilotDir, 'session-store.db'));
  db.prepare(
    `INSERT INTO assistant_usage_events (session_id, turn_index, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, total_nano_aiu, duration_ms, created_at)
     VALUES ('a', 1, 'm', 50, 5, 0, 0, 0, 2500000000, 0, '2026-07-12T11:00:00Z')`
  ).run();
  db.prepare("INSERT INTO session_files (session_id, file_path, tool_name, turn_index) VALUES ('a', ?, 'create', 1)")
    .run(`${root}/console/src/alertengine.mjs`);
  db.close();

  const second = await collectSessionUsage({ copilotDir, root });
  assert.deepEqual(second.files, [{ path: 'console/src/alertengine.mjs', tool: 'create' }]); // task 1's file is not replayed
  rmSync(join(root, CURSOR_FILE));
});

test('a store without session_files degrades to no files, never breaks recording', async () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  const copilotDir = mkdtempSync(join(tmpdir(), 'older-cli-'));
  const db = new DatabaseSync(join(copilotDir, 'session-store.db'));
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, updated_at TEXT);
    CREATE TABLE assistant_usage_events (session_id TEXT, turn_index INTEGER, model TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
      cache_write_tokens INTEGER, reasoning_tokens INTEGER, total_nano_aiu INTEGER,
      duration_ms INTEGER, created_at TEXT);
  `);
  db.prepare('INSERT INTO sessions (id, cwd, updated_at) VALUES (?, ?, ?)').run('a', root, '2026-07-12T10:00:00Z');
  db.prepare(
    `INSERT INTO assistant_usage_events (session_id, turn_index, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, total_nano_aiu, duration_ms, created_at)
     VALUES ('a', 0, 'm', 10, 1, 0, 0, 0, 1500000000, 0, '2026-07-12T10:00:00Z')`
  ).run();
  db.close();
  const usage = await collectSessionUsage({ copilotDir, root });
  assert.equal(usage.credits, 1.5);
  assert.deepEqual(usage.files, []);
});
