# Agent Orchestration + Foundation Fixes Design

**Date:** 2026-06-01
**Status:** Draft
**Approach:** Layer-by-layer — build CLI provider abstraction first, then wire foundation fixes around it

## Problem

PromptQueue has a working queue with Anthropic/OpenAI providers, but:
1. **No agent runtime integration** — tasks are single-shot API calls, not agent workflows
2. **Foundation gaps** — no timeout enforcement, retry backoff not wired, rate limiting not applied, missing provider/worker tests

## Architecture Overview

```
PromptQueue Worker
  ├── In-process providers (Anthropic, OpenAI, Mock)
  │     └── execute() with Promise.race timeout
  └── CLI agent providers (Claude Code, Codex, Gemini)
        └── executeAgent() via CliProvider subprocess
              ├── subprocess timeout (SIGTERM/SIGKILL)
              ├── stdout streaming → AgentEvent
              └── exit code → retry/error classification
```

---

## Section 1: CliProvider Base Class

New abstract class at `packages/server/src/providers/cli-provider.ts`.

```typescript
abstract class CliProvider implements ProviderAdapter {
  abstract name: string;
  abstract models: readonly string[];

  protected abstract buildCommand(request: ProviderRequest): string[];
  protected abstract parseOutput(stdout: string): ProviderResponse;

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const args = this.buildCommand(request);
    const child = spawn(args[0], args.slice(1), { timeout: request.timeout });

    // Capture stdout, handle timeout, capture exit code
    // Return parsed response
  }
}
```

### Key behaviors

- **Timeout** — `spawn` gets a `timeout` option; if exceeded, `SIGTERM` then `SIGKILL`. Single timeout mechanism for CLI providers.
- **Exit code mapping** — non-zero exit → retryable error (unless specific codes indicate auth failure)
- **Stdout/stderr capture** — stderr logged, stdout parsed by subclass
- **Process cleanup** — child process killed on worker shutdown

### Concrete providers

```typescript
class ClaudeCodeProvider extends CliProvider {
  name = "claude-code";
  models = ["claude-sonnet-4-6", "claude-opus-4-7"];

  protected buildCommand(req) {
    return ["claude", "-p", req.prompt, "--model", req.model, "--output-format", "json"];
  }
  protected parseOutput(stdout) {
    const json = JSON.parse(stdout);
    return { result: json.result, inputTokens: json.usage.input_tokens, ... };
  }
}
```

Similar pattern for `CodexProvider` and `GeminiProvider`.

### Config registration

Add to `promptqueue.config.yaml`:

```yaml
providers:
  claude-code:
    type: cli
    command: claude
    defaultModel: claude-sonnet-4-6
  codex:
    type: cli
    command: codex
    defaultModel: o3
```

Server `index.ts` registers CLI providers when `type: cli` is present in config.

---

## Section 2: ProviderAdapter Evolution

### New types in `@promptqueue/core`

```typescript
interface ProviderAdapter {
  execute(request: ProviderRequest): Promise<ProviderResponse>;
  executeAgent?(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

interface AgentRequest extends ProviderRequest {
  tools?: ToolDefinition[];
  maxTurns?: number;
  workingDirectory?: string;
}

type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "completed"; response: ProviderResponse }
  | { type: "error"; error: string };
```

### Key decisions

- `executeAgent` is **optional** — existing providers keep working with just `execute()`. No breaking changes.
- `CliProvider` implements both — `execute()` calls `executeAgent()` internally, returns the final `ProviderResponse` from the `completed` event.
- `AbortSignal` lets the worker cancel a running agent (shutdown or manual cancel). `CliProvider` sends `SIGTERM` to subprocess.
- Worker uses `executeAgent` when available — streams events to `EventStore` in real-time for dashboard visibility.

---

## Section 3: Timeout Enforcement

### For in-process providers

Wrap `execute()` with `Promise.race` in the worker:

```typescript
private async executeWithTimeout(
  provider: ProviderAdapter,
  request: ProviderRequest
): Promise<ProviderResponse> {
  const timeoutMs = (request.timeout ?? 300) * 1000;
  return Promise.race([
    provider.execute(request),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new TimeoutError("Task timed out")), timeoutMs)
    ),
  ]);
}
```

On timeout → transition task to `timed_out` status, insert event.

### For CLI providers

`child_process.spawn` with `timeout` option handles this natively. The `CliProvider` catches the timeout error and maps it to a `TimeoutError`.

### Worker behavior

