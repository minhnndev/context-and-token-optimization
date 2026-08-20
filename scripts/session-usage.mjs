#!/usr/bin/env node
// Read the current Copilot CLI session's AI-credit usage — the same data
// /usage renders — straight from the CLI's own store (~/.copilot/session-store.db,
// table assistant_usage_events; total_nano_aiu / 1e9 = AI credits). The same
// store's session_files table says which files the agent created or edited,
// so a recording captures what the task cost and what it changed.
//
//   node scripts/session-usage.mjs                    # print usage-since-last-recording as JSON
//   node scripts/session-usage.mjs --advance-cursor   # ...and mark this point as recorded
//
// /clear does NOT start a new session, so the session total keeps growing
// across tasks. A cursor file (.ai-usage-cursor.json, gitignored) remembers
// where the last recording stopped; each read returns only the delta since
// then. record-usage.mjs --from-session builds on this.
//
// Verified against Copilot CLI 1.0.76-5. If a newer CLI moves or reshapes the
// store, this script fails loudly and you fall back to reading /usage yourself:
//   node scripts/record-usage.mjs --issue N --credits <what /usage showed>
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';

export const CURSOR_FILE = '.ai-usage-cursor.json';

const FALLBACK =
  'Fallback: read /usage inside Copilot CLI, then record manually:\n' +
  '  node scripts/record-usage.mjs --issue N --credits <what /usage showed>';

// node:sqlite ships with Node >=22.5 but sits behind --experimental-sqlite on
// some 22.x builds. Loaded lazily so importing this module never hard-fails.
async function loadSqlite() {
  // Node tags node:sqlite as experimental and prints a warning on import.
  // Swallow that one warning only; everything else still reaches stderr.
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
    console.error(`${w.name}: ${w.message}`);
  });
  try {
    return await import('node:sqlite');
  } catch {
    throw new Error(
      'This Node build cannot open SQLite (node:sqlite unavailable). ' +
      'Re-run the same command with the flag: node --experimental-sqlite <script> <flags>\n' + FALLBACK
    );
  }
}

export function gitRoot(cwd = process.cwd()) {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : cwd;
}

export async function openSessionStore(copilotDir = join(homedir(), '.copilot')) {
  const dbPath = join(copilotDir, 'session-store.db');
  if (!existsSync(dbPath)) {
    throw new Error(`Copilot CLI session store not found at ${dbPath} — has a session run on this machine?\n${FALLBACK}`);
  }
  const { DatabaseSync } = await loadSqlite();
  return new DatabaseSync(dbPath, { readOnly: true });
}

function hasLiveLock(copilotDir, sessionId) {
  try {
    return readdirSync(join(copilotDir, 'session-state', sessionId))
      .some((f) => /^inuse\..+\.lock$/.test(f));
  } catch {
    return false;
  }
}

// The session Copilot CLI is (or was last) running in this repo: cwd matches
// the git root or a subdirectory of it; a live inuse lock beats recency.
export function pickSession(db, { root, copilotDir = join(homedir(), '.copilot') }) {
  const rows = db
    .prepare('SELECT id, cwd, repository, updated_at FROM sessions WHERE cwd = ? OR cwd LIKE ? ORDER BY updated_at DESC')
    .all(root, `${root}/%`);
  if (rows.length === 0) {
    throw new Error(`No Copilot CLI session found for ${root} — was copilot started inside this repo?\n${FALLBACK}`);
  }
  return rows.find((r) => hasLiveLock(copilotDir, r.id)) ?? rows[0];
}

export function usageSince(db, sessionId, sinceRowId = 0) {
  const perModel = db
    .prepare(
      `SELECT model, COUNT(*) AS requests,
              SUM(input_tokens) AS input, SUM(cache_read_tokens) AS cached,
              SUM(cache_write_tokens) AS cacheWrite, SUM(output_tokens) AS output,
              SUM(reasoning_tokens) AS reasoning,
              SUM(total_nano_aiu) / 1e9 AS credits,
              SUM(duration_ms) AS apiDurationMs, MAX(rowid) AS maxRowId
       FROM assistant_usage_events WHERE session_id = ? AND rowid > ?
       GROUP BY model ORDER BY credits DESC`
    )
    .all(sessionId, sinceRowId);
  const sum = (key) => perModel.reduce((n, m) => n + (m[key] ?? 0), 0);
  return {
    credits: sum('credits'),
    apiDurationMs: sum('apiDurationMs'),
    totals: {
      input: sum('input'), cached: sum('cached'), cacheWrite: sum('cacheWrite'),
      output: sum('output'), reasoning: sum('reasoning'),
    },
    perModel: perModel.map(({ maxRowId, apiDurationMs, ...m }) => m),
    maxRowId: perModel.length ? Math.max(...perModel.map((m) => m.maxRowId)) : sinceRowId,
  };
}

// Which files the agent created or edited, from the same store as the credits.
// session_files has an AUTOINCREMENT id, so the cursor trick used for usage
// events works here too: rows above the cursor belong to the current task.
// Paths are absolute in the store; report them relative to the repo.
export function filesSince(db, sessionId, sinceFileId = 0, root = gitRoot()) {
  let rows;
  try {
    rows = db
      .prepare(
        `SELECT id, file_path, tool_name, turn_index FROM session_files
         WHERE session_id = ? AND id > ? ORDER BY id`
      )
      .all(sessionId, sinceFileId);
  } catch {
    return { files: [], maxFileId: sinceFileId }; // older CLI without session_files
  }
  const prefix = root.endsWith('/') ? root : `${root}/`;
  const files = rows
    .filter((r) => r.file_path.startsWith(prefix))
    .map((r) => ({ path: r.file_path.slice(prefix.length), tool: r.tool_name ?? 'edit' }));
  return {
    files,
    maxFileId: rows.length ? Math.max(...rows.map((r) => r.id)) : sinceFileId,
  };
}

export function readCursor(root) {
  try {
    return JSON.parse(readFileSync(join(root, CURSOR_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export function writeCursor(root, cursor) {
  writeFileSync(join(root, CURSOR_FILE), JSON.stringify(cursor) + '\n');
}

// One-call entry point (record-usage.mjs uses this too): current session's
// usage since the last recording. A cursor from a different session means the
// user exited and started fresh — ignore it and count the whole session.
export async function collectSessionUsage({ copilotDir = join(homedir(), '.copilot'), root = gitRoot() } = {}) {
  const db = await openSessionStore(copilotDir);
  try {
    const session = pickSession(db, { root, copilotDir });
    const cursor = readCursor(root);
    const resumed = cursor?.sessionId === session.id;
    const sinceRowId = resumed ? cursor.lastRowId : 0;
    const usage = usageSince(db, session.id, sinceRowId);
    if (usage.perModel.length === 0) {
      throw new Error(
        `Session ${session.id} has no new usage since the last recording (cursor at row ${sinceRowId}).\n${FALLBACK}`
      );
    }
    // A cursor written before this field existed has no lastFileId; starting at
    // 0 replays that session's earlier files, which is better than losing them.
    const { files, maxFileId } = filesSince(db, session.id, resumed ? cursor.lastFileId ?? 0 : 0, root);
    return { sessionId: session.id, sinceRowId, ...usage, files, maxFileId };
  } finally {
    db.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2), { advanceCursor: 'boolean' });
    const root = gitRoot();
    const usage = await collectSessionUsage({ root });
    if (args.advanceCursor) writeCursor(root, { sessionId: usage.sessionId, lastRowId: usage.maxRowId, lastFileId: usage.maxFileId });
    console.log(JSON.stringify(usage, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
