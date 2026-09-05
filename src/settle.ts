import type { Task } from "./tasks.js";
import type { Config } from "./config.js";
import type { ApplyResult } from "./apply.js";

export type ApplyOutcome = "done" | "blocked" | "retry";

/**
 * Decide a task's fate after a test-gated apply, and produce the status lines.
 * Pure except for mutating `task.status`: pass → done; fail with the cheap-tier
 * attempt budget exhausted → blocked; fail with budget left → back to pending.
 * Shared by `build --apply` and `diagnose --apply` so they never drift.
 */
export function settleAfterApply(task: Task, config: Config, applied: ApplyResult): { outcome: ApplyOutcome; lines: string[] } {
  if (applied.passed) {
    task.status = "done";
    return { outcome: "done", lines: [`✓ ${applied.summary}`, `✓ Applied (${applied.method}). Task ${task.id} marked done.`] };
  }
  if (task.attempts >= config.cheap_attempts_before_orchestrator) {
    task.status = "blocked";
    return { outcome: "blocked", lines: [`✗ ${applied.summary}`, `✗ ${task.attempts} cheap-tier attempt(s) exhausted — task BLOCKED.`] };
  }
  task.status = "pending";
  return { outcome: "retry", lines: [`✗ ${applied.summary}`, `  Attempt ${task.attempts}/${config.cheap_attempts_before_orchestrator} failed.`] };
}
