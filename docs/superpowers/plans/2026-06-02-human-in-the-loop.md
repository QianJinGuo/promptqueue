# Human-in-the-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ask_user` built-in tool so the LLM can pause execution, ask the user a question, and resume when the user responds.

**Architecture:** `ask_user` is just another tool in the ToolRegistry. Its executor returns a Promise that blocks until `POST /tasks/:id/input` resolves it. Worker releases the concurrency slot while waiting, reclaims it on resume. A new `waiting_for_input` task status bridges the gap.

**Tech Stack:** TypeScript, Hono, Vitest, better-sqlite3, Next.js

---

## File Structure

### New files
- `packages/server/src/tools/ask-user.ts` — PendingInputStore, ASK_USER_DEFINITION, createAskUserTool factory
- `packages/server/src/__tests__/ask-user.test.ts` — PendingInputStore and ask_user tool tests
- `packages/server/src/__tests__/task-input-api.test.ts` — POST /tasks/:id/input API tests

### Modified files
- `packages/core/src/types.ts:9-15` — Add `waiting_for_input` to TaskStatus
- `packages/core/src/types/tools.ts` — Add `waitingForInputTimeout` to ToolConfig
- `packages/core/src/schemas.ts:28,71-76` — Add `waiting_for_input` to status enum, add `waitingForInputTimeout` to tools schema
- `packages/core/src/constants.ts:52-57` — Update DEFAULT_TOOL_CONFIG
- `packages/server/src/tools/registry.ts` — Add `executeWithContext()` method
- `packages/server/src/worker/worker.ts:17-28,92-96` — Add releaseSlot/reclaimSlot, update toolExecutor creation with task context
- `packages/server/src/api/tasks.ts` — Add POST /:id/input route, update cancel to handle waiting_for_input
- `packages/server/src/app.ts` — Add PendingInputStore to AppEnv
- `packages/server/src/index.ts:106-131` — Register ask_user tool, handle stuck waiting_for_input tasks
- `packages/dashboard/src/lib/api-client.ts` — Add submitTaskInput()
- `packages/dashboard/src/app/tasks/[id]/page.tsx` — Add input UI

---

### Task 1: Add `waiting_for_input` to Core Types

**Files:**
- Modify: `packages/core/src/types.ts:9-15`
- Modify: `packages/core/src/types/tools.ts`
- Modify: `packages/core/src/schemas.ts:28,71-76`
- Modify: `packages/core/src/constants.ts:52-57`

- [ ] **Step 1: Add `waiting_for_input` to TaskStatus**

In `packages/core/src/types.ts`, replace the TaskStatus type (lines 9-15):

```typescript
export type TaskStatus =
  | "pending"
  | "running"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";
```

- [ ] **Step 2: Add `waitingForInputTimeout` to ToolConfig**

In `packages/core/src/types/tools.ts`, replace the ToolConfig interface:

```typescript
export interface ToolConfig {
  allowed: string[];
  denied: string[];
  maxTurns: number;
  timeout: number;
  waitingForInputTimeout: number;
}
```

- [ ] **Step 3: Update schemas**

In `packages/core/src/schemas.ts`, make two changes:

1. Replace line 28 (the status enum in taskQuerySchema) to include the new status:

```typescript
  status: z
    .enum(["pending", "running", "waiting_for_input", "completed", "failed", "cancelled", "timed_out"])
    .optional(),
```

2. Replace the tools schema (lines 71-76) to add `waitingForInputTimeout`:

```typescript
  tools: z.object({
    allowed: z.array(z.string()).default([]),
    denied: z.array(z.string()).default([]),
    maxTurns: z.coerce.number().int().positive().default(10),
    timeout: z.coerce.number().int().positive().default(30),
    waitingForInputTimeout: z.coerce.number().int().positive().default(3600),
  }).optional(),
```

- [ ] **Step 4: Update DEFAULT_TOOL_CONFIG**

In `packages/core/src/constants.ts`, replace the DEFAULT_TOOL_CONFIG (lines 52-57):

