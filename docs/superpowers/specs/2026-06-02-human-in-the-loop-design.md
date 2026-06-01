# Human-in-the-Loop (HITL) Design Spec

**Date:** 2026-06-02
**Status:** Draft
**Depends on:** Phase 1 Tool Loop (complete)

## Problem

The Tool Loop allows LLM → Tool → LLM cycles, but there is no way for the LLM to interact with the human who submitted the task. When the LLM is uncertain, needs clarification, or wants approval for a risky action, it has no channel to pause and ask. The task runs to completion (or failure) with whatever assumptions the LLM made.

TREASURE.md identifies "人工审批" as a Phase 4 Governance capability that depends on Tool Loop. This spec brings it forward as a natural extension of the existing tool architecture.

## Architecture

```
LLM: "I need clarification" → tool_call(name="ask_user", args={question: "Should I proceed?"})
  ↓
Worker: toolExecutor("ask_user", {question: "..."})
  ↓
ask_user executor:
  1. Sets task status → waiting_for_input
  2. Decrements activeCount (releases concurrency slot)
  3. Emits agent_tool_call event via EventBus
  4. Returns Promise (blocks until resolved or timed out)
  ↓
Dashboard: SSE receives agent_tool_call with name="ask_user"
  → Shows question + input field
  → User types response, submits
  ↓
POST /api/v1/tasks/:id/input { response: "Yes, proceed" }
  ↓
Server: resolves the Promise → ToolResult { content: "Yes, proceed" }
  1. Sets task status → running
  2. Increments activeCount (reclaims concurrency slot)
  3. Emits agent_tool_result event
  ↓
Worker: receives ToolResult, injects into LLM conversation, continues loop
```

### Key Design Decisions

1. **`ask_user` is just another tool** — It follows the same `ToolExecutorFn` contract, same whitelist/blacklist governance, same `ToolResult` return type. No special-casing in the Worker.

2. **Promise-based blocking** — The `ask_user` executor returns a Promise that resolves when user input arrives. The Worker's `for await` loop naturally blocks on this, just like it blocks on `execute_command` waiting for a subprocess.

3. **Concurrency slot release** — When a task enters `waiting_for_input`, it releases its `activeCount` slot. This prevents long waits from starving the queue. When input arrives, the slot is reclaimed.

4. **Configurable timeout** — `ask_user` has a `waitingForInputTimeout` (default: 3600s / 1 hour). On timeout, the tool returns `ToolResult { content: "User did not respond within the timeout period.", isError: true }`. The LLM decides what to do next.

5. **Server restart = lost wait** — In-memory Promise is lost on restart. This is acceptable for Phase 1. The task transitions to `failed` with error "Server restarted while waiting for user input". Phase 2 can add conversation checkpointing.

---

## Section 1: TaskStatus Extension

### New status

Add `waiting_for_input` to `TaskStatus` in `packages/core/src/types.ts`:

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

### State machine

```
pending → running → waiting_for_input → running → completed
                    waiting_for_input → running → failed
                    waiting_for_input → failed (timeout/server restart)
running → completed
running → failed
running → timed_out
```

### claimNext() impact

`claimNext()` only selects `pending` tasks. `waiting_for_input` tasks are invisible to the poll loop. No SQL change needed.

### activeCount management

The Worker must release and reclaim the concurrency slot:

```typescript
// In ask_user executor (when entering waiting_for_input):
this.activeCount--;

// In POST /tasks/:id/input handler (when resuming):
worker.reclaimSlot();
```

This requires the Worker to expose a `reclaimSlot()` method, or the input handler needs a reference to manage the count.

---

## Section 2: ask_user Built-in Tool

### Tool Definition

```typescript
// packages/server/src/tools/ask-user.ts

import type { ToolDefinition, ToolResult, ToolExecutorFn } from "@promptqueue/core";

const ASK_USER_DEFINITION: ToolDefinition = {
  name: "ask_user",
  description: "Ask the user a question and wait for their response. Use when you need clarification, confirmation, or approval before proceeding.",
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
        description: "Optional list of suggested responses the user can choose from",
      },
    },
    required: ["question"],
  },
};
```

