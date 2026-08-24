import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SessionProvider } from '../providers/sessionProvider';

test('session provider returns task deltas and repo-relative files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tokenlens-repo-'));
  const copilotDir = mkdtempSync(join(tmpdir(), 'tokenlens-copilot-'));
  const db = new DatabaseSync(join(copilotDir, 'session-store.db'));
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, updated_at TEXT);
    CREATE TABLE assistant_usage_events (
      session_id TEXT, model TEXT, input_tokens INTEGER, cache_read_tokens INTEGER,
      cache_write_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
      total_nano_aiu INTEGER, duration_ms INTEGER
    );
    CREATE TABLE session_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, file_path TEXT, tool_name TEXT
    );
  `);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('session-a', root, '2026-08-24T00:00:00Z');
  insertEvent(db, 10, 4);
  db.prepare('INSERT INTO session_files (session_id, file_path, tool_name) VALUES (?, ?, ?)')
    .run('session-a', join(root, 'src', 'before.ts'), 'edit');
  const baseline = { sessionId: 'session-a', lastRowId: 1, lastFileId: 1 };
  insertEvent(db, 20, 6, 15);
  db.prepare('INSERT INTO session_files (session_id, file_path, tool_name) VALUES (?, ?, ?)')
    .run('session-a', join(root, 'src', 'after.ts'), 'create');
  db.close();

  const provider = new SessionProvider(root, copilotDir);
  const snapshot = await provider.usageSince(baseline);
  assert.ok(snapshot);
  assert.equal(snapshot.credits, 6);
  assert.equal(snapshot.totals.input, 20);
  assert.equal(snapshot.totals.cached, 15);
  assert.deepEqual(snapshot.files, [{ path: join('src', 'after.ts'), tool: 'create' }]);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.lastRowId, 2);
  assert.equal(snapshot.lastFileId, 2);
});

test('live session selection prefers an in-use lock', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tokenlens-repo-'));
  const copilotDir = mkdtempSync(join(tmpdir(), 'tokenlens-copilot-'));
  const db = new DatabaseSync(join(copilotDir, 'session-store.db'));
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, updated_at TEXT);
    CREATE TABLE assistant_usage_events (
      session_id TEXT, model TEXT, input_tokens INTEGER, cache_read_tokens INTEGER,
      cache_write_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
      total_nano_aiu INTEGER, duration_ms INTEGER
    );
    CREATE TABLE session_files (id INTEGER PRIMARY KEY, session_id TEXT, file_path TEXT, tool_name TEXT);
  `);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('live', root, '2026-08-24T00:00:00Z');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('newer', root, '2026-08-24T01:00:00Z');
  db.prepare(`INSERT INTO assistant_usage_events VALUES ('live', 'model-a', 10, 0, 0, 1, 0, 1000000000, 1)`).run();
  db.prepare(`INSERT INTO assistant_usage_events VALUES ('newer', 'model-b', 10, 0, 0, 1, 0, 2000000000, 1)`).run();
  db.close();
  mkdirSync(join(copilotDir, 'session-state', 'live'), { recursive: true });
  writeFileSync(join(copilotDir, 'session-state', 'live', 'inuse.123.lock'), '');

  const snapshot = await new SessionProvider(root, copilotDir).liveSnapshot();
  assert.equal(snapshot?.sessionId, 'live');
  assert.equal(snapshot?.credits, 1);
});

function insertEvent(db: DatabaseSync, input: number, credits: number, cached = 0): void {
  db.prepare(
    `INSERT INTO assistant_usage_events
      (session_id, model, input_tokens, cache_read_tokens, cache_write_tokens,
       output_tokens, reasoning_tokens, total_nano_aiu, duration_ms)
     VALUES (?, ?, ?, ?, 0, 1, 0, ?, 10)`,
  ).run('session-a', 'claude-sonnet-4.5', input, cached, credits * 1e9);
}
