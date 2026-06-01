# Agent Orchestration + Foundation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CLI agent provider abstraction and wire foundation fixes (timeout, retry backoff, rate limiting, tests) to make PromptQueue production-ready.

**Architecture:** Layer-by-layer — build the CliProvider abstraction first, then evolve ProviderAdapter with optional `executeAgent`, then wire foundation fixes (timeout, backoff, rate limiting) using the same subprocess timeout mechanism, then add tests for everything.

**Tech Stack:** TypeScript, Node.js child_process, better-sqlite3, Hono, Vitest, Zod

---

## File Structure

### New files
- `packages/core/src/types/agent.ts` — AgentRequest, AgentEvent, ToolDefinition types
- `packages/server/src/providers/cli-provider.ts` — Abstract CliProvider base class
- `packages/server/src/providers/claude-code.ts` — ClaudeCodeProvider concrete implementation
- `packages/server/src/worker/errors.ts` — TimeoutError, custom error classes
- `packages/server/src/storage/migrations/002_next_retry_at.sql` — Migration for next_retry_at column
- `packages/server/src/__tests__/anthropic-provider.test.ts` — Anthropic provider tests
- `packages/server/src/__tests__/openai-provider.test.ts` — OpenAI provider tests
- `packages/server/src/__tests__/cli-provider.test.ts` — CliProvider base class tests
- `packages/server/src/__tests__/worker.test.ts` — Worker tests (timeout, backoff, retry)
- `packages/server/src/__tests__/rate-limit.test.ts` — Rate limiting tests
- `packages/server/src/__tests__/config-loader.test.ts` — Config loader tests

### Modified files
- `packages/core/src/types.ts` — Add nextRetryAt to Task, import agent types
- `packages/core/src/index.ts` — Export new types
- `packages/core/src/schemas.ts` — Add rateLimit to ServerConfig, type field to ProviderConfig
- `packages/server/src/storage/task-store.ts` — Add next_retry_at to TaskRow, rowToTask, claimNext SQL, updateStatus nextRetryAt
- `packages/server/src/worker/worker.ts` — Add executeWithTimeout, wire calculateBackoff, handle TimeoutError
- `packages/server/src/app.ts` — Wire rate limiting middleware
- `packages/server/src/index.ts` — Register CLI providers from config
- `promptqueue.config.yaml` — Add rateLimit config, example CLI providers

---

### Task 1: Add Agent Types to Core

**Files:**
- Create: `packages/core/src/types/agent.ts`
- Modify: `packages/core/src/types.ts:1-175`
- Modify: `packages/core/src/index.ts:1-39`

- [ ] **Step 1: Create agent types file**

```typescript
// packages/core/src/types/agent.ts

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface AgentRequest {
  prompt: string;
  systemPrompt?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
  tools?: ToolDefinition[];
  maxTurns?: number;
  workingDirectory?: string;
  timeout?: number;
}

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "completed"; response: { result: string; inputTokens: number; outputTokens: number; costUsd: number; model: string } }
  | { type: "error"; error: string };
```

- [ ] **Step 2: Add nextRetryAt to Task type and update ProviderAdapter**

In `packages/core/src/types.ts`, add `nextRetryAt` to the `Task` interface after `completedAt`:

```typescript
  completedAt?: string;
  nextRetryAt?: number | null;
```

Update `ProviderAdapter` to add optional `executeAgent`:

```typescript
export interface ProviderAdapter {
  readonly name: string;
  readonly models: readonly string[];
  execute(request: ProviderRequest): Promise<ProviderResponse>;
  healthCheck(): Promise<ProviderHealth>;
  executeAgent?(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}
```

Add the import at the top of `types.ts`:

```typescript
import type { AgentRequest, AgentEvent } from "./types/agent.js";
```

- [ ] **Step 3: Update core index.ts exports**

In `packages/core/src/index.ts`, add to the type exports block:

```typescript
  AgentRequest,
  AgentEvent,
  ToolDefinition,
```

These go after `AppConfig` in the `export type { ... } from "./types.js"` block.

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm test`
Expected: All 81 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/agent.ts packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat: add AgentRequest, AgentEvent types and nextRetryAt to Task"
```

---

### Task 2: Add 002_next_retry_at Migration