### Tool Executor

The executor creates a Promise, registers it in a `PendingInputStore`, and waits:

```typescript
interface PendingInput {
  taskId: string;
  question: string;
  options?: string[];
  resolve: (result: ToolResult) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  createdAt: number;
}

class PendingInputStore {
  private pending = new Map<string, PendingInput>();

  register(taskId: string, question: string, options: string[] | undefined, timeout: number): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(taskId);
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
    });
  }

  resolve(taskId: string, response: string): boolean {
    const pending = this.pending.get(taskId);
    if (!pending) return false;

    clearTimeout(pending.timeoutId);
    this.pending.delete(taskId);
    pending.resolve({ content: response });
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
    return true;
  }

  get(taskId: string): PendingInput | undefined {
    return this.pending.get(taskId);
  }
}
```

### Factory function

```typescript
function createAskUserTool(
  pendingInputStore: PendingInputStore,
  taskStore: TaskStore,
  eventBus: EventBus,
  worker: Worker,           // for activeCount management
  defaultTimeout: number
): { definition: ToolDefinition; executor: ToolExecutorFn } {
  return {
    definition: ASK_USER_DEFINITION,
    executor: async (name: string, args: unknown): Promise<ToolResult> => {
      const { question, options } = args as { question: string; options?: string[] };
      // taskId is available via closure — the Worker creates a per-task toolExecutor
      // that closes over task.id (see "Context passing" below)
      const taskId = taskContext.taskId;

      // Release concurrency slot
      worker.releaseSlot();

      // Set task status
      taskStore.updateStatus(taskId, "waiting_for_input", {});

      // Emit event for dashboard
      eventBus.emit(taskId, {
        type: "tool_call",
        name: "ask_user",
        args: { question, options },
      });

      // Wait for user input
      const result = await pendingInputStore.register(taskId, question, options, defaultTimeout);

      // Reclaim concurrency slot (if resolved, not timed out)
      if (!result.isError) {
        worker.reclaimSlot();
        taskStore.updateStatus(taskId, "running", {});
      }

      return result;
    },
  };
}
```

### Context passing problem

The `ToolExecutorFn` signature is `(name: string, args: unknown) => Promise<ToolResult>` — it does not receive the task ID. The Worker needs to inject task context. Two options:

**Option A: Closure-based (recommended)** — The Worker creates a per-task `toolExecutor` that closes over the `taskId`:

```typescript
// In Worker.executeTaskStreaming():
const taskContext = { taskId: task.id };
const toolExecutor = this.toolRegistry
  ? (name: string, args: unknown) => this.toolRegistry!.executeWithContext(name, args, taskContext)
  : undefined;
```

`ToolRegistry.executeWithContext` passes the task context to tools that need it.

**Option B: AsyncLocalStorage** — Use Node's `AsyncLocalStorage` to pass task context implicitly. More elegant but harder to debug and test.

**Recommendation:** Option A. Explicit is better than implicit.

---

## Section 3: API Endpoint for User Input

### New endpoint

`POST /api/v1/tasks/:id/input`

```typescript
// Request body
interface TaskInputRequest {
  response: string;
}

// Response
ApiResponse<Task>
```

### Handler logic

```typescript
app.post("/api/v1/tasks/:id/input", async (c) => {
  const taskId = c.req.param("id");
  const body = await c.req.json<{ response: string }>();

  if (!body.response || typeof body.response !== "string") {
    return c.json({ success: false, data: null, error: "response is required" }, 400);
  }

  const task = taskStore.getById(taskId);
  if (!task) {
    return c.json({ success: false, data: null, error: "Task not found" }, 404);
  }

  if (task.status !== "waiting_for_input") {
    return c.json({ success: false, data: null, error: "Task is not waiting for input" }, 409);
  }

  // Resolve the pending Promise
  const resolved = pendingInputStore.resolve(taskId, body.response);
  if (!resolved) {
    return c.json({ success: false, data: null, error: "No pending input request for this task" }, 409);
  }

  // Emit tool_result event
  eventBus.emit(taskId, {
    type: "tool_result",
    name: "ask_user",
    result: body.response,
  });

  const updated = taskStore.getById(taskId);
  return c.json({ success: true, data: updated, error: null });
});
```

