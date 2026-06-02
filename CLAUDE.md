# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
pnpm install                  # Install all workspace dependencies
pnpm build                    # Build all packages (turbo orchestrates order)
pnpm test                     # Run all tests across all packages
pnpm lint                     # Type-check all packages (tsc --noEmit)
pnpm clean                    # Remove all dist/ and .next/ artifacts

# Run a single package's tests
pnpm --filter @promptqueue/server test
pnpm --filter @promptqueue/core test

# Run a single test file
cd packages/server && npx vitest run src/__tests__/api.test.ts

# Start the server (dev mode, auto-restart)
pnpm --filter @promptqueue/server dev

# Start the server (production)
node packages/server/dist/index.js

# Start the dashboard (dev mode, hot reload)
pnpm --filter @promptqueue/dashboard dev

# Convenience scripts from project root
pnpm serve                    # Start server via CLI dev mode
pnpm submit "Hello"           # Submit a task
pnpm pq-status t_abc          # Check task status
pnpm pq-list                  # List tasks
```

## Architecture

pnpm monorepo with Turborepo. Four workspace packages under `packages/`:

### Package Dependency Graph

```
core (types, schemas, constants)
  <- server (API, worker, storage, providers)
  <- cli (commander CLI, depends on server for serve command)
  <- dashboard (Next.js UI, depends on core for types)
```

### @promptqueue/core

Shared TypeScript types and Zod schemas. The source of truth for:
- `Task`, `ProviderAdapter`, `ProviderRequest/Response`, `TaskEvent` interfaces
- `ToolDefinition`, `ToolResult`, `ToolExecutorFn`, `ToolConfig` (tool loop types)
- `createTaskSchema`, `taskQuerySchema`, `configSchema` (Zod validation)
- `PRIORITY_LEVELS`, `TASK_STATUSES`, `DEFAULT_CONFIG`, `DEFAULT_TOOL_CONFIG` constants

All other packages import types and schemas from here. Never duplicate type definitions in server or CLI.

### @promptqueue/server

**Critical constraint: better-sqlite3 is synchronous.** Worker uses async for provider calls but all DB operations are sync. The API accepts event-loop blocking on writes for single-node MVP.

Key layers:
- **Storage** (`storage/`) — SQLite with WAL mode. `TaskStore` and `EventStore` wrap better-sqlite3. `claimNext()` uses `BEGIN IMMEDIATE` transaction for atomic task claiming. `task_events` table is append-only (immutable audit trail). Migrations auto-run on startup from `storage/migrations/` SQL files.
- **API** (`api/`) — Hono routes. Each route file exports a Hono sub-app. All routes receive dependencies (stores, registry) via Hono's `c.set()`/`c.get()` context through middleware in `app.ts`. The `AppEnv` type in `app.ts` defines what's available.
- **Worker** (`worker/`) — Polling loop. `claimNext()` -> `executeTask()` -> `updateStatus()`. Concurrency controlled by `activeCount` semaphore. `executeTaskStreaming()` passes `toolExecutor` callback from `ToolRegistry` to providers that support `executeAgent()`. Retries use exponential backoff with jitter (`retry.ts`). Callbacks are fire-and-forget via `fetch()`.
- **Providers** (`providers/`) — `ProviderAdapter` interface from core. Each provider (anthropic, openai, mock, anthropic-sdk) implements `execute()` and `healthCheck()`. `AnthropicSDKProvider` also implements `executeAgent()` for the multi-turn tool loop via `@anthropic-ai/sdk`. `ProviderRegistry` maps model names to providers. `pricing.ts` has per-model token pricing.
- **Tools** (`tools/`) — `ToolRegistry` manages built-in tools with whitelist/blacklist governance and timeout enforcement. Built-in tools: `execute_command` (shell execution with allowed-commands filter), `read_file` (with offset/limit and path protection), `write_file` (with 1MB size limit and path protection), `ask_user` (human-in-the-loop — blocks on a Promise until user responds via `POST /tasks/:id/input`). The `PendingInputStore` in `ask-user.ts` manages the Promise-based blocking with timeout. All tools return `ToolResult` and never throw.
- **Config** (`config/`) — YAML file loader with env var interpolation (`${VAR_NAME}`). Custom YAML parser (no js-yaml dependency). Merges with `DEFAULT_CONFIG` and validates via `configSchema`.
- **Logging** (`logging.ts`) — Structured JSON logger singleton. Writes to stdout/stderr. No `console.log` in production code.

Server entry (`index.ts`): Creates DB, stores, registry, worker, Hono app. Registers providers (API, CLI, and anthropic-sdk types). Creates `ToolRegistry` and registers built-in tools if `tools` config is present. Creates `PendingInputStore` for HITL support — fails stuck `waiting_for_input` tasks on restart. Worker receives `toolRegistry` for tool loop support. Graceful shutdown on SIGTERM/SIGINT: stop worker -> close HTTP server -> close DB, with 30s timeout.

### @promptqueue/cli

Commander-based CLI. Each command in `commands/` makes HTTP requests to the running server. Build uses tsup with `@promptqueue/core` and `@promptqueue/server` marked as external (resolved at runtime via workspace symlinks). The `serve` command imports `startServer` from `@promptqueue/server` directly.

### @promptqueue/dashboard

Next.js 15 App Router with shadcn/ui (zinc color, CSS variables). Dark mode only (next-themes forced). API client in `src/lib/api-client.ts` fetches from `http://localhost:9090/api/v1`. Private package (not published to npm).

