# Integration Strategy: Agent Runtime Providers

PromptQueue is a task queue and orchestrator. It does not need to rebuild agent runtimes — Claude Code, Codex, and Gemini CLI already are agent runtimes. PromptQueue dispatches work to them and tracks results.

## Architecture

```
┌─────────────┐     dispatches      ┌──────────────┐
│  PromptQueue │ ──────────────────► │  Claude Code  │
│  (orchestrator)│                   │  Codex CLI    │
│               │ ──────────────────► │  Gemini CLI   │
└─────────────┘                     └──────────────┘
       ▲                                    │
       │  callback / event stream           │
       └────────────────────────────────────┘
```

PromptQueue owns: **queuing, retry, priority, cost tracking, persistence**

Agent runtimes own: **tool use, multi-turn, reasoning, execution**

The `ProviderAdapter` interface evolves from "raw API call" to "agent invocation."

---

## Integration Paths

### Path 1: CLI Subprocess (Simplest, Works Today)

Each task spawns the agent as a subprocess. The agent handles tool loops, multi-turn reasoning, everything — PromptQueue just queues and dispatches.

```typescript
class ClaudeCodeProvider implements ProviderAdapter {
  name = "claude-code";
  models = ["claude-sonnet-4-6", "claude-opus-4-7"] as const;

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const result = exec(`claude -p "${request.prompt}" --model ${request.model}`);
    // parse result, capture tokens/cost from output
  }
}
```

Same pattern for `codex` or `gemini`.

**Pros:**
- Zero SDK dependency — just needs the CLI installed
- Agent runtime handles all complexity (tools, guardrails, context)
- Works immediately with existing ProviderAdapter interface

**Cons:**
- Parsing CLI output for tokens/cost is fragile
- Limited streaming control — get final result, not intermediate steps
- Process lifecycle management (timeouts, crashes)

---

### Path 2: Programmatic via Agent SDK

Use the official Agent SDKs to invoke agents programmatically with more control.

```typescript
// Claude Agent SDK
import { Agent, run } from "@anthropic-ai/agent-sdk";

class ClaudeAgentProvider implements ProviderAdapter {
  name = "claude-agent";
  models = ["claude-sonnet-4-6", "claude-opus-4-7"] as const;

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const agent = new Agent({ model: request.model, tools: [...] });
    const result = await run(agent, request.prompt);
    // structured result with tokens, cost, tool usage
  }
}
```

```typescript
// OpenAI Agents SDK
import { Agent, Runner } from "openai-agents";

class OpenAIAgentProvider implements ProviderAdapter {
  name = "openai-agent";
  models = ["gpt-4o", "o3"] as const;

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const agent = new Agent({ name: "worker", model: request.model });
    const result = await Runner.run(agent, request.prompt);
  }
}
```

```typescript
// Google ADK
import { Agent, Runner } from "@google/agent-development-kit";

class GeminiAgentProvider implements ProviderAdapter {
  name = "gemini-agent";
  models = ["gemini-2.5-pro", "gemini-2.5-flash"] as const;

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const agent = new Agent({ model: request.model });
    const result = await Runner.run(agent, request.prompt);
  }
}
```

**Pros:**
- Structured output — tokens, cost, tool usage come back as typed objects
- Streaming intermediate steps as events (tool calls, reasoning)
- Control over tool permissions and guardrails
- Better error handling and retry semantics

**Cons:**
- SDK dependency per provider
- SDK API churn — need to keep up with changes
- More complex ProviderAdapter interface (tools, streaming)

---

### Path 3: MCP (Model Context Protocol)

PromptQueue exposes itself as an MCP server. Agents connect to it to submit and manage tasks as tools inside their own agent loops.

**PromptQueue as MCP server provides these tools:**

| Tool | Description |
|------|-------------|
| `submit_task` | Submit a new task to the queue |
| `get_task` | Check task status and result |
| `list_tasks` | List tasks with filters |
| `cancel_task` | Cancel a pending task |
| `list_queues` | List available queues and stats |

**Usage example (Claude Code):**

```bash
# In CLAUDE.md or MCP config
mcpServers:
  promptqueue:
    command: npx
    args: ["@promptqueue/mcp-server"]

# Agent can now use promptqueue as a tool
> "Submit this analysis to the queue and check back in 5 minutes"
# → calls submit_task, then get_task later
```

**Pros:**
- Any MCP-compatible agent can use PromptQueue — no SDK coupling
- Agents orchestrate themselves — PromptQueue is a tool, not a dispatcher
- Natural fit for multi-agent workflows (agent A submits, agent B consumes)

**Cons:**
- Requires building and publishing an MCP server package
- Agents must support MCP (Claude Code, Cursor do; not all do yet)
- Less control over execution — agent decides when/how to call tools

---

## Recommended Approach

**Start with Path 1 (CLI), graduate to Path 2 (SDK) for production, add Path 3 (MCP) for ecosystem integration.**

| Phase | Path | Why |
|-------|------|-----|
| MVP | CLI Subprocess | Ship fast, validate the queue works end-to-end |
| Production | Agent SDK | Structured output, streaming events, cost tracking |
| Ecosystem | MCP Server | Let any agent use PromptQueue as a tool |

### ProviderAdapter Evolution

The interface needs to evolve to support all three paths:

```typescript
// Current (single-shot text completion)
interface ProviderAdapter {
  execute(request: ProviderRequest): Promise<ProviderResponse>;
}

// Evolved (agent invocation with tools and streaming)
interface ProviderAdapter {
  execute(request: ProviderRequest): Promise<ProviderResponse>;
  executeAgent?(request: AgentRequest): AsyncIterable<AgentEvent>;
}

interface AgentRequest extends ProviderRequest {
  tools?: ToolDefinition[];
  maxTurns?: number;
  systemPrompt?: string;
}

type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "completed"; response: ProviderResponse }
  | { type: "error"; error: string };
```

This lets Path 1 (CLI) and Path 2 (SDK) share the same interface while streaming agent events back through the existing SSE event system.
