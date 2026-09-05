import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCostUsd, knownModel, roughTokenEstimate, PRICING } from "../src/pricing.ts";

test("knownModel recognizes priced models and rejects unknown ones", () => {
  for (const m of ["deepseek-chat", "kimi-k3", "kimi-k2-0905-preview", "qwen3-coder-flash", "qwen-flash"]) {
    assert.equal(knownModel(m), true, `${m} should be priced`);
  }
  assert.equal(knownModel("gpt-99-ultra"), false);
});

test("estimateCostUsd matches the published rates (deepseek-chat, all cache miss)", () => {
  // $0.27/M in, $1.10/M out
  const cost = estimateCostUsd("deepseek-chat", 1_000_000, 1_000_000);
  assert.equal(cost.toFixed(2), "1.37");
});

test("deepseek cache-hit input bills at the cheaper rate", () => {
  // 1M prompt tokens all cache hits ($0.07/M) + 1M output ($1.10/M)
  const cost = estimateCostUsd("deepseek-chat", 1_000_000, 1_000_000, 1_000_000);
  assert.equal(cost.toFixed(2), "1.17");
});

test("cache hits are clamped to the prompt size", () => {
  const cost = estimateCostUsd("deepseek-chat", 100, 0, 999_999);
  assert.equal(cost, estimateCostUsd("deepseek-chat", 100, 0, 100));
});

test("kimi-k3: $0.60/M in, $2.50/M out", () => {
  const cost = estimateCostUsd("kimi-k3", 500_000, 200_000);
  assert.equal(cost.toFixed(4), (0.5 * 0.6 + 0.2 * 2.5).toFixed(4));
});

test("kimi-k2-0905-preview is priced the same as kimi-k3", () => {
  assert.deepEqual(PRICING["kimi-k2-0905-preview"], PRICING["kimi-k3"]);
});

test("qwen models price per the table", () => {
  assert.equal(estimateCostUsd("qwen3-coder-flash", 1_000_000, 0).toFixed(2), "0.30");
  assert.equal(estimateCostUsd("qwen-flash", 1_000_000, 1_000_000).toFixed(2), "0.45");
});

test("unknown model costs 0 (callers should check knownModel first)", () => {
  assert.equal(estimateCostUsd("mystery-model", 1_000_000, 1_000_000), 0);
});

test("roughTokenEstimate is chars/4, rounded up", () => {
  assert.equal(roughTokenEstimate(400), 100);
  assert.equal(roughTokenEstimate(401), 101);
  assert.equal(roughTokenEstimate(0), 0);
});
