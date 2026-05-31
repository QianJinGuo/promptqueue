# PromptQueue — Getting Started Guide

This guide covers how to run, configure, monitor, and maintain PromptQueue in development and production.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [Running the Server](#3-running-the-server)
4. [Configuration](#4-configuration)
5. [Provider Setup](#5-provider-setup)
6. [Using the CLI](#6-using-the-cli)
7. [Using the API](#7-using-the-api)
8. [Running the Dashboard](#8-running-the-dashboard)
9. [Running with Docker](#9-running-with-docker)
10. [Monitoring and Logging](#10-monitoring-and-logging)
11. [Database Management](#11-database-management)
12. [Graceful Shutdown](#12-graceful-shutdown)
13. [Rate Limiting](#13-rate-limiting)
14. [Authentication](#14-authentication)
15. [Troubleshooting](#15-troubleshooting)
16. [Development Workflow](#16-development-workflow)
17. [Production Checklist](#17-production-checklist)

---

## 1. Prerequisites

- **Node.js** 20 or later
- **pnpm** 10.x (the project uses `packageManager: "pnpm@10.11.0"`)
- For Docker deployment: **Docker** and **Docker Compose**
- For AI providers: API keys for Anthropic and/or OpenAI

Install pnpm via corepack (bundled with Node.js):

```bash
corepack enable
corepack prepare pnpm@10.11.0 --activate
```

---

## 2. Installation

### From Source (Development)

```bash
git clone https://github.com/your-org/promptqueue.git
cd promptqueue
pnpm install
pnpm build
```

Verify everything works:

```bash
pnpm test
```

You should see all tests pass (81 tests across core, server, and CLI packages).

### Running from Source (Current Method)

Since the package is not yet published to npm, run from source:

```bash
# Clone and build
git clone https://github.com/your-org/promptqueue.git
cd promptqueue
pnpm install
pnpm build

# Run via CLI
pnpm --filter @promptqueue/cli dev -- serve

# Or run the server directly
node packages/server/dist/index.js
```

### Global Install (After npm Publish)

Once published to npm:

```bash
npm install -g promptqueue
promptqueue serve
```

---

## 3. Running the Server

### Quick Start

```bash
# From source — start with default settings (in-memory DB, mock provider)
pnpm build
node packages/server/dist/index.js

# Or via dev mode (auto-restart on changes)
pnpm --filter @promptqueue/server dev

# Or via CLI dev mode
pnpm --filter @promptqueue/cli dev -- serve
```

The server starts on **port 8080** by default. You should see:

```
{"timestamp":"...","level":"info","message":"Server running on http://localhost:8080"}
```

### Command Line Options

```bash
# From source
pnpm --filter @promptqueue/cli dev -- serve [options]

# After npm publish
promptqueue serve [options]

Options:
  -p, --port <port>       Server port (default: 8080)
  -c, --config <path>     Path to config file
```

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PROMPTQUEUE_API_KEY` | API key for authentication | None (auth disabled) |
| `ANTHROPIC_API_KEY` | Anthropic provider API key | None |
| `OPENAI_API_KEY` | OpenAI provider API key | None |
| `WORKER_CONCURRENCY` | Max concurrent task executions | 10 |

---

## 4. Configuration

PromptQueue loads configuration from a YAML file with environment variable interpolation. It searches for config at `~/.promptqueue/config.yaml` by default.

### Config File Location

```bash
# Default search paths (in order):
~/.promptqueue/config.yaml
~/.promptqueue/config.yml

# Or specify explicitly:
pnpm --filter @promptqueue/cli dev -- serve --config /path/to/config.yaml
```

### Full Config Example

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

routing:
  defaultStrategy: explicit
  fallbackModel: claude-haiku-4-5-20251001

worker:
  pollInterval: 500
  retryBackoff: exponential
  retryDelay: 1000
  maxRetries: 3
```

### Config Merging

Configuration is merged in this priority order (highest wins):

1. Command-line flags (`--port`, `--config`)
2. Config file values
3. Environment variable interpolation (within config file values)
4. Built-in defaults

### Default Values

| Setting | Default |
|---------|---------|
| `server.port` | 8080 |
| `server.concurrency` | 10 |
| `storage.type` | sqlite |
| `storage.path` | ~/.promptqueue/data.db |
| `routing.defaultStrategy` | explicit |
| `routing.fallbackModel` | claude-haiku-4-5-20251001 |
| `worker.pollInterval` | 500ms |
| `worker.retryBackoff` | exponential |
| `worker.retryDelay` | 1000ms |
| `worker.maxRetries` | 3 |

---

## 5. Provider Setup

### Anthropic

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Then in your config:

```yaml
providers:
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
    defaultModel: claude-sonnet-4-6
```

Supported models: `claude-opus-4-20250514`, `claude-sonnet-4-20250514`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`, `claude-3-haiku-20240307`

### OpenAI

```bash
export OPENAI_API_KEY="sk-..."
```

Then in your config:

```yaml
providers:
  openai:
    apiKey: ${OPENAI_API_KEY}
    defaultModel: gpt-4.1
```

Supported models: `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`, `o3`, `o3-mini`, `o4-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`

### Mock Provider (Development)

When no API keys are configured, the server uses a **mock provider** that returns canned responses. This is useful for local development and testing without incurring API costs.

### Custom Base URL

Both providers support custom base URLs (e.g., for proxies or Azure endpoints):

```yaml
providers:
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
    baseURL: https://my-proxy.example.com/v1
```

---

## 6. Using the CLI

### Submit a Task

```bash
# From source
pnpm --filter @promptqueue/cli dev -- submit "Summarize the key findings of this paper" \
  --model claude-sonnet-4-6 \
  --priority 2 \
  --queue research

# After npm publish
promptqueue submit "Summarize the key findings of this paper" \
  --model claude-sonnet-4-6 \
  --priority 2 \
  --queue research
```

Options:

| Flag | Description | Default |
|------|-------------|---------|
| `-m, --model` | AI model to use | Config default |
| `-p, --priority` | Priority 1-5 | 3 |
| `-q, --queue` | Named queue | default |
| `-s, --system-prompt` | System prompt | None |
| `--max-tokens` | Max response tokens | Provider default |
| `--temperature` | Sampling temperature (0-2) | Provider default |
| `--callback-url` | Webhook URL for completion | None |
| `--api-url` | API server URL | http://localhost:8080 |

### Check Task Status

```bash
pnpm --filter @promptqueue/cli dev -- status t_01HXYZABCDEF
```

Output:

```
Task: t_01HXYZABCDEF
Status: completed
Model: claude-sonnet-4-6
Prompt: Summarize the key findings of this paper
Result: The paper identifies three key findings...
Tokens: 2450 in / 380 out
Cost: $0.018300
```

### List Tasks

```bash
# All tasks
pnpm --filter @promptqueue/cli dev -- list

# Filter by status
pnpm --filter @promptqueue/cli dev -- list --status pending

# Filter by priority
pnpm --filter @promptqueue/cli dev -- list --priority 1

# Filter by queue
pnpm --filter @promptqueue/cli dev -- list --queue research

# Limit results
pnpm --filter @promptqueue/cli dev -- list --limit 50
```

### Start the Server

```bash
pnpm --filter @promptqueue/cli dev -- serve --port 8080
```

---

## 7. Using the API

### Submit a Task

```bash
curl -X POST http://localhost:8080/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Summarize this article",
    "model": "claude-sonnet-4-6",
    "priority": 2,
    "maxTokens": 1024,
    "callbackUrl": "https://myapp.com/hooks/task-done"
  }'
```

Response (202 Accepted):

```json
{
  "success": true,
  "data": {
    "id": "t_01HXYZABCDEF",
    "status": "pending",
    "prompt": "Summarize this article",
    "model": "claude-sonnet-4-6",
    "priority": 2,
    "queue": "default",
    "createdAt": "2026-05-30T12:00:00Z"
  },
  "error": null
}
```

### Get Task Status

```bash
curl http://localhost:8080/api/v1/tasks/t_01HXYZABCDEF
```

### List Tasks

```bash
curl "http://localhost:8080/api/v1/tasks?status=pending&limit=10&page=1"
```

### Cancel a Task

```bash
curl -X DELETE http://localhost:8080/api/v1/tasks/t_01HXYZABCDEF
```

Only pending tasks can be cancelled. Running or completed tasks return 409.

### List Queues

```bash
curl http://localhost:8080/api/v1/queues
```

### List Providers

```bash
curl http://localhost:8080/api/v1/providers
```

### SSE Stream (Real-time Events)

```bash
curl -N http://localhost:8080/api/v1/tasks/t_01HXYZABCDEF/events
```

Streams task lifecycle events as they happen:

```
data: {"event":"started","timestamp":"2026-05-30T12:00:01Z"}
data: {"event":"completed","result":"...","timestamp":"2026-05-30T12:00:04Z"}
```

### With Authentication

If `PROMPTQUEUE_API_KEY` is set, all requests need an Authorization header:

```bash
curl -H "Authorization: Bearer your-api-key" \
  http://localhost:8080/api/v1/tasks
```

---

## 8. Running the Dashboard

The dashboard is a Next.js app that connects to the API server.

### Development

```bash
# Terminal 1: Start the API server
pnpm --filter @promptqueue/cli dev -- serve

# Terminal 2: Start the dashboard
pnpm --filter @promptqueue/dashboard dev
```

The dashboard runs on **http://localhost:3000** by default.

### Production

```bash
pnpm --filter @promptqueue/dashboard build
pnpm --filter @promptqueue/dashboard start
```

### Pages

| URL | Description |
|-----|-------------|
| `/` | Overview — queue depth, recent tasks, provider status |
| `/tasks` | Filterable task list (status, priority, queue, model) |
| `/tasks/[id]` | Task detail — prompt, result, tokens, cost, timeline |
| `/queues` | Per-queue stats and depth |
| `/providers` | Provider health, latency, model list |

The dashboard uses dark mode by default and connects to the API at `http://localhost:8080`.

---

## 9. Running with Docker

### Build and Run

```bash
cd docker
docker compose up -d
```

### Configuration

Create a `.env` file in the project root:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
PROMPTQUEUE_API_KEY=your-secure-api-key
```

The Docker setup:
- Builds a multi-stage image (deps, build, runtime) based on `node:20-alpine`
- Exposes port **8080**
- Mounts `./data` to `/root/.promptqueue` for SQLite persistence
- Includes a health check at `/health`
- Auto-restarts on failure (`unless-stopped`)

### Verify

```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

### View Logs

```bash
docker compose logs -f promptqueue
```

### Stop

```bash
docker compose down
```

Data persists in the `./data` directory.

---

## 10. Monitoring and Logging

### Structured JSON Logs

PromptQueue outputs structured JSON logs to stdout/stderr. Each log entry:

```json
{"timestamp":"2026-05-30T12:00:00.000Z","level":"info","message":"Server running on http://localhost:8080"}
```

- **level**: `info`, `warn`, or `error`
- **error** level logs go to stderr; others go to stdout
- Additional data fields are merged into the log entry

### Log File Persistence

To persist logs to a file, pipe stdout/stderr:

```bash
pnpm --filter @promptqueue/cli dev -- serve 2>>/var/log/promptqueue/error.log >>/var/log/promptqueue/access.log
```

Or use a process manager like systemd (see below).

### Health Check Endpoint

```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

Use this for load balancer health checks, Docker HEALTHCHECK, or monitoring systems.

### Key Metrics to Monitor

| Metric | How |
|--------|-----|
| Queue depth (pending tasks) | `GET /api/v1/tasks?status=pending` — check `meta.total` |
| Running tasks | `GET /api/v1/tasks?status=running` — check `meta.total` |
| Failed tasks | `GET /api/v1/tasks?status=failed` — check `meta.total` |
| Provider health | `GET /api/v1/providers` |

### systemd Service Example

```ini
# /etc/systemd/system/promptqueue.service
[Unit]
Description=PromptQueue Server
After=network.target

[Service]
Type=simple
User=promptqueue
WorkingDirectory=/opt/promptqueue
ExecStart=/usr/bin/node packages/server/dist/index.js
Restart=on-failure
RestartSec=10

Environment=ANTHROPIC_API_KEY=sk-ant-...
Environment=OPENAI_API_KEY=sk-...
Environment=PROMPTQUEUE_API_KEY=your-secure-api-key

# Log to journald (structured JSON preserved)
StandardOutput=journal
StandardError=journal
SyslogIdentifier=promptqueue

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable promptqueue
sudo systemctl start promptqueue
sudo journalctl -u promptqueue -f   # follow logs
```

---

## 11. Database Management

### Location

Default: `~/.promptqueue/data.db`

Configured via `storage.path` in config.yaml.

### Backup

Since SQLite is a single file, backup is straightforward:

```bash
# Safe backup (uses SQLite's built-in backup)
sqlite3 ~/.promptqueue/data.db ".backup /backup/promptqueue-$(date +%Y%m%d).db"

# Or simply copy (may have minor inconsistency under write load)
cp ~/.promptqueue/data.db /backup/promptqueue-$(date +%Y%m%d).db
```

### WAL Mode

The database runs in **WAL (Write-Ahead Logging)** mode by default, which provides:
- Better read concurrency (reads don't block writes)
- Automatic checkpoint every 1000 pages
- WAL file (`data.db-wal`) and shared memory file (`data.db-shm`) are normal

### Migrations

Migrations run automatically on server startup. They are tracked in the `_migrations` table and applied in order (`001_initial.sql`, `002_...`, etc.). You should never need to run migrations manually.

### Resetting the Database

```bash
# Stop the server first
rm ~/.promptqueue/data.db
# Restart the server — migrations will recreate the schema
```

---

## 12. Graceful Shutdown

PromptQueue handles SIGTERM and SIGINT gracefully:

1. **Stop the worker** — no new tasks are claimed; active tasks finish
2. **Close the HTTP server** — stops accepting new connections
3. **Close the database** — ensures all writes are flushed
4. **Exit** — with code 0 on success, code 1 on timeout

There is a **30-second shutdown timeout**. If active tasks don't complete within 30 seconds, the process force-exits with code 1.

This means:
- Tasks in progress when shutdown begins will complete (if they finish within 30s)
- Tasks still pending in the queue remain in the database and will be picked up on next startup
- No tasks are lost during a controlled shutdown

---

## 13. Rate Limiting

PromptQueue includes in-memory per-IP rate limiting.

### Default Limits

- **100 requests per minute** per IP address
- Returns **429 Too Many Requests** with a `Retry-After` header when exceeded
- Includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on every response

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 45
```

### Notes

- Rate limiting is in-memory only — counters reset on server restart
- The IP is determined from `X-Forwarded-For` or `X-Real-IP` headers, falling back to "unknown"
- For production behind a reverse proxy, ensure your proxy sets these headers

---

## 14. Authentication

### Enabling API Key Auth

Set the `PROMPTQUEUE_API_KEY` environment variable:

```bash
export PROMPTQUEUE_API_KEY="your-secure-api-key"
pnpm --filter @promptqueue/cli dev -- serve
```

When set, all API endpoints require the header:

```
Authorization: Bearer your-secure-api-key
```

### Disabling Auth

If `PROMPTQUEUE_API_KEY` is not set, authentication is **disabled**. This is intended for local development only.

**Production warning**: Always set `PROMPTQUEUE_API_KEY` in production.

---

## 15. Troubleshooting

### Server won't start — "address already in use"

Another process is using port 8080:

```bash
# Find the process
lsof -i :8080

# Use a different port
pnpm --filter @promptqueue/cli dev -- serve --port 9090
```

### Tasks stuck in "pending"

The worker may not be running or no provider is registered:

1. Check that the server started successfully (look for "Server running" log)
2. Check that a provider is configured (Anthropic or OpenAI API key set)
3. If using the mock provider, tasks will complete automatically
4. Check worker concurrency isn't exhausted: `GET /api/v1/tasks?status=running`

### "No provider found for model"

The model name doesn't match any registered provider. Check:

1. The model name is exact (e.g., `claude-sonnet-4-6`, not `claude-sonnet`)
2. The corresponding API key is configured
3. List available providers: `GET /api/v1/providers`

### Database locked errors

SQLite writes are serialized. Under very high write load:

1. Ensure WAL mode is active (it is by default)
2. Reduce worker concurrency
3. For high-throughput needs, consider migrating to PostgreSQL (future v0.2 feature)

### High memory usage

The rate limiter stores IP counters in memory. If you have many unique IPs:

1. Counters are lazily evicted when they expire (default: 1 minute window)
2. Cleanup runs every 10x the window duration
3. Memory impact is typically negligible for normal traffic

### Callback/webhook failures

Callbacks are fire-and-forget — failures are logged but don't affect task completion:

1. Ensure your callback URL is reachable from the server
2. Check server logs for connection errors
3. Callbacks use a default timeout (no retry on failure)

---

## 16. Development Workflow

### Project Structure

```
promptqueue/
  packages/
    core/        # Shared types, schemas, constants
    server/      # Hono API + Worker + Storage
    cli/         # Commander CLI tool
    dashboard/   # Next.js dashboard
  docker/        # Dockerfile and compose
  docs/          # Spec and plans
```

### Common Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Type-check all packages
pnpm lint

# Run a specific package's tests
pnpm --filter @promptqueue/server test

# Start server in dev mode (auto-restart)
pnpm --filter @promptqueue/server dev

# Start dashboard in dev mode (hot reload)
pnpm --filter @promptqueue/dashboard dev

# Clean all build artifacts
pnpm clean
```

### Adding a New Provider

1. Create `packages/server/src/providers/your-provider.ts`
2. Implement the `ProviderAdapter` interface from `@promptqueue/core`
3. Register it in `packages/server/src/index.ts`
4. Add pricing data to `packages/server/src/providers/pricing.ts`
5. Add tests in `packages/server/src/providers/__tests__/`

### Adding a New API Endpoint

1. Create `packages/server/src/api/your-route.ts`
2. Define a Hono router with the `AppEnv` type
3. Mount it in `packages/server/src/app.ts`
4. Add validation schemas to `packages/core/src/schemas.ts` if needed
5. Add tests

---

## 17. Production Checklist

Before deploying PromptQueue to production:

- [ ] **API key authentication enabled** — `PROMPTQUEUE_API_KEY` is set
- [ ] **Provider API keys configured** — `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` set
- [ ] **SQLite path set to persistent storage** — not `:memory:`, configure `storage.path`
- [ ] **Database backup strategy** — periodic `sqlite3 ... ".backup"` or file copy
- [ ] **Reverse proxy configured** — nginx/Caddy with `X-Forwarded-For` header for rate limiting
- [ ] **HTTPS enabled** — either via reverse proxy or at the application level
- [ ] **Log collection configured** — stdout/stderr piped to log aggregation
- [ ] **Health check monitored** — poll `/health` endpoint
- [ ] **Process manager configured** — systemd, Docker, or similar with auto-restart
- [ ] **Worker concurrency tuned** — match your provider rate limits and server capacity
- [ ] **Shutdown timeout adequate** — ensure long-running tasks can complete within 30s (or adjust `SHUTDOWN_TIMEOUT` in source)
- [ ] **Rate limiting adequate** — adjust if behind a proxy that shares IPs
