import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { counselAsiaHome } from "./paths.js";

/**
 * Load optional global env vars (MOONSHOT_API_KEY, DEEPSEEK_API_KEY,
 * DASHSCOPE_API_KEY, …) from `~/.counsel-asia/.env`. Real environment
 * variables always win; the file only fills in what is unset.
 */
export function loadAsiaEnv(): void {
  const file = join(counselAsiaHome(), ".env");
  if (!existsSync(file)) return;

  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}
