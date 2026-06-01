import { serve } from "@hono/node-server";
import { createDatabase, runMigrations, closeDatabase } from "./storage/database.js";
import { TaskStore } from "./storage/task-store.js";
import { EventStore } from "./storage/event-store.js";
import { ProviderRegistry } from "./providers/registry.js";
import { MockProvider } from "./providers/mock.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { Worker } from "./worker/worker.js";
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
  const eventStore = new EventStore(db);

  const registry = new ProviderRegistry();

  const config = options.config ?? DEFAULT_CONFIG;

  const providers: Record<string, { apiKey?: string; defaultModel?: string; baseURL?: string }> = config.providers;
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

  registry.register(new MockProvider());

  const worker = new Worker(taskStore, registry, {
    concurrency,
    pollInterval: config.worker.pollInterval,
    retryBackoff: config.worker.retryBackoff,
    retryDelay: config.worker.retryDelay,
  });

  const app = createApp({
    taskStore,
    eventStore,
    providerRegistry: registry,
    defaultModel: config.routing.fallbackModel,
    apiKey: options.apiKey,
    rateLimit: config.server.rateLimit,
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
