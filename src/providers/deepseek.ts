import { OpenAICompatibleProvider } from "./openai.js";

/**
 * DeepSeek — the workhorse coder. OpenAI-compatible Chat Completions API.
 * Key from DEEPSEEK_API_KEY, never stored in config.json; loaded from the
 * environment or ~/.counsel-asia/.env.
 *
 * DeepSeek offers context caching: cache-hit input tokens bill at the cheaper
 * `cacheHitInput` rate, accounted for in src/pricing.ts via the API's
 * `prompt_cache_hit_tokens` usage field.
 */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(
    model: string = "deepseek-chat",
    baseUrl: string = "https://api.deepseek.com",
    apiKey: string | undefined = process.env.DEEPSEEK_API_KEY,
  ) {
    super("deepseek", model, baseUrl, apiKey, "DEEPSEEK_API_KEY");
  }
}
