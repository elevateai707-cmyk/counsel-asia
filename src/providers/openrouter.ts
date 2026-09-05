import { OpenAICompatibleProvider } from "./openai.js";

/**
 * OpenRouter — hosts the Hermes routing agent (and can back any role).
 * OpenAI-compatible Chat Completions API. Key from OPENROUTER_API_KEY, never
 * stored in config.json; loaded from the environment or ~/.counsel-asia/.env.
 *
 * Default model is `nousresearch/hermes-4-70b`. Note:
 * `nousresearch/hermes-4-405b` also works if you want a stronger routing
 * brain — set it via the model profile
 * (`counsel-asia model router openrouter nousresearch/hermes-4-405b`).
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(
    model: string = "nousresearch/hermes-4-70b",
    baseUrl: string = "https://openrouter.ai/api/v1",
    apiKey: string | undefined = process.env.OPENROUTER_API_KEY,
  ) {
    super("openrouter", model, baseUrl, apiKey, "OPENROUTER_API_KEY");
  }
}
