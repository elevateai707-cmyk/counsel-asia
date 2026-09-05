import type { Config } from "./config.js";
import type { Task } from "./tasks.js";

/**
 * The "Token Economist": a pure, deterministic, cost-tiered router. Given a
 * task, the config, and current project spend, it returns which role should do
 * the work. NO LLM is consulted here — that is the whole point. Routing is
 * cheap, predictable, and free.
 */

export type Route = "orchestrator" | "coder" | "coder-cheap";

export interface RouteDecision {
  route: Route;
  /** Human-readable justification, logged + shown to the user. */
  reason: string;
}

/**
 * Policy (mirrors README):
 *   risk = security | payments           -> orchestrator (Kimi review)
 *   blocked AND attempts >= threshold    -> orchestrator (hard repair)
 *   kind = integration                   -> orchestrator (largest context)
 *   kind = logic | ui | test-fix         -> coder (DeepSeek)
 *   kind = boilerplate | css | docs      -> coder-cheap (Qwen)
 *
 * When project spend is within 10% of `max_usd_per_project`, routes are
 * downgraded one tier (orchestrator -> coder, coder -> coder-cheap) and the
 * reason says so. `spentUsd` is passed in to keep this function pure.
 */
export function route(task: Task, config: Config, spentUsd = 0): RouteDecision {
  const threshold = config.cheap_attempts_before_orchestrator;
  let decision: RouteDecision;

  if (task.risk === "security" || task.risk === "payments") {
    decision = { route: "orchestrator", reason: `risk=${task.risk} -> orchestrator (Kimi review)` };
  } else if (task.status === "blocked" && task.attempts >= threshold) {
    decision = {
      route: "orchestrator",
      reason: `blocked after ${task.attempts} attempts (>= ${threshold}) -> orchestrator (hard repair)`,
    };
  } else if (task.kind === "integration") {
    decision = { route: "orchestrator", reason: `kind=integration -> orchestrator (largest context)` };
  } else if (task.kind === "logic" || task.kind === "ui" || task.kind === "test-fix") {
    decision = { route: "coder", reason: `kind=${task.kind} -> coder (DeepSeek)` };
  } else {
    decision = { route: "coder-cheap", reason: `kind=${task.kind} -> coder-cheap (Qwen)` };
  }

  // Near-budget downgrade: within 10% of the project USD cap, drop one tier.
  const cap = config.max_usd_per_project;
  if (cap > 0 && spentUsd >= 0.9 * cap) {
    if (decision.route === "orchestrator") {
      decision = { route: "coder", reason: `${decision.reason}; downgraded to coder (spend $${spentUsd.toFixed(4)} within 10% of $${cap.toFixed(2)} cap)` };
    } else if (decision.route === "coder") {
      decision = { route: "coder-cheap", reason: `${decision.reason}; downgraded to coder-cheap (spend $${spentUsd.toFixed(4)} within 10% of $${cap.toFixed(2)} cap)` };
    } else {
      decision = { ...decision, reason: `${decision.reason}; already at cheapest tier (spend $${spentUsd.toFixed(4)} within 10% of $${cap.toFixed(2)} cap)` };
    }
  }

  return decision;
}
