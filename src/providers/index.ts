import type { Config, ModelProfile } from "../config.js";
import type { Route } from "../router.js";
import { KimiProvider } from "./kimi.js";
import { DeepSeekProvider } from "./deepseek.js";
import { QwenProvider } from "./qwen.js";
import { OllamaProvider } from "./ollama.js";
import { OpenRouterProvider } from "./openrouter.js";
import type { Provider } from "./types.js";

export * from "./types.js";

/** Build a Provider from a model profile. */
export function makeProvider(profile: ModelProfile, config: Config): Provider {
  switch (profile.provider) {
    case "kimi":
      return new KimiProvider(profile.model ?? "kimi-k3", config.moonshot_url);
    case "deepseek":
      return new DeepSeekProvider(profile.model ?? "deepseek-chat", config.deepseek_url);
    case "qwen":
      return new QwenProvider(profile.model ?? "qwen3-coder-flash", config.qwen_url);
    case "ollama":
      return new OllamaProvider(profile.model ?? "gemma4:e4b", config.ollama_url);
    case "openrouter":
      return new OpenRouterProvider(profile.model ?? "nousresearch/hermes-4-70b", config.openrouter_url);
    case "disabled":
      throw new Error(`Model role is disabled${profile.reason ? ` (${profile.reason})` : ""}.`);
  }
}

/** Map a router route to the configured model profile for that role. */
export function profileForRoute(r: Route, config: Config): ModelProfile {
  switch (r) {
    case "orchestrator":
      return config.models.orchestrator;
    case "coder":
      return config.models.coder;
    case "coder-cheap":
      return config.models.coder_cheap;
  }
}
