# counsel-asia — Fork Status

_Forked 2026-09-05 from `counsel-cli` (upstream: `elevateai707-cmyk/counsel-cli`). Fresh git history; no upstream `.git` carried over._

## Inherited unchanged (upstream machinery)

- `src/patch.ts` — structured zod-validated JSON patches + tolerant parser.
- `src/apply.ts` — test-gated apply in an isolated git worktree with rollback.
- `src/settle.ts` — shared post-apply task settling (renamed config key only).
- `src/tasks.ts` — task graph schema.
- `.counsel/` per-project workspace layout (same directory name).
- `src/providers/ollama.ts` — kept as the explicit $0 fallback provider.

## Changed for the fork

- **Stripped extras**: Hermes training, web skill-scanner, Fastify web GUI,
  Nous/Claude/Codex/Gemini providers, fastify deps, related tests and the
  web-public copy step in the build.
- **Providers** (`src/providers/`): one generic `OpenAICompatibleProvider`
  (`openai.ts`) parameterized by name/base-URL/key-env-var; thin wrappers
  `kimi.ts` (Moonshot, `MOONSHOT_API_KEY`→`KIMI_API_KEY`), `deepseek.ts`,
  `qwen.ts` (DashScope compatible-mode, `DASHSCOPE_API_KEY`→`QWEN_API_KEY`).
  Missing key = loud `MissingApiKeyError` naming the env var and
  `~/.counsel-asia/.env` (never a silent fallback). `GenerateResult` gains
  optional `usage { promptTokens, completionTokens, costUsd }` populated from
  the API usage field.
- **`src/pricing.ts` (new)**: per-model USD/1M-token table (DeepSeek cache-hit
  rate included), `estimateCostUsd`, `knownModel`, `roughTokenEstimate`.
- **`src/config.ts`**: dollar-first budgets (`max_usd_per_project` 0.50,
  `max_usd_per_task` 0.10, `cloud_enabled` true, approval prompt off),
  `cheap_attempts_before_orchestrator`, roles `orchestrator`/`coder`/
  `coder_cheap`/`fallback`, endpoints `moonshot_url`/`deepseek_url`/`qwen_url`/
  `ollama_url`, provider enum `kimi|deepseek|qwen|ollama|disabled`.
- **`src/router.ts`**: cost-tiered pure router `route(task, config, spentUsd)`
  → `orchestrator|coder|coder-cheap`, with one-tier downgrade within 10% of
  the project USD cap (reason string says so).
- **`src/gate.ts`**: hard USD caps (per project + per task via ledger `cost`
  events) alongside call-count caps; y/N prompt only when
  `require_user_approval_for_cloud` is true.
- **`src/ledger.ts`**: `cost` events carry `model`; new `spendForTask`,
  `spendByModel`, `recordCost`/`costLine` helpers.
- **Commands**: plan = orchestrator (Kimi, json mode, temp 0.1); build /
  build --all / diagnose resolve via the new router and log a cost event per
  call with a printed per-call cost line; status shows roles, caps, and spend
  (total / per-model / remaining); escalate = manual orchestrator escalation
  through the gate (failed calls consume no budget); model shows/switches the
  four roles.
- **env**: `~/.counsel-asia/.env` (override with `COUNSEL_ASIA_HOME`) replaces
  the old `~/.counsel/hermes/.env`.

## Verification (2026-09-05, Node 22, Linux)

- `npm install` — clean (fastify deps removed, lockfile regenerated).
- `npm run typecheck` — clean.
- `npm test` — **57/57 pass**, 0 fail (incl. new pricing tests, USD-cap gate
  tests, near-budget router downgrade tests; no network needed).
- `npm run build` — clean (`tsc` only).
- Smoke (no API keys set, temp dir): `init "test app"` ✓, `status` ✓,
  `plan` fails loudly with the `MOONSHOT_API_KEY` missing-key error ✓.
  `model` show/switch ✓, `.env` loading via `COUNSEL_ASIA_HOME` ✓.

## Not yet exercised

- No live paid API calls have been made (no keys in CI/dev env). The provider
  HTTP path follows the upstream DeepSeek shape; first real call against each
  vendor should confirm response/usage field names.
- Prices in `src/pricing.ts` are the values from the fork spec — verify
  against vendor pricing pages before relying on them.

---

## Round 2 — Hermes router + web GUI (2026-09-05): BUILT + VERIFIED

- **Hermes routing agent (autoroute)**: new `openrouter` provider
  (`nousresearch/hermes-4-70b` default, 405b noted), new `router` role,
  `src/hermes-route.ts` (zod-validated decomposition + per-task route choice).
  `plan` calls Hermes first; on missing key / network / validation failure it
  falls back with a printed warning to orchestrator-plan + deterministic
  router. Gate refusals never fall back (`GateBlockedError` from the new
  shared `src/call.ts` `gatedCall`). Routing call is cost-logged like any
  other. Task schema gains optional `route` + `routeReason` (old task files
  still parse). `resolveRoute()` prefers Hermes's choice; the near-cap
  downgrade applies to it identically — dollar caps are the invariant.
- **Web GUI**: `fastify` + `@fastify/static` re-added; `src/web/server.ts`
  (`buildServer()` factory + `startServer()`, localhost-only) + zero-build
  mobile-first dark frontend in `src/web/public/`. Views: Prompt (autoroute +
  build --all --apply), Progress (2s polling, budget bar, ledger tail), Models
  (5 roles incl. router, override dropdowns, key-presence without key values).
  API: POST /api/prompt, POST /api/build, GET /api/status, GET
  /api/events?since=, GET /api/models, PUT /api/models/:role. Long runs are
  async in-process. Build script restores the public-assets copy step.
- **Tests**: 13 hermes-route tests (parse/fence/garbage/enum/mock-provider),
  5 router-interaction tests (Hermes route respected; downgrade overrides near
  cap), 7 web inject tests. **82/82 pass** (57 prior + 25 new), no network.
- **Verification**: npm install clean; typecheck clean; `npm run build` green
  (tsc + public copy); smoke: `dist/index.js web --port 4319` served the
  dashboard HTML, /api/status and /api/models correctly from a temp project,
  then killed; `plan` with no keys warns about OPENROUTER_API_KEY, falls back,
  then fails loudly on MOONSHOT_API_KEY as designed.
- Not exercised: live Hermes/OpenRouter call (no keys). Fallback path is
  fully tested with a mock provider.
