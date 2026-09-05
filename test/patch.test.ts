import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePatch } from "../src/patch.ts";

test("parses clean JSON", () => {
  const p = parsePatch('{"summary":"add file","files":[{"path":"a.txt","content":"hi"}]}');
  assert.equal(p.summary, "add file");
  assert.equal(p.files.length, 1);
  assert.equal(p.files[0].path, "a.txt");
  assert.equal(p.files[0].content, "hi");
});

test("strips ```json code fences", () => {
  const raw = "```json\n{\"files\":[{\"path\":\"a\",\"content\":\"x\"}]}\n```";
  const p = parsePatch(raw);
  assert.equal(p.files[0].path, "a");
  assert.equal(p.summary, ""); // defaulted
});

test("recovers JSON embedded in prose", () => {
  const raw = 'Sure! Here is the patch:\n{"files":[{"path":"b.ts","content":"export const x = 1;"}]}\nHope that helps.';
  const p = parsePatch(raw);
  assert.equal(p.files[0].path, "b.ts");
});

test("rejects a patch with no files", () => {
  assert.throws(() => parsePatch('{"files":[]}'));
});

test("rejects non-JSON output", () => {
  assert.throws(() => parsePatch("I cannot do that."));
});

test("rejects a file missing content", () => {
  assert.throws(() => parsePatch('{"files":[{"path":"a"}]}'));
});