```typescript
export const DEFAULT_TOOL_CONFIG: ToolConfig = {
  allowed: ["execute_command", "read_file", "write_file", "ask_user"],
  denied: [],
  maxTurns: 10,
  timeout: 30,
  waitingForInputTimeout: 3600,
};
```

Also update TASK_STATUSES (lines 5-12) to include the new status:

```typescript
export const TASK_STATUSES: readonly TaskStatus[] = [
  "pending",
  "running",
  "waiting_for_input",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;
```

- [ ] **Step 5: Build and verify**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm build`
Expected: All 4 packages build successfully

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/types/tools.ts packages/core/src/schemas.ts packages/core/src/constants.ts
git commit -m "feat: add waiting_for_input status and waitingForInputTimeout config"
```

---

### Task 2: PendingInputStore and ask_user Tool

**Files:**
- Create: `packages/server/src/tools/ask-user.ts`
- Create: `packages/server/src/__tests__/ask-user.test.ts`

- [ ] **Step 1: Write failing tests for PendingInputStore**

Create `packages/server/src/__tests__/ask-user.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PendingInputStore } from "../tools/ask-user.js";

describe("PendingInputStore", () => {
  let store: PendingInputStore;

  beforeEach(() => {
    store = new PendingInputStore();
  });

  it("registers a pending input and resolves when resolve() is called", async () => {
    const promise = store.register("t_001", "Should I proceed?", undefined, 30);

    expect(store.get("t_001")).toBeDefined();
    expect(store.get("t_001")!.question).toBe("Should I proceed?");

    store.resolve("t_001", "Yes");

    const result = await promise;
    expect(result.content).toBe("Yes");
    expect(result.isError).toBeUndefined();
  });

  it("resolves with error on timeout", async () => {
    vi.useFakeTimers();
    const promise = store.register("t_002", "Quick question", undefined, 1);

    vi.advanceTimersByTime(1500);

    const result = await promise;
    expect(result.content).toBe("User did not respond within the timeout period.");
    expect(result.isError).toBe(true);

    vi.useRealTimers();
  });

  it("resolves with error on cancel", async () => {
    const promise = store.register("t_003", "Cancel me", undefined, 30);

    const cancelled = store.cancel("t_003");
    expect(cancelled).toBe(true);

    const result = await promise;
    expect(result.content).toBe("Input request was cancelled.");
    expect(result.isError).toBe(true);
  });

  it("returns false when resolving non-existent task", () => {
    const result = store.resolve("t_999", "Nope");
    expect(result).toBe(false);
  });

  it("returns false when cancelling non-existent task", () => {
    const result = store.cancel("t_999");
    expect(result).toBe(false);
  });

  it("cleans up after resolve", async () => {
    const promise = store.register("t_004", "Clean up test", undefined, 30);
    store.resolve("t_004", "Done");
    await promise;

    expect(store.get("t_004")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test -- src/__tests__/ask-user.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PendingInputStore and ASK_USER_DEFINITION**

Create `packages/server/src/tools/ask-user.ts`:

```typescript
import type { ToolDefinition, ToolResult } from "@promptqueue/core";
import { logger } from "../logging.js";

export const ASK_USER_DEFINITION: ToolDefinition = {
  name: "ask_user",
  description:
    "Ask the user a question and wait for their response. Use when you need clarification, confirmation, or approval before proceeding.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask the user",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional list of suggested responses the user can choose from",
      },
    },
    required: ["question"],
  },
};

export interface PendingInput {
  taskId: string;
  question: string;
  options?: string[];
  resolve: (result: ToolResult) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  createdAt: number;
}

export class PendingInputStore {
  private pending = new Map<string, PendingInput>();