## Key Patterns

**API response envelope** — All endpoints return `{ success: boolean, data: T | null, error: string | null, meta?: { page, limit, total } }`. Never return raw data without the envelope.

**DB row-to-model mapping** — SQLite uses snake_case columns, TypeScript models use camelCase. The `rowToTask()` function in `task-store.ts` handles this mapping. When adding new columns, update both the SQL migration and `rowToTask()`.

**Task ID format** — `t_` prefix + ULID (e.g., `t_01HXYZABCDEF`). Generated via `TASK_ID_PREFIX` constant and `ulid()` in `TaskStore.create()`.

**Priority ordering** — Priority 1 (critical) through 5 (best-effort). `claimNext()` orders by `priority ASC, created_at ASC`. Lower number = higher priority.

**Provider registration** — Providers are registered in `index.ts` at server startup. To add a provider: create file in `providers/`, implement `ProviderAdapter`, register in `index.ts`, add pricing to `pricing.ts`. For tool loop support, implement `executeAgent()` with `toolExecutor` callback parameter.

**Tool loop** — Worker owns tool execution. When a provider returns `tool_use`, Worker intercepts via `toolExecutor` callback, runs it through `ToolRegistry` (governance check + execution), and injects the result back into the LLM conversation. This loops up to `maxTurns` (default 10). Enable per-task with `--tools` CLI flag or `tools.enabled` in task creation.

**Tool governance** — `ToolRegistry.isAllowed()` checks denied list first (prefix match), then allowed list. Empty allowed list means all registered tools are permitted (except denied). Tools never throw — errors are returned as `ToolResult.isError = true`.

**Human-in-the-Loop (HITL)** — The `ask_user` tool is a built-in tool that blocks on a Promise until the user responds via `POST /tasks/:id/input`. `ToolRegistry.executeWithContext()` injects `__taskId` into tool args so `ask_user` knows which task it's serving. The Worker releases the concurrency slot while waiting (`releaseSlot()`) and reclaims it on resume (`reclaimSlot()`). Tasks in `waiting_for_input` status can be cancelled via the existing DELETE endpoint. `waitingForInputTimeout` (default 3600s) controls how long to wait before timing out. On server restart, stuck `waiting_for_input` tasks are failed automatically.

**Test setup** — Server tests use in-memory SQLite (`:memory:`) via `createDatabase()`. The Hono `app.request()` method is used for API testing without starting an HTTP server. CLI tests mock `globalThis.fetch` and `process.exit`. HITL tests use `PendingInputStore` directly (unit tests) or via `createApp()` with `pendingInputStore` dependency (API tests).

**Import paths** — All source imports use `.js` extensions (e.g., `import { foo } from "./bar.js"`) for ESM compatibility, even though the source files are `.ts`.