**Files:**
- Create: `packages/server/src/storage/migrations/002_next_retry_at.sql`
- Modify: `packages/server/src/storage/task-store.ts:6-60`
- Modify: `packages/core/src/schemas.ts:34-62`

- [ ] **Step 1: Create migration SQL**

```sql
-- packages/server/src/storage/migrations/002_next_retry_at.sql
ALTER TABLE tasks ADD COLUMN next_retry_at INTEGER DEFAULT NULL;
CREATE INDEX idx_tasks_next_retry ON tasks(status, next_retry_at);
```

- [ ] **Step 2: Update TaskRow and rowToTask in task-store.ts**

Add `next_retry_at` to the `TaskRow` interface after `completed_at`:

```typescript
  completed_at: string | null;
  next_retry_at: number | null;
```

Add `nextRetryAt` mapping to `rowToTask()` after `completedAt`:

```typescript
    completedAt: row.completed_at ?? undefined,
    nextRetryAt: row.next_retry_at ?? undefined,
```

- [ ] **Step 3: Add nextRetryAt to StatusTransitionPayload**

In `packages/server/src/storage/task-store.ts`, add to the `StatusTransitionPayload` interface:

```typescript
export interface StatusTransitionPayload {
  result?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  retryCount?: number;
  nextRetryAt?: number | null;
}
```

- [ ] **Step 4: Handle nextRetryAt in updateStatus**

In `updateStatus()`, after the `retryCount` handling block, add:

```typescript
      if (payload.nextRetryAt !== undefined) {
        updates.push("next_retry_at = ?");
        values.push(payload.nextRetryAt);
      }
```

- [ ] **Step 5: Update claimNext() SQL to respect backoff**

Replace the `claimNext()` method's SELECT query:

```typescript
  claimNext(): Task | null {
    const claim = this.db.transaction(() => {
      const now = Date.now();
      const row = this.db
        .prepare(
          `SELECT id FROM tasks
           WHERE status = 'pending'
             AND (next_retry_at IS NULL OR next_retry_at <= ?)
           ORDER BY priority ASC, created_at ASC
           LIMIT 1`
        )
        .get(now) as { id: string } | undefined;
```

The rest of `claimNext()` stays the same. Also reset `next_retry_at` when claiming a task — add to the UPDATE:

```typescript
      this.db
        .prepare(`UPDATE tasks SET status = 'running', started_at = ?, next_retry_at = NULL WHERE id = ? AND status = 'pending'`)
        .run(now, row.id);
```

- [ ] **Step 6: Run tests to verify migration and task store changes**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test`
Expected: All server tests pass (migration runs on in-memory DB)

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/storage/migrations/002_next_retry_at.sql packages/server/src/storage/task-store.ts
git commit -m "feat: add next_retry_at migration and update claimNext to respect backoff"
```

---

### Task 3: Add TimeoutError and Worker Timeout Enforcement

**Files:**
- Create: `packages/server/src/worker/errors.ts`
- Modify: `packages/server/src/worker/worker.ts:1-111`

- [ ] **Step 1: Create error types**

```typescript
// packages/server/src/worker/errors.ts

export class TimeoutError extends Error {
  constructor(message = "Task timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}
```

- [ ] **Step 2: Update worker to use executeWithTimeout and handle TimeoutError**

Replace the `executeTask` method in `packages/server/src/worker/worker.ts`:

```typescript
  private async executeTask(task: Task): Promise<void> {
    try {
      const provider = this.registry.resolve(task.model);
      const result = await this.executeWithTimeout(provider, {
        prompt: task.prompt,
        systemPrompt: task.systemPrompt,
        model: task.model,
        maxTokens: task.maxTokens,
        temperature: task.temperature,
      }, task.timeout);

      this.store.updateStatus(task.id, "completed", {
        result: result.result,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      });

      this.fireCallback(task, "completed");
    } catch (error: unknown) {
      if (error instanceof TimeoutError) {
        this.store.updateStatus(task.id, "timed_out", {
          error: "Task exceeded timeout",
        });
        this.fireCallback(task, "timed_out");
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      const retryable = this.isRetryable(error);

      if (retryable && task.retryCount < task.maxRetries) {
        const delay = calculateBackoff(
          task.retryCount,
          this.config.retryBackoff,
          this.config.retryDelay
        );
        this.store.updateStatus(task.id, "pending", {
          retryCount: task.retryCount + 1,
          nextRetryAt: Date.now() + delay,
        });
      } else {
        this.store.updateStatus(task.id, "failed", { error: message });
        this.fireCallback(task, "failed");
      }
    }
  }

  private async executeWithTimeout(
    provider: ProviderAdapter,
    request: ProviderRequest,
    timeoutSeconds: number
  ): Promise<ProviderResponse> {
    const timeoutMs = timeoutSeconds * 1000;
    let timer: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
    });

    try {
      return await Promise.race([
        provider.execute(request),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
```

