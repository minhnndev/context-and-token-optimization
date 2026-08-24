import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ModelRate {
  inPer1M: number;
  outPer1M: number;
  cachedInPer1M?: number;
  cacheWritePer1M?: number;
}

export interface PricingRates {
  creditUsd: number;
  autoDiscount: number;
  models: Record<string, ModelRate>;
  verifiedAgainstDocs?: string;
  source?: string;
  note?: string;
}

export async function loadBundledRates(extensionPath: string): Promise<PricingRates> {
  const raw = await readFile(join(extensionPath, 'scripts', 'rates.json'), 'utf8');
  return JSON.parse(raw) as PricingRates;
}

export function tokensToCredits(
  usage: { inputTokens: number; outputTokens: number; cachedTokens?: number; cacheWriteTokens?: number },
  model: string,
  rates: PricingRates,
  auto = false,
): number {
  const rate = rates.models[model];
  if (!rate) throw new Error(`Unknown model "${model}".`);
  if (usage.cachedTokens && rate.cachedInPer1M == null) {
    throw new Error(`No cache-read rate is configured for "${model}".`);
  }
  if (usage.cacheWriteTokens && rate.cacheWritePer1M == null) {
    throw new Error(`No cache-write rate is configured for "${model}".`);
  }
  let usd = usage.inputTokens / 1e6 * rate.inPer1M
    + usage.outputTokens / 1e6 * rate.outPer1M
    + (usage.cachedTokens ?? 0) / 1e6 * (rate.cachedInPer1M ?? 0)
    + (usage.cacheWriteTokens ?? 0) / 1e6 * (rate.cacheWritePer1M ?? 0);
  if (auto) usd *= rates.autoDiscount;
  return usd / rates.creditUsd;
}
