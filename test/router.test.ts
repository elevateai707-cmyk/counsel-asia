import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "../src/router.ts";
import { defaultConfig } from "../src/config.ts";
import { Task } from "../src/tasks.ts";

const task = (over: Partial<ReturnType<typeof Task.parse>> = {}) =>
  Task.parse({ id: "t1", title: "x", ...over });

test("risk = security routes to the orchestrator (Kimi review)", () => {
  const d = route(task({ risk: "security" }), defaultConfig());
  assert.equal(d.route, "orchestrator");
  assert.match(d.reason, /Kimi/);
});

test("risk = payments routes to the orchestrator", () => {
  assert.equal(route(task({ risk: "payments" }), defaultConfig()).route, "orchestrator");
});

test("blocked past the attempt threshold routes to the orchestrator", () => {
  const cfg = { ...defaultConfig(), cheap_attempts_before_orchestrator: 3 };
  const d = route(task({ status: "blocked", attempts: 3 }), cfg);
  assert.equal(d.route, "orchestrator");
  assert.match(d.reason, /hard repair/);
});

test("blocked but under threshold does NOT escalate", () => {
  const cfg = { ...defaultConfig(), cheap_attempts_before_orchestrator: 3 };
  const d = route(task({ status: "blocked", attempts: 2, kind: "logic" }), cfg);
  assert.equal(d.route, "coder");
});

test("kind = integration routes to the orchestrator (largest context)", () => {
  const d = route(task({ kind: "integration" }), defaultConfig());
  assert.equal(d.route, "orchestrator");
});

test("logic / ui / test-fix route to the coder (DeepSeek)", () => {
  for (const kind of ["logic", "ui", "test-fix"] as const) {
    const d = route(task({ kind }), defaultConfig());
    assert.equal(d.route, "coder", `${kind} should route to coder`);
  }
});

test("boilerplate / css / docs route to the cheap coder (Qwen)", () => {
  for (const kind of ["boilerplate", "css", "docs"] as const) {
    const d = route(task({ kind }), defaultConfig());
    assert.equal(d.route, "coder-cheap", `${kind} should route to coder-cheap`);
  }
});

test("risk takes precedence over kind=integration", () => {
  const d = route(task({ kind: "integration", risk: "security" }), defaultConfig());
  assert.equal(d.route, "orchestrator");
  assert.match(d.reason, /risk=security/);
});

test("risk takes precedence over the blocked-attempts rule", () => {
  const cfg = { ...defaultConfig(), cheap_attempts_before_orchestrator: 3 };
  const d = route(task({ kind: "boilerplate", status: "blocked", attempts: 9, risk: "security" }), cfg);
  assert.equal(d.route, "orchestrator");
  assert.match(d.reason, /risk=security/);
});

// --- near-budget downgrade (spentUsd passed in to keep route() pure) ---

test("spend within 10% of the project cap downgrades orchestrator -> coder", () => {
  const cfg = { ...defaultConfig(), max_usd_per_project: 0.5 };
  const d = route(task({ risk: "security" }), cfg, 0.45);
  assert.equal(d.route, "coder");
  assert.match(d.reason, /downgraded to coder/);
  assert.match(d.reason, /within 10%/);
});

test("spend within 10% of the project cap downgrades coder -> coder-cheap", () => {
  const cfg = { ...defaultConfig(), max_usd_per_project: 0.5 };
  const d = route(task({ kind: "logic" }), cfg, 0.46);
  assert.equal(d.route, "coder-cheap");
  assert.match(d.reason, /downgraded to coder-cheap/);
});

test("coder-cheap has nowhere to fall — stays, reason notes it", () => {
  const cfg = { ...defaultConfig(), max_usd_per_project: 0.5 };
  const d = route(task({ kind: "docs" }), cfg, 0.5);
  assert.equal(d.route, "coder-cheap");
  assert.match(d.reason, /already at cheapest tier/);
});

test("spend below the 90% threshold does NOT downgrade", () => {
  const cfg = { ...defaultConfig(), max_usd_per_project: 0.5 };
  assert.equal(route(task({ risk: "security" }), cfg, 0.44).route, "orchestrator");
  assert.equal(route(task({ kind: "logic" }), cfg, 0.44).route, "coder");
});

test("default spentUsd is 0 — no downgrade", () => {
  assert.equal(route(task({ risk: "security" }), defaultConfig()).route, "orchestrator");
});