  register(
    taskId: string,
    question: string,
    options: string[] | undefined,
    timeout: number
  ): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(taskId);
        logger.info(`ask_user timed out for task ${taskId}`);
        resolve({
          content: "User did not respond within the timeout period.",
          isError: true,
        });
      }, timeout * 1000);

      this.pending.set(taskId, {
        taskId,
        question,
        options,
        resolve,
        timeoutId,
        createdAt: Date.now(),
      });

      logger.info(`ask_user registered for task ${taskId}: ${question}`);
    });
  }

  resolve(taskId: string, response: string): boolean {
    const pending = this.pending.get(taskId);
    if (!pending) return false;

    clearTimeout(pending.timeoutId);
    this.pending.delete(taskId);
    pending.resolve({ content: response });
    logger.info(`ask_user resolved for task ${taskId}`);
    return true;
  }

  cancel(taskId: string): boolean {
    const pending = this.pending.get(taskId);
    if (!pending) return false;

    clearTimeout(pending.timeoutId);
    this.pending.delete(taskId);
    pending.resolve({
      content: "Input request was cancelled.",
      isError: true,
    });
    logger.info(`ask_user cancelled for task ${taskId}`);
    return true;
  }

  get(taskId: string): PendingInput | undefined {
    return this.pending.get(taskId);
  }
}

export interface AskUserDeps {
  pendingInputStore: PendingInputStore;
  taskStore: { updateStatus: (id: string, status: "waiting_for_input" | "running", payload?: Record<string, unknown>) => unknown };
  eventBus: { emit: (taskId: string, event: unknown) => void };
  releaseSlot: () => void;
  reclaimSlot: () => void;
  timeout: number;
}

