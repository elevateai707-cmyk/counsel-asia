import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { paths } from "./paths.js";

/**
 * A single model profile. `provider: "disabled"` means the role is turned off
 * entirely.
 */
export const ModelProfile = z.object({
  provider: z.enum(["kimi", "deepseek", "qwen", "ollama", "disabled"]),
  model: z.string().optional(),
  reason: z.string().optional(),
});
export type ModelProfile = z.infer<typeof ModelProfile>;

export const Config = z.object({
  // --- hard budget controls (dollar-first: the USD caps are the guardrail) ---
  cloud_enabled: z.boolean().default(true),
  max_usd_per_project: z.number().nonnegative().default(0.5),
  max_usd_per_task: z.number().nonnegative().default(0.1),
  max_cloud_calls_per_project: z.number().int().nonnegative().default(50),
  max_cloud_calls_per_task: z.number().int().nonnegative().default(5),
  require_user_approval_for_cloud: z.boolean().default(false),
  /** Cheap-tier attempts before the router hands a blocked task to the orchestrator. */
  cheap_attempts_before_orchestrator: z.number().int().positive().default(3),

  // Test gate for `counsel-asia build --apply`. Run in an isolated worktree; the
  // patch is only kept if this exits 0. Empty string disables the gate (apply
  // unconditionally). Shell command, run via execa with shell:true.
  test_command: z.string().default("npm test"),

  // --- model profiles by role ---
  models: z
    .object({
      orchestrator: ModelProfile.default({ provider: "kimi", model: "kimi-k3" }),
      coder: ModelProfile.default({ provider: "deepseek", model: "deepseek-chat" }),
      coder_cheap: ModelProfile.default({ provider: "qwen", model: "qwen3-coder-flash" }),
      // Explicit $0 fallback — point a role at this when an API key is missing.
      fallback: ModelProfile.default({ provider: "ollama", model: "gemma4:e4b" }),
    })
    .default({}),

  // Provider endpoints (OpenAI-compatible, except Ollama). API keys are read
  // from the environment or ~/.counsel-asia/.env, never stored here.
  moonshot_url: z.string().default("https://api.moonshot.ai/v1"),
  deepseek_url: z.string().default("https://api.deepseek.com"),
  qwen_url: z.string().default("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
  ollama_url: z.string().default("http://localhost:11434"),
});
export type Config = z.infer<typeof Config>;

/** Defaults produced purely from the schema. */
export function defaultConfig(): Config {
  return Config.parse({});
}

/** Load `.counsel/config.json`, falling back to schema defaults if absent. */
export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  const p = paths(cwd);
  if (!existsSync(p.config)) return defaultConfig();
  const raw = await readFile(p.config, "utf8");
  return Config.parse(JSON.parse(raw));
}

/** Persist config, creating `.counsel/` if needed. Re-validates before writing. */
export async function saveConfig(config: Config, cwd: string = process.cwd()): Promise<void> {
  const p = paths(cwd);
  await mkdir(p.root, { recursive: true });
  const validated = Config.parse(config);
  await writeFile(p.config, JSON.stringify(validated, null, 2) + "\n", "utf8");
}
