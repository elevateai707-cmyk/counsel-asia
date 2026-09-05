import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/web/server.ts";
import { saveConfig, defaultConfig } from "../src/config.ts";
import { saveTasks } from "../src/tasks.ts";
import { logEvent } from "../src/ledger.ts";

// Isolate the server in a temp project (all data fns key off process.cwd()).
let prevCwd: string;
let dir: string;

before(async () => {
  prevCwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "counsel-asia-web-"));
  process.chdir(dir);
  await saveConfig(defaultConfig());
  await saveTasks({
    goal: "web test",
    createdAt: "2026-09-05T00:00:00.000Z",
    tasks: [
      { id: "t1", title: "Scaffold", kind: "boilerplate", risk: "none", files: [], dependsOn: [], attempts: 0, status: "done", route: "coder-cheap", routeReason: "cheap" },
      { id: "t2", title: "Core logic", kind: "logic", risk: "none", files: [], dependsOn: ["t1"], attempts: 1, status: "pending" },
    ],
  });
  await logEvent({ type: "cost", taskId: "t1", provider: "qwen", model: "qwen3-coder-flash", usd: 0.01 });
});

after(async () => {
  process.chdir(prevCwd);
  await rm(dir, { recursive: true, force: true });
});

test("GET / serves the dashboard HTML", async () => {
  const app = buildServer();
  const res = await app.inject({ method: "GET", url: "/" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] ?? "", /text\/html/);
  assert.match(res.body, /counsel-asia/);
  await app.close();
});

test("GET /api/status returns tasks with routes, spend, and caps", async () => {
  const app = buildServer();
  const res = await app.inject({ method: "GET", url: "/api/status" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.goal, "web test");
  assert.equal(body.tasks.length, 2);
  assert.equal(body.tasks[0].route, "coder-cheap");
  assert.equal(body.tasks[0].routeReason, "cheap");
  assert.equal(body.tasks[0].spendUsd, 0.01);
  assert.equal(body.tasks[1].route, null);
  assert.equal(body.spend.total, 0.01);
  assert.equal(body.spend.byModel["qwen3-coder-flash"], 0.01);
  assert.ok(Math.abs(body.spend.remaining - 0.49) < 1e-9);
  assert.equal(body.caps.max_usd_per_project, 0.5);
  assert.equal(body.roles.router.provider, "openrouter");
  await app.close();
});

test("GET /api/events tails the ledger with a cursor", async () => {
  const app = buildServer();
  const first = (await app.inject({ method: "GET", url: "/api/events" })).json();
  assert.equal(first.events.length, 1);
  assert.equal(first.next, 1);
  const second = (await app.inject({ method: "GET", url: "/api/events?since=1" })).json();
  assert.equal(second.events.length, 0);
  assert.equal(second.next, 1);
  await app.close();
});

test("GET /api/models shows roles + key presence without leaking key values", async () => {
  const app = buildServer();
  const res = await app.inject({ method: "GET", url: "/api/models" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(Object.keys(body.roles).sort(), ["coder", "coder_cheap", "fallback", "orchestrator", "router"]);
  assert.ok(body.providers.includes("openrouter"));
  for (const p of Object.values(body.keys) as Array<{ configured: boolean }>) {
    assert.equal(typeof p.configured, "boolean");
  }
  assert.ok(!JSON.stringify(body).includes("sk-"), "no key material in response");
  await app.close();
});

test("PUT /api/models/:role switches a role's provider + model", async () => {
  const app = buildServer();
  const res = await app.inject({
    method: "PUT",
    url: "/api/models/coder",
    payload: { provider: "qwen", model: "qwen3-coder-flash" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().roles.coder.provider, "qwen");
  const cfg = JSON.parse((await app.inject({ method: "GET", url: "/api/models" })).body);
  assert.equal(cfg.roles.coder.provider, "qwen");
  assert.equal(cfg.roles.coder.model, "qwen3-coder-flash");
  await app.close();
});

test("PUT /api/models/:role rejects unknown role, provider, and disabled", async () => {
  const app = buildServer();
  const badRole = await app.inject({ method: "PUT", url: "/api/models/nope", payload: { provider: "kimi" } });
  assert.equal(badRole.statusCode, 400);
  const badProvider = await app.inject({ method: "PUT", url: "/api/models/coder", payload: { provider: "nope" } });
  assert.equal(badProvider.statusCode, 400);
  const disabled = await app.inject({ method: "PUT", url: "/api/models/coder", payload: { provider: "disabled" } });
  assert.equal(disabled.statusCode, 400);
  await app.close();
});

test("POST /api/prompt requires an idea", async () => {
  const app = buildServer();
  const res = await app.inject({ method: "POST", url: "/api/prompt", payload: {} });
  assert.equal(res.statusCode, 400);
  const blank = await app.inject({ method: "POST", url: "/api/prompt", payload: { idea: "   " } });
  assert.equal(blank.statusCode, 400);
  await app.close();
});
