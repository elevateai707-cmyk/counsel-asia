import type { Config } from "../config.js";
import { loadConfig } from "../config.js";
import type { Task, TaskGraph } from "../tasks.js";
import { loadTasks, saveTasks } from "../tasks.js";
import { resolveRoute } from "../router.js";
import { makeProvider, profileForRoute } from "../providers/index.js";
import { logEvent, readLedger, recordCost, spendForTask, totalSpend } from "../ledger.js";
import { cloudGate } from "../gate.js";
import { estimateCostUsd, knownModel, roughTokenEstimate } from "../pricing.js";
import { PATCH_SYSTEM, parsePatch, savePatch } from "../patch.js";
import { applyPatch } from "../apply.js";
import { settleAfterApply } from "../settle.js";

interface BuildOpts {
  apply?: boolean;
  all?: boolean;
}

/**
 * The first pending/in-progress task whose dependencies are all `done` and which
 * we haven't already handled this run. Keeping `build` dependency-aware means
 * `--all` processes a graph in a safe order and never builds a task before its
 * prerequisites.
 */
export function nextActionable(graph: TaskGraph, visited: Set<string>): Task | undefined {
  const doneIds = new Set(graph.tasks.filter((t) => t.status === "done").map((t) => t.id));
  return graph.tasks.find(
    (t) =>
      !visited.has(t.id) &&
      (t.status === "pending" || t.status === "in_progress") &&
      t.dependsOn.every((d) => doneIds.has(d)),
  );
}

/**
 * `counsel-asia build` — the cost-tiered router picks a role (orchestrator /
 * coder / coder-cheap), the budget gate checks the USD caps, and the chosen
 * provider drafts a structured JSON patch. With `--apply` the patch is
 * test-gated in an isolated worktree (kept only if tests pass). `--all`
 * repeats this for every actionable task, in dependency order, one attempt
 * each. Every paid call logs a real-token `cost` event to the ledger.
 */
export async function buildCommand(opts: BuildOpts = {}): Promise<void> {
  const config = await loadConfig();
  const graph = await loadTasks();
  if (!graph) {
    console.log(`No tasks. Run: counsel-asia plan "<idea>" first.`);
    return;
  }

  if (opts.all) return buildAll(graph, config, opts);

  const next = nextActionable(graph, new Set());
  if (!next) {
    const pending = graph.tasks.some((t) => t.status === "pending" || t.status === "in_progress");
    console.log(pending ? `No actionable task — remaining ones are blocked or waiting on dependencies. See: counsel-asia status` : `✓ No pending tasks — all done. See: counsel-asia status`);
    return;
  }
  await buildOne(graph, next, config, opts);
}

