import { loadConfig } from "../config.js";
import { loadTasks, saveTasks } from "../tasks.js";
import { readLedger, logEvent, recordCost, spendForTask, totalSpend } from "../ledger.js";
import { resolveRoute } from "../router.js";
import { makeProvider, profileForRoute } from "../providers/index.js";
import { cloudGate } from "../gate.js";
import { estimateCostUsd, knownModel, roughTokenEstimate } from "../pricing.js";
import { PATCH_SYSTEM, parsePatch, savePatch, loadPatch } from "../patch.js";
import { applyPatch } from "../apply.js";
import { settleAfterApply } from "../settle.js";

const truncate = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + "…" : s);

/**
 * `counsel-asia diagnose <taskId> [--apply]` — the repair loop. Takes a task
 * that failed the test gate, feeds the previous patch + the captured test
 * failure back through the router's chosen role (cheap by default; blocked
 * tasks past the attempt threshold escalate to the orchestrator), and drafts a
 * corrected patch. With `--apply` it test-gates the corrected patch
 * immediately. Every paid call is gated and cost-logged.
 */
export async function diagnoseCommand(taskId: string, opts: { apply?: boolean } = {}): Promise<void> {
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

  const ledger = await readLedger();
  const lastFail = [...ledger].reverse().find((e) => e.type === "test_result" && e.taskId === taskId && !e.passed);
  if (!lastFail || lastFail.type !== "test_result") {
    console.log(`No failing test result on record for ${taskId} — nothing to diagnose.`);
    console.log(`  Run \`counsel-asia build --apply\` first; diagnose repairs what the test gate rejected.`);
    return;
  }

  const decision = resolveRoute(task, config, totalSpend(ledger));
  const profile = profileForRoute(decision.route, config);
  const model = profile.model ?? "(default)";
  const provider = makeProvider(profile, config);

  const prior = await loadPatch(taskId);
  console.log(`Diagnosing ${taskId}: ${task.title}`);
  console.log(`Router -> ${decision.route} (${decision.reason})`);
  console.log(`Last failure: ${truncate(lastFail.summary ?? "(no summary)")}`);

  const prompt = [
    `Task: ${task.title}`,
    `Kind: ${task.kind}`,
    ``,
    prior ? `Your previous patch (it FAILED the test gate):\n${JSON.stringify(prior, null, 2)}` : `(no previous patch on record)`,
    ``,
    `The test gate failed with this output:`,
    lastFail.summary ?? "(no output captured)",
    ``,
    `Produce a CORRECTED JSON patch that fixes the failure. Full file contents, smallest change that makes the tests pass.`,
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

  console.log(`Repairing with ${provider.name}:${model}…`);
  const result = await provider.generate(prompt, { system: PATCH_SYSTEM, temperature: 0.2, json: true });

  if (provider.isCloud) {
    await logEvent({ type: "cloud_call", taskId: task.id, provider: provider.name, model: result.model, approved: true });
  }
  const costOut = await recordCost(result, task.id);
  if (costOut) console.log(costOut);
  else if (provider.isCloud) console.log(`   cost: (no usage reported by provider)`);
  console.log(`   task spend: $${spendForTask(await readLedger(), task.id).toFixed(4)} / $${config.max_usd_per_task.toFixed(2)}`);

  let patch;
  try {
    patch = parsePatch(result.text);
  } catch (err) {
    console.log(`\n✗ Model did not return a valid patch: ${(err as Error).message}`);
    console.log(`  Task left as-is — run diagnose again to retry.`);
    return;
  }

  const file = await savePatch(taskId, patch);
  await logEvent({ type: "diagnosis", taskId, basedOn: truncate(lastFail.summary ?? "", 160) });
  console.log(`\n✓ Corrected patch drafted: ${file}`);
  console.log(`  ${patch.summary || "(no summary)"} — ${patch.files.length} file(s): ${patch.files.map((f) => f.path).join(", ")}`);

  if (!opts.apply) {
    if (task.status === "blocked") {
      task.status = "pending";
      await saveTasks(graph);
      console.log(`  Task un-blocked → pending.`);
    }
    console.log(`\nApply it: counsel-asia diagnose ${taskId} --apply   (or: counsel-asia build --apply)`);
    return;
  }

  // --apply: test-gate the corrected patch against THIS task right now.
  if (config.test_command) console.log(`\nApplying in an isolated worktree, gating on: ${config.test_command}`);
  else console.log(`\nApplying (no test_command configured — no gate).`);

  const applied = await applyPatch(patch, config.test_command);
  await logEvent({ type: "test_result", taskId, passed: applied.passed, summary: applied.summary });

  const { outcome, lines } = settleAfterApply(task, config, applied);
  await saveTasks(graph);
  lines.forEach((l) => console.log(l));

  if (outcome === "blocked") {
    console.log(`  Diagnose again: counsel-asia diagnose ${taskId} --apply`);
    console.log(`  Or escalate to the orchestrator (gated): counsel-asia escalate ${taskId}`);
  } else if (outcome === "retry") {
    console.log(`  Diagnose again: counsel-asia diagnose ${taskId} --apply`);
  }
}
