# Phase 1: Tool Loop — Worker-Owned Tool Execution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Worker tool execution ownership so it can intercept, control, and govern tool calls made by the LLM — transforming PromptQueue from a pass-through queue into an Agent engine.

**Architecture:** Add `AnthropicSDKProvider` using `@anthropic-ai/sdk` for direct API tool loop control. Worker passes a `toolExecutor` callback to providers that support it. When the LLM returns a `tool_use`, the provider yields a `tool_call` event, calls `toolExecutor` to execute the tool, injects the result back into the conversation, and continues. A `ToolRegistry` manages built-in tools (execute_command, read_file, write_file) with whitelist/blacklist governance.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk`, better-sqlite3, Hono, Next.js

---

## Core Types

### ToolDefinition and ToolExecutor (new file: `packages/core/src/types/tools.ts`)

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;  // JSON Schema
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export type ToolExecutorFn = (name: string, args: unknown) => Promise<ToolResult>;

export interface ToolConfig {
  allowed: string[];          // whitelist (e.g., ["execute_command", "read_file"])
  denied: string[];           // blacklist (e.g., ["execute_command:rm -rf"])
  maxTurns: number;           // default 10
  timeout: number;            // per-tool timeout in seconds, default 30
}
```

### ProviderAdapter change (`packages/core/src/types.ts`)

Add optional `toolExecutor` parameter to `executeAgent`:

```typescript
interface ProviderAdapter {
  readonly name: string;
  readonly models: readonly string[];
  execute(request: ProviderRequest): Promise<ProviderResponse>;
  healthCheck(): Promise<ProviderHealth>;
  executeAgent?(
    request: AgentRequest,
    signal?: AbortSignal,
    toolExecutor?: ToolExecutorFn
  ): AsyncIterable<AgentEvent>;
}
```

### AgentRequest change (`packages/core/src/types/agent.ts`)

`tools` and `maxTurns` fields already exist but are never populated. No type change needed.

### Task schema addition

Add `tools` field to task creation and config:

```yaml
tools:
  allowed: ["read_file", "execute_command", "write_file"]
  denied: ["execute_command:sudo", "execute_command:rm -rf"]
  maxTurns: 10
  timeout: 30
  execute_command:
    allowed_commands: ["python", "node", "git", "curl", "ls", "cat"]
  read_file:
    allowed_paths: ["./data", "./src", "./output"]
  write_file:
    allowed_paths: ["./output", "./data"]
```

---

## AnthropicSDKProvider

New provider: `packages/server/src/providers/anthropic-sdk.ts`

### How it works

1. Creates an `Anthropic` client with the configured API key.
2. `executeAgent(request, signal, toolExecutor)` implements the multi-turn tool loop:
   - Starts a conversation with the user's prompt.
   - Calls `client.messages.stream()` with the model, system prompt, tool definitions, and messages.
   - Streams `text_delta` events as `agent_text` events in real time.
   - When the response contains `tool_use` content blocks:
     - Yields `tool_call` event for each tool_use.
     - If `toolExecutor` is provided: calls `toolExecutor(name, input)`, yields `tool_result`, injects both into the conversation, and loops back for the next turn.
     - If `toolExecutor` is NOT provided: just yields the tool_call (observation mode, no execution).
   - Continues until no more tool_use blocks or `maxTurns` is reached.
   - Yields `completed` with the final response (result text, token counts, cost, model).
3. `execute(request)` calls `executeAgent` and collects the final completed event (same pattern as CliProvider).

### Conversation management

The provider maintains the messages array internally:

```typescript
messages: [
  { role: "user", content: prompt },
  // Turn 1:
  { role: "assistant", content: [text_block, tool_use_block] },
  { role: "user", content: [tool_result_block] },
  // Turn 2:
  { role: "assistant", content: [text_block] },  // final answer
]
```

### Token budget tracking

Each turn accumulates input/output tokens. The provider tracks total tokens across turns and stops if the cumulative total exceeds a configurable budget (default: 200K tokens).

### Error handling

