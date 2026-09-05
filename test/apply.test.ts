import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { applyPatch } from "../src/apply.ts";
import type { Patch } from "../src/patch.ts";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "counsel-apply-"));
}

const patch = (files: Patch["files"]): Patch => ({ summary: "test", files });

test("in-place: applies when the test gate passes", async () => {
  const dir = await tmp();
  try {
    const r = await applyPatch(patch([{ path: "out.txt", content: "ok" }]), "exit 0", dir);
    assert.equal(r.applied, true);
    assert.equal(r.passed, true);
    assert.equal(r.method, "in-place");
    assert.equal(await readFile(join(dir, "out.txt"), "utf8"), "ok");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("in-place: rolls back a NEW file when tests fail", async () => {
  const dir = await tmp();
  try {
    const r = await applyPatch(patch([{ path: "new.txt", content: "nope" }]), "exit 1", dir);
    assert.equal(r.applied, false);
    assert.equal(r.passed, false);
    assert.equal(existsSync(join(dir, "new.txt")), false, "new file must be removed on failure");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("in-place: removes directories created for a failed patch", async () => {
  const dir = await tmp();
  try {
    const r = await applyPatch(patch([{ path: "new/deep/file.txt", content: "nope" }]), "exit 1", dir);
    assert.equal(r.applied, false);
    assert.equal(r.passed, false);
    assert.equal(existsSync(join(dir, "new")), false, "new parent directories must be removed on failure");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("in-place: restores prior content of an EXISTING file when tests fail", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "keep.txt"), "ORIGINAL", "utf8");
    const r = await applyPatch(patch([{ path: "keep.txt", content: "CLOBBERED" }]), "exit 1", dir);
    assert.equal(r.applied, false);
    assert.equal(await readFile(join(dir, "keep.txt"), "utf8"), "ORIGINAL");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty test_command applies without a gate", async () => {
  const dir = await tmp();
  try {
    const r = await applyPatch(patch([{ path: "x.txt", content: "y" }]), "", dir);
    assert.equal(r.applied, true);
    assert.equal(r.tested, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects path traversal outside the project root", async () => {
  const dir = await tmp();
  try {
    await assert.rejects(() => applyPatch(patch([{ path: "../escape.txt", content: "x" }]), "", dir));
    assert.equal(existsSync(join(dir, "..", "escape.txt")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects patches that target counsel's internal state", async () => {
  const dir = await tmp();
  try {
    await assert.rejects(() => applyPatch(patch([{ path: ".counsel/config.json", content: "{}" }]), "", dir), /counsel state/);
    assert.equal(existsSync(join(dir, ".counsel", "config.json")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("worktree: tests run in isolation; tree only changes on green", async () => {
  const dir = await tmp();
  try {
    await execa("git", ["init", "-q"], { cwd: dir });
    await execa("git", ["config", "user.email", "t@t"], { cwd: dir });
    await execa("git", ["config", "user.name", "t"], { cwd: dir });
    await writeFile(join(dir, "seed.txt"), "seed", "utf8");
    await execa("git", ["add", "-A"], { cwd: dir });
    await execa("git", ["commit", "-qm", "init"], { cwd: dir });

    // Failing gate: working tree must stay clean (file not written to main tree).
    const fail = await applyPatch(patch([{ path: "feat.txt", content: "v1" }]), "exit 3", dir);
    assert.equal(fail.method, "worktree");
    assert.equal(fail.applied, false);
    assert.equal(existsSync(join(dir, "feat.txt")), false);

    // Passing gate: now the file lands in the real tree.
    const ok = await applyPatch(patch([{ path: "feat.txt", content: "v1" }]), "exit 0", dir);
    assert.equal(ok.method, "worktree");
    assert.equal(ok.applied, true);
    assert.equal(await readFile(join(dir, "feat.txt"), "utf8"), "v1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
