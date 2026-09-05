import type { GenerateOptions, GenerateResult, Provider } from "./types.js";

/**
 * Local Ollama provider. Free, runs on the box, never costs money. Talks to the
 * `/api/generate` endpoint with `stream: false` for a single complete response.
 */
export class OllamaProvider implements Provider {
  readonly name = "ollama";
  readonly isCloud = false;

  constructor(
    private readonly model: string,
    private readonly baseUrl: string = "http://localhost:11434",
  ) {}

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: false,
      options: { temperature: opts.temperature ?? 0.2 },
    };
    if (opts.system) body.system = opts.system;
    if (opts.json) body.format = "json";

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Could not reach Ollama at ${this.baseUrl}. Is it running? (\`ollama serve\`). Cause: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama returned ${res.status} ${res.statusText}: ${text}`);
    }

    const data = (await res.json()) as { response?: string; error?: string };
    if (data.error) throw new Error(`Ollama error: ${data.error}`);

    return { text: data.response ?? "", model: this.model, provider: this.name };
  }
}