```typescript
try {
  const result = await this.executeWithTimeout(provider, request);
  await store.updateStatus(taskId, "completed", { ...result });
} catch (err) {
  if (err instanceof TimeoutError) {
    await store.updateStatus(taskId, "timed_out", { error: "Task exceeded timeout" });
  } else if (isRetryable(err) && retryCount < maxRetries) {
    // backoff + requeue
  } else {
    await store.updateStatus(taskId, "failed", { error: err.message });
  }
}
```

---

## Section 4: Retry Backoff

Wire the existing `calculateBackoff()` from `retry.ts` into the worker's error handler.

### New `nextRetryAt` field

Add `next_retry_at` column to `tasks` table via migration:

```sql
ALTER TABLE tasks ADD COLUMN next_retry_at INTEGER DEFAULT NULL;
```

### Worker error path

```typescript
if (isRetryable && retryCount < maxRetries) {
  const delay = calculateBackoff(retryCount, config.retryBackoff, config.retryDelay);
  const nextRetryAt = Date.now() + delay;
  await store.updateStatus(taskId, "pending", {
    retryCount: retryCount + 1,
    nextRetryAt,
  });
}
```

### claimNext() SQL update

```sql
SELECT * FROM tasks
WHERE status = 'pending'
  AND (next_retry_at IS NULL OR next_retry_at <= ?)
ORDER BY priority ASC, created_at ASC
LIMIT 1;
```

This skips tasks still in backoff without blocking the queue.

---

## Section 5: Rate Limiting

Wire the existing `createRateLimitMiddleware()` into `app.ts`:

```typescript
app.use("*", createRateLimitMiddleware({ windowMs: 60_000, max: 100 }));
```

Configuration via config YAML:

```yaml
server:
  rateLimit:
    windowMs: 60000
    max: 100
```

---

## Section 6: Tests

### Provider tests

- **Anthropic provider** — mock `@anthropic-ai/sdk` responses, test `execute()` with various models, test `healthCheck()`, test error handling (auth errors not retried, server errors retried)
- **OpenAI provider** — mock `openai` SDK responses, same test pattern
- **CliProvider** — spawn `echo` or `sleep` commands, test timeout killing (short timeout + `sleep 10`), test exit code mapping, test stdout parsing

### Worker tests

- **Backoff delay** — verify `calculateBackoff` is called and `nextRetryAt` is set correctly
- **Timeout transition** — verify `timed_out` status when task exceeds timeout
- **Retry count** — verify increment on failure, verify max retries respected
- **Event insertion** — verify `timed_out` and `retrying` events are created

### Rate limit tests

- Hit API rapidly (e.g., 110 requests in a minute), verify 429 response after 100th request
- Verify `X-RateLimit-*` headers present

### Config tests

- Test `loadConfig()` with YAML containing `${ENV_VAR}` interpolation
- Test deep merge with defaults
- Test Zod validation rejects invalid config

---

## Migration for next_retry_at

New file: `packages/server/src/storage/migrations/002_next_retry_at.sql`

```sql
ALTER TABLE tasks ADD COLUMN next_retry_at INTEGER DEFAULT NULL;
CREATE INDEX idx_tasks_next_retry ON tasks(status, next_retry_at);
```

The index supports efficient `claimNext()` queries that filter on backoff status.

### Task type update

Add `nextRetryAt` optional field to the `Task` interface in `@promptqueue/core/src/types.ts`:

```typescript
interface Task {
  // ... existing fields
  nextRetryAt?: number | null;  // Unix timestamp ms, null = ready to claim
}
```

Update `rowToTask()` in `task-store.ts` to map `next_retry_at` → `nextRetryAt`.

---

## Implementation Order

1. Add `AgentRequest`, `AgentEvent` types to `@promptqueue/core`
2. Add `nextRetryAt` to `Task` type and update `rowToTask()`
3. Evolve `ProviderAdapter` interface (add optional `executeAgent`)
4. Build `CliProvider` base class with timeout and subprocess management
5. Add `002_next_retry_at` migration
6. Wire `calculateBackoff()` into worker, update `claimNext()` SQL
7. Wire timeout enforcement in worker (`executeWithTimeout`)
8. Wire rate limiting in `app.ts`
9. Add provider tests (Anthropic, OpenAI, CliProvider)
10. Add worker tests (backoff, timeout, retry)
11. Add rate limit and config tests
12. Add `ClaudeCodeProvider` as first concrete CLI provider
13. Register CLI providers in `index.ts` from config
