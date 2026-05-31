# PromptQueue — Design Specification

> Version: 0.1.0-draft
> Date: 2026-05-30
> Status: Approved
> Authors: jinguo + Claude

---

## 1. Overview

**PromptQueue** is an open-source async task queue for AI prompts. Developers submit prompt tasks, get a task ID, and receive results via polling, SSE, or webhook callback. Think BullMQ meets AI — a reliable, observable, beautiful task orchestrator for the AI-native era.

### 1.1 Problem Statement

AI app developers need a simple way to:

- Submit prompt tasks asynchronously (don't block on API calls)
- Prioritize tasks (user-blocking vs background)
- Route tasks to different AI models/providers
- Track task status, token usage, and cost
- Retry failed tasks automatically
- Get notified when tasks complete

Existing solutions (BullMQ, Temporal) are general-purpose task queues that don't understand AI-specific concerns like token tracking, model routing, or provider health. PromptQueue fills this gap.

### 1.2 Target User

**AI App Developers** — developers building applications that call AI APIs and need reliable, observable task orchestration.

### 1.3 Design Principles

1. **Single-node first** — SQLite + embedded worker. `npx promptqueue serve` and it runs.
2. **Explicit default, smart opt-in** — Developer specifies model by default; smart routing is an optional strategy.
3. **Immutable task events** — Status transitions are append-only; task history is always auditable.
4. **Provider as plugin** — Built-in providers for Anthropic/OpenAI; community can add more.
5. **Full-stack TypeScript** — Shared types from API to worker to dashboard. One language, zero type drift.
6. **Beautiful by default** — Dark-mode dashboard inspired by Vercel/Linear, built with shadcn/ui.

---

## 2. Core Architecture

### 2.1 System Components

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client     │────>│  Hono API    │────>│   SQLite     │────>│   Worker    │
│  (SDK/HTTP)  │     │  (REST)      │     │   (Queue)    │     │  (Loop)     │
└─────────────┘     └──────────────┘     └──────────────┘     └──────┬──────┘
      ^                   ^                    ^                      |
      |                   |              ┌─────┴──────┐       ┌──────v──────┐
      |                   |              │ Task Table  │       │  Provider   │
      |                   |              │ Priority    │       │  Adapter    │
      |                   |              │ Status      │       │             │
      |              Webhook/            │ Result      │       │ Anthropic   │
      |              SSE                 └────────────┘       │ OpenAI      │
      └──────────────────────────────────────────────────────┘ Google      │
                                                             LiteLLM      │
                                                             └─────────────┘
```

### 2.2 Core Abstractions

| Concept | Description |
|---|---|
| **Task** | A single prompt execution request. Has prompt, model, priority, status, result. |
| **Queue** | An ordered collection of tasks. Default queue + named queues for isolation. |
| **Worker** | A process that polls the queue and executes tasks against AI providers. |
| **Provider** | An AI model provider adapter (Anthropic, OpenAI, Google, etc.). |
| **Router** | Decides which provider/model to use. Explicit by default, smart routing opt-in. |

### 2.3 Task Lifecycle

```
pending -> running -> completed
                  -> failed -> (retry) -> pending
                  -> cancelled
                  -> timed_out
```

State transitions:

| From | To | Trigger |
|---|---|---|
| pending | running | Worker claims task |
| running | completed | Provider returns result |
| running | failed | Provider throws error |
| running | timed_out | Timeout exceeded |
| failed | pending | Retry policy triggers |
| pending | cancelled | User cancels |

### 2.4 Priority Model

| Priority | Name | Use Case |
|---|---|---|
| 1 | Critical | User-blocking requests, real-time chat |
| 2 | High | Interactive tools, code review |
| 3 | Normal | Default — batch processing, summaries |
| 4 | Low | Background indexing, archival |
| 5 | Best-effort | Analytics, training data generation |

Tasks are dequeued in priority order (1 first), then by creation time (FIFO within same priority).

---

## 3. API Design

### 3.1 REST Endpoints

```
# Task CRUD
POST   /api/v1/tasks              # Submit a new task
GET    /api/v1/tasks/:id          # Get task status + result
GET    /api/v1/tasks              # List tasks (filter by status, queue, priority)
DELETE /api/v1/tasks/:id          # Cancel a pending task

# Queue Management
GET    /api/v1/queues             # List queues
GET    /api/v1/queues/:name       # Queue stats (depth, processing rate)
POST   /api/v1/queues/:name/purge # Remove all pending tasks from queue

# Provider Management
GET    /api/v1/providers          # List configured providers
GET    /api/v1/providers/:id/health # Health check a provider

# Real-time
GET    /api/v1/tasks/:id/events   # SSE stream for task updates

# Dashboard
GET    /                          # Next.js dashboard
```

### 3.2 Request/Response Types

```typescript
// --- Create Task ---
interface CreateTaskRequest {
  prompt: string                    // The prompt to execute
  model?: string                    // Explicit model e.g. "claude-sonnet-4-6"
  routingStrategy?: RoutingStrategy // "explicit" | "cost-optimize" | "speed-optimize"
  priority?: number                 // 1-5, default 3
  queue?: string                    // Named queue, default "default"
  maxTokens?: number                // Max response tokens
  temperature?: number              // Sampling temperature
  timeout?: number                  // Seconds before task is marked timed_out
  maxRetries?: number               // Max retry attempts, default 3
  callbackUrl?: string              // Webhook URL for completion notification
  metadata?: Record<string, unknown> // Arbitrary metadata, stored as-is
  systemPrompt?: string             // Optional system prompt
}

type RoutingStrategy = "explicit" | "cost-optimize" | "speed-optimize" | "quality-optimize";

type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "timed_out";

// --- Task Response ---
interface TaskResponse {
  id: string                        // "t_abc123"
  status: TaskStatus
  prompt: string
  model: string                     // Resolved model (may differ from requested)
  priority: number
  queue: string
  result?: string                   // Present when completed
  error?: string                    // Present when failed
  tokenUsage?: TokenUsage           // Input/output tokens
  cost?: number                     // Estimated cost in USD
  createdAt: string
  startedAt?: string
  completedAt?: string
  metadata?: Record<string, unknown>
}

interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

// --- API Envelope ---
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}
```

### 3.3 Example Interactions

**Submit a task:**

```
POST /api/v1/tasks
Content-Type: application/json

