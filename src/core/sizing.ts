import { GitSnapshot, SizeBucket, TaskEstimate, TaskRecord } from './types';

export const BUCKETS: Record<SizeBucket, { min: number; max: number }> = {
  XS: { min: 0, max: 10 },
  S: { min: 11, max: 30 },
  M: { min: 31, max: 75 },
  L: { min: 76, max: 150 },
  XL: { min: 151, max: Number.POSITIVE_INFINITY },
};

const COMPLEXITY_TERMS = [
  'architecture', 'migration', 'security', 'authentication', 'offline', 'synchronization',
  'sync', 'database', 'refactor', 'cross-platform', 'performance', 'concurrency', 'streaming',
];

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'to', 'for', 'of', 'in', 'on', 'with', 'is', 'are', 'add',
  'fix', 'update', 'create', 'implement', 'change', 'task', 'feature', 'support',
]);

export function bucketForCredits(credits: number): SizeBucket {
  if (credits <= 10) return 'XS';
  if (credits <= 30) return 'S';
  if (credits <= 75) return 'M';
  if (credits <= 150) return 'L';
  return 'XL';
}

export function formatRange(bucket: SizeBucket): string {
  const range = BUCKETS[bucket];
  return Number.isFinite(range.max) ? `${range.min}–${range.max}` : `>${range.min - 1}`;
}

export function estimateTask(
  description: string,
  git: GitSnapshot,
  history: TaskRecord[],
): TaskEstimate {
  const churn = git.insertions + git.deletions;
  const terms = tokenize(description);
  const complexityHits = COMPLEXITY_TERMS.filter((term) => terms.has(term));
  const completed = history.filter(
    (task): task is TaskRecord & { usage: NonNullable<TaskRecord['usage']> } =>
      task.status === 'completed' && Boolean(task.usage) && task.usage!.credits >= 0,
  );

  const analogues = completed
    .map((task) => ({
      task,
      similarity: similarity(description, git, task),
    }))
    .filter(({ similarity: score }) => score >= 0.08)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);

  let expected = 7;
  expected += Math.min(42, git.changedFiles * 3.5);
  expected += Math.min(24, git.addedFiles * 6);
  expected += Math.min(36, churn / 45);
  expected += Math.max(0, git.modules.length - 1) * 7;
  expected += complexityHits.length * 9;

  if (analogues.length > 0) {
    const totalWeight = analogues.reduce((sum, item) => sum + item.similarity, 0);
    const historical = analogues.reduce(
      (sum, item) => sum + item.task.usage.credits * item.similarity,
      0,
    ) / totalWeight;
    const historyWeight = Math.min(0.65, 0.25 + analogues[0].similarity * 0.5);
    expected = expected * (1 - historyWeight) + historical * historyWeight;
  }

  expected = Math.max(0, Math.round(expected * 10) / 10);
  const bucket = bucketForCredits(expected);
  const range = BUCKETS[bucket];
  const evidence = Math.min(0.14, git.changedFiles * 0.012 + Math.min(churn, 1000) / 15000);
  const historyEvidence = Math.min(0.22, analogues.reduce((sum, item) => sum + item.similarity, 0) * 0.12);
  const confidence = Math.min(0.92, Math.round((0.55 + evidence + historyEvidence) * 100) / 100);

  const drivers: string[] = [];
  if (git.changedFiles > 0) drivers.push(`${git.changedFiles} affected file${git.changedFiles === 1 ? '' : 's'}`);
  if (git.addedFiles > 0) drivers.push(`${git.addedFiles} new file${git.addedFiles === 1 ? '' : 's'}`);
  if (churn > 0) drivers.push(`${churn.toLocaleString('en-US')} changed lines`);
  if (git.modules.length > 1) drivers.push(`Cross-module change (${git.modules.length} areas)`);
  if (complexityHits.length > 0) drivers.push(`Complexity signals: ${complexityHits.join(', ')}`);
  if (analogues.length > 0) drivers.push(`${analogues.length} similar recorded task${analogues.length === 1 ? '' : 's'}`);
  if (drivers.length === 0) drivers.push('Description-only estimate; confidence improves after scope is visible in Git');

  return {
    bucket,
    min: range.min,
    max: Number.isFinite(range.max) ? range.max : null,
    expectedCredits: expected,
    confidence,
    drivers,
    analogues: analogues.map(({ task, similarity: score }) => ({
      id: task.id,
      description: task.description,
      bucket: task.estimate.bucket,
      actualCredits: task.usage.credits,
      similarity: Math.round(score * 100) / 100,
      issueNumber: task.github?.issueNumber,
    })),
  };
}

function similarity(description: string, git: GitSnapshot, task: TaskRecord): number {
  const left = tokenize(description);
  const right = tokenize(task.description);
  const union = new Set([...left, ...right]);
  const intersection = [...left].filter((term) => right.has(term)).length;
  const textScore = union.size === 0 ? 0 : intersection / union.size;

  const currentModules = new Set(git.modules);
  const oldModules = new Set(task.endGit?.modules ?? task.startGit.modules);
  const moduleUnion = new Set([...currentModules, ...oldModules]);
  const moduleIntersection = [...currentModules].filter((module) => oldModules.has(module)).length;
  const moduleScore = moduleUnion.size === 0 ? 0 : moduleIntersection / moduleUnion.size;
  return textScore * 0.75 + moduleScore * 0.25;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1 && !STOP_WORDS.has(term)),
  );
}
