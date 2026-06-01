# PromptQueue Getting Started

This guide gets PromptQueue running end-to-end as quickly as possible.

## Before you start

You need:

- **Node.js 20+**
- **pnpm 10.x**

Enable pnpm with Corepack:

```bash
corepack enable
corepack prepare pnpm@10.11.0 --activate
```

---

## 1. Fastest demo (recommended first run)

No config, no API keys, in-memory SQLite, mock provider.

### Step 1: Install and build

```bash
git clone https://github.com/QianJinGuo/promptqueue.git
cd promptqueue
pnpm install
pnpm build
```

### Step 2: Start the server

```bash
node packages/server/dist/index.js
```

This gives you:

- API server on **http://localhost:9090**
- Embedded worker loop
- **In-memory** SQLite database (data lost on restart)
- **Mock provider** only (no real AI calls)

You should see:

```json
{"level":"info","message":"Server running on http://localhost:9090"}
```

### Step 3: Verify and use

In a second terminal:

```bash
# Health check
curl http://localhost:9090/health

# Submit a task
pnpm submit "Hello from PromptQueue"

# List tasks
pnpm pq-list

# Check a specific task (replace t_xxx with the ID from submit)
pnpm pq-status t_xxx
```

---

## 2. Persistent local setup

File-backed SQLite, config-driven, supports real AI providers.

### Step 1: Create a config file

Create `promptqueue.config.yaml` in the repo root:

```yaml
server:
  port: 9090
  concurrency: 10
  rateLimit:
    windowMs: 60000
    max: 100

storage:
  type: sqlite
  path: ./data/promptqueue.db

routing:
  defaultStrategy: explicit
  fallbackModel: mock-model

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
  # anthropic-sdk:
  #   type: anthropic-sdk
  #   apiKey: ${ANTHROPIC_API_KEY}
  #   defaultModel: claude-sonnet-4-6

worker:
  pollInterval: 500
  retryBackoff: exponential
  retryDelay: 1000
  maxRetries: 3

# Enable built-in tools for agent tool loop
# tools:
#   allowed:
#     - execute_command
#     - read_file
#     - write_file
#   denied: []
#   maxTurns: 10
#   timeout: 30
```

Create the data directory:

```bash
mkdir -p data
```

### Step 2: Start the server

```bash
pnpm serve
```

This reads `promptqueue.config.yaml` automatically. To specify a different config:

```bash
pnpm serve --config ./my-config.yaml
```

The server:

- Creates/opens SQLite at `./data/promptqueue.db`
- Runs pending migrations automatically on startup
- Registers providers based on config (API keys from environment variables)
- Falls back to the mock provider if no API keys are set

### Step 3: Use with real AI providers

Set environment variables for the providers you want to use:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...

pnpm serve
```

When API keys are set, tasks routed to those providers will make real AI calls. Without API keys, only the mock provider is available.

### Step 4: Submit tasks with a specific model

```bash
# Uses the default model (mock)
pnpm submit "Hello"

# Use a specific provider's model
curl -X POST http://localhost:9090/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Explain quantum computing","model":"claude-sonnet-4-6"}'

# Submit a task with tool loop enabled (requires anthropic-sdk provider and tools config)
pnpm submit "List all TypeScript files in the src directory" --model claude-sonnet-4-6 --tools
```

---

## 3. Run the dashboard

The dashboard is a Next.js app that runs separately from the API server.

### Terminal 1: start the API server

```bash
pnpm serve
```

### Terminal 2: start the dashboard

```bash
pnpm --filter @promptqueue/dashboard dev
```

Open:

- **Dashboard:** http://localhost:3000
- **API:** http://localhost:9090

The dashboard expects the API at `http://localhost:9090`.

---

## 4. CLI reference

```bash
# Start the server
pnpm serve                                    # uses promptqueue.config.yaml
pnpm serve --config ./my-config.yaml          # custom config
pnpm serve --port 8080                        # override port

# Submit a task
pnpm submit "Summarize this article"
pnpm submit "Translate to French" --model gpt-4o
pnpm submit "Debug this code" --priority 1 --system-prompt "You are a debugger"
pnpm submit "List files in src" --model claude-sonnet-4-6 --tools

# Check task status
pnpm pq-status t_01ABCDEF

# List tasks
pnpm pq-list
pnpm pq-list --status completed
pnpm pq-list --limit 50
```