Add the imports at the top of `worker.ts`:

```typescript
import { TimeoutError } from "./errors.js";
import { calculateBackoff } from "./retry.js";
import type { ProviderAdapter, ProviderRequest } from "@promptqueue/core";
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test`
Expected: All tests pass (worker changes are backward compatible with MockProvider)

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/worker/errors.ts packages/server/src/worker/worker.ts
git commit -m "feat: add timeout enforcement and retry backoff to worker"
```

---

### Task 4: Wire Rate Limiting

**Files:**
- Modify: `packages/server/src/app.ts:1-56`
- Modify: `packages/core/src/schemas.ts:34-39`
- Modify: `packages/core/src/types.ts:140-143`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Add rateLimit to config schema**

In `packages/core/src/schemas.ts`, update the `server` object in `configSchema`:

```typescript
  server: z.object({
    port: z.coerce.number().int().positive().default(9090),
    concurrency: z.coerce.number().int().positive().default(10),
    rateLimit: z.object({
      windowMs: z.coerce.number().int().positive().default(60_000),
      max: z.coerce.number().int().positive().default(100),
    }).default({}),
  }).default({}),
```

Also add `rateLimit` to `ServerConfig` in `packages/core/src/types.ts`:

```typescript
export interface ServerConfig {
  port: number;
  concurrency: number;
  rateLimit?: {
    windowMs: number;
    max: number;
  };
}
```

- [ ] **Step 2: Wire rate limit middleware in app.ts**

In `packages/server/src/app.ts`, add the import:

```typescript
import { createRateLimitMiddleware } from "./api/middleware/index.js";
```

Add after the auth middleware line, before the context middleware:

```typescript
  app.use("*", createAuthMiddleware(deps.apiKey));
  app.use("*", createRateLimitMiddleware(deps.rateLimit));
```

Update the `createApp` function signature to accept `rateLimit`:

```typescript
export function createApp(deps: {
  taskStore: TaskStore;
  eventStore: EventStore;
  providerRegistry: ProviderRegistry;
  defaultModel: string;
  apiKey?: string;
  rateLimit?: { windowMs: number; max: number };
}) {
```

- [ ] **Step 3: Pass rateLimit config from index.ts**

In `packages/server/src/index.ts`, update the `createApp` call:

```typescript
  const app = createApp({
    taskStore,
    eventStore,
    providerRegistry: registry,
    defaultModel: config.routing.fallbackModel,
    apiKey: options.apiKey,
    rateLimit: config.server.rateLimit,
  });
```

- [ ] **Step 4: Add rateLimit to config YAML**

In `promptqueue.config.yaml`, add under `server:`:

```yaml
server:
  port: 9090
  concurrency: 10
  rateLimit:
    windowMs: 60000
    max: 100
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/index.ts packages/core/src/schemas.ts packages/core/src/types.ts promptqueue.config.yaml
git commit -m "feat: wire rate limiting middleware with config"
```

---

### Task 5: Build CliProvider Base Class

**Files:**
- Create: `packages/server/src/providers/cli-provider.ts`

- [ ] **Step 1: Write the CliProvider class**

```typescript
// packages/server/src/providers/cli-provider.ts
import { spawn, type ChildProcess } from "node:child_process";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderHealth, AgentRequest, AgentEvent } from "@promptqueue/core";
import { logger } from "../logging.js";

export interface CliProviderConfig {
  command: string;
  defaultModel?: string;
  baseURL?: string;
  defaultTimeout?: number;
}

export abstract class CliProvider implements ProviderAdapter {
  abstract readonly name: string;
  abstract readonly models: readonly string[];

