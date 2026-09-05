import { writeFile, mkdir, readFile, rm, symlink, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { simpleGit } from "simple-git";
import { execa } from "execa";
import type { Patch } from "./patch.js";

export interface ApplyResult {
  /** True if the patch files now live in the target working tree. */
  applied: boolean;
  /** True if a test command actually ran. */
  tested: boolean;
  /** True if tests passed (or there was no gate). */
  passed: boolean;
  /** How isolation was achieved. */
  method: "worktree" | "in-place" | "none";
  /** Human-readable test/diagnostic summary for the ledger + console. */
  summary: string;
}

/**
 * Resolve a patch path against the project root, refusing anything that escapes
 * it (absolute paths, `..` traversal). This is the only thing standing between a
 * model hallucination and an arbitrary file write, so it is deliberately strict.
 */
function safeTarget(cwd: string, p: string): string {
  if (isAbsolute(p)) throw new Error(`Patch path must be relative, got: ${p}`);
  const root = resolve(cwd);
  const target = resolve(root, p);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Patch path escapes the project root: ${p}`);
  }
  const rel = target.slice(root.length + 1);
  if (rel === ".counsel" || rel.startsWith(`.counsel${sep}`)) {
    throw new Error(`Patch path may not modify counsel state: ${p}`);
  }
  return target;
}

function missingParentDirs(cwd: string, target: string): string[] {
  const root = resolve(cwd);
  const dirs: string[] = [];
  let dir = dirname(target);
  while (dir !== root && dir.startsWith(root + sep)) {
    if (!existsSync(dir)) dirs.push(dir);
    dir = dirname(dir);
  }
  return dirs;
}

async function writeFiles(baseDir: string, cwd: string, patch: Patch): Promise<void> {
  for (const f of patch.files) {
    // Validate against the *project* root, then re-base into baseDir (worktree).
    const rel = safeTarget(cwd, f.path).slice(resolve(cwd).length + 1);
    const dest = rel ? join(baseDir, rel) : join(baseDir, f.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, f.content, "utf8");
  }
}

function truncate(s: string, n = 1200): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n) + `\n…(${t.length - n} more chars)` : t;
}

async function runTests(testCommand: string, dir: string): Promise<{ passed: boolean; summary: string }> {
  try {
    const res = await execa(testCommand, { cwd: dir, shell: true, reject: false, all: true });
    const out = truncate(res.all ?? "");
    if (res.exitCode === 0) return { passed: true, summary: `tests passed: ${testCommand}` };
    return { passed: false, summary: `tests failed (exit ${res.exitCode}): ${testCommand}\n${out}` };
  } catch (err) {
    return { passed: false, summary: `could not run tests (${testCommand}): ${(err as Error).message}` };
  }
}

/**
 * Apply `patch` to the project at `cwd`, gated on `testCommand`.
 *
 * Preferred path (git repo with at least one commit): create a detached git
 * worktree, symlink `node_modules` in so the suite can actually run, write the
 * files there, and run the tests in isolation. The real working tree is only
 * touched once tests pass. On failure nothing is applied.
 *
 * Fallback (no git / no commits): write in place with a backup-and-restore, so a
 * failing test still leaves the tree exactly as it was found.
 *
 * If `testCommand` is empty, files are applied with no gate (`tested: false`).
 */
export async function applyPatch(patch: Patch, testCommand: string, cwd: string = process.cwd()): Promise<ApplyResult> {
  // Surface path problems before we create any worktree.
  for (const f of patch.files) safeTarget(cwd, f.path);

  const git = simpleGit(cwd);
  let hasCommit = false;
  try {
    if (await git.checkIsRepo()) {
      await git.revparse(["HEAD"]);
      hasCommit = true;
    }
  } catch {
    hasCommit = false;
  }

  if (hasCommit && testCommand) {
    return applyViaWorktree(git, patch, testCommand, cwd);
  }
  return applyInPlace(patch, testCommand, cwd);
}

async function applyViaWorktree(
  git: ReturnType<typeof simpleGit>,
  patch: Patch,
  testCommand: string,
  cwd: string,
): Promise<ApplyResult> {
  const worktree = join(tmpdir(), `counsel-wt-${randomBytes(6).toString("hex")}`);
  try {
    await git.raw(["worktree", "add", "--detach", worktree, "HEAD"]);

    // A fresh worktree has source but no node_modules; symlink the project's so
    // the test command can resolve its deps without a costly reinstall.
    const nm = resolve(cwd, "node_modules");
    if (existsSync(nm) && !existsSync(join(worktree, "node_modules"))) {
      try {
        await symlink(nm, join(worktree, "node_modules"), "dir");
      } catch {
        /* best-effort; tests may still pass for dep-free projects */
      }
    }

    await writeFiles(worktree, cwd, patch);
    const test = await runTests(testCommand, worktree);

    if (!test.passed) {
      return { applied: false, tested: true, passed: false, method: "worktree", summary: test.summary };
    }

    // Tests green in isolation → commit the files to the real tree.
    await writeFiles(cwd, cwd, patch);
    return { applied: true, tested: true, passed: true, method: "worktree", summary: test.summary };
  } finally {
    await git.raw(["worktree", "remove", "--force", worktree]).catch(() => rm(worktree, { recursive: true, force: true }).catch(() => {}));
  }
}

async function applyInPlace(patch: Patch, testCommand: string, cwd: string): Promise<ApplyResult> {
  // Snapshot every target file so we can roll back on a failed test gate.
  const backups = new Map<string, string | null>(); // path -> prior content, or null if new
  const createdDirs = new Set<string>();
  for (const f of patch.files) {
    const target = safeTarget(cwd, f.path);
    backups.set(target, existsSync(target) ? await readFile(target, "utf8") : null);
    for (const dir of missingParentDirs(cwd, target)) createdDirs.add(dir);
  }

  await writeFiles(cwd, cwd, patch);

  if (!testCommand) {
    return { applied: true, tested: false, passed: true, method: "in-place", summary: "applied (no test gate configured)" };
  }

  const test = await runTests(testCommand, cwd);
  if (test.passed) {
    return { applied: true, tested: true, passed: true, method: "in-place", summary: test.summary };
  }

  // Roll back to the pre-apply snapshot.
  for (const [target, prior] of backups) {
    if (prior === null) await rm(target, { force: true });
    else await writeFile(target, prior, "utf8");
  }
  for (const dir of [...createdDirs].sort((a, b) => b.length - a.length)) {
    await rmdir(dir).catch(() => {});
  }
  return { applied: false, tested: true, passed: false, method: "in-place", summary: test.summary };
}
