import { UsageEvent } from './types';

export const SIGNIFICANT_CACHE_DELTA_TOKENS = 4096;

export type CacheTransition =
  | 'baseline'
  | 'same configuration'
  | 'returned to seen configuration'
  | 'model changed'
  | 'reasoning changed'
  | 'model + reasoning changed';

export interface CacheTurn {
  model: string;
  reasoningEffort: string;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  reuseRate: number | null;
  transition: CacheTransition;
  cacheDelta: number | null;
  significant: boolean;
}

export class CacheTurnObserver {
  private previous: (CacheTurn & { configuration: string }) | undefined;
  private readonly seenConfigurations = new Set<string>();

  constructor(private readonly significantThreshold = SIGNIFICANT_CACHE_DELTA_TOKENS) {}

  observe(event: UsageEvent): CacheTurn {
    const model = event.model || 'unknown';
    const reasoningEffort = event.reasoningEffort || 'unavailable';
    const inputTokens = normalizeCount(event.inputTokens);
    const cacheReadTokens = normalizeCount(event.cacheReadTokens);
    const configuration = `${model}\0${reasoningEffort}`;
    const seenBefore = this.seenConfigurations.has(configuration);
    const transition = classifyTransition(this.previous, { model, reasoningEffort, configuration }, seenBefore);
    const cacheDelta = this.previous?.cacheReadTokens != null && cacheReadTokens != null
      ? cacheReadTokens - this.previous.cacheReadTokens
      : null;
    const reuseRate = inputTokens && cacheReadTokens != null
      ? Math.min(1, cacheReadTokens / inputTokens)
      : inputTokens === 0 ? null : null;
    const turn = {
      model,
      reasoningEffort,
      inputTokens,
      cacheReadTokens,
      reuseRate,
      transition,
      cacheDelta,
      significant: cacheDelta != null && Math.abs(cacheDelta) >= this.significantThreshold,
      configuration,
    };
    this.seenConfigurations.add(configuration);
    this.previous = turn;
    return turn;
  }
}

export function formatCacheTurn(turn: CacheTurn): string {
  const reuse = turn.reuseRate == null
    ? 'cache data unavailable'
    : `${formatTokens(turn.cacheReadTokens ?? 0)} of ${formatTokens(turn.inputTokens ?? 0)} reused (${Math.round(turn.reuseRate * 100)}%)`;
  const delta = turn.significant && turn.cacheDelta != null
    ? ` | cache change ${turn.cacheDelta >= 0 ? '+' : '-'}${formatTokens(Math.abs(turn.cacheDelta))}`
    : '';
  return `Cache: ${turn.model} / ${turn.reasoningEffort} | ${reuse} | ${turn.transition}${delta}`;
}

function classifyTransition(
  previous: { model: string; reasoningEffort: string; configuration: string } | undefined,
  current: { model: string; reasoningEffort: string; configuration: string },
  seenBefore: boolean,
): CacheTransition {
  if (!previous) return 'baseline';
  if (current.configuration === previous.configuration) return 'same configuration';
  if (seenBefore) return 'returned to seen configuration';
  const modelChanged = current.model !== previous.model;
  const effortChanged = current.reasoningEffort !== previous.reasoningEffort;
  if (modelChanged && effortChanged) return 'model + reasoning changed';
  if (modelChanged) return 'model changed';
  return 'reasoning changed';
}

function normalizeCount(value: number | null): number | null {
  return Number.isFinite(value) && value != null && value >= 0 ? value : null;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