{
  "prompt": "Summarize the key findings of this research paper",
  "model": "claude-sonnet-4-6",
  "priority": 2,
  "maxTokens": 1024,
  "callbackUrl": "https://myapp.com/hooks/task-done"
}

-> 202 Accepted
{
  "success": true,
  "data": {
    "id": "t_01HXYZABCDEF",
    "status": "pending",
    "prompt": "Summarize the key findings of this research paper",
    "model": "claude-sonnet-4-6",
    "priority": 2,
    "queue": "default",
    "createdAt": "2026-05-30T12:00:00Z"
  },
  "error": null
}
```

**Check status:**

```
GET /api/v1/tasks/t_01HXYZABCDEF

-> 200 OK
{
  "success": true,
  "data": {
    "id": "t_01HXYZABCDEF",
    "status": "completed",
    "result": "The paper identifies three key findings...",
    "tokenUsage": { "inputTokens": 2450, "outputTokens": 380 },
    "cost": 0.0183,
    "startedAt": "2026-05-30T12:00:01Z",
    "completedAt": "2026-05-30T12:00:04Z"
  },
  "error": null
}
```

---

## 4. Data Model

### 4.1 SQLite Schema

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,                -- ULID-based e.g. "t_01HXYZABCDEF"
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 3,
  queue TEXT NOT NULL DEFAULT 'default',
  prompt TEXT NOT NULL,
  system_prompt TEXT,
  model TEXT NOT NULL,
  routing_strategy TEXT DEFAULT 'explicit',
  max_tokens INTEGER,
  temperature REAL,
  timeout INTEGER DEFAULT 300,
  max_retries INTEGER DEFAULT 3,
  retry_count INTEGER DEFAULT 0,
  callback_url TEXT,
  metadata TEXT,                       -- JSON string
  result TEXT,
  error TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX idx_tasks_status_priority ON tasks(status, priority, created_at);
CREATE INDEX idx_tasks_queue ON tasks(queue, status);

CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  event_type TEXT NOT NULL,            -- "created", "started", "completed", "failed", "retrying", "cancelled"
  payload TEXT,                         -- JSON details
  created_at TEXT NOT NULL
);

CREATE INDEX idx_events_task ON task_events(task_id, created_at);
```

### 4.2 Immutability Guarantee

The `task_events` table is append-only. Every status transition creates a new event record. This provides:

- Full audit trail for every task
- Ability to reconstruct task timeline
- Debugging capability for failed tasks
- No data loss on status changes

---

## 5. Worker Architecture

### 5.1 Worker Loop