- API errors (rate limit, auth, server) yield `{ type: "error", error: message }`.
- Tool execution errors yield `{ type: "tool_result", name, result: { content: error_message, isError: true } }` and continue the loop (the LLM can decide how to handle tool errors).
- Timeout (signal abort or maxTurns exceeded) yields `{ type: "error", error: "..." }`.

---

## ToolRegistry

New component: `packages/server/src/tools/registry.ts`

### Interface

```typescript
class ToolRegistry {
  constructor(config: ToolConfig);

  register(definition: ToolDefinition, executor: (args: unknown) => Promise<ToolResult>): void;
  execute(name: string, args: unknown): Promise<ToolResult>;
  getDefinitions(): ToolDefinition[];
  isAllowed(name: string): boolean;
  createExecutor(): ToolExecutorFn;  // returns bound function for passing to provider
}
```

### Governance

- `isAllowed(name)` checks the `allowed` whitelist and `denied` blacklist.
- `execute(name, args)` first checks `isAllowed`, then runs the executor with a timeout.
- Denied patterns support prefix matching: `"execute_command:rm -rf"` denies any command starting with `rm -rf`.
- If a tool is not in the whitelist (when whitelist is non-empty), it's denied.
- If a tool is in the blacklist, it's denied even if in the whitelist.

### Built-in tools

**execute_command** (`packages/server/src/tools/execute-command.ts`)
- Spawns a subprocess with the given command.
- Captures stdout and stderr.
- Enforces timeout (default 30s).
- Config: `allowed_commands` restricts which binaries can run (prefix match).
- Security: no shell expansion, arguments passed as array.

**read_file** (`packages/server/src/tools/read-file.ts`)
- Reads a file at the given path.
- Supports `offset` and `limit` for partial reads.
- Config: `allowed_paths` restricts which directories can be read from.
- Security: resolves path and checks against allowed_paths (no path traversal via `..`).

**write_file** (`packages/server/src/tools/write-file.ts`)
- Writes content to a file at the given path.
- Creates parent directories if they don't exist.
- Config: `allowed_paths` restricts which directories can be written to.
- Security: same path traversal protection as read_file. File size limit (default 1MB).

---

## Worker Tool Loop

### Changes to `packages/server/src/worker/worker.ts`

In `executeTaskStreaming`:

1. Resolve `ToolRegistry` from the Worker's dependencies.
2. If the task has tool config and the registry has allowed tools:
   - Create `toolExecutor = registry.createExecutor()`.
   - Populate `request.tools` with `registry.getDefinitions()`.
   - Populate `request.maxTurns` from config.
3. Pass `toolExecutor` to `provider.executeAgent(request, signal, toolExecutor)`.
4. The existing event emission loop remains unchanged — events (including tool_call and tool_result from the executor) flow through EventBus and EventStore.

### Worker constructor change

```typescript
constructor(
  private store: TaskStore,
  private eventStore: EventStore,
  private eventBus: EventBus,
  private registry: ProviderRegistry,
  private toolRegistry: ToolRegistry,  // NEW
  private config: WorkerConfig
)
```

### Provider routing

No change to routing logic. The `ProviderRegistry.resolve(model)` still maps models to providers. The difference is:
- If the resolved provider supports `toolExecutor` (SDK provider), the Worker passes it.
- If the resolved provider doesn't support it (CLI provider), `toolExecutor` is `undefined` and the provider runs in observation mode.

### CLI --tools flag

In `packages/cli/src/commands/submit.ts`, add `--tools` flag:

```bash
pnpm submit "Find all TypeScript files" --model claude-sonnet-4-6 --tools
```

When `--tools` is present, the task is created with the default tool config (all built-in tools allowed, maxTurns=10). The user can override via config file.

When `--tools` is absent, the task has no tool config and runs in single-turn mode (current behavior).

---

## Dashboard Changes

### Turn grouping visualization

In `packages/dashboard/src/app/tasks/[id]/page.tsx`:

Group consecutive events into turns. A new turn starts when:
- An `agent_text` event follows an `agent_tool_result` event, OR
- The first `agent_text` event after task start.

Visual structure:

