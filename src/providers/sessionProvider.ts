import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { ModelUsage, UsageCursor, UsageEvent, UsageFile, UsageSnapshot } from '../core/types';

interface SqliteStatement {
  all(...params: unknown[]): Array<Record<string, unknown>>;
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SessionRow {
  id: string;
  cwd: string;
  updatedAt: string;
}

export class SessionProvider {
  private observedSessionId: string | undefined;
  private observedRowId = 0;

  constructor(
    private readonly root: string,
    private readonly copilotDir = join(homedir(), '.copilot'),
  ) {}

  async currentCursor(): Promise<UsageCursor | undefined> {
    return this.withDatabase((db) => {
      const session = this.pickSession(db);
      if (!session) return undefined;
      const usageRow = db.prepare(
        'SELECT COALESCE(MAX(rowid), 0) AS lastRowId FROM assistant_usage_events WHERE session_id = ?',
      ).get(session.id);
      let lastFileId = 0;
      try {
        const fileRow = db.prepare(
          'SELECT COALESCE(MAX(id), 0) AS lastFileId FROM session_files WHERE session_id = ?',
        ).get(session.id);
        lastFileId = numberValue(fileRow?.lastFileId);
      } catch {
        // Older Copilot CLI stores do not have session_files.
      }
      return { sessionId: session.id, lastRowId: numberValue(usageRow?.lastRowId), lastFileId };
    });
  }

  async liveSnapshot(): Promise<UsageSnapshot | undefined> {
    return this.withDatabase((db) => {
      const session = this.pickSession(db);
      if (!session) return undefined;
      const firstObservation = this.observedSessionId !== session.id;
      if (firstObservation) {
        this.observedSessionId = session.id;
        this.observedRowId = 0;
      }
      const snapshot = this.collect(db, session.id, 0, 0, this.observedRowId);
      if (firstObservation && snapshot.events.length > 1) {
        snapshot.events = snapshot.events.slice(-1);
      }
      this.observedRowId = snapshot.lastRowId;
      return snapshot;
    });
  }

  async usageSince(cursor?: UsageCursor): Promise<UsageSnapshot | undefined> {
    return this.withDatabase((db) => {
      const session = this.pickSession(db);
      if (!session) return undefined;
      const sameSession = cursor?.sessionId === session.id;
      const snapshot = this.collect(
        db,
        session.id,
        sameSession ? cursor.lastRowId : 0,
        sameSession ? cursor.lastFileId : 0,
        sameSession ? cursor.lastRowId : 0,
      );
      this.observedSessionId = session.id;
      this.observedRowId = snapshot.lastRowId;
      return snapshot;
    });
  }

  private async withDatabase<T>(read: (db: SqliteDatabase) => T): Promise<T> {
    const dbPath = join(this.copilotDir, 'session-store.db');
    if (!existsSync(dbPath)) {
      throw new Error(`Copilot CLI session store not found at ${dbPath}.`);
    }
    let DatabaseSync: new (path: string, options: { readOnly: boolean }) => SqliteDatabase;
    try {
      ({ DatabaseSync } = await import('node:sqlite') as unknown as {
        DatabaseSync: new (path: string, options: { readOnly: boolean }) => SqliteDatabase;
      });
    } catch {
      throw new Error('This VS Code extension host cannot load node:sqlite; use a VS Code build with Node 22.5 or newer.');
    }
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return read(db);
    } catch (error) {
      throw new Error(`Copilot CLI session schema is not compatible: ${(error as Error).message}`);
    } finally {
      db.close();
    }
  }

  private pickSession(db: SqliteDatabase): SessionRow | undefined {
    const nested = `${this.root}${sep}%`;
    const rows = db.prepare(
      'SELECT id, cwd, updated_at AS updatedAt FROM sessions WHERE cwd = ? OR cwd LIKE ? ORDER BY updated_at DESC',
    ).all(this.root, nested).map((row) => ({
      id: String(row.id),
      cwd: String(row.cwd),
      updatedAt: String(row.updatedAt),
    }));
    return rows.find((row) => this.hasLiveLock(row.id)) ?? rows[0];
  }

