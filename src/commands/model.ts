import { loadConfig, saveConfig, type Config, type ModelProfile } from "../config.js";
import { counselAsiaHome } from "../paths.js";

/** The model roles this fork routes between. */
const ROLES = ["router", "orchestrator", "coder", "coder_cheap", "fallback"] as const;
type Role = (typeof ROLES)[number];

/** Providers a role can point at. */
const PROVIDERS = ["kimi", "deepseek", "qwen", "ollama", "openrouter", "disabled"] as const;
type ProviderName = (typeof PROVIDERS)[number];

/** Sensible default model per provider when the user doesn't name one. */
const DEFAULT_MODEL: Record<ProviderName, string | undefined> = {
  kimi: "kimi-k3",
  deepseek: "deepseek-chat",
  qwen: "qwen3-coder-flash",
  ollama: "gemma4:e4b",
  openrouter: "nousresearch/hermes-4-70b",
  disabled: undefined,
};

/** Which env var funds each provider (for readiness hints). */
const KEY_ENV: Partial<Record<ProviderName, string>> = {
  kimi: "MOONSHOT_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function isRole(x: string): x is Role {
  return (ROLES as readonly string[]).includes(x);
}
function isProvider(x: string): x is ProviderName {
  return (PROVIDERS as readonly string[]).includes(x);
}

function describe(p: ModelProfile): string {
  return `${p.provider}${p.model ? `:${p.model}` : ""}`;
}

function showAll(config: Config): void {
  console.log(`Model roles:`);
  for (const r of ROLES) {
    console.log(`  ${r.padEnd(13)} ${describe(config.models[r])}`);
  }
  console.log(`\nSwitch with: counsel-asia model <role> <${PROVIDERS.join(" | ")}> [model]`);
}

/**
 * `counsel-asia model [role] [provider] [model]` — show or switch which
 * provider/model fills each role for this project. No args prints all roles.
 * Writes `.counsel/config.json`.
 */
export async function modelCommand(role?: string, provider?: string, model?: string): Promise<void> {
  const config = await loadConfig();

  if (!role) {
    showAll(config);
    return;
  }

  const roleName = role.toLowerCase();
  if (!isRole(roleName)) {
    console.log(`Unknown role "${role}". Choose one of: ${ROLES.join(", ")}`);
    return;
  }
  if (!provider) {
    console.log(`${roleName}: ${describe(config.models[roleName])}`);
    console.log(`Switch with: counsel-asia model ${roleName} <${PROVIDERS.join(" | ")}> [model]`);
    return;
  }

  const choice = provider.toLowerCase();
  if (!isProvider(choice)) {
    console.log(`Unknown provider "${provider}". Choose one of: ${PROVIDERS.join(", ")}`);
    return;
  }

  config.models[roleName] = { provider: choice, model: model ?? DEFAULT_MODEL[choice] };
  await saveConfig(config);
  console.log(`✓ ${roleName} → ${describe(config.models[roleName])}`);

  // Readiness hints — never block the switch, just flag what's missing.
  const envVar = KEY_ENV[choice];
  if (envVar && !process.env[envVar]) {
    console.log(`  ⚠  No ${envVar} found — export it, or: echo '${envVar}=...' >> ${counselAsiaHome()}/.env`);
  }
  if (choice === "ollama") {
    console.log(`  Free local path ($0). Make sure the model is pulled: ollama list`);
  }
}
