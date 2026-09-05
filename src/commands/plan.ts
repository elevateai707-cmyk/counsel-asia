import { writeFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { TaskGraph, Task, saveTasks } from "../tasks.js";
import { logEvent, readLedger, totalSpend } from "../ledger.js";
import { paths } from "../paths.js";
import { gatedCall, GateBlockedError } from "../call.js";
import { HERMES_ROUTE_SYSTEM, extractJsonObject, hermesPlanToTasks, parseHermesPlan } from "../hermes-route.js";

const PLAN_SYSTEM = `You are a software build planner. Given a project idea, break it into a small ordered list of concrete build tasks. Reply with ONLY a JSON object, no prose, of the form:
{"tasks":[{"id":"t1","title":"...","kind":"boilerplate|ui|css|docs|logic|test-fix|integration","risk":"none|security|payments","files":["path"],"dependsOn":["t0"]}]}
Keep it to 4-8 tasks. Use "boilerplate" for scaffolding, "logic" for core code. Mark anything touching auth/secrets as risk "security" and anything touching money as "payments".`;

/** Deterministic-fallback decomposition: orchestrator plans, router assigns. */
function tasksFromPlanJson(text: string): Task[] {
  const parsed = extractJsonObject(text) as { tasks?: unknown[] };
  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return rawTasks.map((t, i) => {
    const obj = (t ?? {}) as Record<string, unknown>;
    if (!obj.id) obj.id = `t${i + 1}`;
    return Task.parse(obj);
  });
}

/**
 * `counsel-asia plan "<idea>"` — AUTOROUTE path: the Hermes routing agent
 * (router role, OpenRouter by default) decomposes the idea into a task graph
 * AND picks a cost tier per task. On any failure (missing key, network, bad
 * output) it falls back with a printed warning to the deterministic path:
 * orchestrator (Kimi) decomposes, the deterministic router assigns. Budget-
 * gate refusals are never fallen back past — the dollar caps are the
 * invariant. Routing-call cost is logged like any other call.
 */
export async function planCommand(idea: string): Promise<void> {
  const config = await loadConfig();
  let tasks: Task[];
  let source: "hermes" | "deterministic";

  try {
    const profile = config.models.router;
    console.log(`Routing with ${profile.provider}:${profile.model ?? "(default)"} (Hermes autoroute)…`);
    const result = await gatedCall({
      config,
      taskId: "route",
      profile,
      prompt: idea,
      gen: { system: HERMES_ROUTE_SYSTEM, json: true, temperature: 0.2 },
    });
    tasks = hermesPlanToTasks(parseHermesPlan(result.text));
    source = "hermes";
    console.log(`✓ Hermes decomposed + routed ${tasks.length} task(s).`);
  } catch (err) {
    if (err instanceof GateBlockedError) throw err; // caps are the invariant
    console.log(`⚠ Hermes routing unavailable: ${(err as Error).message}`);
    console.log(`  Falling back to orchestrator plan + deterministic router.`);
    const profile = config.models.orchestrator;
    console.log(`Planning with ${profile.provider}:${profile.model ?? "(default)"}…`);
    const result = await gatedCall({
      config,
      taskId: "plan",
      profile,
      prompt: idea,
      gen: { system: PLAN_SYSTEM, json: true, temperature: 0.1 },
    });
    tasks = tasksFromPlanJson(result.text);
    source = "deterministic";
  }

  if (tasks.length === 0) throw new Error("Planner produced no tasks. Try rephrasing the idea.");

  const graph: TaskGraph = { goal: idea, createdAt: new Date().toISOString(), tasks };
  await saveTasks(graph);

  // Seed goal.md too so the workspace reflects the real prompt.
  await writeFile(paths().goal, `# Goal\n\n${idea}\n`, "utf8");

  for (const t of tasks) await logEvent({ type: "task_created", taskId: t.id, title: t.title });

  const spent = totalSpend(await readLedger());
  console.log(`\n✓ ${tasks.length} tasks written to .counsel/tasks.json (${source === "hermes" ? "Hermes autoroute" : "deterministic fallback"}; project spend: $${spent.toFixed(4)} / $${config.max_usd_per_project.toFixed(2)}):\n`);
  for (const t of tasks) {
    const r = t.route ? `  → ${t.route}${t.routeReason ? ` (${t.routeReason})` : ""}` : "";
    console.log(`  ${t.id}  [${t.kind}/${t.risk}]  ${t.title}${r}`);
  }
  console.log(`\nNext: counsel-asia build`);
}
