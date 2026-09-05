import { OpenAICompatibleProvider } from "./openai.js";

/**
 * Qwen via Alibaba DashScope's OpenAI-compatible mode — the cheapest coder,
 * used for boilerplate / css / docs. Key from DASHSCOPE_API_KEY (falls back
 * to QWEN_API_KEY), never stored in config.json; loaded from the environment
 * or ~/.counsel-asia/.env.
 */
export class QwenProvider extends OpenAICompatibleProvider {
  constructor(
    model: string = "qwen3-coder-flash",
    baseUrl: string = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKey: string | undefined = process.env.DASHSCOPE_API_KEY ?? process.env.QWEN_API_KEY,
  ) {
    super("qwen", model, baseUrl, apiKey, "DASHSCOPE_API_KEY");
  }
}
