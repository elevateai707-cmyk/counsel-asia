import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HERMES_ROUTE_SYSTEM,
  HermesRouteError,
  extractJsonObject,
  hermesPlanToTasks,
  parseHermesPlan,
  runHermesRouter,
} from "../src/hermes-route.ts";
import type { GenerateResult, Provider } from "../src/providers/types.ts";

const GOOD = {
  tasks: [
    { id: "t1", title: "Scaffold app", kind: "boilerplate", risk: "none", files: ["package.json"], dependsOn: [], route: "coder-cheap", reason: "scaffolding is cheap" },
    { id: "t2", title: "Auth flow", kind: "logic", risk: "security", files: ["src/auth.ts"], dependsOn: ["t1"], route: "orchestrator", reason: "security-sensitive" },
  ],
};

function mockProvider(text: string): Provider {
  return {
    name: "mock",
    isCloud: false,
    async generate(): Promise<GenerateResult> {
      return { text, model: "mock", provider: "mock" };
    },
  };
}

test("parses a clean Hermes routing plan", () => {
  const plan = parseHermesPlan(JSON.stringify(GOOD));
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].route, "coder-cheap");
  assert.equal(plan.tasks[1].route, "orchestrator");
});

test("tolerates code fences and surrounding prose", () => {
  const wrapped = "Here you go:\n```json\n" + JSON.stringify(GOOD) + "\n```\nHope that helps.";
  const plan = parseHermesPlan(wrapped);
  assert.equal(plan.tasks.length, 2);
});

test("throws HermesRouteError on non-JSON output", () => {
  assert.throws(() => parseHermesPlan("sorry, cannot help"), HermesRouteError);
});

test("throws HermesRouteError on invalid JSON", () => {
  assert.throws(() => parseHermesPlan("{not json}"), HermesRouteError);
});

test("throws HermesRouteError when a route value is not a valid tier", () => {
  const bad = { tasks: [{ title: "x", route: "mega-brain" }] };
  assert.throws(() => parseHermesPlan(JSON.stringify(bad)), HermesRouteError);
});

test("throws HermesRouteError when tasks is missing", () => {
  assert.throws(() => parseHermesPlan("{}"), HermesRouteError);
});

test("hermesPlanToTasks assigns ids and defaults, keeps route + reason", () => {
  const plan = parseHermesPlan(
    JSON.stringify({ tasks: [{ title: "A", route: "coder-cheap" }, { id: "tx", title: "B", route: "coder", reason: "r" }] }),
  );
  const tasks = hermesPlanToTasks(plan);
  assert.deepEqual(tasks.map((t) => t.id), ["t1", "tx"]); // missing id assigned in order
  assert.equal(tasks[0].kind, "logic"); // schema default
  assert.equal(tasks[0].route, "coder-cheap");
  assert.equal(tasks[1].routeReason, "r");
});

test("route is required on every Hermes task", () => {
  assert.throws(() => parseHermesPlan(JSON.stringify({ tasks: [{ title: "A" }] })), HermesRouteError);
});

test("extractJsonObject rejects empty text", () => {
  assert.throws(() => extractJsonObject(""), HermesRouteError);
});

test("runHermesRouter wires provider output through validation (mock, no network)", async () => {
  const tasks = await runHermesRouter("a todo app", mockProvider(JSON.stringify(GOOD)));
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, "t1");
  assert.equal(tasks[0].route, "coder-cheap");
  assert.equal(tasks[0].routeReason, "scaffolding is cheap");
  assert.equal(tasks[1].route, "orchestrator");
  assert.equal(tasks[1].status, "pending");
  assert.equal(tasks[1].attempts, 0);
});

test("runHermesRouter assigns ids when Hermes omits them", async () => {
  const noIds = { tasks: GOOD.tasks.map(({ id: _id, ...rest }) => rest) };
  const tasks = await runHermesRouter("idea", mockProvider(JSON.stringify(noIds)));
  assert.deepEqual(tasks.map((t) => t.id), ["t1", "t2"]);
});

test("runHermesRouter propagates HermesRouteError for garbage output (caller falls back)", async () => {
  await assert.rejects(() => runHermesRouter("idea", mockProvider("definitely not json")), HermesRouteError);
});

test("system prompt documents all three tiers", () => {
  for (const tier of ["orchestrator", "coder", "coder-cheap"]) {
    assert.ok(HERMES_ROUTE_SYSTEM.includes(`"${tier}"`), `prompt should name ${tier}`);
  }
});
