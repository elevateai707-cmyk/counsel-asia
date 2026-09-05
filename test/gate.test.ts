import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudCallsThisProject, cloudCallsForTask, totalSpend, spendForTask, spendByModel, logEvent, readLedger, type LedgerEvent } from "../src/ledger.ts";
import { cloudGate } from "../src/gate.ts";
import { defaultConfig, saveConfig } from "../src/config.ts";
import { saveTasks } from "../src/tasks.ts";
import { escalateCommand } from "../src/commands/escalate.ts";

// --- pure ledger helpers (no IO) ---
const events: LedgerEvent[] = [
  { type: "cloud_call", ts: "t", taskId: "a", provider: "kimi", model: "kimi-k3", approved: true },
  { type: "cloud_call", ts: "t", taskId: "a", provider: "kimi", model: "kimi-k3", approved: false }, // declined: not counted
  { type: "cloud_call", ts: "t", taskId: "b", provider: "deepseek", model: "deepseek-chat", approved: true },
  { type: "cost", ts: "t", taskId: "a", provider: "kimi", model: "kimi-k3", usd: 0.12 },
  { type: "cost", ts: "t", taskId: "b", provider: "deepseek", model: "deepseek-chat", usd: 0.03 },
];

test("cloudCallsThisProject counts only approved calls", () => {
  assert.equal(cloudCallsThisProject(events), 2);
});
test("cloudCallsForTask is per-task and approval-gated", () => {
  assert.equal(cloudCallsForTask(events, "a"), 1);
  assert.equal(cloudCallsForTask(events, "b"), 1);
  assert.equal(cloudCallsForTask(events, "zzz"), 0);
});
test("totalSpend sums cost events", () => {
  assert.equal(totalSpend(events).toFixed(2), "0.15");
});
test("spendForTask is per-task", () => {
  assert.equal(spendForTask(events, "a").toFixed(2), "0.12");
  assert.equal(spendForTask(events, "b").toFixed(2), "0.03");
  assert.equal(spendForTask(events, "zzz"), 0);
});
test("spendByModel breaks spend down per model", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(spendByModel(events)).map(([k, v]) => [k, v.toFixed(2)])),
    { "kimi-k3": "0.12", "deepseek-chat": "0.03" },
  );
});

// --- gate decision branches ---
test("gate refuses when cloud_enabled is false", async () => {
  const r = await cloudGate({ config: { ...defaultConfig(), cloud_enabled: false }, taskId: "t1", provider: "kimi", model: "m" });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /cloud_enabled is false/);
});

// --- gate cap branches (need a ledger; isolate via temp cwd) ---
let prevCwd: string | undefined;
afterEach(() => { if (prevCwd) { process.chdir(prevCwd); prevCwd = undefined; } });

async function tempProject(): Promise<string> {
  prevCwd = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "counsel-asia-gate-"));
  process.chdir(dir);
  return dir;
}

// Approval-off config so the gate is non-interactive.
const gateConfig = (over: Partial<ReturnType<typeof defaultConfig>> = {}) => ({
  ...defaultConfig(),
  require_user_approval_for_cloud: false,
  ...over,
});

test("gate allows calls under all caps (approval off)", async () => {
  const dir = await tempProject();
  try {
    const r = await cloudGate({ config: gateConfig(), taskId: "t1", provider: "kimi", model: "kimi-k3" });
    assert.equal(r.allowed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gate enforces the per-project USD cap", async () => {
  const dir = await tempProject();
  try {
    const config = gateConfig({ max_usd_per_project: 0.5 });
    // $0.49 spent: still allowed.
    await logEvent({ type: "cost", taskId: "t1", provider: "deepseek", model: "deepseek-chat", usd: 0.49 });
    assert.equal((await cloudGate({ config, taskId: "t2", provider: "kimi", model: "kimi-k3" })).allowed, true);
    // crossing $0.50: hard refusal naming the cap.
    await logEvent({ type: "cost", taskId: "t1", provider: "deepseek", model: "deepseek-chat", usd: 0.02 });
    const r = await cloudGate({ config, taskId: "t2", provider: "kimi", model: "kimi-k3" });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /project USD cap reached/);
    assert.match(r.reason, /max_usd_per_project/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gate enforces the per-task USD cap (other tasks unaffected)", async () => {
  const dir = await tempProject();
  try {
    const config = gateConfig({ max_usd_per_task: 0.1 });
    await logEvent({ type: "cost", taskId: "t1", provider: "deepseek", model: "deepseek-chat", usd: 0.11 });
    const same = await cloudGate({ config, taskId: "t1", provider: "deepseek", model: "deepseek-chat" });
    assert.equal(same.allowed, false);
    assert.match(same.reason, /task USD cap reached/);
    // a different task is still allowed
    assert.equal((await cloudGate({ config, taskId: "t2", provider: "deepseek", model: "deepseek-chat" })).allowed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gate enforces the per-project call cap", async () => {
  const dir = await tempProject();
  try {
    const config = gateConfig({ max_cloud_calls_per_project: 1 });
    assert.equal((await cloudGate({ config, taskId: "t1", provider: "kimi", model: "m" })).allowed, true);
    await logEvent({ type: "cloud_call", taskId: "t1", provider: "kimi", model: "m", approved: true });
    const r = await cloudGate({ config, taskId: "t2", provider: "kimi", model: "m" });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /project cloud-call cap/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gate enforces the per-task call cap", async () => {
  const dir = await tempProject();
  try {
    const config = gateConfig({ max_cloud_calls_per_task: 1 });
    await logEvent({ type: "cloud_call", taskId: "t1", provider: "kimi", model: "m", approved: true });
    const same = await cloudGate({ config, taskId: "t1", provider: "kimi", model: "m" });
    assert.equal(same.allowed, false);
    assert.match(same.reason, /task cloud-call cap/);
    assert.equal((await cloudGate({ config, taskId: "t2", provider: "kimi", model: "m" })).allowed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed cloud provider call does not consume cloud-call budget", async () => {
  const dir = await tempProject();
  // Ensure no key: the missing-key error must surface, and budget must not move.
  const savedMoonshot = process.env.MOONSHOT_API_KEY;
  const savedKimi = process.env.KIMI_API_KEY;
  delete process.env.MOONSHOT_API_KEY;
  delete process.env.KIMI_API_KEY;
  try {
    await saveConfig(gateConfig());
    await saveTasks({
      goal: "secure the app",
      createdAt: "2026-09-05T00:00:00.000Z",
      tasks: [{ id: "t1", title: "Review auth", kind: "logic", risk: "security", files: [], dependsOn: [], attempts: 0, status: "pending" }],
    });

    await escalateCommand("t1");

    const ledger = await readLedger();
    assert.equal(cloudCallsThisProject(ledger), 0);
    assert.equal(cloudCallsForTask(ledger, "t1"), 0);
    assert.equal(totalSpend(ledger), 0);
  } finally {
    if (savedMoonshot !== undefined) process.env.MOONSHOT_API_KEY = savedMoonshot;
    if (savedKimi !== undefined) process.env.KIMI_API_KEY = savedKimi;
    await rm(dir, { recursive: true, force: true });
  }
});
