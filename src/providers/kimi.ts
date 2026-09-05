import { OpenAICompatibleProvider } from "./openai.js";

/**
 * Kimi (Moonshot AI) — the orchestrator brain. OpenAI-compatible API.
 * Key from MOONSHOT_API_KEY (falls back to KIMI_API_KEY), never stored in
 * config.json; loaded from the environment or ~/.counsel-asia/.env.
 *
 * Default model is `kimi-k3`. Note: `kimi-k2-0905-preview` also works if K3
 * isn't available on the account — set it via the model profile
 * (`counsel-asia model orchestrator kimi kimi-k2-0905-preview`).
 */
export class KimiProvider extends OpenAICompatibleProvider {
  constructor(
    model: string = "kimi-k3",
    baseUrl: string = "https://api.moonshot.ai/v1",
    apiKey: string | undefined = process.env.MOONSHOT_API_KEY ?? process.env.KIMI_API_KEY,
  ) {
    super("kimi", model, baseUrl, apiKey, "MOONSHOT_API_KEY");
  }
}
