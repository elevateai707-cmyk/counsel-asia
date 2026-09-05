import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { paths } from "./paths.js";

/**
 * A unit of work in the task graph. `kind` and `risk` are what the deterministic
 * router keys off of — they must be set by the planner, never inferred at runtime.
 */
export const TaskKind = z.enum(["boilerplate", "ui", "css", "docs", "logic", "test-fix", "integration"]);
export type TaskKind = z.infer<typeof TaskKind>;

export const TaskRisk = z.enum(["none", "security", "payments"]);
export type TaskRisk = z.infer<typeof TaskRisk>;

export const Task = z.object({
  id: z.string(),
  title: z.string(),
  kind: TaskKind.default("logic"),
  risk: TaskRisk.default("none"),
  files: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  attempts: z.number().int().nonnegative().default(0),
  status: z.enum(["pending", "in_progress", "blocked", "done"]).default("pending"),
  // Optional Hermes-assigned route. Absent on old task files and on the
  // deterministic-fallback path — the deterministic router then decides.
  route: z.enum(["orchestrator", "coder", "coder-cheap"]).optional(),
  routeReason: z.string().optional(),
});
export type Task = z.infer<typeof Task>;

export const TaskGraph = z.object({
  goal: z.string(),
  createdAt: z.string(),
  tasks: z.array(Task),
});
export type TaskGraph = z.infer<typeof TaskGraph>;

export async function loadTasks(cwd: string = process.cwd()): Promise<TaskGraph | null> {
  const p = paths(cwd);
  if (!existsSync(p.tasks)) return null;
  return TaskGraph.parse(JSON.parse(await readFile(p.tasks, "utf8")));
}

export async function saveTasks(graph: TaskGraph, cwd: string = process.cwd()): Promise<void> {
  const p = paths(cwd);
  await mkdir(p.root, { recursive: true });
  const validated = TaskGraph.parse(graph);
  await writeFile(p.tasks, JSON.stringify(validated, null, 2) + "\n", "utf8");
}