```
Turn 1
  📝 "Let me check the files..."
  🔧 execute_command: ls src/
  ✅ Result: a.ts, b.ts, c.ts

Turn 2
  📝 "Found 3 files: a.ts, b.ts, c.ts"
```

### Tool config display

In the task detail card, show:
- Tools: allowed list
- Max Turns: 10
- Tool Timeout: 30s

---

## Configuration

### New provider type: anthropic-sdk

```yaml
providers:
  claude-code:                    # CLI provider (no tool loop)
    type: cli
    command: claude
    defaultModel: glm-5.1

  anthropic-sdk:                  # SDK provider (tool loop)
    type: anthropic-sdk
    apiKey: ${ANTHROPIC_API_KEY}
    defaultModel: claude-sonnet-4-6

tools:
  maxTurns: 10
  timeout: 30
  allowed: ["execute_command", "read_file", "write_file"]
  denied: ["execute_command:sudo", "execute_command:rm -rf"]
  execute_command:
    allowed_commands: ["python", "node", "git", "curl", "ls", "cat"]
  read_file:
    allowed_paths: ["./data", "./src", "./output"]
  write_file:
    allowed_paths: ["./output", "./data"]
```

### Config schema update

Add `tools` section to `AppConfig` and `ProviderConfig`. Add `anthropic-sdk` as a recognized provider type in the config loader.

---

## Coexistence

- **ClaudeCodeProvider** (CLI subprocess) continues to work for single-turn tasks and observation-mode streaming.
- **AnthropicSDKProvider** handles tool-loop tasks when `--tools` is specified.
- Both providers register models in the `ProviderRegistry`. The model name determines which provider is used.
- The `fallbackModel` config still works — if a model isn't in any provider's list, the fallback provider is used.

---

## File Structure

### New files

- `packages/core/src/types/tools.ts` — ToolDefinition, ToolExecutorFn, ToolResult, ToolConfig
- `packages/server/src/providers/anthropic-sdk.ts` — AnthropicSDKProvider
- `packages/server/src/tools/registry.ts` — ToolRegistry
- `packages/server/src/tools/execute-command.ts` — execute_command tool
- `packages/server/src/tools/read-file.ts` — read_file tool
- `packages/server/src/tools/write-file.ts` — write_file tool
- `packages/server/src/__tests__/anthropic-sdk-provider.test.ts` — provider tests
- `packages/server/src/tools/__tests__/registry.test.ts` — registry tests
- `packages/server/src/tools/__tests__/execute-command.test.ts` — tool tests
- `packages/server/src/tools/__tests__/read-file.test.ts` — tool tests
- `packages/server/src/tools/__tests__/write-file.test.ts` — tool tests

### Modified files

- `packages/core/src/types.ts` — Add `toolExecutor` param to `ProviderAdapter.executeAgent`
- `packages/core/src/types/agent.ts` — Re-export from tools.ts
- `packages/core/src/schemas.ts` — Add tool config to configSchema
- `packages/core/src/constants.ts` — Add DEFAULT_TOOL_CONFIG
- `packages/server/src/worker/worker.ts` — Accept ToolRegistry, pass toolExecutor to provider
- `packages/server/src/index.ts` — Create ToolRegistry, register built-in tools, pass to Worker
- `packages/server/src/config/loader.ts` — Parse tools config section
- `packages/dashboard/src/app/tasks/[id]/page.tsx` — Turn grouping, tool config display
- `packages/cli/src/commands/submit.ts` — Add --tools flag

---

## Testing Strategy

1. **Unit tests** for each built-in tool (mock filesystem, mock subprocess).
2. **Unit tests** for ToolRegistry (allow/deny logic, timeout, executor binding).
3. **Unit tests** for AnthropicSDKProvider (mock Anthropic SDK, test multi-turn loop, maxTurns, token budget).
4. **Integration test** for Worker with toolExecutor (end-to-end task with tool loop).
5. **Manual E2E test**: `pnpm submit "List all TypeScript files in src/" --model claude-sonnet-4-6 --tools` and verify dashboard shows turns with tool calls.
