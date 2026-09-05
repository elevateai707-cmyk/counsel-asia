/** A model provider abstraction. All providers share this shape. */
export interface GenerateOptions {
  /** System / instruction prompt. */
  system?: string;
  /** Force deterministic-ish output for planning. */
  temperature?: number;
  /** Hint the model to return JSON (OpenAI-compatible `response_format`). */
  json?: boolean;
}

export interface GenerateUsage {
  promptTokens: number;
  completionTokens: number;
  /** Real USD cost computed from the API usage field via src/pricing.ts. */
  costUsd: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  provider: string;
  /** Present when the API returned a usage field; absent otherwise. */
  usage?: GenerateUsage;
}

export interface Provider {
  readonly name: string;
  /** True if calling this provider can incur real money cost. */
  readonly isCloud: boolean;
  generate(prompt: string, opts?: GenerateOptions): Promise<GenerateResult>;
}

/** Raised when a cloud provider has no API key configured. */
export class MissingApiKeyError extends Error {
  constructor(provider: string, envVar: string, hint: string) {
    super(`${envVar} is not set — ${provider} cannot be called. ${hint}`);
    this.name = "MissingApiKeyError";
  }
}
