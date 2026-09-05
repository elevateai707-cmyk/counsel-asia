import { resolve, join } from "node:path";
import { homedir } from "node:os";

/**
 * All counsel-asia state for a target project lives under `.counsel/` in that
 * project's root. We resolve everything relative to the current working
 * directory so the CLI can be run from inside any project.
 */
export function counselRoot(cwd: string = process.cwd()): string {
  return resolve(cwd, ".counsel");
}

export const paths = (cwd: string = process.cwd()) => {
  const root = counselRoot(cwd);
  return {
    root,
    goal: join(root, "goal.md"),
    config: join(root, "config.json"),
    tasks: join(root, "tasks.json"),
    ledger: join(root, "ledger.jsonl"),
    contextPacks: join(root, "context-packs"),
    patches: join(root, "patches"),
    reviews: join(root, "reviews"),
  };
};

export type CounselPaths = ReturnType<typeof paths>;

/**
 * Global home for fork-level settings (API keys in `.env`). Defaults to
 * `~/.counsel-asia`; override with `COUNSEL_ASIA_HOME` (handy for tests).
 */
export function counselAsiaHome(): string {
  return resolve(process.env.COUNSEL_ASIA_HOME ?? join(homedir(), ".counsel-asia"));
}
