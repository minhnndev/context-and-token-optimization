import { BUCKETS } from './sizing';
import { CalibrationSummary, SizeBucket, TaskRecord } from './types';

export function verdictFor(bucket: SizeBucket, actualCredits: number): TaskRecord['verdict'] {
  const range = BUCKETS[bucket];
  if (actualCredits < range.min) return 'under';
  if (actualCredits > range.max) return 'over';
  return 'on-target';
}

export function buildMarker(data: unknown, kind = 'ai-usage'): string {
  return `<!-- ${kind} ${JSON.stringify(data)} -->`;
}

export function extractMarker<T>(body: string, kind = 'ai-usage'): T | null {
  const escaped = kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`<!--\\s*${escaped}\\s+(\\{.*?\\})\\s*-->`, 's'));
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as T;
  } catch {
    return null;
  }
}

export function calibrationSummary(tasks: TaskRecord[]): CalibrationSummary {
  const completed = tasks.filter(
    (task) => task.status === 'completed' && task.verdict && task.verdict !== 'unknown',
  );
  const order: SizeBucket[] = ['XS', 'S', 'M', 'L', 'XL'];
  const byBucket = order.map((bucket) => {
    const entries = completed.filter((task) => task.estimate.bucket === bucket);
    return {
      bucket,
      total: entries.length,
      hits: entries.filter((task) => task.verdict === 'on-target').length,
    };
  }).filter((entry) => entry.total > 0);
  const hits = byBucket.reduce((sum, entry) => sum + entry.hits, 0);
  return {
    recorded: completed.length,
    hits,
    rate: completed.length === 0 ? null : hits / completed.length,
    byBucket,
  };
}
