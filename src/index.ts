#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { planCommand } from "./commands/plan.js";
import { buildCommand } from "./commands/build.js";
import { statusCommand } from "./commands/status.js";
import { escalateCommand } from "./commands/escalate.js";
import { diagnoseCommand } from "./commands/diagnose.js";
import { modelCommand } from "./commands/model.js";
import { loadAsiaEnv } from "./env.js";

loadAsiaEnv();

const program = new Command();

program
  .name("counsel-asia")
  .description("Cost-optimized multi-agent build orchestrator for Asian cloud models. Kimi orchestrates; DeepSeek and Qwen build; hard dollar budgets on every task.")
  .version("0.1.0");

program
  .command("init")
  .description("Create the .counsel/ workspace with default (cloud-first, dollar-capped) config")
  .argument("[idea]", "optional project idea to seed goal.md")
  .action(initCommand);

program
  .command("plan")
  .description("Orchestrator (Kimi) -> validated task graph (one cheap gated call)")
  .argument("<idea>", "what you want built")
  .action(planCommand);

program
  .command("build")
  .description("Route the next task to the cheapest suitable model; draft a structured patch")
  .option("--apply", "test-gate the patch in an isolated worktree and apply it on green", false)
  .option("--all", "process every actionable task (dependency order), one attempt each", false)
  .action((opts) => buildCommand({ apply: opts.apply, all: opts.all }));

program
  .command("status")
  .description("Show config posture, task progress, and spend (total / per-model / remaining)")
  .action(statusCommand);

program
  .command("model")
  .description("Show or switch the model roles: orchestrator | coder | coder_cheap | fallback")
  .argument("[role]", "role to show or switch")
  .argument("[provider]", "kimi | deepseek | qwen | ollama | disabled")
  .argument("[model]", "optional model name to pin")
  .action(modelCommand);

program
  .command("escalate")
  .description("MANUAL, budget-gated escalation of one task to the orchestrator (Kimi)")
  .argument("<taskId>", "id of the task to escalate")
  .action(escalateCommand);

program
  .command("diagnose")
  .description("Repair loop: feed a failed task's test output back through the routed role for a corrected patch")
  .argument("<taskId>", "id of the task to repair")
  .option("--apply", "test-gate the corrected patch and apply it on green", false)
  .action((taskId, opts) => diagnoseCommand(taskId, { apply: opts.apply }));

program.parseAsync(process.argv).catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