---

## Section 4: Configuration

### New config fields

```yaml
# In promptqueue.config.yaml
tools:
  allowed:
    - execute_command
    - read_file
    - write_file
    - ask_user          # Add to allowed list
  denied: []
  maxTurns: 10
  timeout: 30
  waitingForInputTimeout: 3600   # New: seconds to wait for user input (default: 3600)
```

### Schema update

```typescript
// In packages/core/src/schemas.ts, tools schema:
tools: z.object({
  allowed: z.array(z.string()).default(["execute_command", "read_file", "write_file", "ask_user"]),
  denied: z.array(z.string()).default([]),
  maxTurns: z.coerce.number().int().positive().default(10),
  timeout: z.coerce.number().int().positive().default(30),
  waitingForInputTimeout: z.coerce.number().int().positive().default(3600),
}).optional(),
```

### ToolConfig update

```typescript
// In packages/core/src/types/tools.ts:
export interface ToolConfig {
  allowed: string[];
  denied: string[];
  maxTurns: number;
  timeout: number;
  waitingForInputTimeout: number;
}
```

### DEFAULT_TOOL_CONFIG update

```typescript
export const DEFAULT_TOOL_CONFIG: ToolConfig = {
  allowed: ["execute_command", "read_file", "write_file", "ask_user"],
  denied: [],
  maxTurns: 10,
  timeout: 30,
  waitingForInputTimeout: 3600,
};
```

---

## Section 5: SSE Event Extensions

### No new event types needed

The existing `agent_tool_call` with `name="ask_user"` already carries the question and options in the payload. The Dashboard detects this and shows an input UI.

### Event payload example

```typescript
// agent_tool_call event for ask_user
{
  type: "agent_tool_call",
  name: "ask_user",
  args: {
    question: "Should I delete the temporary files?",
    options: ["Yes, delete them", "No, keep them", "Let me review first"],
  }
}

// agent_tool_result event for user input
{
  type: "agent_tool_result",
  name: "ask_user",
  result: "Yes, delete them"
}
```

---

## Section 6: Dashboard Changes

### Task detail page

When the task is in `waiting_for_input` status and the latest `agent_tool_call` event has `name="ask_user"`, show an input UI:

```
┌─────────────────────────────────────────┐
│ Agent asks:                             │
│                                         │
│ Should I delete the temporary files?    │
│                                         │
│ Suggested responses:                    │
│ ┌─────────────────────────────────┐     │
│ │ Yes, delete them                │     │
│ │ No, keep them                   │     │
│ │ Let me review first             │     │
│ └─────────────────────────────────┘     │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Type your response...               │ │
│ └─────────────────────────────────────┘ │
│                          [Submit]       │
└─────────────────────────────────────────┘
```

### Implementation sketch

```typescript
// In packages/dashboard/src/app/tasks/[id]/page.tsx

// Detect ask_user events
const askUserEvent = events
  .filter(e => e.eventType === "agent_tool_call")
  .findLast(e => e.payload?.name === "ask_user");

const isWaitingForInput = task.status === "waiting_for_input" && askUserEvent;

// Submit handler
async function submitInput(response: string) {
  await fetch(`/api/v1/tasks/${taskId}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response }),
  });
}
```

---

## Section 7: Worker Changes

### activeCount management

Add methods to the Worker class:

```typescript
export class Worker {
  // ... existing code ...

  releaseSlot(): void {
    this.activeCount--;
  }