```typescript
class Worker {
  private running = false;

  async start() {
    this.running = true;
    while (this.running) {
      const task = await this.claimNextTask();
      if (!task) {
        await sleep(this.pollInterval);
        continue;
      }
      this.executeTask(task).catch(console.error);
    }
  }

  private async claimNextTask(): Promise<Task | null> {
    // SQLite transaction:
    // 1. BEGIN IMMEDIATE
    // 2. SELECT next pending task ORDER BY priority ASC, created_at ASC LIMIT 1
    // 3. UPDATE status = 'running', started_at = now
    // 4. INSERT INTO task_events (event_type = 'started')
    // 5. COMMIT
  }

  private async executeTask(task: Task) {
    const provider = this.router.resolve(task);
    try {
      const result = await provider.execute({
        prompt: task.prompt,
        systemPrompt: task.systemPrompt,
        model: task.model,
        maxTokens: task.maxTokens,
        temperature: task.temperature,
      });
      await this.transitionTask(task.id, 'completed', result);
    } catch (error) {
      if (task.retryCount < task.maxRetries) {
        await this.transitionTask(task.id, 'retrying');
      } else {
        await this.transitionTask(task.id, 'failed', { error: error.message });
      }
    }
  }
}
```

### 5.2 Concurrency

```typescript
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '10');
```

Multiple workers can run against the same SQLite DB. SQLite WAL mode handles read concurrency; writes are serialized (adequate for single-node).

### 5.3 Retry Policy

```typescript
interface RetryPolicy {
  maxRetries: number;       // Default: 3
  backoff: "exponential" | "linear" | "fixed";
  baseDelayMs: number;      // Default: 1000
}
```

Exponential backoff: `delay = baseDelayMs * 2^retryCount` with jitter.

---

## 6. Provider Architecture

### 6.1 Provider Interface

```typescript
interface ProviderAdapter {
  name: string;                                     // "anthropic", "openai", "google"
  models: string[];                                 // Supported model IDs

  execute(request: ProviderRequest): Promise<ProviderResponse>;
  healthCheck(): Promise<ProviderHealth>;
}

interface ProviderRequest {
  prompt: string;
  systemPrompt?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
}

interface ProviderResponse {
  result: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;                                    // Actual model used
}

interface ProviderHealth {
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  details?: string;
}
```

### 6.2 Built-in Providers (v0.1.0)

| Provider | Package | Notes |
|---|---|---|
| **Anthropic** | `@anthropic-ai/sdk` | First-class support, prompt caching |
| **OpenAI** | `openai` | GPT-4.1, o3, etc. |
| **Google Gemini** | `@google/generative-ai` | Gemini 2.5 Pro/Flash |
| **LiteLLM Proxy** | HTTP adapter | Universal proxy for 100+ models |

### 6.3 Smart Routing

```typescript
type RoutingStrategy =
  | "explicit"        // Use specified model (default)
  | "cost-optimize"   // Route to cheapest capable model
  | "speed-optimize"  // Route to fastest available model
  | "quality-optimize"; // Route to highest-capability model

interface Router {
  resolve(task: Task, providers: ProviderAdapter[]): ProviderAdapter;
}
```

### 6.4 Callback and SSE

On task completion, if `callbackUrl` is set:

```
POST {callbackUrl}
Content-Type: application/json

{
  "event": "task.completed",
  "task": { ...TaskResponse }
}
```

SSE endpoint streams task events in real-time:

```
GET /api/v1/tasks/t_01HXYZABCDEF/events

data: {"event":"started","timestamp":"2026-05-30T12:00:01Z"}
data: {"event":"completed","result":"...","timestamp":"2026-05-30T12:00:04Z"}
```

---

## 7. Project Structure