  private hasLiveLock(sessionId: string): boolean {
    try {
      return readdirSync(join(this.copilotDir, 'session-state', sessionId))
        .some((file) => /^inuse\..+\.lock$/.test(file));
    } catch {
      return false;
    }
  }

  private collect(
    db: SqliteDatabase,
    sessionId: string,
    sinceRowId: number,
    sinceFileId: number,
    eventRowId: number,
  ): UsageSnapshot {
    const rows = db.prepare(
      `SELECT model, COUNT(*) AS requests,
              SUM(input_tokens) AS input, SUM(cache_read_tokens) AS cached,
              SUM(cache_write_tokens) AS cacheWrite, SUM(output_tokens) AS output,
              SUM(reasoning_tokens) AS reasoning, SUM(total_nano_aiu) / 1e9 AS credits,
              SUM(duration_ms) AS apiDurationMs, MAX(rowid) AS maxRowId
       FROM assistant_usage_events WHERE session_id = ? AND rowid > ?
       GROUP BY model ORDER BY credits DESC`,
    ).all(sessionId, sinceRowId);
    const perModel: ModelUsage[] = rows.map((row) => ({
      model: String(row.model ?? 'unknown'),
      requests: numberValue(row.requests),
      input: numberValue(row.input),
      cached: numberValue(row.cached),
      cacheWrite: numberValue(row.cacheWrite),
      output: numberValue(row.output),
      reasoning: numberValue(row.reasoning),
      credits: numberValue(row.credits),
    }));
    const sum = (key: keyof Omit<ModelUsage, 'model'>) =>
      perModel.reduce((total, model) => total + Number(model[key] ?? 0), 0);
    const lastRowId = rows.length === 0
      ? sinceRowId
      : Math.max(...rows.map((row) => numberValue(row.maxRowId)));
    return {
      sessionId,
      credits: sum('credits'),
      apiDurationMs: rows.reduce((total, row) => total + numberValue(row.apiDurationMs), 0),
      totals: {
        input: sum('input'),
        cached: sum('cached'),
        cacheWrite: sum('cacheWrite'),
        output: sum('output'),
        reasoning: sum('reasoning'),
      },
      perModel,
      lastRowId,
      lastFileId: this.maxFileId(db, sessionId, sinceFileId),
      files: this.filesSince(db, sessionId, sinceFileId),
      events: this.eventsSince(db, sessionId, eventRowId),
    };
  }

  private eventsSince(db: SqliteDatabase, sessionId: string, rowId: number): UsageEvent[] {
    return db.prepare(
      `SELECT rowid AS rowId, model, input_tokens AS inputTokens,
              cache_read_tokens AS cacheReadTokens, output_tokens AS outputTokens,
              total_nano_aiu / 1e9 AS credits
       FROM assistant_usage_events WHERE session_id = ? AND rowid > ? ORDER BY rowid`,
    ).all(sessionId, rowId).map((row) => ({
      rowId: numberValue(row.rowId),
      model: String(row.model ?? 'unknown'),
      inputTokens: nullableNumber(row.inputTokens),
      cacheReadTokens: nullableNumber(row.cacheReadTokens),
      outputTokens: nullableNumber(row.outputTokens),
      credits: numberValue(row.credits),
    }));
  }

  private filesSince(db: SqliteDatabase, sessionId: string, fileId: number): UsageFile[] {
    try {
      return db.prepare(
        'SELECT file_path AS path, tool_name AS tool FROM session_files WHERE session_id = ? AND id > ? ORDER BY id',
      ).all(sessionId, fileId)
        .map((row) => ({ absolute: String(row.path), tool: String(row.tool ?? 'edit') }))
        .filter((file) => !relative(this.root, file.absolute).startsWith('..'))
        .map((file) => ({ path: relative(this.root, file.absolute), tool: file.tool }));
    } catch {
      return [];
    }
  }

  private maxFileId(db: SqliteDatabase, sessionId: string, fileId: number): number {
    try {
      const row = db.prepare(
        'SELECT COALESCE(MAX(id), ?) AS maxFileId FROM session_files WHERE session_id = ? AND id > ?',
      ).get(fileId, sessionId, fileId);
      return numberValue(row?.maxFileId) || fileId;
    } catch {
      return fileId;
    }
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