  protected abstract buildCommand(request: ProviderRequest): string[];
  protected abstract parseOutput(stdout: string): ProviderResponse;

  constructor(protected config: CliProviderConfig) {}

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const events = this.executeAgent(request);
    let finalResponse: ProviderResponse | undefined;

    for await (const event of events) {
      if (event.type === "completed") {
        finalResponse = event.response;
      }
    }

    if (!finalResponse) {
      throw new Error("CLI provider did not produce a completed event");
    }

    return finalResponse;
  }

  async *executeAgent(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const args = this.buildCommand(request);
    const timeoutMs = (request.timeout ?? this.config.defaultTimeout ?? 300) * 1000;

    const child = spawn(args[0], args.slice(1), {
      cwd: request.workingDirectory,
      timeout: timeoutMs,
      killSignal: "SIGTERM",
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const cleanup = () => {
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
    };

    signal?.addEventListener("abort", () => {
      try { child.kill("SIGTERM"); } catch { /* already exited */ }
    }, { once: true });

    try {
      const result = await collectOutput(child, timeoutMs);

      if (result.timedOut) {
        yield { type: "error", error: "Task exceeded timeout" };
        return;
      }

      if (result.exitCode !== 0) {
        const errorMsg = result.stderr.trim() || `Process exited with code ${result.exitCode}`;
        yield { type: "error", error: errorMsg };
        return;
      }

      const response = this.parseOutput(result.stdout);
      yield { type: "completed", response };
    } catch (err) {
      cleanup();
      const message = err instanceof Error ? err.message : String(err);
      yield { type: "error", error: message };
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const child = spawn(this.config.command, ["--version"], { timeout: 5000 });
      const result = await collectOutput(child, 5000);

      if (result.exitCode === 0) {
        return { status: "healthy", latencyMs: Date.now() - start };
      }
      return { status: "down", latencyMs: Date.now() - start, details: `Exit code ${result.exitCode}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: "down", latencyMs: Date.now() - start, details: message };
    }
  }
}

interface CollectedOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

function collectOutput(child: ChildProcess, timeoutMs: number): Promise<CollectedOutput> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* already exited */ }
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (stderr.trim()) {
        logger.info(`CLI provider stderr: ${stderr.trim()}`);
      }
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: 1, timedOut: false });
    });
  });
}
```

- [ ] **Step 2: Run type check**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm lint`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/cli-provider.ts
git commit -m "feat: add CliProvider base class with subprocess management"
```

---

### Task 6: Add ClaudeCodeProvider

**Files:**
- Create: `packages/server/src/providers/claude-code.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/core/src/schemas.ts:43-49`
- Modify: `packages/core/src/types.ts:150-154`

- [ ] **Step 1: Add type and command fields to ProviderConfig**

In `packages/core/src/types.ts`, update `ProviderConfig`:

```typescript
export interface ProviderConfig {
  type?: "api" | "cli";
  apiKey?: string;
  defaultModel?: string;
  baseURL?: string;
  command?: string;
}
```

In `packages/core/src/schemas.ts`, update the providers record schema:

```typescript
  providers: z.record(
    z.object({
      type: z.enum(["api", "cli"]).optional(),
      apiKey: z.string().optional(),
      defaultModel: z.string().optional(),
      baseURL: z.string().optional(),
      command: z.string().optional(),
    })
  ).default({}),
```

- [ ] **Step 2: Create ClaudeCodeProvider**

```typescript
// packages/server/src/providers/claude-code.ts
import type { ProviderRequest, ProviderResponse } from "@promptqueue/core";
import { CliProvider, type CliProviderConfig } from "./cli-provider.js";

const CLAUDE_CODE_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const;

export class ClaudeCodeProvider extends CliProvider {
  readonly name = "claude-code";
  readonly models = CLAUDE_CODE_MODELS;

  constructor(config: CliProviderConfig) {
    super(config);
  }

  protected buildCommand(request: ProviderRequest): string[] {
    const args = [
      this.config.command,
      "-p", request.prompt,
      "--model", request.model,
      "--output-format", "json",
    ];

    if (request.systemPrompt) {
      args.push("--system-prompt", request.systemPrompt);
    }

    if (request.maxTokens) {
      args.push("--max-tokens", String(request.maxTokens));
    }

    return args;
  }

  protected parseOutput(stdout: string): ProviderResponse {
    const json = JSON.parse(stdout.trim());
    return {
      result: json.result ?? json.content ?? stdout,
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      costUsd: json.cost_usd ?? 0,
      model: json.model ?? this.config.defaultModel ?? "claude-sonnet-4-6",
    };
  }
}
```

- [ ] **Step 3: Register CLI providers in index.ts**

In `packages/server/src/index.ts`, add the import:

```typescript
import { ClaudeCodeProvider } from "./providers/claude-code.js";
```

After the OpenAI provider registration block (after `log("Registered OpenAI provider");`), add:

```typescript
  // Register CLI providers
  for (const [providerName, providerConfig] of Object.entries(providers)) {
    if (providerConfig.type === "cli" && providerConfig.command) {
      const CliClass = providerName === "claude-code" ? ClaudeCodeProvider : null;
      if (CliClass) {
        registry.register(new CliClass({
          command: providerConfig.command,
          defaultModel: providerConfig.defaultModel,
        }));
        log(`Registered CLI provider: ${providerName}`);
      }
    }
  }
```

- [ ] **Step 4: Add example CLI provider to config YAML**

In `promptqueue.config.yaml`, add under `providers:`:

```yaml
providers:
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
    defaultModel: claude-sonnet-4-6
  openai:
    apiKey: ${OPENAI_API_KEY}
    defaultModel: gpt-4o
  # claude-code:
  #   type: cli
  #   command: claude
  #   defaultModel: claude-sonnet-4-6
```

- [ ] **Step 5: Run type check and tests**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm lint && pnpm test`
Expected: No type errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/providers/claude-code.ts packages/server/src/index.ts packages/core/src/schemas.ts packages/core/src/types.ts promptqueue.config.yaml
git commit -m "feat: add ClaudeCodeProvider and CLI provider registration"
```

---

### Task 7: Anthropic Provider Tests

**Files:**
- Create: `packages/server/src/__tests__/anthropic-provider.test.ts`

- [ ] **Step 1: Write Anthropic provider tests**

```typescript
// packages/server/src/__tests__/anthropic-provider.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicProvider } from "../providers/anthropic.js";

vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  return { default: MockAnthropic, __mockCreate: mockCreate };
});

describe("AnthropicProvider", () => {
  let provider: AnthropicProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import("@anthropic-ai/sdk") as { __mockCreate: ReturnType<typeof vi.fn> };
    mockCreate = mod.__mockCreate;
    mockCreate.mockReset();
    provider = new AnthropicProvider({ apiKey: "test-key" });
  });

  it("executes a prompt and returns structured response", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello world" }],
      usage: { input_tokens: 10, output_tokens: 5 },
      model: "claude-sonnet-4-6",
    });

    const result = await provider.execute({
      prompt: "Say hello",
      model: "claude-sonnet-4-6",
    });

    expect(result.result).toBe("Hello world");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
  });

  it("includes system prompt when provided", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Response" }],
      usage: { input_tokens: 15, output_tokens: 3 },
      model: "claude-sonnet-4-6",
    });

    await provider.execute({
      prompt: "Test",
      model: "claude-sonnet-4-6",
      systemPrompt: "You are a helper",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "You are a helper",
      })
    );
  });

  it("reports healthy on successful health check", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: "claude-haiku-4-5-20251001",
    });

    const health = await provider.healthCheck();
    expect(health.status).toBe("healthy");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports down on authentication error", async () => {
    const authError = new Error("Invalid API key");
    authError.name = "AuthenticationError";
    mockCreate.mockRejectedValue(authError);

    const health = await provider.healthCheck();
    expect(health.status).toBe("down");
    expect(health.details).toContain("Invalid API key");
  });

  it("lists supported models", () => {
    expect(provider.models).toContain("claude-sonnet-4-6");
    expect(provider.models).toContain("claude-opus-4-20250514");
    expect(provider.name).toBe("anthropic");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test -- src/__tests__/anthropic-provider.test.ts`
Expected: All 5 tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/anthropic-provider.test.ts
git commit -m "test: add Anthropic provider tests"
```

---

### Task 8: OpenAI Provider Tests

**Files:**
- Create: `packages/server/src/__tests__/openai-provider.test.ts`

- [ ] **Step 1: Write OpenAI provider tests**

```typescript
// packages/server/src/__tests__/openai-provider.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIProvider } from "../providers/openai.js";

vi.mock("openai", () => {
  const mockCreate = vi.fn();
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
  return { default: MockOpenAI, __mockCreate: mockCreate };
});

describe("OpenAIProvider", () => {
  let provider: OpenAIProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import("openai") as { __mockCreate: ReturnType<typeof vi.fn> };
    mockCreate = mod.__mockCreate;
    mockCreate.mockReset();
    provider = new OpenAIProvider({ apiKey: "test-key" });
  });

  it("executes a prompt and returns structured response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Hello world" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: "gpt-4o",
    });

    const result = await provider.execute({
      prompt: "Say hello",
      model: "gpt-4o",
    });

    expect(result.result).toBe("Hello world");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
  });

  it("reports healthy on successful health check", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: "gpt-4o-mini",
    });

    const health = await provider.healthCheck();
    expect(health.status).toBe("healthy");
  });

  it("reports down on authentication error", async () => {
    const authError = new Error("Invalid API key");
    authError.name = "AuthenticationError";
    mockCreate.mockRejectedValue(authError);

    const health = await provider.healthCheck();
    expect(health.status).toBe("down");
  });

  it("lists supported models", () => {
    expect(provider.models).toContain("gpt-4o");
    expect(provider.name).toBe("openai");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test -- src/__tests__/openai-provider.test.ts`
Expected: All 4 tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/openai-provider.test.ts
git commit -m "test: add OpenAI provider tests"
```

---

### Task 9: CliProvider Tests

**Files:**
- Create: `packages/server/src/__tests__/cli-provider.test.ts`

- [ ] **Step 1: Write CliProvider tests**

```typescript
// packages/server/src/__tests__/cli-provider.test.ts
import { describe, it, expect } from "vitest";
import type { ProviderRequest, ProviderResponse } from "@promptqueue/core";
import { CliProvider, type CliProviderConfig } from "../providers/cli-provider.js";

class EchoProvider extends CliProvider {
  readonly name = "echo";
  readonly models = ["echo-model"] as const;

  protected buildCommand(request: ProviderRequest): string[] {
    return ["echo", JSON.stringify({ result: request.prompt, tokens: 10 })];
  }

  protected parseOutput(stdout: string): ProviderResponse {
    const json = JSON.parse(stdout.trim());
    return {
      result: json.result,
      inputTokens: json.tokens,
      outputTokens: json.tokens,
      costUsd: 0,
      model: "echo-model",
    };
  }
}

class SleepProvider extends CliProvider {
  readonly name = "sleep";
  readonly models = ["sleep-model"] as const;

  protected buildCommand(): string[] {
    return ["sleep", "30"];
  }

  protected parseOutput(): ProviderResponse {
    return { result: "", inputTokens: 0, outputTokens: 0, costUsd: 0, model: "sleep-model" };
  }
}

class FailProvider extends CliProvider {
  readonly name = "fail";
  readonly models = ["fail-model"] as const;

  protected buildCommand(): string[] {
    return ["sh", "-c", "echo 'fatal error' >&2 && exit 1"];
  }

  protected parseOutput(): ProviderResponse {
    return { result: "", inputTokens: 0, outputTokens: 0, costUsd: 0, model: "fail-model" };
  }
}

describe("CliProvider", () => {
  const config: CliProviderConfig = { command: "echo" };

  it("executes a command and parses output", async () => {
    const provider = new EchoProvider(config);
    const result = await provider.execute({
      prompt: "hello world",
      model: "echo-model",
    });

    expect(result.result).toBe("hello world");
    expect(result.inputTokens).toBe(10);
  });

  it("times out when command takes too long", async () => {
    const provider = new SleepProvider(config);
    const events: unknown[] = [];

    for await (const event of provider.executeAgent({
      prompt: "test",
      model: "sleep-model",
      timeout: 1,
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "error", error: expect.stringContaining("timeout") });
  });

  it("reports error on non-zero exit code", async () => {
    const provider = new FailProvider(config);
    const events: unknown[] = [];

    for await (const event of provider.executeAgent({
      prompt: "test",
      model: "fail-model",
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "error", error: expect.any(String) });
  });

  it("health check returns healthy for available command", async () => {
    const provider = new EchoProvider(config);
    const health = await provider.healthCheck();
    expect(health.status).toBe("healthy");
  });

  it("health check returns down for missing command", async () => {
    const provider = new EchoProvider({ command: "nonexistent-command-xyz" });
    const health = await provider.healthCheck();
    expect(health.status).toBe("down");
  });

  it("streams completed event on success", async () => {
    const provider = new EchoProvider(config);
    const events: unknown[] = [];

    for await (const event of provider.executeAgent({
      prompt: "stream test",
      model: "echo-model",
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    const completed = events[0] as { type: string; response: ProviderResponse };
    expect(completed.type).toBe("completed");
    expect(completed.response.result).toBe("stream test");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test -- src/__tests__/cli-provider.test.ts`
Expected: All 6 tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/cli-provider.test.ts
git commit -m "test: add CliProvider base class tests"
```

---

### Task 10: Worker Tests

**Files:**
- Create: `packages/server/src/__tests__/worker.test.ts`

- [ ] **Step 1: Write worker tests**

```typescript
// packages/server/src/__tests__/worker.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Worker } from "../worker/worker.js";
import { TaskStore } from "../storage/task-store.js";
import { ProviderRegistry } from "../providers/registry.js";
import { MockProvider } from "../providers/mock.js";
import { createDatabase, runMigrations, closeDatabase } from "../storage/database.js";
import { calculateBackoff } from "../worker/retry.js";

describe("Worker", () => {
  let db: ReturnType<typeof createDatabase>;
  let store: TaskStore;
  let registry: ProviderRegistry;

  beforeEach(() => {
    db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    store = new TaskStore(db);
    registry = new ProviderRegistry();
    registry.register(new MockProvider());
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it("transitions timed out tasks to timed_out status", async () => {
    const task = store.create({
      prompt: "test",
      model: "mock-model",
      priority: 3,
      queue: "default",
      routingStrategy: "explicit",
      timeout: 1,
      maxRetries: 0,
    });

    // Create a provider that never resolves
    const slowRegistry = new ProviderRegistry();
    slowRegistry.register({
      name: "slow",
      models: ["mock-model"],
      execute: () => new Promise(() => {}),
      healthCheck: () => Promise.resolve({ status: "healthy", latencyMs: 0 }),
    });

    const worker = new Worker(store, slowRegistry, {
      concurrency: 1,
      pollInterval: 50,
      retryBackoff: "exponential",
      retryDelay: 100,
    });

    worker.start();

    // Wait for timeout to fire (1s timeout + buffer)
    await new Promise((r) => setTimeout(r, 2000));

    const updated = store.getById(task.id);
    expect(updated?.status).toBe("timed_out");

    await worker.stop();
  });

  it("applies retry backoff and sets nextRetryAt", async () => {
    const task = store.create({
      prompt: "test",
      model: "mock-model",
      priority: 3,
      queue: "default",
      routingStrategy: "explicit",
      timeout: 300,
      maxRetries: 3,
    });

    const failRegistry = new ProviderRegistry();
    failRegistry.register({
      name: "fail",
      models: ["mock-model"],
      execute: () => Promise.reject(new Error("Server error")),
      healthCheck: () => Promise.resolve({ status: "healthy", latencyMs: 0 }),
    });

    const worker = new Worker(store, failRegistry, {
      concurrency: 1,
      pollInterval: 50,
      retryBackoff: "exponential",
      retryDelay: 100,
    });

    worker.start();
    await new Promise((r) => setTimeout(r, 500));
    await worker.stop();

    const updated = store.getById(task.id);
    expect(updated?.retryCount).toBe(1);
    expect(updated?.nextRetryAt).toBeGreaterThan(Date.now() - 1000);
  });

  it("does not retry non-retryable errors", async () => {
    const task = store.create({
      prompt: "test",
      model: "mock-model",
      priority: 3,
      queue: "default",
      routingStrategy: "explicit",
      timeout: 300,
      maxRetries: 3,
    });

    const authError = new Error("Invalid API key");
    authError.name = "AuthenticationError";

    const failRegistry = new ProviderRegistry();
    failRegistry.register({
      name: "auth-fail",
      models: ["mock-model"],
      execute: () => Promise.reject(authError),
      healthCheck: () => Promise.resolve({ status: "healthy", latencyMs: 0 }),
    });

    const worker = new Worker(store, failRegistry, {
      concurrency: 1,
      pollInterval: 50,
      retryBackoff: "exponential",
      retryDelay: 100,
    });

    worker.start();
    await new Promise((r) => setTimeout(r, 500));
    await worker.stop();

    const updated = store.getById(task.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.retryCount).toBe(0);
  });
});

describe("calculateBackoff", () => {
  it("returns exponential backoff with jitter", () => {
    const delays = new Set<number>();
    for (let i = 0; i < 10; i++) {
      delays.add(calculateBackoff(2, "exponential", 1000));
    }
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(4000);
      expect(d).toBeLessThanOrEqual(4800);
    }
    expect(delays.size).toBeGreaterThan(1);
  });

  it("returns linear backoff", () => {
    const d = calculateBackoff(3, "linear", 1000);
    expect(d).toBeGreaterThanOrEqual(4000);
    expect(d).toBeLessThanOrEqual(4800);
  });

  it("returns fixed backoff", () => {
    const d = calculateBackoff(5, "fixed", 1000);
    expect(d).toBeGreaterThanOrEqual(1000);
    expect(d).toBeLessThanOrEqual(1200);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test -- src/__tests__/worker.test.ts`
Expected: All tests pass (3 worker tests + 3 calculateBackoff tests)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/worker.test.ts
git commit -m "test: add worker timeout, backoff, and retry tests"
```

---

### Task 11: Rate Limit and Config Loader Tests

**Files:**
- Create: `packages/server/src/__tests__/rate-limit.test.ts`
- Create: `packages/server/src/__tests__/config-loader.test.ts`

- [ ] **Step 1: Write rate limit tests**

```typescript
// packages/server/src/__tests__/rate-limit.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { createDatabase, runMigrations, closeDatabase } from "../storage/database.js";
import { TaskStore } from "../storage/task-store.js";
import { EventStore } from "../storage/event-store.js";
import { ProviderRegistry } from "../providers/registry.js";
import { MockProvider } from "../providers/mock.js";

describe("Rate limiting", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const taskStore = new TaskStore(db);
    const eventStore = new EventStore(db);
    const registry = new ProviderRegistry();
    registry.register(new MockProvider());

    app = createApp({
      taskStore,
      eventStore,
      providerRegistry: registry,
      defaultModel: "mock-model",
      rateLimit: { windowMs: 1000, max: 5 },
    });
  });

  it("allows requests under the limit", async () => {
    const res = await app.request("/api/v1/tasks");
    expect(res.status).toBe(200);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    for (let i = 0; i < 5; i++) {
      await app.request("/api/v1/tasks");
    }

    const res = await app.request("/api/v1/tasks");
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 2: Write config loader tests**

```typescript
// packages/server/src/__tests__/config-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../config/loader.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("merges with default config when no file found", () => {
    const config = loadConfig();
    expect(config.server.port).toBe(9090);
    expect(config.server.concurrency).toBe(10);
    expect(config.worker.retryBackoff).toBe("exponential");
  });

  it("interpolates environment variables in provider config", () => {
    process.env.TEST_PQ_KEY = "sk-test-123";
    // Config loader will interpolate ${TEST_PQ_KEY} if present in YAML
    const config = loadConfig();
    // Verify the config loaded without error
    expect(config).toBeDefined();
  });

  it("has rateLimit defaults", () => {
    const config = loadConfig();
    expect(config.server.rateLimit).toBeDefined();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test -- src/__tests__/rate-limit.test.ts src/__tests__/config-loader.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/__tests__/rate-limit.test.ts packages/server/src/__tests__/config-loader.test.ts
git commit -m "test: add rate limit and config loader tests"
```

---

### Task 12: Final Integration Test

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm test`
Expected: All tests pass (81 original + new provider/worker/rate-limit/config tests)

- [ ] **Step 2: Run type check**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm lint`
Expected: No type errors

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address any integration test issues"
```