```
promptqueue/
├── package.json                    # Monorepo root (turborepo)
├── turbo.json
├── packages/
│   ├── core/                       # Shared types, schemas, utilities
│   │   ├── src/
│   │   │   ├── types.ts            # Task, Provider, Router interfaces
│   │   │   ├── schema.ts           # Zod validation schemas
│   │   │   └── constants.ts        # Priority levels, statuses, etc.
│   │   └── package.json
│   ├── server/                     # Hono API + Worker
│   │   ├── src/
│   │   │   ├── api/                # Hono routes
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── queues.ts
│   │   │   │   ├── providers.ts
│   │   │   │   └── events.ts       # SSE
│   │   │   ├── worker/
│   │   │   │   ├── worker.ts       # Main worker loop
│   │   │   │   ├── claim.ts        # Atomic task claiming
│   │   │   │   └── retry.ts        # Retry logic + backoff
│   │   │   ├── providers/
│   │   │   │   ├── anthropic.ts
│   │   │   │   ├── openai.ts
│   │   │   │   ├── google.ts
│   │   │   │   └── litellm.ts
│   │   │   ├── routing/
│   │   │   │   ├── router.ts       # Router interface + default
│   │   │   │   ├── cost.ts         # Cost-optimize strategy
│   │   │   │   ├── speed.ts        # Speed-optimize strategy
│   │   │   │   └── quality.ts      # Quality-optimize strategy
│   │   │   ├── storage/
│   │   │   │   ├── database.ts     # SQLite connection + migrations
│   │   │   │   ├── task-store.ts   # Task CRUD operations
│   │   │   │   └── event-store.ts  # Event log operations
│   │   │   └── index.ts            # Server entrypoint
│   │   └── package.json
│   ├── dashboard/                  # Next.js dashboard
│   │   ├── src/
│   │   │   ├── app/                # App router pages
│   │   │   │   ├── page.tsx        # Dashboard home
│   │   │   │   ├── tasks/
│   │   │   │   └── queues/
│   │   │   ├── components/         # shadcn/ui components
│   │   │   └── lib/                # API client (shared types from core)
│   │   └── package.json
│   └── cli/                        # CLI tool
│       ├── src/
│       │   ├── commands/
│       │   │   ├── serve.ts        # Start server + worker + dashboard
│       │   │   ├── submit.ts       # Submit a task from CLI
│       │   │   ├── status.ts       # Check task status
│       │   │   └── list.ts         # List tasks
│       │   └── index.ts
│       └── package.json
├── docker/
│   └── Dockerfile                  # Single Docker image
├── docs/
│   ├── spec.md                     # This document
│   └── architecture.md             # Architecture decision records
└── README.md
```

---

## 8. Dashboard Design

### 8.1 Aesthetic

Dark mode, minimal, data-dense — inspired by Vercel Dashboard and Linear.

### 8.2 Screens

| Screen | Purpose |
|---|---|
| **Overview** | Live queue depth, throughput chart, success rate, recent tasks |
| **Tasks** | Filterable table (status, priority, queue, model), click for detail |
| **Task Detail** | Full prompt, result, token usage, timeline, retry history |
| **Queues** | Per-queue stats, depth, processing rate |
| **Providers** | Health status, latency, model list, configuration |

### 8.3 Tech Stack

- Next.js 15 App Router
- Tailwind CSS
- shadcn/ui components
- Recharts for charts
- Shared types from `@promptqueue/core`

---

## 9. CLI Interface

```bash
# Install
npm install -g promptqueue

# Start the server (API + Worker + Dashboard)
promptqueue serve --port 8080 --concurrency 10

# Submit a task
promptqueue submit "Summarize this article" --model claude-sonnet-4-6 --priority 2

# Check status
promptqueue status t_abc123

# List tasks
promptqueue list --status pending --priority 1

# Configure providers
promptqueue config set anthropic.apiKey sk-...
promptqueue config set openai.apiKey sk-...
```

---

## 10. Configuration

```yaml
# ~/.promptqueue/config.yaml
server:
  port: 8080
  concurrency: 10

storage:
  type: sqlite
  path: ~/.promptqueue/data.db

providers:
  anthropic:
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
```

---

## 11. Testing Strategy

| Layer | Framework | Coverage Target |
|---|---|---|
| Core types/schemas | Vitest + Zod | 95% |
| API routes | Vitest + Hono test client | 90% |
| Worker logic | Vitest + mocked providers | 90% |
| Provider adapters | Vitest + recorded responses | 80% |
| Storage layer | Vitest + in-memory SQLite | 90% |
| Dashboard | Playwright E2E | Key flows only |
| CLI | Vitest + mocked server | 80% |

TDD workflow enforced: write test first, implement to pass, refactor.

---

## 12. Security

| Area | Measure |
|---|---|
| API Keys | Never logged, env var interpolation, validated at startup |
| Input Validation | Zod schemas on every endpoint |
| SQL Injection | Parameterized queries only |
| Rate Limiting | Per-IP rate limiting (configurable) |
| Error Messages | Structured error envelope, no internal details |
| Callback URLs | Validated against allowlist, HTTPS-only in production |
| CORS | Configurable origins, strict default |
| Auth | API key auth for all endpoints (optional for local dev) |

