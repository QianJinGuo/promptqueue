# PromptQueue

Async task queue for AI prompts

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Build Status](https://img.shields.io/github/actions/workflow/status/promptqueue/promptqueue/ci.yml?branch=main)](https://github.com/promptqueue/promptqueue/actions)

Submit prompt tasks, get a task ID, and receive results via polling, SSE, or webhook callback. Think BullMQ meets AI -- a reliable, observable task orchestrator for the AI-native era.

## Quick Start

```bash
git clone https://github.com/QianJinGuo/promptqueue.git
cd promptqueue
pnpm install
pnpm build
pnpm --filter @promptqueue/cli dev -- serve
```

Or run directly:

```bash
pnpm build
node packages/server/dist/index.js
```

The server starts on port 9090 with a SQLite-backed queue, an embedded worker, and a dark-mode dashboard. Submit tasks via the CLI, HTTP API, or the dashboard UI.

## Features

- **Async task submission** -- submit prompts and poll for results; never block on an API call
- **Priority queues** -- five priority levels (critical, high, normal, low, best-effort) with FIFO ordering within each level
- **Multi-provider support** -- Anthropic, OpenAI, Google Gemini, and LiteLLM proxy; provider-as-plugin architecture for community adapters
- **Tool loop** -- Worker-owned tool execution with multi-turn agent loops; LLM calls tools, Worker governs and executes them
- **Built-in tools** -- `execute_command`, `read_file`, `write_file` with security controls (allowed paths, command whitelists, size limits)
- **Tool governance** -- whitelist/blacklist filtering, timeout enforcement, and audit trail for every tool call
- **Token tracking** -- input and output token counts recorded for every task
- **Cost estimation** -- per-task USD cost calculated from provider pricing tables
- **Retry with exponential backoff** -- configurable retry policy with jitter
- **Server-Sent Events** -- real-time task status streaming with agent event details
- **Webhooks** -- callback URLs notified on task completion
- **Dark-mode dashboard** -- built with Next.js, Tailwind CSS, and shadcn/ui; turn-grouped agent event visualization

## Architecture

```
+-------------+     +--------------+     +--------------+     +-------------+
|   Client    |---->|  Hono API    |---->|   SQLite     |---->|   Worker    |
|  (SDK/HTTP) |     |  (REST)      |     |   (Queue)    |     |  (Loop)     |
+-------------+     +--------------+     +--------------+     +------+------+
      ^                   ^                    ^                      |
      |                   |              +-----+-------+       +------v------+
      |                   |              | Task Table  |       |  Provider   |
      |                   |              | Priority    |       |  Adapter    |
      |                   |              | Status      |       |             |
      |              Webhook/            | Result      |       | Anthropic   |
      |              SSE                 +-------------+       | OpenAI      |
      +------------------------------------------------------>+ Google      |
                                                              | LiteLLM     |
                                                              +-------------+
```

## API Examples

### Submit a task

```bash
curl -X POST http://localhost:9090/api/v1/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "prompt": "Summarize the key findings of this research paper",
    "model": "claude-sonnet-4-6",
    "priority": 2,
    "maxTokens": 1024,
    "callbackUrl": "https://myapp.com/hooks/task-done"
  }'
```

Response: `202 Accepted` with task ID and status `pending`.

### Check task status

```bash
curl http://localhost:9090/api/v1/tasks/t_01HXYZABCDEF \
  -H "Authorization: Bearer sk-..."
```

Response includes `status`, `result` (when completed), `tokenUsage`, and `cost`.

### List tasks

```bash
curl "http://localhost:9090/api/v1/tasks?status=pending&priority=1" \
  -H "Authorization: Bearer sk-..."
```

### Cancel a task

```bash
curl -X DELETE http://localhost:9090/api/v1/tasks/t_01HXYZABCDEF \
  -H "Authorization: Bearer sk-..."
```

## CLI Commands

```bash
# Start the server (API + worker + dashboard)
promptqueue serve --port 9090 --concurrency 10

# Submit a task
promptqueue submit "Summarize this article" --model claude-sonnet-4-6 --priority 2

# Submit a task with tool loop enabled
promptqueue submit "List all TypeScript files in src" --model claude-sonnet-4-6 --tools

# Check task status
promptqueue status t_abc123

# List tasks
promptqueue list --status pending --priority 1
```

## Configuration

Create `~/.promptqueue/config.yaml`:

```yaml
server:
  port: 9090
  concurrency: 10

storage:
  type: sqlite
  path: ~/.promptqueue/data.db

providers:
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
    defaultModel: claude-sonnet-4-6
  anthropic-sdk:
    type: anthropic-sdk
    apiKey: ${ANTHROPIC_API_KEY}
    defaultModel: claude-sonnet-4-6
  openai:
    apiKey: ${OPENAI_API_KEY}
    defaultModel: gpt-4.1
  google:
    apiKey: ${GOOGLE_API_KEY}
    defaultModel: gemini-2.5-pro

routing:
  defaultStrategy: explicit
  fallbackModel: claude-haiku-4-5

worker:
  pollInterval: 500
  retryBackoff: exponential
  retryDelay: 1000
  maxRetries: 3

tools:
  allowed:
    - execute_command
    - read_file
    - write_file
  denied: []
  maxTurns: 10
  timeout: 30
```

## Provider Setup

Set your API keys as environment variables or in the config file:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-proj-...
export GOOGLE_API_KEY=AIza...

promptqueue serve
```

API keys are never logged and are validated at startup.

## Dashboard

PromptQueue includes a dark-mode dashboard built with Next.js 15, Tailwind CSS, and shadcn/ui. Access it at `http://localhost:9090` when the server is running.

Screens:
- **Overview** -- live queue depth, throughput, success rate, recent tasks
- **Tasks** -- filterable table with detail drill-down
- **Queues** -- per-queue stats and depth
- **Providers** -- health status, latency, model list

## Development

```bash
pnpm install
pnpm build
pnpm test
```

The project is a pnpm monorepo with Turborepo:

| Package | Description |
|---|---|
| `@promptqueue/core` | Shared types, Zod schemas, constants |
| `@promptqueue/server` | Hono API, SQLite storage, worker, providers |
| `@promptqueue/dashboard` | Next.js dark-mode dashboard |
| `@promptqueue/cli` | CLI tool |

## License

MIT