  reclaimSlot(): void {
    this.activeCount++;
  }
}
```

### Server restart handling

On server startup, check for tasks stuck in `waiting_for_input`:

```typescript
// In packages/server/src/index.ts, after DB initialization:
const stuckTasks = taskStore.getByStatus("waiting_for_input");
for (const task of stuckTasks) {
  taskStore.updateStatus(task.id, "failed", {
    error: "Server restarted while waiting for user input",
  });
}
```

### Task cancellation while waiting

When a task is cancelled (`DELETE /api/v1/tasks/:id`), resolve the pending Promise with an error:

```typescript
// In cancel handler:
if (task.status === "waiting_for_input") {
  pendingInputStore.cancel(taskId);
}
```

---

## Section 8: Governance Implications

### Denying ask_user = autonomous mode

If `ask_user` is in the `denied` list, the tool is not available to the LLM. This enforces fully autonomous execution — the LLM cannot ask for human help. Use cases:
- Batch processing jobs
- High-throughput pipelines
- Trusted autonomous agents

### Allowing ask_user = supervised mode

If `ask_user` is in the `allowed` list, the LLM can request human input. Use cases:
- Interactive workflows
- High-stakes decisions (delete, deploy, send)
- Exploration tasks where user guidance improves outcomes

### Approval pattern

The LLM can use `ask_user` for approval gates:

```
LLM: "I'm about to execute: rm -rf /tmp/cache. Should I proceed?"
     → tool_call(name="ask_user", args={question: "I'm about to execute: rm -rf /tmp/cache. Should I proceed?", options: ["Approve", "Deny"]})
```

The user's response becomes the `ToolResult` content. The LLM reads it and decides whether to proceed.

---

## Section 9: Files to Change

### New files
- `packages/server/src/tools/ask-user.ts` — `ask_user` tool definition, executor, `PendingInputStore`

### Modified files
- `packages/core/src/types.ts:9-15` — Add `waiting_for_input` to `TaskStatus`
- `packages/core/src/types/tools.ts:14-18` — Add `waitingForInputTimeout` to `ToolConfig`
- `packages/core/src/schemas.ts` — Add `waitingForInputTimeout` to tools schema, add `ask_user` to default allowed
- `packages/core/src/constants.ts` — Update `DEFAULT_TOOL_CONFIG`
- `packages/server/src/worker/worker.ts:17-28` — Add `releaseSlot()` / `reclaimSlot()` methods
- `packages/server/src/tools/registry.ts` — Add `executeWithContext()` method
- `packages/server/src/api/tasks.ts` — Add `POST /:id/input` route
- `packages/server/src/index.ts:~108` — Register `ask_user` tool, handle stuck `waiting_for_input` tasks on startup
- `packages/dashboard/src/app/tasks/[id]/page.tsx` — Add input UI for `waiting_for_input` tasks
- `packages/dashboard/src/lib/api-client.ts` — Add `submitTaskInput()` function

---

## Section 10: Known Limitations (Phase 1)

1. **Server restart loses in-progress waits** — Tasks in `waiting_for_input` are failed on restart. Conversation state is not persisted.
2. **Single input per wait** — The LLM asks one question, gets one response. Multi-turn within a single `ask_user` call is not supported (but the LLM can call `ask_user` again in a subsequent turn).
3. **No input validation** — The user can type anything. The LLM must interpret the response. Structured input (forms, dropdowns) is Phase 2.
4. **One pending input per task** — `PendingInputStore` uses `taskId` as key. A task can only have one outstanding question at a time. This matches the Tool Loop's sequential execution model.

---

## Future Extensions (Phase 2+)

- **Conversation checkpointing** — Serialize Anthropic SDK message history to DB. Resume after server restart.
- **Structured input** — Support form schemas, file uploads, multi-field input.
- **Approval workflow** — Separate `request_approval` tool with approve/reject/modify semantics and escalation chains.
- **Input via external channels** — Email, Slack, Feishu notifications with reply-to-submit.
- **Multi-user input** — Multiple stakeholders must approve before proceeding.
