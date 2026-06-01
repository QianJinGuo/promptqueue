# AGENTS.md

Guidance for coding agents working in this repository.

## Build and run

```bash
pnpm install                   # Install workspace dependencies
pnpm build                     # Build all packages via Turborepo
pnpm test                      # Run all tests
pnpm lint                      # Type-check all packages
pnpm clean                     # Remove build artifacts

# Package-specific
pnpm --filter @promptqueue/server test
pnpm --filter @promptqueue/core test
pnpm --filter @promptqueue/server dev
pnpm --filter @promptqueue/dashboard dev

# Single test file
cd packages/server && npx vitest run src/__tests__/api.test.ts

# Root convenience commands
pnpm serve
pnpm submit "Hello"
pnpm pq-status t_abc
pnpm pq-list
```

## Repository shape

This is a `pnpm` monorepo managed by Turborepo.

```text
core
  <- server
  <- cli
  <- dashboard
```

### `@promptqueue/core`

Shared types, Zod schemas, and constants. Treat this package as the source of truth for:

- `Task`, `ProviderAdapter`, `ProviderRequest`, `ProviderResponse`, `TaskEvent`
- `ToolDefinition`, `ToolResult`, `ToolExecutorFn`, `ToolConfig` (tool loop types)
- `createTaskSchema`, `taskQuerySchema`, `configSchema`
- `PRIORITY_LEVELS`, `TASK_STATUSES`, `DEFAULT_CONFIG`, `DEFAULT_TOOL_CONFIG`

Do not duplicate core types in other packages.

### `@promptqueue/server`

Hono API, SQLite storage, worker loop, providers, config loading, and logging.

Important constraints and structure:

- `better-sqlite3` is synchronous. DB operations are sync even though provider execution is async.
- `storage/` contains the SQLite-backed stores. When adding fields, update both SQL and row-mapping code.
- `api/` exports Hono sub-apps mounted from `app.ts`.
- `worker/` runs the polling loop: claim -> execute -> update status. `executeTaskStreaming()` passes `toolExecutor` callback to providers that support `executeAgent()`.
- `providers/` contains implementations of the shared `ProviderAdapter` contract. `AnthropicSDKProvider` implements the multi-turn tool loop via `@anthropic-ai/sdk`.
- `tools/` contains the `ToolRegistry` and built-in tools (`execute_command`, `read_file`, `write_file`). Tools are registered at startup and governed by whitelist/blacklist config.
- `config/` loads YAML, interpolates env vars, merges defaults, then validates.
- `logging.ts` is the structured logger entrypoint; avoid ad hoc production logging.

Server startup lives in `packages/server/src/index.ts`. It wires the database, stores, provider registry, worker, and HTTP server, and handles graceful shutdown.

### `@promptqueue/cli`

Commander-based CLI. Commands in `commands/` talk to the running server over HTTP, except `serve`, which starts the server package directly.

### `@promptqueue/dashboard`

Next.js 15 App Router UI. Uses shadcn/ui and dark mode only. API access lives in `src/lib/api-client.ts`.

## Repo-specific patterns

- **API responses:** return the standard envelope  
  `{ success, data, error, meta? }`
- **Task IDs:** `t_` prefix plus ULID
- **Priority semantics:** lower numeric priority means higher execution priority
- **Queue ordering:** `priority ASC, created_at ASC`
- **DB mapping:** SQLite columns use `snake_case`; TypeScript models use `camelCase`
- **Imports:** source imports use `.js` extensions for ESM compatibility, even in `.ts` files

## When changing code

- Reuse `@promptqueue/core` schemas and types instead of redefining validation or contracts
- Preserve the API response envelope shape across server routes
- Keep storage changes consistent across migrations, stores, and model mapping helpers
- Register new providers in server startup and update pricing where relevant
- Register new built-in tools in `index.ts` startup and add them to `DEFAULT_TOOL_CONFIG`
- Built-in tools must never throw — return `ToolResult` with `isError: true` on failure
- File tools must use `resolve()` + allowed-paths prefix matching to prevent path traversal
- Follow existing package boundaries instead of moving logic across workspaces casually

## Testing guidance

- Server tests commonly use in-memory SQLite via `createDatabase()`
- API tests use `app.request()` without starting a live HTTP server
- CLI tests mock `globalThis.fetch` and `process.exit`

Prefer targeted package tests while iterating, then run the relevant workspace-wide command before finishing larger changes.
