import { test } from "node:test";
import assert from "node:assert/strict";
import { settleAfterApply } from "../src/settle.ts";
import { Task } from "../src/tasks.ts";
import { defaultConfig } from "../src/config.ts";
import type { ApplyResult } from "../src/apply.ts";

const task = (over = {}) => Task.parse({ id: "t1", title: "x", ...over });
const result = (over: Partial<ApplyResult> = {}): ApplyResult => ({
  applied: false, tested: true, passed: false, method: "worktree", summary: "boom", ...over,
});
const cfg = (over = {}) => ({ ...defaultConfig(), ...over });

test("pass → task done", () => {
  const t = task();
  const { outcome } = settleAfterApply(t, cfg(), result({ applied: true, passed: true, summary: "ok" }));
  assert.equal(outcome, "done");
  assert.equal(t.status, "done");
});

test("fail with budget exhausted → blocked", () => {
  const t = task({ attempts: 3 });
  const { outcome, lines } = settleAfterApply(t, cfg({ cheap_attempts_before_orchestrator: 3 }), result());
  assert.equal(outcome, "blocked");
  assert.equal(t.status, "blocked");
  assert.match(lines.join("\n"), /BLOCKED/);
});

test("fail with budget left → back to pending (retry)", () => {
  const t = task({ attempts: 1 });
  const { outcome } = settleAfterApply(t, cfg({ cheap_attempts_before_orchestrator: 3 }), result());
  assert.equal(outcome, "retry");
  assert.equal(t.status, "pending");
});
