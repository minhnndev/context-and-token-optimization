export const SIGNIFICANT_CACHE_DELTA_TOKENS = 4096;

export function createTurnEntryGate() {
  let awaitingUsage = false;

  return {
    start(agentId) {
      if (agentId == null) awaitingUsage = true;
    },
    take(isEligible) {
      if (!awaitingUsage || !isEligible) return false;
      awaitingUsage = false;
      return true;
    },
  };
}

export function createCacheTurnObserver(
  significantThreshold = SIGNIFICANT_CACHE_DELTA_TOKENS
) {
  let previous;
  const seenConfigurations = new Set();

  return {
    observe(data = {}) {
      const current = {
        model: data.model ?? 'unknown',
        reasoningEffort: data.reasoningEffort ?? 'default',
        inputTokens: normalizeCount(data.inputTokens),
        cacheReadTokens: normalizeCount(data.cacheReadTokens),
      };
      current.configuration = `${current.model}\0${current.reasoningEffort}`;

      const seenBefore = seenConfigurations.has(current.configuration);
      const transition = classifyTransition(previous, current, seenBefore);
      const cacheDelta =
        previous?.cacheReadTokens != null && current.cacheReadTokens != null
          ? current.cacheReadTokens - previous.cacheReadTokens
          : null;

      seenConfigurations.add(current.configuration);
      previous = current;

      return {
        ...current,
        transition,
        cacheDelta,
        significant:
          cacheDelta != null && Math.abs(cacheDelta) >= significantThreshold,
      };
    },
  };
}

export function formatCacheTurn(turn) {
  const parts = [
    `Cache: ${turn.model} / ${turn.reasoningEffort}`,
    formatReuse(turn.cacheReadTokens, turn.inputTokens),
    turn.transition,
  ];

  if (turn.significant) {
    parts.push(`cache change ${formatSignedTokens(turn.cacheDelta)}`);
  }

  return parts.join(' | ');
}

function classifyTransition(previous, current, seenBefore) {
  if (!previous) return 'baseline';
  if (current.configuration === previous.configuration) return 'same configuration';
  if (seenBefore) return 'returned to seen configuration';

  const modelChanged = current.model !== previous.model;
  const effortChanged = current.reasoningEffort !== previous.reasoningEffort;
  if (modelChanged && effortChanged) return 'model + reasoning changed';
  if (modelChanged) return 'model changed';
  return 'reasoning changed';
}

function normalizeCount(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatReuse(cached, input) {
  if (cached == null || input == null) return 'cache data unavailable';
  if (input === 0) return `${formatTokens(cached)} of 0 reused (n/a)`;

  const percentage = Math.min(100, Math.round((cached / input) * 100));
  return `${formatTokens(cached)} of ${formatTokens(input)} reused (${percentage}%)`;
}

function formatSignedTokens(value) {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatTokens(Math.abs(value))}`;
}

function formatTokens(value) {
  return new Intl.NumberFormat('en-US').format(value);
}
