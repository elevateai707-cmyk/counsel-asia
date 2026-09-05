import { writeFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { makeProvider } from "../providers/index.js";
import { TaskGraph, Task, saveTasks } from "../tasks.js";
import { logEvent, recordCost, totalSpend, readLedger } from "../ledger.js";
import { cloudGate } from "../gate.js";
import { estimateCostUsd, knownModel, roughTokenEstimate } from "../pricing.js";
import { paths } from "../paths.js";

const PLAN_SYSTEM = `You are a software build planner. Given a project idea, break it into a small ordered list of concrete build tasks. Reply with ONLY a JSON object, no prose, of the form:
{"tasks":[{"id":"t1","title":"...","kind":"boilerplate|ui|css|docs|logic|test-fix|integration","risk":"none|security|payments","files":["path"],"dependsOn":["t0"]}]}
Keep it to 4-8 tasks. Use "boilerplate" for scaffolding, "logic" for core code. Mark anything touching auth/secrets as risk "security" and anything touching money as "payments".`;

/** Parse the model's JSON, tolerating a code-fence wrapper. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * `counsel-asia plan "<idea>"` — the orchestrator (Kimi) produces a validated
 * task graph. Always the orchestrator role: planning quality drives everything
 * downstream, and it is one cheap call per project.
 */
export async function planCommand(idea: string): Promise<void> {
  const config = await loadConfig();
  const profile = config.models.orchestrator;
  const provider = makeProvider(profile, config);
  const model = profile.model ?? "(default)";

  const prompt = idea;
  if (provider.isCloud) {
    const estTokens = roughTokenEstimate(PLAN_SYSTEM.length + prompt.length);
    const est = knownModel(model) ? estimateCostUsd(model, estTokens, 1024) : undefined;
    const gate = await cloudGate({ config, taskId: "plan", provider: provider.name, model, costEstimateUsd: est });
    if (!gate.allowed) {
      await logEvent({ type: "cloud_call", taskId: "plan", provider: provider.name, model, approved: false });
      throw new Error(`Plan blocked by budget gate: ${gate.reason}`);
    }
  }

  console.log(`Planning with ${provider.name}:${model} (${provider.isCloud ? "paid" : "local, $0"})…`);
  const result = await provider.generate(prompt, { system: PLAN_SYSTEM, json: true, temperature: 0.1 });

  if (provider.isCloud) {
    await logEvent({ type: "cloud_call", taskId: "plan", provider: provider.name, model: result.model, approved: true });
  }
  const line = await recordCost(result, "plan");
  if (line) console.log(line);
  else if (provider.isCloud) console.log(`   cost: (no usage reported by provider)`);

  const parsed = extractJson(result.text) as { tasks?: unknown[] };
  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

  // Validate every task through zod; assign ids if the model omitted them.
  const tasks: Task[] = rawTasks.map((t, i) => {
    const obj = (t ?? {}) as Record<string, unknown>;
    if (!obj.id) obj.id = `t${i + 1}`;
    return Task.parse(obj);
  });

  if (tasks.length === 0) throw new Error("Planner produced no tasks. Try rephrasing the idea.");

  const graph: TaskGraph = { goal: idea, createdAt: new Date().toISOString(), tasks };
  await saveTasks(graph);

  // Seed goal.md too so the workspace reflects the real prompt.
  await writeFile(paths().goal, `# Goal\n\n${idea}\n`, "utf8");

  for (const t of tasks) await logEvent({ type: "task_created", taskId: t.id, title: t.title });

  const spent = totalSpend(await readLedger());
  console.log(`\n✓ ${tasks.length} tasks written to .counsel/tasks.json (project spend: $${spent.toFixed(4)} / $${config.max_usd_per_project.toFixed(2)}):\n`);
  for (const t of tasks) {
    console.log(`  ${t.id}  [${t.kind}/${t.risk}]  ${t.title}`);
  }
  console.log(`\nNext: counsel-asia build`);
}
