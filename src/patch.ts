import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { paths } from "./paths.js";

/**
 * A structured, multi-file patch. The local model is required to emit exactly
 * this shape (as JSON) so applying it is mechanical — no fuzzy diff parsing,
 * and every write is validated by zod before it touches a working tree.
 *
 * We intentionally use FULL file contents, not diffs: small local models are
 * far more reliable producing whole files than valid unified diffs.
 */
export const PatchFile = z.object({
  /** POSIX relative path within the target project. Validated again at apply. */
  path: z.string().min(1),
  /** Complete file content to write. */
  content: z.string(),
});
export type PatchFile = z.infer<typeof PatchFile>;

export const Patch = z.object({
  summary: z.string().default(""),
  files: z.array(PatchFile).min(1, "patch must contain at least one file"),
});
export type Patch = z.infer<typeof Patch>;

/**
 * System prompt that pins the model to the patch contract. Paired with Ollama's
 * `format: "json"` so the response is guaranteed parseable JSON.
 */
export const PATCH_SYSTEM = `You are a local coding agent. Implement the requested task by emitting a JSON patch and NOTHING else.

Output schema (return ONLY this object):
{
  "summary": "one short sentence describing the change",
  "files": [
    { "path": "relative/posix/path.ext", "content": "<COMPLETE file content>" }
  ]
}

Rules:
- Output ONLY the JSON object. No markdown, no code fences, no prose.
- "content" is the ENTIRE file, not a diff or a fragment.
- Use forward-slash relative paths inside the project. Never absolute paths, never "..".
- Prefer the fewest files needed. Be correct and concise.`;

/**
 * Extract a Patch from raw model text. With Ollama JSON mode the response is
 * already clean JSON, but we defensively strip code fences and locate the
 * outermost object so a chatty model can't break us.
 */
export function parsePatch(raw: string): Patch {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : trimmed).trim();

  let candidate: unknown;
  try {
    candidate = JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Model did not return a JSON patch object.");
    }
    candidate = JSON.parse(body.slice(start, end + 1));
  }
  return Patch.parse(candidate);
}

/** Persist a validated patch as `.counsel/patches/<id>.json`. */
export async function savePatch(id: string, patch: Patch, cwd: string = process.cwd()): Promise<string> {
  const dir = paths(cwd).patches;
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${id}.json`);
  await writeFile(file, JSON.stringify(Patch.parse(patch), null, 2) + "\n", "utf8");
  return file;
}

/** Load a previously drafted patch, or null if none exists. */
export async function loadPatch(id: string, cwd: string = process.cwd()): Promise<Patch | null> {
  const file = join(paths(cwd).patches, `${id}.json`);
  if (!existsSync(file)) return null;
  return Patch.parse(JSON.parse(await readFile(file, "utf8")));
}
