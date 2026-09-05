import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { defaultConfig, saveConfig } from "../config.js";
import { paths, counselAsiaHome } from "../paths.js";

/**
 * `counsel-asia init` — create the `.counsel/` workspace with the default
 * cloud-first, dollar-capped config. Optionally seed goal.md from an idea.
 */
export async function initCommand(idea?: string): Promise<void> {
  const p = paths();
  if (existsSync(p.config)) {
    console.log(`✓ .counsel/ already initialized at ${p.root}`);
    return;
  }

  await mkdir(p.root, { recursive: true });
  await mkdir(p.contextPacks, { recursive: true });
  await mkdir(p.patches, { recursive: true });
  await mkdir(p.reviews, { recursive: true });

  await saveConfig(defaultConfig());
  await writeFile(p.goal, idea ? `# Goal\n\n${idea}\n` : `# Goal\n\n_Describe what you want built._\n`, "utf8");

  console.log(`✓ Initialized counsel-asia workspace at ${p.root}`);
  console.log(`  orchestrator:  kimi:kimi-k3        (plans + reviews)`);
  console.log(`  coder:         deepseek:deepseek-chat`);
  console.log(`  coder-cheap:   qwen:qwen3-coder-flash`);
  console.log(`  budget:        $0.50/project, $0.10/task, 50 calls/project, 5 calls/task`);
  console.log(`\nAPI keys: export MOONSHOT_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY,`);
  console.log(`or add them to ${counselAsiaHome()}/.env`);
  console.log(`\nNext: counsel-asia plan "<your idea>"`);
}
