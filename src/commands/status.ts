import { loadConfig } from "../config.js";
import { loadTasks } from "../tasks.js";
import { readLedger, cloudCallsThisProject, totalSpend, spendByModel } from "../ledger.js";

/** `counsel-asia status` — config posture, task progress, and the spend ledger. */
export async function statusCommand(): Promise<void> {
  const config = await loadConfig();
  const graph = await loadTasks();
  const events = await readLedger();
  const spent = totalSpend(events);

  const role = (label: string, p: { provider: string; model?: string }) =>
    console.log(`  ${label.padEnd(13)} ${p.provider}${p.model ? `:${p.model}` : ""}`);

  console.log(`counsel-asia status`);
  console.log(`───────────────────`);
  console.log(`models:`);
  role("orchestrator", config.models.orchestrator);
  role("coder", config.models.coder);
  role("coder-cheap", config.models.coder_cheap);
  role("fallback", config.models.fallback);
  console.log(`caps:`);
  console.log(`  cloud_enabled: ${config.cloud_enabled}   approval prompt: ${config.require_user_approval_for_cloud}`);
  console.log(`  budget: $${config.max_usd_per_project.toFixed(2)}/project, $${config.max_usd_per_task.toFixed(2)}/task`);
  console.log(`  calls:  ${cloudCallsThisProject(events)}/${config.max_cloud_calls_per_project} project, ${config.max_cloud_calls_per_task}/task`);

  console.log(`\nspend:`);
  console.log(`  total:     $${spent.toFixed(4)}`);
  const byModel = spendByModel(events);
  const modelRows = Object.entries(byModel);
  if (modelRows.length === 0) console.log(`  per model: (none yet)`);
  else for (const [m, usd] of modelRows) console.log(`  per model: ${m}  $${usd.toFixed(4)}`);
  const remaining = config.max_usd_per_project - spent;
  console.log(`  remaining: $${remaining.toFixed(4)} of $${config.max_usd_per_project.toFixed(2)} project budget`);

  if (!graph) {
    console.log(`\nNo task graph yet. Run: counsel-asia plan "<idea>"`);
    return;
  }

  const byStatus = graph.tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\ngoal: ${graph.goal}`);
  console.log(`tasks: ${graph.tasks.length}  (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ")})`);
  for (const t of graph.tasks) {
    const mark = t.status === "done" ? "✓" : t.status === "blocked" ? "✗" : "·";
    console.log(`  ${mark} ${t.id}  [${t.kind}/${t.risk}]  ${t.title}  (attempts: ${t.attempts})`);
  }
}