---

## 13. Open Source Strategy

| Area | Decision |
|---|---|
| License | MIT |
| Repository | GitHub with Issues + Discussions |
| Package | `promptqueue` on npm |
| Documentation | README + dashboard-integrated docs |
| Contribution | Provider adapters and routing strategies as community plugins |
| CI/CD | GitHub Actions: lint, test, build, publish |
| Release | Semantic versioning, changeset for changelogs |

### Plugin Architecture

```typescript
// Provider plugin
interface ProviderPlugin {
  name: string;
  adapter: ProviderAdapter;
}

// Router plugin
interface RouterPlugin {
  name: string;
  strategy: RoutingStrategy;
  resolve: (task: Task, providers: ProviderAdapter[]) => ProviderAdapter;
}

// Discovery:
// - Built-in: packages/server/src/providers/*.ts
// - Community: npm packages named "promptqueue-provider-*"
// - Local: configured in config.yaml under providers.custom
```

---

## 14. MVP Scope (v0.1.0)

### In Scope

- Submit task, get status, list tasks, cancel task
- Anthropic + OpenAI providers
- Explicit model routing
- SQLite storage with WAL mode
- SSE for real-time task updates
- CLI submit/status/list/serve
- Dashboard overview + task list
- API key authentication
- Single worker with concurrency
- Retry with exponential backoff
- Priority-based task ordering
- Callback webhooks
- Zod input validation
- Append-only task event log

### Out of Scope (v0.2+)

- Scheduled/recurring jobs
- Google, LiteLLM providers
- Smart routing strategies (cost/speed/quality)
- Redis/PostgreSQL storage adapters
- WebSocket support
- Full dashboard with charts
- OAuth / multi-user auth
- Multi-worker coordination
- Fairness / multi-tenant queue isolation
- Task chaining / DAG workflows
- Batch task submission

---

## 15. Evidence Map

This design is grounded in evidence from the user's wiki knowledge base:

| Source | Evidence Type | How It Informed Design |
|---|---|---|
| Task Queue Priority and Fairness (Temporal) | Strong (review 8/8) | Priority model (1-5 levels), fairness as future scope |
| AgentCore Managed Harness (AWS) | Strong (review 7/8) | Provider-as-plugin pattern, MCP compatibility, Skills concept |
| Harness Engineering (Wang Yunhe) | Strong (review 9/8) | Multi-model routing, Harness Engineering philosophy |
| we-mp-rss cascade dispatcher | Direct (existing project) | Parent-child task dispatch pattern, AK-SK auth, retry/reconnect |
| routine-demo (Anthropic Routine) | Direct (existing project) | Schedule/API/GitHub triggers as future scope, MCP integration |
| Browser Use Runtime Harness | Medium (review 8/7) | Six-dimension verification concept for task result validation |

---

## 16. Red-Team Challenge

**What could make this project fail?**

1. **SQLite bottleneck under load** — WAL mode handles reads well, but write serialization could become a bottleneck at high throughput. Mitigation: v0.2 adds Redis/Postgres adapters; single-node SQLite is appropriate for the target user (AI app developers, not enterprise platforms).

2. **Provider API instability** — AI provider APIs change frequently, rate limits vary, and outages happen. Mitigation: provider adapters are isolated, health checks are built-in, retry with backoff is default.

3. **"Yet another queue" problem** — Developers already have BullMQ, Temporal, Celery. Why adopt PromptQueue? Mitigation: AI-native features (token tracking, model routing, cost estimation) that general-purpose queues don't have. The dashboard alone is a differentiator.

4. **Scope creep** — Adding scheduled jobs, DAG workflows, multi-tenant fairness too early. Mitigation: strict MVP scope with explicit out-of-scope list. Community can vote on v0.2 priorities via GitHub Discussions.

---

## 17. Self-Critique

| Dimension | Assessment |
|---|---|
| **Blind spot** | Haven't researched how Vercel AI SDK's `generateText` async patterns compare; may be a competing abstraction |
| **Evidence quality** | Strong on task queue theory (Temporal) and harness engineering; medium on AI-specific queue patterns (emerging field) |
| **Calibration** | High confidence on architecture and API; medium confidence on worker concurrency model (needs real-world benchmarking) |
| **Upgrade candidate** | Should research BullMQ's delayed job and rate limiter plugins for v0.2 retry/scheduling design |
| **Wiki capture** | This spec should be ingested into ~/wiki as a decision record once the project ships |
