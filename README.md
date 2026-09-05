# counsel-asia

A **cost-optimized multi-agent build orchestrator for Asian cloud models**.
**Kimi (Moonshot AI) orchestrates; DeepSeek and Qwen build.** Hard dollar
budgets are enforced on every task and every project.

Forked from [`elevateai707-cmyk/counsel-cli`](https://github.com/elevateai707-cmyk/counsel-cli)
— same orchestrator machinery (deterministic router, structured patches,
test-gated apply in an isolated git worktree, append-only ledger), rebuilt
dollar-first for cheap Asian cloud models instead of local-Ollama-first.

> Core principle: this is NOT a free-form "ask many models" chat room. The
> moat is **routing, cost control, context compression, test-gated
> application, and a reproducible ledger.**

## Why it exists

DeepSeek and Qwen are cheap enough to use as everyday builders — cheap enough
that the old "cloud is emergency-only" posture is the wrong default. The new
failure mode is *quiet spend drift*, so the guardrail moved from "keep cloud
off" to **hard USD caps with real per-token accounting on every call.**

## Agent roles

| Role | Default | Job |
|------|---------|-----|
| **Router / "Token Economist"** | deterministic code (not an LLM) | classify tasks, assign the cheapest suitable tier, downgrade near budget — costs 0 tokens |
| **orchestrator** | Kimi `kimi-k3` | planning, security/payments review, integration, hard repair |
| **coder** | DeepSeek `deepseek-chat` | logic, UI, test fixes |
| **coder-cheap** | Qwen `qwen3-coder-flash` | boilerplate, CSS, docs |
| **fallback** | Ollama `gemma4:e4b` | explicit $0 local option for when an API key is missing |
| **router** | Hermes 4 70B via OpenRouter | decomposes your prompt and picks a tier per task |

## Routing: Hermes agent via OpenRouter

`counsel-asia plan "<idea>"` is the **autoroute** path:

1. You write a prompt.
2. **Hermes** (the `router` role, `nousresearch/hermes-4-70b` via OpenRouter by
   default) decomposes it into a task graph AND picks a cost tier per task,
   with a one-line reason. Everything Hermes returns is zod-validated; the
   routing call is gated and cost-logged like any other call.
3. On **any failure** (missing `OPENROUTER_API_KEY`, network error, malformed
   output) plan falls back with a printed warning to the deterministic path:
   the orchestrator (Kimi) decomposes and the deterministic router assigns.
4. **Dollar caps always win.** Hermes's per-task choices are stored on the
   tasks (`route` + `routeReason`), but the near-cap downgrade below applies
   to them exactly as it applies to deterministic routes — Hermes can only
   choose within budget.

`nousresearch/hermes-4-405b` also works if you want a stronger routing brain:
`counsel-asia model router openrouter nousresearch/hermes-4-405b`. The router
role can point at any provider (`counsel-asia model router <provider> [model]`).

## Deterministic routing policy (fallback, 0 tokens)

```
risk = security | payments        -> orchestrator (Kimi review)
blocked AND attempts >= 3         -> orchestrator (hard repair)
kind = integration                -> orchestrator (largest context)
kind = logic | ui | test-fix      -> coder (DeepSeek)
kind = boilerplate | css | docs   -> coder-cheap (Qwen)
```

When project spend comes **within 10% of `max_usd_per_project`**, routes are
downgraded one tier (orchestrator→coder, coder→coder-cheap) and the logged
reason says so — whether the route came from Hermes or this table.

## Pricing (USD per 1M tokens)

| model | input | output | cache-hit input |
|-------|------:|-------:|----------------:|
| deepseek-chat | $0.27 | $1.10 | $0.07 |
| kimi-k3 | $0.60 | $2.50 | — |
| kimi-k2-0905-preview | $0.60 | $2.50 | — |
| qwen3-coder-flash | $0.30 | $1.50 | — |
| qwen-flash | $0.05 | $0.40 | — |

⚠️ **Verify against the vendor pricing pages — they change. Edit
`src/pricing.ts` when prices change**; all cost estimates and ledger events
read from that one table. `kimi-k2-0905-preview` also works as the orchestrator
if `kimi-k3` isn't available on your account.

## Hard budget controls (defaults)

```json
{
  "cloud_enabled": true,
  "max_usd_per_project": 0.50,
  "max_usd_per_task": 0.10,
  "max_cloud_calls_per_project": 50,
  "max_cloud_calls_per_task": 5,
  "require_user_approval_for_cloud": false,
  "cheap_attempts_before_orchestrator": 3
}
```

The USD caps are the guardrail: the gate **hard-refuses** any call once a cap
is reached (reason names the cap). The interactive `Approve? [y/N]` prompt
fires only when `require_user_approval_for_cloud` is true.

## Setup

Requires Node 20+.

```bash
npm install && npm run build
```

API keys come from the environment or `~/.counsel-asia/.env` (override the
directory with `COUNSEL_ASIA_HOME`). Keys are never stored in a project's
`config.json`.

```bash
export OPENROUTER_API_KEY=...   # Hermes routing agent (autoroute)
export MOONSHOT_API_KEY=...     # Kimi orchestrator (KIMI_API_KEY also accepted)
export DEEPSEEK_API_KEY=...     # DeepSeek coder
export DASHSCOPE_API_KEY=...    # Qwen cheap coder (QWEN_API_KEY also accepted)
```

A missing key is a **loud error naming the env var and the .env file** — never
a silent fallback. If you deliberately want the $0 local path for a role,
point it at ollama explicitly: `counsel-asia model coder ollama gemma4:e4b`.

## Commands

```
counsel-asia init "<idea>"      # create .counsel/ workspace + dollar-capped config
counsel-asia plan "<idea>"      # Hermes autoroute: decompose + per-task model choice (deterministic fallback)
counsel-asia build [--apply] [--all]   # routed draft; --apply test-gates in a worktree
counsel-asia diagnose <taskId> [--apply]  # repair loop: failure output -> corrected patch
counsel-asia status             # config posture, task table, spend (total/per-model/remaining)
counsel-asia escalate <taskId>  # MANUAL escalation to orchestrator, through the gate
counsel-asia model [role] [provider] [model]  # show/switch the five roles (incl. router)
counsel-asia web [--port 4319] [--cwd path]   # local mobile-first control panel
```

## Web GUI

`counsel-asia web` serves a **local, mobile-first** control panel at
`http://127.0.0.1:4319` — a phone screen is the primary target: zero-build
vanilla HTML/CSS/JS, dark theme, thumb-friendly tabs. Three views:

- **Prompt** — one big textarea + Run button. Posts your idea to the Hermes
  autoroute (plan), then kicks off `build --all --apply`. The resulting task
  graph shows Hermes's model choice + reason per task.
- **Progress** — live view, polls every ~2s: task list with status / route /
  per-task cost, a spend bar with remaining budget, and a streaming ledger
  event tail.
- **Models** — the five roles. Default mode is **Auto (Hermes)**; per-role
  override dropdowns (kimi / deepseek / qwen / ollama / openrouter) with
  optional model pin, plus a per-provider key-presence indicator
  (configured / missing — key values are never exposed).

⚠️ **Localhost only, no auth — do not expose this port** beyond your own
machine. API: `POST /api/prompt {idea}`, `POST /api/build`, `GET /api/status`,
`GET /api/events?since=`, `GET /api/models`, `PUT /api/models/:role`. Long
plan/build runs execute async in-process; progress is visible via polling.

## Cost design

- **Hermes autoroute with a 0-token deterministic fallback.** The router role
  (Hermes via OpenRouter) decomposes prompts and picks the cheapest suitable
  tier per task; if it's unavailable, the deterministic router
  (`src/router.ts`) decides without spending a token.
- **Cheapest-tier routing by task kind.** Boilerplate/docs never touch the
  expensive models; only risk, integration, and repeated failure reach Kimi.
- **Hard USD caps** per project and per task, enforced in `src/gate.ts`
  against the ledger before every paid call. Hermes's route choices are
  subject to the same caps and the same near-cap downgrade.
- **A `cost` ledger event per call** with the real token cost computed from
  the API's `usage` field (including DeepSeek cache-hit rates), plus a
  per-call cost line printed to the user — the routing call included.
- **Near-budget downgrade**: within 10% of the project cap, routes drop a tier
  automatically.
- **Pre-call estimates** (chars/4 tokens) shown in the approval prompt when
  prompting is enabled.

## Workspace layout (per target project)

```
.counsel/
  goal.md            # the original prompt
  config.json        # budget + model profiles
  tasks.json         # task graph
  ledger.jsonl       # append-only event log (cost + decisions)
  context-packs/     # compressed context handed to the orchestrator on escalation
  patches/           # task diffs, applied only after tests pass
  reviews/           # orchestrator review outputs
```

## Stack

TypeScript / Node 20+ · `commander` (CLI) · `execa` (commands) · `simple-git`
(worktree isolation) · `zod` (validated task/patch/config shapes) ·
OpenAI-compatible chat completions over plain `fetch` (Kimi / DeepSeek /
Qwen-DashScope / OpenRouter) · Ollama HTTP API for the optional local fallback ·
`fastify` + `@fastify/static` for the localhost web panel.