export function createAskUserTool(
  deps: AskUserDeps
): { definition: ToolDefinition; executor: (args: unknown) => Promise<ToolResult> } {
  return {
    definition: ASK_USER_DEFINITION,
    executor: async (args: unknown): Promise<ToolResult> => {
      const { question, options } = args as {
        question: string;
        options?: string[];
      };

      // Task context (taskId) is injected by ToolRegistry.executeWithContext
      const taskId = (args as { __taskId?: string }).__taskId;
      if (!taskId) {
        return { content: "No task context available for ask_user", isError: true };
      }

      // Release concurrency slot
      deps.releaseSlot();

      // Set task status to waiting_for_input
      deps.taskStore.updateStatus(taskId, "waiting_for_input", {});

      // Emit event for dashboard
      deps.eventBus.emit(taskId, {
        type: "tool_call",
        name: "ask_user",
        args: { question, options },
      });

      // Wait for user input (blocks until resolved or timed out)
      const result = await deps.pendingInputStore.register(
        taskId,
        question,
        options,
        deps.timeout
      );

      // Reclaim concurrency slot if user responded (not timed out)
      if (!result.isError) {
        deps.reclaimSlot();
        deps.taskStore.updateStatus(taskId, "running", {});
      }

      return result;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test -- src/__tests__/ask-user.test.ts`
Expected: All 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/tools/ask-user.ts packages/server/src/__tests__/ask-user.test.ts
git commit -m "feat: add PendingInputStore and ask_user tool"
```

---

### Task 3: ToolRegistry.executeWithContext and Worker Slot Management

**Files:**
- Modify: `packages/server/src/tools/registry.ts`
- Modify: `packages/server/src/worker/worker.ts`

- [ ] **Step 1: Add executeWithContext to ToolRegistry**

In `packages/server/src/tools/registry.ts`, add this method after `createExecutor()` (after line 69):

```typescript
  executeWithContext(
    name: string,
    args: unknown,
    taskContext: { taskId: string }
  ): Promise<ToolResult> {
    // Inject task context into args for tools that need it (e.g., ask_user)
    const argsWithContext =
      typeof args === "object" && args !== null
        ? { ...args, __taskId: taskContext.taskId }
        : { __taskId: taskContext.taskId, value: args };
    return this.execute(name, argsWithContext);
  }
```

- [ ] **Step 2: Add releaseSlot and reclaimSlot to Worker**

In `packages/server/src/worker/worker.ts`, add two public methods after the `stop()` method (after line 39):

```typescript
  releaseSlot(): void {
    this.activeCount--;
  }

  reclaimSlot(): void {
    this.activeCount++;
  }
```

Also add `setToolRegistry` method (needed for Task 5 wiring):

```typescript
  setToolRegistry(registry: ToolRegistry | null): void {
    this.toolRegistry = registry;
  }
```

- [ ] **Step 3: Update Worker's toolExecutor creation to use executeWithContext**

In `packages/server/src/worker/worker.ts`, replace lines 92-96 (the toolExecutor creation block in `executeTaskStreaming`):

```typescript
      const toolExecutor = this.toolRegistry
        ? (name: string, args: unknown) => this.toolRegistry!.executeWithContext(name, args, { taskId: task.id })
        : undefined;
      if (toolExecutor && this.toolRegistry) {
        agentRequest.tools = this.toolRegistry.getDefinitions();
        agentRequest.maxTurns = agentRequest.maxTurns ?? 10;
      }
```

The only change from the original is replacing `this.toolRegistry!.createExecutor()` with the closure that calls `executeWithContext`. This passes the `taskId` to all tool executors via `__taskId` in args.

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/tools/registry.ts packages/server/src/worker/worker.ts
git commit -m "feat: add ToolRegistry.executeWithContext and Worker slot management"
```

---

### Task 4: POST /tasks/:id/input API Endpoint

**Files:**
- Modify: `packages/server/src/api/tasks.ts`
- Modify: `packages/server/src/app.ts`
- Create: `packages/server/src/__tests__/task-input-api.test.ts`

- [ ] **Step 1: Write failing test for the input endpoint**

Create `packages/server/src/__tests__/task-input-api.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { createDatabase, runMigrations, closeDatabase } from "../storage/database.js";
import { TaskStore } from "../storage/task-store.js";
import { EventStore } from "../storage/event-store.js";
import { ProviderRegistry } from "../providers/registry.js";
import { MockProvider } from "../providers/mock.js";
import { EventBus } from "../worker/event-bus.js";
import { PendingInputStore } from "../tools/ask-user.js";

describe("POST /api/v1/tasks/:id/input", () => {
  let app: ReturnType<typeof createApp>;
  let taskStore: TaskStore;
  let pendingInputStore: PendingInputStore;

  beforeEach(() => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    taskStore = new TaskStore(db);
    const eventStore = new EventStore(db);
    const eventBus = new EventBus();
    const registry = new ProviderRegistry();
    registry.register(new MockProvider());
    pendingInputStore = new PendingInputStore();

    app = createApp({
      taskStore,
      eventStore,
      eventBus,
      providerRegistry: registry,
      defaultModel: "mock-model",
      pendingInputStore,
    });
  });

  it("returns 404 for non-existent task", async () => {
    const res = await app.request("/api/v1/tasks/t_nonexistent/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: "Yes" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when task is not waiting_for_input", async () => {
    const task = taskStore.create({
      prompt: "test",
      model: "mock-model",
      priority: 3,
      queue: "default",
      routingStrategy: "explicit",
      timeout: 300,
      maxRetries: 3,
    });

    const res = await app.request(`/api/v1/tasks/${task.id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: "Yes" }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 when response is missing", async () => {
    const task = taskStore.create({
      prompt: "test",
      model: "mock-model",
      priority: 3,
      queue: "default",
      routingStrategy: "explicit",
      timeout: 300,
      maxRetries: 3,
    });

    // Manually set to waiting_for_input
    taskStore.updateStatus(task.id, "running", {});
    taskStore.updateStatus(task.id, "waiting_for_input", {});

    const res = await app.request(`/api/v1/tasks/${task.id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("resolves pending input and returns updated task", async () => {
    const task = taskStore.create({
      prompt: "test",
      model: "mock-model",
      priority: 3,
      queue: "default",
      routingStrategy: "explicit",
      timeout: 300,
      maxRetries: 3,
    });

    // Manually set to waiting_for_input and register pending
    taskStore.updateStatus(task.id, "running", {});
    taskStore.updateStatus(task.id, "waiting_for_input", {});
    pendingInputStore.register(task.id, "Question?", undefined, 60);

    const res = await app.request(`/api/v1/tasks/${task.id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: "Yes, proceed" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("running");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test -- src/__tests__/task-input-api.test.ts`
Expected: FAIL — route not found or pendingInputStore not in deps

- [ ] **Step 3: Add PendingInputStore to AppEnv and createApp deps**

In `packages/server/src/app.ts`, make three changes:

1. Add import after line 11:

```typescript
import type { PendingInputStore } from "./tools/ask-user.js";
import { PendingInputStore as PendingInputStoreClass } from "./tools/ask-user.js";
```

2. Update `AppEnv` Variables to add `pendingInputStore`:

```typescript
export interface AppEnv {
  Variables: {
    taskStore: TaskStore;
    eventStore: EventStore;
    eventBus: EventBus;
    providerRegistry: ProviderRegistry;
    defaultModel: string;
    pendingInputStore: PendingInputStore;
  };
}
```

3. Update `createApp` function signature — make `pendingInputStore` optional:

```typescript
export function createApp(deps: {
  taskStore: TaskStore;
  eventStore: EventStore;
  eventBus: EventBus;
  providerRegistry: ProviderRegistry;
  defaultModel: string;
  apiKey?: string;
  rateLimit?: { windowMs: number; max: number };
  pendingInputStore?: PendingInputStore;
}) {
```

4. Update the context middleware to use a fallback:

```typescript
  app.use("*", async (c, next) => {
    c.set("taskStore", deps.taskStore);
    c.set("eventStore", deps.eventStore);
    c.set("eventBus", deps.eventBus);
    c.set("providerRegistry", deps.providerRegistry);
    c.set("defaultModel", deps.defaultModel);
    c.set("pendingInputStore", deps.pendingInputStore ?? new PendingInputStoreClass());
    return next();
  });
```

- [ ] **Step 4: Add POST /:id/input route and update cancel handler in tasks.ts**

In `packages/server/src/api/tasks.ts`, add the import at the top:

```typescript
import type { PendingInputStore } from "../tools/ask-user.js";
```

Update the delete route (lines 56-74) to also handle `waiting_for_input` tasks:

```typescript
tasks.delete("/:id", async (c) => {
  const { id } = c.req.param();
  const store = c.get("taskStore");

  const task = store.getById(id);
  if (!task) {
    return c.json({ success: false, data: null, error: "Task not found" }, 404);
  }

  if (task.status !== "pending" && task.status !== "waiting_for_input") {
    return c.json(
      { success: false, data: null, error: "Only pending or waiting_for_input tasks can be cancelled" },
      409
    );
  }

  if (task.status === "waiting_for_input") {
    const pendingInputStore = c.get("pendingInputStore");
    pendingInputStore.cancel(id);
  }

  const cancelled = store.updateStatus(id, "cancelled");
  return c.json({ success: true, data: cancelled, error: null });
});
```

Add the input route before the `export { tasks }` at the end of the file:

```typescript
tasks.post("/:id/input", async (c) => {
  const { id } = c.req.param();
  const store = c.get("taskStore");
  const eventBus = c.get("eventBus");
  const pendingInputStore = c.get("pendingInputStore");

  const body = await c.req.json<{ response?: string }>();

  if (!body.response || typeof body.response !== "string") {
    return c.json(
      { success: false, data: null, error: "response is required and must be a string" },
      400
    );
  }

  const task = store.getById(id);
  if (!task) {
    return c.json({ success: false, data: null, error: "Task not found" }, 404);
  }

  if (task.status !== "waiting_for_input") {
    return c.json(
      { success: false, data: null, error: "Task is not waiting for input" },
      409
    );
  }

  const resolved = pendingInputStore.resolve(id, body.response);
  if (!resolved) {
    return c.json(
      { success: false, data: null, error: "No pending input request for this task" },
      409
    );
  }

  eventBus.emit(id, {
    type: "tool_result",
    name: "ask_user",
    result: body.response,
  });

  const updated = store.getById(id);
  return c.json({ success: true, data: updated, error: null });
});
```

- [ ] **Step 5: Run the tests**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm --filter @promptqueue/server test`
Expected: All existing + new tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/tasks.ts packages/server/src/app.ts packages/server/src/__tests__/task-input-api.test.ts
git commit -m "feat: add POST /tasks/:id/input endpoint for HITL"
```

---

### Task 5: Wire ask_user Tool into Server Startup

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Add imports**

In `packages/server/src/index.ts`, add the import after line 14:

```typescript
import { PendingInputStore, createAskUserTool } from "./tools/ask-user.js";
```

- [ ] **Step 2: Handle stuck waiting_for_input tasks on startup**

In `packages/server/src/index.ts`, after the `const taskStore = new TaskStore(db);` line (after line 43), add:

```typescript
  // Fail tasks stuck in waiting_for_input from a previous server run
  const stuckTasks = taskStore.list({ status: "waiting_for_input" });
  for (const task of stuckTasks.tasks) {
    taskStore.updateStatus(task.id, "failed", {
      error: "Server restarted while waiting for user input",
    });
    logger.info(`Failed stuck task ${task.id}: was waiting_for_input on restart`);
  }
```

- [ ] **Step 3: Create PendingInputStore and Worker before tool registration**

In `packages/server/src/index.ts`, after the AnthropicSDK provider registration (after line 103), add:

```typescript
  // Create PendingInputStore for ask_user tool
  const pendingInputStore = new PendingInputStore();
```

Then create the Worker *before* tool registration. Replace the current worker creation (line 126-131) with this code, placed *before* the tool registration block:

```typescript
  // Create worker first (ask_user needs releaseSlot/reclaimSlot references)
  const worker = new Worker(taskStore, eventStore, eventBus, registry, null, {
    concurrency,
    pollInterval: config.worker.pollInterval,
    retryBackoff: config.worker.retryBackoff,
    retryDelay: config.worker.retryDelay,
  });
```

Note: `toolRegistry` is `null` here — it will be set after registration.

- [ ] **Step 4: Register ask_user tool**

In `packages/server/src/index.ts`, inside the `if (toolConfig && toolConfig.allowed.length > 0)` block, after the `write_file` registration (after line 122), add:

```typescript
    if (toolConfig.allowed.includes("ask_user")) {
      const askUserTool = createAskUserTool({
        pendingInputStore,
        taskStore,
        eventBus,
        releaseSlot: () => worker.releaseSlot(),
        reclaimSlot: () => worker.reclaimSlot(),
        timeout: toolConfig.waitingForInputTimeout,
      });
      toolRegistry.register(askUserTool.definition, askUserTool.executor);
    }
```

After the tool registration block, set the toolRegistry on the worker:

```typescript
  worker.setToolRegistry(toolRegistry);
```

- [ ] **Step 5: Pass pendingInputStore to createApp**

Update the `createApp` call in `packages/server/src/index.ts` to include `pendingInputStore`:

```typescript
  const app = createApp({
    taskStore,
    eventStore,
    eventBus,
    providerRegistry: registry,
    defaultModel: config.routing.fallbackModel,
    apiKey: options.apiKey,
    rateLimit: config.server.rateLimit,
    pendingInputStore,
  });
```

- [ ] **Step 6: Build and test**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm build && pnpm test`
Expected: All packages build, all tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat: wire ask_user tool and PendingInputStore into server startup"
```

---

### Task 6: Dashboard API Client and Input UI

**Files:**
- Modify: `packages/dashboard/src/lib/api-client.ts`
- Modify: `packages/dashboard/src/app/tasks/[id]/page.tsx`

- [ ] **Step 1: Add submitTaskInput to API client**

In `packages/dashboard/src/lib/api-client.ts`, add this function after `cancelTask` (after line 118):

```typescript
export async function submitTaskInput(
  taskId: string,
  response: string
): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/input`, {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}
```

- [ ] **Step 2: Add input UI to task detail page**

In `packages/dashboard/src/app/tasks/[id]/page.tsx`, add the import at the top:

```typescript
import { submitTaskInput } from "@/lib/api-client";
import React from "react";
```

Add the AskUserInput component (as a function component within the file):

```typescript
function AskUserInput({
  taskId,
  question,
  options,
  onSubmitted,
}: {
  taskId: string;
  question: string;
  options?: string[];
  onSubmitted: () => void;
}) {
  const [response, setResponse] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(text: string) {
    setSubmitting(true);
    try {
      await submitTaskInput(taskId, text);
      setResponse("");
      onSubmitted();
    } catch {
      // Error handled silently — user can retry
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-blue-800 bg-blue-950/30 p-4 my-4">
      <p className="text-sm font-medium text-blue-300 mb-2">Agent asks:</p>
      <p className="text-white mb-3">{question}</p>
      {options && options.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => handleSubmit(opt)}
              disabled={submitting}
              className="px-3 py-1.5 text-sm rounded-md border border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Type your response..."
          className="flex-1 px-3 py-2 text-sm rounded-md border border-zinc-600 bg-zinc-900 text-white placeholder:text-zinc-500"
          onKeyDown={(e) => {
            if (e.key === "Enter" && response.trim()) {
              handleSubmit(response.trim());
            }
          }}
        />
        <button
          onClick={() => handleSubmit(response.trim())}
          disabled={submitting || !response.trim()}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
```

Then, in the main page component, detect `waiting_for_input` status and the ask_user event:

```typescript
// Find the latest ask_user tool_call event
const askUserEvent = events
  ?.filter((e: TaskEvent) => e.eventType === "agent_tool_call")
  .findLast((e: TaskEvent) => e.payload?.name === "ask_user");

const isWaitingForInput = task.status === "waiting_for_input" && askUserEvent;
```

Render the `AskUserInput` component in the page, between the task header and the events list:

```tsx
{isWaitingForInput && askUserEvent && (
  <AskUserInput
    taskId={task.id}
    question={askUserEvent.payload?.args?.question ?? "Waiting for your input..."}
    options={askUserEvent.payload?.args?.options as string[] | undefined}
    onSubmitted={() => {
      window.location.reload();
    }}
  />
)}
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm build`
Expected: All 4 packages build successfully

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/lib/api-client.ts packages/dashboard/src/app/tasks/[id]/page.tsx
git commit -m "feat: add ask_user input UI to dashboard task detail page"
```

---

### Task 7: QueueStats Update and Final Verification

**Files:**
- Modify: `packages/core/src/types.ts` (QueueStats)
- Modify: `packages/server/src/storage/task-store.ts` (getQueueStats)

- [ ] **Step 1: Add waitingForInput to QueueStats**

In `packages/core/src/types.ts`, update the QueueStats interface:

```typescript
export interface QueueStats {
  name: string;
  pending: number;
  running: number;
  waitingForInput: number;
  completed: number;
  failed: number;
  total: number;
}
```

- [ ] **Step 2: Update getQueueStats SQL**

In `packages/server/src/storage/task-store.ts`, replace the `getQueueStats` method to include `waiting_for_input`:

```typescript
  getQueueStats(): Record<string, { pending: number; running: number; waitingForInput: number; completed: number; failed: number; total: number }> {
    const rows = this.db
      .prepare(
        `SELECT queue,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
           SUM(CASE WHEN status = 'waiting_for_input' THEN 1 ELSE 0 END) as waiting_for_input,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
           COUNT(*) as total
         FROM tasks
         GROUP BY queue`
      )
      .all() as Array<{
      queue: string;
      pending: number;
      running: number;
      waiting_for_input: number;
      completed: number;
      failed: number;
      total: number;
    }>;

    const result: Record<string, { pending: number; running: number; waitingForInput: number; completed: number; failed: number; total: number }> = {};
    for (const row of rows) {
      result[row.queue] = {
        pending: row.pending,
        running: row.running,
        waitingForInput: row.waiting_for_input,
        completed: row.completed,
        failed: row.failed,
        total: row.total,
      };
    }
    return result;
  }
```

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm test`
Expected: All tests pass

- [ ] **Step 4: Run type check**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm lint`
Expected: No type errors

- [ ] **Step 5: Verify build**

Run: `cd /Users/jinguo/projects/promptqueue && pnpm build`
Expected: All 4 packages build clean

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/server/src/storage/task-store.ts
git commit -m "feat: add waitingForInput to QueueStats"
```
