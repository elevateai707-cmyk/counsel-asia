import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, ModelProfile } from "../config.js";
import { loadTasks } from "../tasks.js";
import { readLedger, totalSpend, spendByModel, spendForTask, cloudCallsThisProject } from "../ledger.js";
import { planCommand } from "../commands/plan.js";
import { buildCommand } from "../commands/build.js";

/**
 * Local web control panel. LOCALHOST ONLY, no auth — never expose this beyond
 * your own machine. Zero-build vanilla frontend in ./public (mobile-first).
 *
 * Commands run in-process against process.cwd() (startServer chdirs when
 * `--cwd` is given). Long-running plan/build runs are fired async; the
 * frontend polls /api/status + /api/events for progress.
 */

interface RunState {
  kind: string;
  startedAt: string;
  done: boolean;
  error?: string;
}

let currentRun: RunState | null = null;

function runAsync(kind: string, fn: () => Promise<void>): void {
  if (currentRun && !currentRun.done) throw new Error(`a run is already in progress (${currentRun.kind})`);
  currentRun = { kind, startedAt: new Date().toISOString(), done: false };
  void (async () => {
    try {
      await fn();
      currentRun = { ...currentRun!, done: true };
    } catch (err) {
      currentRun = { ...currentRun!, done: true, error: (err as Error).message };
    }
  })();
}

/** Key presence per provider — booleans only, key VALUES never leave the process. */
function keyPresence(): Record<string, { configured: boolean; keyEnv: string | null; local?: boolean }> {
  const has = (...vars: string[]) => vars.some((v) => Boolean(process.env[v]));
  return {
    kimi: { configured: has("MOONSHOT_API_KEY", "KIMI_API_KEY"), keyEnv: "MOONSHOT_API_KEY" },
    deepseek: { configured: has("DEEPSEEK_API_KEY"), keyEnv: "DEEPSEEK_API_KEY" },
    qwen: { configured: has("DASHSCOPE_API_KEY", "QWEN_API_KEY"), keyEnv: "DASHSCOPE_API_KEY" },
    openrouter: { configured: has("OPENROUTER_API_KEY"), keyEnv: "OPENROUTER_API_KEY" },
    ollama: { configured: true, keyEnv: null, local: true },
  };
}

const PROVIDERS = ModelProfile.shape.provider.options as string[];

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  // dist/web/server.js -> dist/web/public; src/web/server.ts -> src/web/public
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
  app.register(fastifyStatic, { root: publicDir });

  app.get("/api/status", async () => {
    const config = await loadConfig();
    const graph = await loadTasks();
    const events = await readLedger();
    const spent = totalSpend(events);
    return {
      goal: graph?.goal ?? null,
      roles: config.models,
      caps: {
        cloud_enabled: config.cloud_enabled,
        max_usd_per_project: config.max_usd_per_project,
        max_usd_per_task: config.max_usd_per_task,
        max_cloud_calls_per_project: config.max_cloud_calls_per_project,
        max_cloud_calls_per_task: config.max_cloud_calls_per_task,
        require_user_approval_for_cloud: config.require_user_approval_for_cloud,
      },
      spend: {
        total: spent,
        byModel: spendByModel(events),
        remaining: config.max_usd_per_project - spent,
      },
      cloudCalls: { project: cloudCallsThisProject(events), projectCap: config.max_cloud_calls_per_project },
      tasks: (graph?.tasks ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        kind: t.kind,
        risk: t.risk,
        status: t.status,
        attempts: t.attempts,
        route: t.route ?? null,
        routeReason: t.routeReason ?? null,
        spendUsd: spendForTask(events, t.id),
      })),
      run: currentRun,
    };
  });

  app.get<{ Querystring: { since?: string } }>("/api/events", async (req) => {
    const events = await readLedger();
    const since = Math.max(0, Number(req.query.since ?? 0) || 0);
    return { events: events.slice(since), next: events.length };
  });

  app.get("/api/models", async () => {
    const config = await loadConfig();
    return { roles: config.models, providers: PROVIDERS, keys: keyPresence() };
  });

  app.put<{ Params: { role: string }; Body: { provider?: string; model?: string } }>("/api/models/:role", async (req, reply) => {
    const config = await loadConfig();
    const role = req.params.role;
    if (!Object.keys(config.models).includes(role)) {
      return reply.code(400).send({ error: `unknown role "${role}"`, roles: Object.keys(config.models) });
    }
    const provider = req.body?.provider;
    if (!provider || !PROVIDERS.includes(provider)) {
      return reply.code(400).send({ error: `unknown provider "${provider}"`, providers: PROVIDERS });
    }
    if (provider === "disabled") {
      return reply.code(400).send({ error: "roles cannot be disabled from the web panel" });
    }
    (config.models as Record<string, { provider: string; model?: string }>)[role] = {
      provider,
      model: req.body?.model || undefined,
    };
    await saveConfig(config);
    return { ok: true, roles: config.models };
  });

  app.post<{ Body: { idea?: string } }>("/api/prompt", async (req, reply) => {
    const idea = req.body?.idea?.trim();
    if (!idea) return reply.code(400).send({ error: "body must be { idea: string }" });
    try {
      // Hermes autoroute (plan) then build everything, test-gated.
      runAsync("plan+build", async () => {
        await planCommand(idea);
        await buildCommand({ apply: true, all: true });
      });
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
    return reply.code(202).send({ ok: true, run: currentRun });
  });

  app.post("/api/build", async (_req, reply) => {
    try {
      runAsync("build", () => buildCommand({ apply: true, all: true }));
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
    return reply.code(202).send({ ok: true, run: currentRun });
  });

  return app;
}

export async function startServer(port = 4319): Promise<void> {
  const app = buildServer();
  await app.listen({ port, host: "127.0.0.1" }); // localhost only, no auth
  console.log(`counsel-asia web panel: http://127.0.0.1:${port}`);
  console.log(`(localhost only, no auth — do not expose this port)`);
  console.log(`project: ${process.cwd()}`);
}
