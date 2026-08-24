export type SizeBucket = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface BucketRange {
  min: number;
  max: number | null;
}

export interface GitSnapshot {
  branch: string | null;
  changedFiles: number;
  addedFiles: number;
  deletedFiles: number;
  insertions: number;
  deletions: number;
  modules: string[];
  files: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
    insertions: number;
    deletions: number;
  }>;
}

export interface TaskAnalogue {
  id: string;
  description: string;
  bucket: SizeBucket;
  actualCredits: number;
  similarity: number;
  issueNumber?: number;
}

export interface TaskEstimate {
  bucket: SizeBucket;
  min: number;
  max: number | null;
  expectedCredits: number;
  confidence: number;
  drivers: string[];
  analogues: TaskAnalogue[];
}

export interface UsageTotals {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

export interface ModelUsage extends UsageTotals {
  model: string;
  requests: number;
  credits: number;
}

export interface UsageEvent {
  rowId: number;
  model: string;
  reasoningEffort?: string;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  outputTokens: number | null;
  credits: number;
}

export interface UsageFile {
  path: string;
  tool: string;
}

export interface UsageCursor {
  sessionId: string;
  lastRowId: number;
  lastFileId: number;
}

export interface UsageSnapshot extends UsageCursor {
  credits: number;
  apiDurationMs: number;
  totals: UsageTotals;
  perModel: ModelUsage[];
  files: UsageFile[];
  events: UsageEvent[];
}

export interface GitHubLink {
  owner: string;
  repo: string;
  issueNumber: number;
  issueUrl: string;
}

export interface TaskRecord {
  id: string;
  description: string;
  status: 'active' | 'completed';
  estimate: TaskEstimate;
  startedAt: string;
  completedAt?: string;
  startGit: GitSnapshot;
  endGit?: GitSnapshot;
  usageBaseline?: UsageCursor;
  usage?: UsageSnapshot;
  verdict?: 'under' | 'on-target' | 'over' | 'unknown';
  github?: GitHubLink;
  syncedAt?: string;
}

export interface CalibrationBucket {
  bucket: SizeBucket;
  hits: number;
  total: number;
}

export interface CalibrationSummary {
  recorded: number;
  hits: number;
  rate: number | null;
  byBucket: CalibrationBucket[];
}
