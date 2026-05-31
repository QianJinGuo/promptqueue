# PromptQueue — Implementation Plan

> Version: 0.1.0
> Date: 2026-05-30
> Status: In Progress (Phases 1-3 complete)

---

## Progress Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Monorepo scaffold + core types | **Complete** |
| 2 | Storage layer (SQLite + migrations + task/event stores) | **Complete** |
| 3 | API + Worker (walking skeleton) | **Complete** |
| 4 | Provider integration (real AI calls) | In Progress |
| 5 | Configuration + CLI | Pending |
| 6 | Dashboard | Pending |
| 7 | Integration testing + polish | Pending |
| 8 | Documentation + release prep | Pending |

---

## Phase 1: Monorepo Scaffold + Core Types — COMPLETE

**Deliverables:**
- pnpm monorepo with Turborepo
- `@promptqueue/core` — shared types, Zod schemas, constants
- `@promptqueue/server` — Hono API scaffold
- `@promptqueue/cli` — Commander CLI scaffold
- Root tsconfig, turbo.json, pnpm-workspace.yaml

**Key files:**
- `packages/core/src/types.ts` — Task, ProviderAdapter, ProviderRequest, ProviderResponse, etc.
- `packages/core/src/schemas.ts` — createTaskSchema, taskQuerySchema, configSchema
- `packages/core/src/constants.ts` — PRIORITY_LEVELS, DEFAULT_CONFIG, TASK_ID_PREFIX

**Verification:** `pnpm build` compiles, types importable across packages

---

## Phase 2: Storage Layer — COMPLETE

**Deliverables:**
- SQLite database with WAL mode
- Migration runner (version-numbered SQL files)
- TaskStore — create, getById, list, updateStatus, claimNext, cancel, getQueueStats
- EventStore — append, getByTaskId, getRecent
- 26 tests passing

**Key files:**
- `packages/server/src/storage/database.ts`
- `packages/server/src/storage/migrations/001_initial.sql`
- `packages/server/src/storage/task-store.ts`
- `packages/server/src/storage/event-store.ts`

**Key patterns:**
- Atomic claim: `db.transaction()` — SELECT pending — UPDATE running — INSERT event — COMMIT
- Priority ordering: `ORDER BY priority ASC, created_at ASC`
- Event type mapping: status "running" maps to event type "started"

**Verification:** All storage tests pass with in-memory SQLite

---

## Phase 3: API + Worker (Walking Skeleton) — COMPLETE

**Deliverables:**
- Hono API routes: tasks, queues, providers, SSE events
- API key auth middleware (skip in dev mode)
- Error handler middleware (structured error envelope)
- ProviderRegistry + MockProvider
- Worker with concurrency control + exponential backoff retry
- Full end-to-end flow: submit — claim — execute — complete
- 34 tests passing

**Key files:**
- `packages/server/src/api/tasks.ts` — POST/GET/DELETE /api/v1/tasks
- `packages/server/src/api/queues.ts` — GET /api/v1/queues
- `packages/server/src/api/providers.ts` — GET /api/v1/providers
- `packages/server/src/api/events.ts` — SSE /api/v1/tasks/:id/events
- `packages/server/src/api/middleware/auth.ts`
- `packages/server/src/api/middleware/error-handler.ts`
- `packages/server/src/providers/registry.ts`
- `packages/server/src/providers/mock.ts`
- `packages/server/src/worker/worker.ts`
- `packages/server/src/worker/retry.ts`
- `packages/server/src/app.ts`
- `packages/server/src/index.ts`

**Verification:** Server boots, serves requests, worker processes tasks end-to-end with mock provider

---

## Phase 4: Provider Integration (Real AI Calls) — In Progress

**Goal:** Anthropic and OpenAI providers making real API calls with token tracking and cost estimation.

### Tasks

1. **Anthropic provider** — `packages/server/src/providers/anthropic.ts`
   - Use `@anthropic-ai/sdk`
   - Map ProviderRequest to messages.create params
   - Extract token usage (input_tokens, output_tokens, cache tokens)
   - Cost calculation based on model pricing
   - Health check

2. **OpenAI provider** — `packages/server/src/providers/openai.ts`
   - Use `openai` SDK v6+
   - Map ProviderRequest to chat.completions.create params
   - Extract token usage (prompt_tokens, completion_tokens)
   - Cost calculation
   - Health check

3. **Cost calculation** — `packages/server/src/providers/pricing.ts`
   - Pricing table for Anthropic/OpenAI models (per 1M tokens)
   - `calculateCost(model, inputTokens, outputTokens): number`

4. **Tests** — `packages/server/src/providers/__tests__/`
   - Unit tests with mocked SDK responses
   - Cost calculation tests

### Verification
- Submit a task with `model: "claude-sonnet-4-6"` and get a real response
- Submit a task with `model: "gpt-4.1"` and get a real response
- Token usage recorded, cost calculated

---

## Phase 5: Configuration + CLI — Pending

**Goal:** YAML config file + CLI commands for serve/submit/status/list.

### Tasks

1. **Configuration** — `packages/server/src/config/`
   - Load from YAML + env vars + CLI flags
   - Zod-validated config schema (reuse from core)
   - Env var interpolation for API keys (`${ANTHROPIC_API_KEY}`)

2. **CLI commands** — `packages/cli/src/commands/`
   - `serve.ts` — Start server + worker
   - `submit.ts` — Submit task from CLI
   - `status.ts` — Check task status
   - `list.ts` — List tasks with filters

3. **Package bin** — `packages/cli/package.json`
   - `bin: { "promptqueue": "./dist/index.js" }`

### Verification
- `promptqueue serve` starts the server
- `promptqueue submit "Hello" --model claude-sonnet-4-6` returns task ID
- `promptqueue status t_abc123` shows current status
- Config file loaded and validated

---

## Phase 6: Dashboard — Pending

**Goal:** Dark-mode dashboard with overview, task list, and task detail views.

### Tasks

1. **Setup** — shadcn/ui + next-themes (dark mode default)
2. **Layout** — Sidebar with nav: Overview, Tasks, Queues, Providers
3. **Overview page** — Queue depth, recent tasks, provider status
4. **Tasks page** — Filterable table with click-through to detail
5. **Task detail** — Prompt, result, token usage, timeline, retry history
6. **Queues page** — Per-queue stats
7. **API client** — Type-safe fetch wrapper using shared types + SSE

### Verification
- Dashboard loads at `http://localhost:3000`
- Dark mode default, tasks filterable and clickable

---

## Phase 7: Integration Testing + Polish — Pending

### Tasks

1. **E2E tests** — Playwright for dashboard
2. **Integration tests** — Full lifecycle: submit — claim — execute — complete/retry/cancel/timeout
3. **Rate limiting** — Per-IP in-memory counter
4. **Graceful shutdown** — SIGTERM handler, drain running tasks
5. **Logging** — Structured JSON logging
6. **Docker** — Multi-stage Dockerfile

### Verification
- E2E + integration tests pass
- Graceful shutdown preserves in-flight tasks
- Docker image builds and runs

---

## Phase 8: Documentation + Release Prep — Pending

### Tasks

1. **README.md** — Quick start, architecture
2. **CONTRIBUTING.md** — Dev setup, PR process
3. **GitHub Actions** — CI: lint, test, build
4. **LICENSE** — MIT
5. **Changeset** — Versioning + changelogs
6. **npm publish config** — Package names and metadata

### Verification
- Fresh clone: `pnpm install && pnpm build && pnpm test` all green
