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
- `createTaskSchema`, `taskQuerySchema`, `configSchema` (Zod validation)
- `PRIORITY_LEVELS`, `TASK_STATUSES`, `DEFAULT_CONFIG` constants

All other packages import types and schemas from here. Never duplicate type definitions in server or CLI.

### @promptqueue/server

**Critical constraint: better-sqlite3 is synchronous.** Worker uses async for provider calls but all DB operations are sync. The API accepts event-loop blocking on writes for single-node MVP.

Key layers:
- **Storage** (`storage/`) — SQLite with WAL mode. `TaskStore` and `EventStore` wrap better-sqlite3. `claimNext()` uses `BEGIN IMMEDIATE` transaction for atomic task claiming. `task_events` table is append-only (immutable audit trail). Migrations auto-run on startup from `storage/migrations/` SQL files.
- **API** (`api/`) — Hono routes. Each route file exports a Hono sub-app. All routes receive dependencies (stores, registry) via Hono's `c.set()`/`c.get()` context through middleware in `app.ts`. The `AppEnv` type in `app.ts` defines what's available.
- **Worker** (`worker/`) — Polling loop. `claimNext()` -> `executeTask()` -> `updateStatus()`. Concurrency controlled by `activeCount` semaphore. Retries use exponential backoff with jitter (`retry.ts`). Callbacks are fire-and-forget via `fetch()`.
- **Providers** (`providers/`) — `ProviderAdapter` interface from core. Each provider (anthropic, openai, mock) implements `execute()` and `healthCheck()`. `ProviderRegistry` maps model names to providers. `pricing.ts` has per-model token pricing.
- **Config** (`config/`) — YAML file loader with env var interpolation (`${VAR_NAME}`). Custom YAML parser (no js-yaml dependency). Merges with `DEFAULT_CONFIG` and validates via `configSchema`.
- **Logging** (`logging.ts`) — Structured JSON logger singleton. Writes to stdout/stderr. No `console.log` in production code.

Server entry (`index.ts`): Creates DB, stores, registry, worker, Hono app. Registers mock provider by default. Graceful shutdown on SIGTERM/SIGINT: stop worker -> close HTTP server -> close DB, with 30s timeout.

### @promptqueue/cli

Commander-based CLI. Each command in `commands/` makes HTTP requests to the running server. Build uses tsup with `@promptqueue/core` and `@promptqueue/server` marked as external (resolved at runtime via workspace symlinks). The `serve` command imports `startServer` from `@promptqueue/server` directly.

### @promptqueue/dashboard

Next.js 15 App Router with shadcn/ui (zinc color, CSS variables). Dark mode only (next-themes forced). API client in `src/lib/api-client.ts` fetches from `http://localhost:8080/api/v1`. Private package (not published to npm).

## Key Patterns

**API response envelope** — All endpoints return `{ success: boolean, data: T | null, error: string | null, meta?: { page, limit, total } }`. Never return raw data without the envelope.

**DB row-to-model mapping** — SQLite uses snake_case columns, TypeScript models use camelCase. The `rowToTask()` function in `task-store.ts` handles this mapping. When adding new columns, update both the SQL migration and `rowToTask()`.

**Task ID format** — `t_` prefix + ULID (e.g., `t_01HXYZABCDEF`). Generated via `TASK_ID_PREFIX` constant and `ulid()` in `TaskStore.create()`.

**Priority ordering** — Priority 1 (critical) through 5 (best-effort). `claimNext()` orders by `priority ASC, created_at ASC`. Lower number = higher priority.

**Provider registration** — Providers are registered in `index.ts` at server startup. To add a provider: create file in `providers/`, implement `ProviderAdapter`, register in `index.ts`, add pricing to `pricing.ts`.

**Test setup** — Server tests use in-memory SQLite (`:memory:`) via `createDatabase()`. The Hono `app.request()` method is used for API testing without starting an HTTP server. CLI tests mock `globalThis.fetch` and `process.exit`.

**Import paths** — All source imports use `.js` extensions (e.g., `import { foo } from "./bar.js"`) for ESM compatibility, even though the source files are `.ts`.
