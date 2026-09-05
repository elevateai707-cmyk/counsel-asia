import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { paths } from "./paths.js";
import type { GenerateResult } from "./providers/types.js";

/**
 * Append-only event log. Every meaningful decision and every cost lands here so
 * a run is reproducible and "$ spent / $ saved" is auditable after the fact.
 */
export const LedgerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task_created"), ts: z.string(), taskId: z.string(), title: z.string() }),
  z.object({ type: z.literal("attempt"), ts: z.string(), taskId: z.string(), n: z.number().int(), route: z.string() }),
  z.object({ type: z.literal("test_result"), ts: z.string(), taskId: z.string(), passed: z.boolean(), summary: z.string().optional() }),
  z.object({ type: z.literal("escalation_request"), ts: z.string(), taskId: z.string(), to: z.string(), reason: z.string() }),
  z.object({ type: z.literal("diagnosis"), ts: z.string(), taskId: z.string(), basedOn: z.string().optional() }),
  z.object({ type: z.literal("cloud_call"), ts: z.string(), taskId: z.string(), provider: z.string(), model: z.string(), approved: z.boolean() }),
  z.object({ type: z.literal("cost"), ts: z.string(), taskId: z.string().optional(), provider: z.string(), model: z.string().optional(), usd: z.number(), note: z.string().optional() }),
]);
export type LedgerEvent = z.infer<typeof LedgerEvent>;

// Distributive omit: drop the auto-filled `ts` from each member of the union.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewEvent = DistributiveOmit<LedgerEvent, "ts"> & { ts?: string };

/** Append one event as a JSONL line. Validates before writing. */
export async function logEvent(event: NewEvent, cwd: string = process.cwd()): Promise<void> {
  const p = paths(cwd);
  await mkdir(p.root, { recursive: true });
  const withTs = { ...event, ts: event.ts ?? new Date().toISOString() };
  const validated = LedgerEvent.parse(withTs);
  await appendFile(p.ledger, JSON.stringify(validated) + "\n", "utf8");
}

/** Read and parse all ledger events (skips malformed lines defensively). */
export async function readLedger(cwd: string = process.cwd()): Promise<LedgerEvent[]> {
  const p = paths(cwd);
  if (!existsSync(p.ledger)) return [];
  const raw = await readFile(p.ledger, "utf8");
  const events: LedgerEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = LedgerEvent.safeParse(JSON.parse(trimmed));
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

/** How many cloud calls have already happened across the whole project. */
export function cloudCallsThisProject(events: LedgerEvent[]): number {
  return events.filter((e) => e.type === "cloud_call" && e.approved).length;
}

/** How many cloud calls have happened for one task. */
export function cloudCallsForTask(events: LedgerEvent[], taskId: string): number {
  return events.filter((e) => e.type === "cloud_call" && e.approved && e.taskId === taskId).length;
}

/** Total USD spent recorded in the ledger. */
export function totalSpend(events: LedgerEvent[]): number {
  return events.filter((e): e is Extract<LedgerEvent, { type: "cost" }> => e.type === "cost").reduce((sum, e) => sum + e.usd, 0);
}

/** USD spent on one task (cost events tagged with this taskId). */
export function spendForTask(events: LedgerEvent[], taskId: string): number {
  return events.filter((e): e is Extract<LedgerEvent, { type: "cost" }> => e.type === "cost" && e.taskId === taskId).reduce((sum, e) => sum + e.usd, 0);
}

/** USD spent per model (keyed by `model`, falling back to provider when absent). */
export function spendByModel(events: LedgerEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    if (e.type !== "cost") continue;
    const key = e.model ?? e.provider;
    out[key] = (out[key] ?? 0) + e.usd;
  }
  return out;
}

/**
 * Log a `cost` event for a provider call that reported usage, and return the
 * formatted per-call line to print. Returns null (and logs nothing) when the
 * API gave no usage data.
 */
export async function recordCost(result: GenerateResult, taskId?: string, cwd: string = process.cwd()): Promise<string | null> {
  const line = costLine(result);
  if (!line) return null;
  const u = result.usage!;
  await logEvent(
    { type: "cost", taskId, provider: result.provider, model: result.model, usd: u.costUsd, note: `${u.promptTokens} in / ${u.completionTokens} out` },
    cwd,
  );
  return line;
}

/** Formatted per-call cost line, or null when the call reported no usage. */
export function costLine(result: GenerateResult): string | null {
  const u = result.usage;
  if (!u) return null;
  return `   cost: $${u.costUsd.toFixed(6)} (${result.provider}:${result.model}, ${u.promptTokens} in / ${u.completionTokens} out)`;
}
