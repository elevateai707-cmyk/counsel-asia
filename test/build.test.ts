import { test } from "node:test";
import assert from "node:assert/strict";
import { nextActionable } from "../src/commands/build.ts";
import { TaskGraph } from "../src/tasks.ts";

const graph = (tasks: unknown[]) => TaskGraph.parse({ goal: "g", createdAt: "2026-01-01T00:00:00Z", tasks });

test("picks the first actionable pending task", () => {
  const g = graph([
    { id: "a", title: "a", status: "done" },
    { id: "b", title: "b", status: "pending" },
    { id: "c", title: "c", status: "pending" },
  ]);
  assert.equal(nextActionable(g, new Set())?.id, "b");
});

test("skips tasks whose dependencies are not done", () => {
  const g = graph([
    { id: "a", title: "a", status: "pending" },
    { id: "b", title: "b", status: "pending", dependsOn: ["a"] },
  ]);
  // b is gated on a (not done) → a is chosen first
  assert.equal(nextActionable(g, new Set())?.id, "a");
});

test("once a dependency is done, the dependent becomes actionable", () => {
  const g = graph([
    { id: "a", title: "a", status: "done" },
    { id: "b", title: "b", status: "pending", dependsOn: ["a"] },
  ]);
  assert.equal(nextActionable(g, new Set())?.id, "b");
});

test("visited tasks are skipped (drives the --all loop)", () => {
  const g = graph([
    { id: "a", title: "a", status: "pending" },
    { id: "b", title: "b", status: "pending" },
  ]);
  assert.equal(nextActionable(g, new Set(["a"]))?.id, "b");
});

test("returns undefined when everything is done, blocked, or dependency-gated", () => {
  const g = graph([
    { id: "a", title: "a", status: "done" },
    { id: "b", title: "b", status: "blocked" },
    { id: "c", title: "c", status: "pending", dependsOn: ["b"] }, // dep is blocked, never done
  ]);
  assert.equal(nextActionable(g, new Set()), undefined);
});
