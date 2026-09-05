import { estimateCostUsd, knownModel } from "../pricing.js";
import { counselAsiaHome } from "../paths.js";
import { MissingApiKeyError, type GenerateOptions, type GenerateResult, type Provider } from "./types.js";

/**
 * Generic OpenAI-compatible Chat Completions provider over fetch. Kimi
 * (Moonshot), DeepSeek, and Qwen (DashScope compatible-mode) all speak this
 * API, so one class parameterized by name + base URL + key env var serves all
 * three. Concrete wrappers live in kimi.ts / deepseek.ts / qwen.ts.
 */
export class OpenAICompatibleProvider implements Provider {
  readonly isCloud = true;

  constructor(
    readonly name: string,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    /** Env var(s) named in the missing-key error. */
    private readonly keyEnvVar: string,
  ) {}

  /** True when a key is configured. */
  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /** Fail loudly and actionably — never silently fall back to another model. */
  protected requireKey(): string {
    if (!this.apiKey) {
      throw new MissingApiKeyError(
        this.name,
        this.keyEnvVar,
        `Export it, or add "${this.keyEnvVar}=..." to ${counselAsiaHome()}/.env (override dir with COUNSEL_ASIA_HOME).`,
      );
    }
    return this.apiKey;
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
    const apiKey = this.requireKey();

    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    messages.push({ role: "user", content: prompt });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.json) body.response_format = { type: "json_object" };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Could not reach ${this.name} at ${this.baseUrl}. Cause: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${this.name} returned ${res.status} ${res.statusText}: ${text}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
      error?: { message?: string };
    };
    if (data.error) throw new Error(`${this.name} error: ${data.error.message ?? "unknown"}`);

    const result: GenerateResult = {
      text: data.choices?.[0]?.message?.content ?? "",
      model: this.model,
      provider: this.name,
    };

    // Populate real token cost when the API reports usage; degrade gracefully
    // (usage simply absent) when it doesn't.
    const u = data.usage;
    if (u && typeof u.prompt_tokens === "number" && typeof u.completion_tokens === "number") {
      result.usage = {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        costUsd: estimateCostUsd(this.model, u.prompt_tokens, u.completion_tokens, u.prompt_cache_hit_tokens ?? 0),
      };
      if (!knownModel(this.model)) {
        console.warn(`  (warn) no price on record for "${this.model}" — cost logged as $0. Edit src/pricing.ts.`);
      }
    }

    return result;
  }
}
