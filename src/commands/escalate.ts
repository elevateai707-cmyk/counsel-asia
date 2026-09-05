import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { loadTasks } from "../tasks.js";
import { makeProvider } from "../providers/index.js";
import { cloudGate } from "../gate.js";
import { logEvent, recordCost } from "../ledger.js";
import { estimateCostUsd, knownModel, roughTokenEstimate } from "../pricing.js";
import { paths } from "../paths.js";

/**
 * `counsel-asia escalate <taskId>` — MANUAL escalation to the orchestrator
 * (Kimi) with a compressed context pack, through the hard budget gate. Logs
 * the decision and the real token cost; a failed call does not consume the
 * call-count budget.
 */
export async function escalateCommand(taskId: string): Promise<void> {
  const config = await loadConfig();
  const graph = await loadTasks();
  if (!graph) {
    console.log(`No tasks. Run: counsel-asia plan "<idea>" first.`);
    return;
  }
  const task = graph.tasks.find((t) => t.id === taskId);
  if (!task) {
    console.log(`No task "${taskId}". See: counsel-asia status`);
    return;
  }

  const profile = config.models.orchestrator;
  const model = profile.model ?? "(default)";

  // Write a compressed context pack for the escalation.
  await mkdir(paths().contextPacks, { recursive: true });
  const packFile = join(paths().contextPacks, `${task.id}.md`);
  const pack =
    `# Context pack: ${task.id}\n\nGoal: ${graph.goal}\nTask: ${task.title}\n` +
    `Kind: ${task.kind} / Risk: ${task.risk}\nAttempts: ${task.attempts}\n` +
    `Files: ${task.files.join(", ") || "(none)"}\n`;
  await writeFile(packFile, pack, "utf8");
  console.log(`Context pack -> ${packFile}`);

  await logEvent({ type: "escalation_request", taskId: task.id, to: "orchestrator", reason: "manual escalate" });

  const est = knownModel(model) ? estimateCostUsd(model, roughTokenEstimate(pack.length), 2048) : undefined;
  const gate = await cloudGate({ config, taskId: task.id, provider: profile.provider, model, costEstimateUsd: est });

  if (!gate.allowed) {
    await logEvent({ type: "cloud_call", taskId: task.id, provider: profile.provider, model, approved: false });
    console.log(`\n✗ Cloud call blocked: ${gate.reason}`);
    return;
  }

  console.log(`\n✓ Approved: ${gate.reason} Calling ${profile.provider}:${model}…`);
  const provider = makeProvider(profile, config);
  let result;
  try {
    result = await provider.generate(`See context pack:\n\n${pack}`);
  } catch (err) {
    // Failed calls never consume the cloud-call budget.
    console.log(`\n✗ Orchestrator call failed (no budget consumed): ${(err as Error).message}`);
    return;
  }

  const out = join(paths().reviews, `${task.id}.md`);
  await mkdir(paths().reviews, { recursive: true });
  await writeFile(out, result.text, "utf8");
  await logEvent({ type: "cloud_call", taskId: task.id, provider: profile.provider, model: result.model, approved: true });
  const line = await recordCost(result, task.id);
  if (line) console.log(line);
  console.log(`✓ Orchestrator output -> ${out}`);
}
