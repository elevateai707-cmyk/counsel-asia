import { startServer } from "../web/server.js";

/**
 * `counsel-asia web [--port 4319] [--cwd path]` — local, mobile-first web
 * control panel. LOCALHOST ONLY, no auth: never expose the port.
 */
export async function webCommand(opts: { port?: string; cwd?: string }): Promise<void> {
  if (opts.cwd) process.chdir(opts.cwd);
  const port = Number(opts.port ?? 4319);
  await startServer(port);
}
