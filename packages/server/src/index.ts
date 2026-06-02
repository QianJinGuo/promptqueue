import { serve } from "@hono/node-server";
import { createDatabase, runMigrations, closeDatabase } from "./storage/database.js";
import { TaskStore } from "./storage/task-store.js";
import { EventStore } from "./storage/event-store.js";
import { ProviderRegistry } from "./providers/registry.js";
import { MockProvider } from "./providers/mock.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { ClaudeCodeProvider } from "./providers/claude-code.js";
import { AnthropicSDKProvider } from "./providers/anthropic-sdk.js";
import { ToolRegistry } from "./tools/registry.js";
import { createExecuteCommandTool } from "./tools/execute-command.js";
import { createReadFileTool } from "./tools/read-file.js";
import { createWriteFileTool } from "./tools/write-file.js";
import { PendingInputStore, createAskUserTool } from "./tools/ask-user.js";
import { Worker } from "./worker/worker.js";
import { EventBus } from "./worker/event-bus.js";
import { createApp } from "./app.js";
import { DEFAULT_CONFIG, type AppConfig } from "@promptqueue/core";
import { logger } from "./logging.js";

const SHUTDOWN_TIMEOUT = 30_000;

export interface ServerOptions {
  port?: number;
  dbPath?: string;
  apiKey?: string;
  concurrency?: number;
  config?: AppConfig;
}

function log(message: string): void {
  logger.info(message);
}

export function startServer(options: ServerOptions = {}): void {
  const port = options.port ?? DEFAULT_CONFIG.server.port;
  const dbPath = options.dbPath ?? ":memory:";
  const concurrency = options.concurrency ?? DEFAULT_CONFIG.server.concurrency;

  const db = createDatabase({ path: dbPath });
  runMigrations(db);

  const taskStore = new TaskStore(db);

  // Fail tasks stuck in waiting_for_input from a previous server run
  const stuckTasks = taskStore.list({ status: "waiting_for_input" });
  for (const task of stuckTasks.tasks) {
    taskStore.updateStatus(task.id, "failed", {
      error: "Server restarted while waiting for user input",
    });
    logger.info(`Failed stuck task ${task.id}: was waiting_for_input on restart`);
  }

  const eventStore = new EventStore(db);
  const eventBus = new EventBus();

  const registry = new ProviderRegistry();

  const config = options.config ?? DEFAULT_CONFIG;

  const providers: Record<string, { type?: "api" | "cli" | "anthropic-sdk"; apiKey?: string; defaultModel?: string; baseURL?: string; command?: string }> = config.providers;
  const anthropic = providers["anthropic"];
  if (anthropic?.apiKey) {
    registry.register(new AnthropicProvider({
      apiKey: anthropic.apiKey,
      defaultModel: anthropic.defaultModel,
      baseURL: anthropic.baseURL,
    }));
    log("Registered Anthropic provider");
  }
  const openai = providers["openai"];
  if (openai?.apiKey) {
    registry.register(new OpenAIProvider({
      apiKey: openai.apiKey,
      defaultModel: openai.defaultModel,
      baseURL: openai.baseURL,
    }));
    log("Registered OpenAI provider");
  }

  // Register CLI providers
  let firstCliProvider: string | null = null;
  for (const [providerName, providerConfig] of Object.entries(providers)) {
    if (providerConfig.type === "cli" && providerConfig.command) {
      const CliClass = providerName === "claude-code" ? ClaudeCodeProvider : null;
      if (CliClass) {
        const instance = new CliClass({
          command: providerConfig.command,
          defaultModel: providerConfig.defaultModel,
        });
        registry.register(instance);
        if (!firstCliProvider) {
          registry.setFallback(instance);
          firstCliProvider = providerName;
        }
        log(`Registered CLI provider: ${providerName}`);
      }
    }
  }

  registry.register(new MockProvider());

  // Register AnthropicSDK provider if configured
  for (const [name, providerConfig] of Object.entries(providers)) {
    if (providerConfig.type === "anthropic-sdk" && providerConfig.apiKey) {
      const sdkProvider = new AnthropicSDKProvider({
        apiKey: providerConfig.apiKey,
        defaultModel: providerConfig.defaultModel,
        baseURL: providerConfig.baseURL,
      });
      registry.register(sdkProvider);
      log(`Registered AnthropicSDK provider: ${name}`);
    }
  }

  // Create PendingInputStore for ask_user tool
  const pendingInputStore = new PendingInputStore();

  // Create worker first (ask_user needs releaseSlot/reclaimSlot references)
  const worker = new Worker(taskStore, eventStore, eventBus, registry, null, {
    concurrency,
    pollInterval: config.worker.pollInterval,
    retryBackoff: config.worker.retryBackoff,
    retryDelay: config.worker.retryDelay,
  });

  // Register tools if configured
  let toolRegistry: ToolRegistry | null = null;
  const toolConfig = (config as AppConfig).tools;
  if (toolConfig && toolConfig.allowed.length > 0) {
    toolRegistry = new ToolRegistry(toolConfig);
    if (toolConfig.allowed.includes("execute_command")) {
      const cmdTool = createExecuteCommandTool();
      toolRegistry.register(cmdTool.definition, cmdTool.executor);
    }
    if (toolConfig.allowed.includes("read_file")) {
      const readTool = createReadFileTool();
      toolRegistry.register(readTool.definition, readTool.executor);
    }
    if (toolConfig.allowed.includes("write_file")) {
      const writeTool = createWriteFileTool();
      toolRegistry.register(writeTool.definition, writeTool.executor);
    }
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
    log(`Registered tools: ${toolConfig.allowed.join(", ")}`);
  }

  worker.setToolRegistry(toolRegistry);

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

  worker.start();

  const server = serve({ fetch: app.fetch, port }, (info) => {
    log(`Server running on http://localhost:${info.port}`);
  });

  async function shutdown(signal: string): Promise<void> {
    log(`Received ${signal}, starting graceful shutdown...`);

    const forceExit = setTimeout(() => {
      log("Shutdown timeout reached, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);

    try {
      // Step 1: Stop the worker (stop accepting new tasks, drain active ones)
      await worker.stop();

      // Step 2: Close the HTTP server (stop accepting new connections)
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Step 3: Close the database
      closeDatabase(db);

      clearTimeout(forceExit);
      log("Graceful shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error(`Error during shutdown: ${error}`);
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

export { createApp } from "./app.js";

// Auto-start when run directly
if (
  process.argv[1]?.endsWith("server/src/index.ts") ||
  process.argv[1]?.endsWith("server/dist/index.js")
) {
  startServer();
}