/** Run one task through route → gate → draft → (optional) gated apply. */
async function buildOne(graph: TaskGraph, task: Task, config: Config, opts: BuildOpts): Promise<void> {
  const events = await readLedger();
  const spent = totalSpend(events);
  const decision = resolveRoute(task, config, spent);
  const profile = profileForRoute(decision.route, config);
  const model = profile.model ?? "(default)";

  console.log(`Task ${task.id}: ${task.title}`);
  console.log(`Router -> ${decision.route} (${decision.reason})`);
  console.log(`Role   -> ${profile.provider}:${model}   |   project spend $${spent.toFixed(4)}/$${config.max_usd_per_project.toFixed(2)}, task spend $${spendForTask(events, task.id).toFixed(4)}/$${config.max_usd_per_task.toFixed(2)}`);

  const provider = makeProvider(profile, config);

  const prompt = [
    `Task: ${task.title}`,
    `Kind: ${task.kind}`,
    `Target files: ${task.files.join(", ") || "(you decide)"}`,
    ``,
    `Implement it as a JSON patch per the schema.`,
  ].join("\n");

  if (provider.isCloud) {
    const est = knownModel(model) ? estimateCostUsd(model, roughTokenEstimate(PATCH_SYSTEM.length + prompt.length), 2048) : undefined;
    const gate = await cloudGate({ config, taskId: task.id, provider: profile.provider, model, costEstimateUsd: est });
    if (!gate.allowed) {
      await logEvent({ type: "cloud_call", taskId: task.id, provider: profile.provider, model, approved: false });
      console.log(`\n✗ Cloud call blocked: ${gate.reason}`);
      return;
    }
  }

  task.status = "in_progress";
  task.attempts += 1;
  await saveTasks(graph);
  await logEvent({ type: "attempt", taskId: task.id, n: task.attempts, route: decision.route });

  console.log(`Drafting with ${provider.name}:${model} (${provider.isCloud ? "paid" : "local, $0"})…`);
  const result = await provider.generate(prompt, { system: PATCH_SYSTEM, temperature: 0.2, json: true });

  if (provider.isCloud) {
    await logEvent({ type: "cloud_call", taskId: task.id, provider: provider.name, model: result.model, approved: true });
  }
  const line = await recordCost(result, task.id);
  if (line) console.log(line);
  else if (provider.isCloud) console.log(`   cost: (no usage reported by provider)`);

  let patch;
  try {
    patch = parsePatch(result.text);
  } catch (err) {
    task.status = "pending";
    await saveTasks(graph);
    console.log(`\n✗ Model did not return a valid patch: ${(err as Error).message}`);
    console.log(`  Task left pending — run build again to retry.`);
    return;
  }

  const patchFile = await savePatch(task.id, patch);
  console.log(`\n✓ Patch drafted: ${patchFile}`);
  console.log(`  ${patch.summary || "(no summary)"} — ${patch.files.length} file(s): ${patch.files.map((f) => f.path).join(", ")}`);

  if (!opts.apply) {
    console.log(`\n(draft only — re-run with --apply to test-gate and write it to the tree.)`);
    return;
  }

  // --- isolated, test-gated apply ---
  if (config.test_command) {
    console.log(`\nApplying in an isolated worktree, gating on: ${config.test_command}`);
  } else {
    console.log(`\nApplying (no test_command configured — no gate).`);
  }

  const applied = await applyPatch(patch, config.test_command);
  await logEvent({ type: "test_result", taskId: task.id, passed: applied.passed, summary: applied.summary });

  const { outcome, lines } = settleAfterApply(task, config, applied);
  await saveTasks(graph);
  lines.forEach((l) => console.log(l));

  if (outcome === "blocked") {
    console.log(`  Repair loop: counsel-asia diagnose ${task.id} --apply`);
    console.log(`  Or escalate to the orchestrator (gated): counsel-asia escalate ${task.id}`);
  } else if (outcome === "retry") {
    console.log(`  Re-run to retry: counsel-asia build --apply`);
  }
}

/** Process every actionable task once, in dependency order, then summarise. */
async function buildAll(graph: TaskGraph, config: Config, opts: BuildOpts): Promise<void> {
  const visited = new Set<string>();
  let processed = 0;
  for (;;) {
    const task = nextActionable(graph, visited);
    if (!task) break;
    visited.add(task.id);
    console.log("\n" + "─".repeat(54));
    await buildOne(graph, task, config, opts);
    processed++;
  }

  const count = (s: Task["status"]) => graph.tasks.filter((t) => t.status === s).length;
  console.log("\n" + "═".repeat(54));
  if (processed === 0) {
    console.log(`build --all: nothing actionable. See: counsel-asia status`);
    return;
  }
  const spent = totalSpend(await readLedger());
  console.log(`build --all: processed ${processed} task(s) → done ${count("done")}, blocked ${count("blocked")}, pending ${count("pending")}, in-progress ${count("in_progress")}.`);
  console.log(`  project spend: $${spent.toFixed(4)} / $${config.max_usd_per_project.toFixed(2)}`);

  const blocked = graph.tasks.filter((t) => t.status === "blocked");
  if (blocked.length) {
    console.log(`  Repair: counsel-asia diagnose <id> --apply   (blocked: ${blocked.map((t) => t.id).join(", ")})`);
  }
  const waiting = graph.tasks.filter((t) => t.status === "pending" && !visited.has(t.id));
  if (waiting.length) {
    console.log(`  Waiting on unmet/blocked dependencies: ${waiting.map((t) => t.id).join(", ")}`);
  }
  if (count("pending") - waiting.length > 0) {
    console.log(`  Some tasks need another pass: counsel-asia build --all`);
  }
}
