import type { Config } from "./config.js";
import type { Task } from "./tasks.js";

/**
 * Two-layer routing:
 *  1. Base route — either Hermes's per-task choice (stored on the task at plan
 *     time) or the deterministic "Token Economist" policy below (0 tokens).
 *  2. Budget pressure — near the project USD cap, routes downgrade one tier.
 *     This ALWAYS applies, including to Hermes's choices: dollar caps are the
 *     invariant, Hermes can only choose within budget.
 */

export type Route = "orchestrator" | "coder" | "coder-cheap";

export interface RouteDecision {
  route: Route;
  /** Human-readable justification, logged + shown to the user. */
  reason: string;
}

/**
 * The deterministic base policy (mirrors README):
 *   risk = security | payments           -> orchestrator (Kimi review)
 *   blocked AND attempts >= threshold    -> orchestrator (hard repair)
 *   kind = integration                   -> orchestrator (largest context)
 *   kind = logic | ui | test-fix         -> coder (DeepSeek)
 *   kind = boilerplate | css | docs      -> coder-cheap (Qwen)
 */
function baseRoute(task: Task, config: Config): RouteDecision {
  const threshold = config.cheap_attempts_before_orchestrator;

  if (task.risk === "security" || task.risk === "payments") {
    return { route: "orchestrator", reason: `risk=${task.risk} -> orchestrator (Kimi review)` };
  }
  if (task.status === "blocked" && task.attempts >= threshold) {
    return {
      route: "orchestrator",
      reason: `blocked after ${task.attempts} attempts (>= ${threshold}) -> orchestrator (hard repair)`,
    };
  }
  if (task.kind === "integration") {
    return { route: "orchestrator", reason: `kind=integration -> orchestrator (largest context)` };
  }
  if (task.kind === "logic" || task.kind === "ui" || task.kind === "test-fix") {
    return { route: "coder", reason: `kind=${task.kind} -> coder (DeepSeek)` };
  }
  return { route: "coder-cheap", reason: `kind=${task.kind} -> coder-cheap (Qwen)` };
}

/**
 * Near-budget downgrade: within 10% of `max_usd_per_project`, drop one tier
 * (orchestrator -> coder, coder -> coder-cheap) and say so in the reason.
 * `spentUsd` is passed in to keep routing pure.
 */
function withBudgetPressure(decision: RouteDecision, config: Config, spentUsd: number): RouteDecision {
  const cap = config.max_usd_per_project;
  if (cap <= 0 || spentUsd < 0.9 * cap) return decision;

  const note = `spend $${spentUsd.toFixed(4)} within 10% of $${cap.toFixed(2)} cap`;
  if (decision.route === "orchestrator") {
    return { route: "coder", reason: `${decision.reason}; downgraded to coder (${note})` };
  }
  if (decision.route === "coder") {
    return { route: "coder-cheap", reason: `${decision.reason}; downgraded to coder-cheap (${note})` };
  }
  return { ...decision, reason: `${decision.reason}; already at cheapest tier (${note})` };
}

/** The deterministic router — pure function of (task, config, spentUsd). */
export function route(task: Task, config: Config, spentUsd = 0): RouteDecision {
  return withBudgetPressure(baseRoute(task, config), config, spentUsd);
}

/**
 * The route that actually applies to a task: Hermes's stored choice when
 * present, else the deterministic policy — either way subject to the same
 * near-cap downgrade.
 */
export function resolveRoute(task: Task, config: Config, spentUsd = 0): RouteDecision {
  if (task.route) {
    return withBudgetPressure(
      { route: task.route, reason: `Hermes route: ${task.route}${task.routeReason ? ` (${task.routeReason})` : ""}` },
      config,
      spentUsd,
    );
  }
  return route(task, config, spentUsd);
}