### API endpoints

```bash
# Health
curl http://localhost:9090/health

# Create task
curl -X POST http://localhost:9090/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hello","model":"mock-model"}'

# List tasks
curl http://localhost:9090/api/v1/tasks

# Get task details
curl http://localhost:9090/api/v1/tasks/t_01ABCDEF

# Get task events
curl http://localhost:9090/api/v1/tasks/t_01ABCDEF/events

# List queues
curl http://localhost:9090/api/v1/queues

# List providers
curl http://localhost:9090/api/v1/providers
```

---

## 5. Provider types

PromptQueue supports three provider types:

### API providers (in-process SDK calls)

Run inside the server process using vendor SDKs. Configured with `apiKey`:

```yaml
providers:
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
    defaultModel: claude-sonnet-4-6
  openai:
    apiKey: ${OPENAI_API_KEY}
    defaultModel: gpt-4o
```

### SDK providers (tool loop support)

Use `@anthropic-ai/sdk` directly for multi-turn tool loop control. The Worker owns tool execution and governance. Configured with `type: anthropic-sdk`:

```yaml
providers:
  anthropic-sdk:
    type: anthropic-sdk
    apiKey: ${ANTHROPIC_API_KEY}
    defaultModel: claude-sonnet-4-6
```

SDK providers support the `--tools` CLI flag for enabling built-in tools (execute_command, read_file, write_file).

### CLI providers (subprocess agent tools)

Spawn agent CLI tools as subprocesses with timeout enforcement. Configured with `type: cli` and `command`:

```yaml
providers:
  claude-code:
    type: cli
    command: claude
    defaultModel: claude-sonnet-4-6
```

CLI providers support streaming agent events and automatic timeout handling via subprocess management.

---

## 6. Current runtime behavior

- **Mock provider** is always registered as a fallback
- **Migrations** run automatically on server startup — new columns are added without manual intervention
- **Rate limiting** is enabled by default (100 requests/minute) when using `pnpm serve`
- **Retry backoff** uses exponential strategy by default with configurable delays
- **Tool loop** enables multi-turn agent execution when `--tools` flag is used with an `anthropic-sdk` provider; Worker governs tool calls via whitelist/blacklist
- **Built-in tools** (`execute_command`, `read_file`, `write_file`) are available when `tools` config is present
- **Task timeout** defaults to 300 seconds; tasks exceeding it transition to `timed_out` status
- Starting the built server directly with `node packages/server/dist/index.js` uses **in-memory** storage
- The dashboard is **not** embedded — it runs separately on port 3000

---

## 7. Troubleshooting

### Port 9090 is already in use

```bash
# Find and stop the existing process
lsof -i :9090
# Or use a different port
pnpm serve --port 8080
```

### `pnpm submit` cannot connect

Make sure the server is running:

```bash
curl http://localhost:9090/health
```

### `SqliteError: no such column` on startup

This means the database schema is out of date. Either:

1. Delete the database and let migrations recreate it (loses data):

   ```bash
   rm data/promptqueue.db
   pnpm serve
   ```

2. Or rebuild to ensure migrations are up to date in dist:

   ```bash
   pnpm build
   pnpm serve
   ```

### Tasks stay pending

- Make sure the server started successfully (check logs)
- Make sure you didn't stop the server after submitting
- Try the **Fastest demo** path first to isolate the issue

### API key not working

- Environment variables must be set **before** starting the server
- The `${VAR_NAME}` syntax in config reads from the process environment at startup
- Verify: `echo $ANTHROPIC_API_KEY`

---

## 8. Quick first-run checklist

1. `git clone https://github.com/QianJinGuo/promptqueue.git`
2. `cd promptqueue`
3. `pnpm install`
4. `pnpm build`
5. `node packages/server/dist/index.js`
6. In another terminal: `curl http://localhost:9090/health`
7. `pnpm submit "Hello from PromptQueue"`
8. Copy the task ID
9. `pnpm pq-status <task-id>`
10. `pnpm pq-list`
