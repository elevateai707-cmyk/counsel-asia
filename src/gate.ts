import { createInterface } from "node:readline/promises";
import type { Config } from "./config.js";
import { readLedger, cloudCallsThisProject, cloudCallsForTask, totalSpend, spendForTask } from "./ledger.js";

export interface GateResult {
  allowed: boolean;
  reason: string;
}

/**
 * The hard budget gate. Before ANY cloud call we check cloud is enabled, the
 * per-project / per-task USD caps (summed from `cost` events in the ledger),
 * and the per-project / per-task call-count caps. A reached cap is a hard
 * refusal with a reason naming the cap. The interactive y/N prompt fires only
 * when `require_user_approval_for_cloud` is true. Nothing here calls a model.
 */
export async function cloudGate(opts: {
  config: Config;
  taskId: string;
  provider: string;
  model: string;
  costEstimateUsd?: number;
}): Promise<GateResult> {
  const { config, taskId, provider, model, costEstimateUsd } = opts;

  if (!config.cloud_enabled) {
    return { allowed: false, reason: "cloud_enabled is false — refusing all paid calls." };
  }

  const events = await readLedger();
  const projCount = cloudCallsThisProject(events);
  const taskCount = cloudCallsForTask(events, taskId);
  const projSpend = totalSpend(events);
  const taskSpend = spendForTask(events, taskId);

  if (projSpend >= config.max_usd_per_project) {
    return {
      allowed: false,
      reason: `project USD cap reached ($${projSpend.toFixed(4)} / $${config.max_usd_per_project.toFixed(2)} max_usd_per_project).`,
    };
  }
  if (taskSpend >= config.max_usd_per_task) {
    return {
      allowed: false,
      reason: `task USD cap reached ($${taskSpend.toFixed(4)} / $${config.max_usd_per_task.toFixed(2)} max_usd_per_task) for ${taskId}.`,
    };
  }
  if (projCount >= config.max_cloud_calls_per_project) {
    return { allowed: false, reason: `project cloud-call cap reached (${projCount}/${config.max_cloud_calls_per_project}).` };
  }
  if (taskCount >= config.max_cloud_calls_per_task) {
    return { allowed: false, reason: `task cloud-call cap reached (${taskCount}/${config.max_cloud_calls_per_task}).` };
  }

  if (!config.require_user_approval_for_cloud) {
    return { allowed: true, reason: "approval not required by config (USD caps are the guardrail)." };
  }

  // Interactive confirmation.
  console.log(`\n⚠️  CLOUD CALL REQUESTED — this costs real money.`);
  console.log(`   task:     ${taskId}`);
  console.log(`   provider: ${provider}:${model}`);
  console.log(`   est cost: ${costEstimateUsd != null ? `~$${costEstimateUsd.toFixed(4)}` : "unknown"}`);
  console.log(`   spend:    project $${projSpend.toFixed(4)}/$${config.max_usd_per_project.toFixed(2)}, task $${taskSpend.toFixed(4)}/$${config.max_usd_per_task.toFixed(2)}`);
  console.log(`   calls:    project ${projCount}/${config.max_cloud_calls_per_project}, task ${taskCount}/${config.max_cloud_calls_per_task}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`   Approve? [y/N] `)).trim().toLowerCase();
    const ok = answer === "y" || answer === "yes";
    return { allowed: ok, reason: ok ? "user approved." : "user declined." };
  } finally {
    rl.close();
  }
}
