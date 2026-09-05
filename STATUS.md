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
