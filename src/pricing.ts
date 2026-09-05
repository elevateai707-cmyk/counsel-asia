/**
 * Per-model pricing table: USD per 1M tokens.
 *
 * ⚠️  VERIFY THESE AGAINST THE VENDOR PRICING PAGES — they change.
 * Edit here when prices change; everything downstream (cost estimates,
 * ledger events, status) reads from this table.
 *   - DeepSeek:   https://api-docs.deepseek.com/quick_start/pricing
 *   - Moonshot:   https://platform.moonshot.ai/docs/pricing
 *   - Qwen:       https://www.alibabacloud.com/help/en/model-studio/models
 */
export interface ModelPrice {
  /** USD per 1M input tokens (cache miss). */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M input tokens served from the vendor's context cache, if offered. */
  cacheHitInput?: number;
}

export const PRICING: Record<string, ModelPrice> = {
  // DeepSeek charges a lower rate for context-cache hits.
  "deepseek-chat": { input: 0.27, output: 1.1, cacheHitInput: 0.07 },
  "kimi-k3": { input: 0.6, output: 2.5 },
  "kimi-k2-0905-preview": { input: 0.6, output: 2.5 },
  "qwen3-coder-flash": { input: 0.3, output: 1.5 },
  "qwen-flash": { input: 0.05, output: 0.4 },
};

/** True when we have a price on record for this model. */
export function knownModel(model: string): boolean {
  return model in PRICING;
}

/**
 * USD cost of one call. Cache-hit input tokens are billed at the (cheaper)
 * cache-hit rate when the vendor offers one; otherwise they bill as normal
 * input. Unknown models cost 0 here — check `knownModel` first and warn.
 */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheHitTokens = 0,
): number {
  const price = PRICING[model];
  if (!price) return 0;
  const hits = Math.min(Math.max(cacheHitTokens, 0), promptTokens);
  const miss = promptTokens - hits;
  const hitRate = price.cacheHitInput ?? price.input;
  return (miss / 1_000_000) * price.input + (hits / 1_000_000) * hitRate + (completionTokens / 1_000_000) * price.output;
}

/** Rough token estimate from character count (~4 chars/token) for pre-call estimates. */
export function roughTokenEstimate(chars: number): number {
  return Math.ceil(chars / 4);
}
