import { z } from "zod";
import { Task, TaskKind, TaskRisk } from "./tasks.js";
import type { Provider } from "./providers/types.js";

/**
 * The Hermes routing agent ("autoroute"): given the user's prompt, Hermes
 * (via OpenRouter by default) decomposes the work AND picks a cost tier per
 * task. Everything it returns is zod-validated here; the caller falls back to
 * the deterministic router on any failure.
 */

export const HERMES_ROUTE_SYSTEM = `You are Hermes, the routing agent of a cost-optimized build orchestrator. Given a project idea, break it into a small ordered list of concrete build tasks AND choose the cheapest suitable model tier for each.

Model tiers:
- "orchestrator": strongest, most expensive. Use ONLY for security/payments-sensitive work, large-context integration, or genuinely hard design.
- "coder": mid-tier coding model. Use for core logic, UI behaviour, test fixes.
- "coder-cheap": cheapest. Use for boilerplate, scaffolding, CSS, docs, simple files.

Reply with ONLY a JSON object, no prose, of the form:
{"tasks":[{"id":"t1","title":"...","kind":"boilerplate|ui|css|docs|logic|test-fix|integration","risk":"none|security|payments","files":["path"],"dependsOn":["t0"],"route":"orchestrator|coder|coder-cheap","reason":"one line"}]}
Keep it to 4-8 tasks. Mark anything touching auth/secrets as risk "security" and anything touching money as "payments". Prefer the cheaper tier whenever quality allows — token cost is the primary constraint.`;

/** Thrown when Hermes's output can't be parsed/validated into a task plan. */
export class HermesRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HermesRouteError";
  }
}

const RoutedTask = z.object({
  id: z.string().optional(),
  title: z.string(),
  kind: TaskKind.default("logic"),
  risk: TaskRisk.default("none"),
  files: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  route: z.enum(["orchestrator", "coder", "coder-cheap"]),
  reason: z.string().default(""),
});

export const HermesPlan = z.object({ tasks: z.array(RoutedTask) });
export type HermesPlan = z.infer<typeof HermesPlan>;

/** Pull a JSON object out of raw / code-fenced / prose-wrapped model output. */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new HermesRouteError("Model did not return JSON.");
  return JSON.parse(body.slice(start, end + 1));
}

/** Parse + validate Hermes's routing output. Throws HermesRouteError. */
export function parseHermesPlan(text: string): HermesPlan {
  let raw: unknown;
  try {
    raw = extractJsonObject(text);
  } catch (err) {
    if (err instanceof HermesRouteError) throw err;
    throw new HermesRouteError(`Invalid JSON from router: ${(err as Error).message}`);
  }
  const parsed = HermesPlan.safeParse(raw);
  if (!parsed.success) {
    throw new HermesRouteError(`Router output failed validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  return parsed.data;
}

/** Convert a validated Hermes plan into Task objects (ids assigned if missing). */
export function hermesPlanToTasks(plan: HermesPlan): Task[] {
  return plan.tasks.map((t, i) =>
    Task.parse({
      id: t.id ?? `t${i + 1}`,
      title: t.title,
      kind: t.kind,
      risk: t.risk,
      files: t.files,
      dependsOn: t.dependsOn,
      route: t.route,
      routeReason: t.reason,
    }),
  );
}

/**
 * Run the routing agent against a provider and return validated tasks.
 * Pure of config/ledger/gate — the caller (plan) wraps the call in the budget
 * gate and logs the cost like any other call.
 */
export async function runHermesRouter(idea: string, provider: Provider): Promise<Task[]> {
  const result = await provider.generate(idea, { system: HERMES_ROUTE_SYSTEM, json: true, temperature: 0.2 });
  return hermesPlanToTasks(parseHermesPlan(result.text));
}
