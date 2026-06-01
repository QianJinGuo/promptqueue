import { Hono } from "hono";
import { cors } from "hono/cors";
import { tasks } from "./api/tasks.js";
import { queues } from "./api/queues.js";
import { providers } from "./api/providers.js";
import { events } from "./api/events.js";
import { errorHandler, createAuthMiddleware, createRateLimitMiddleware } from "./api/middleware/index.js";
import type { TaskStore } from "./storage/task-store.js";
import type { EventStore } from "./storage/event-store.js";
import type { ProviderRegistry } from "./providers/registry.js";
import type { EventBus } from "./worker/event-bus.js";

export interface AppEnv {
  Variables: {
    taskStore: TaskStore;
    eventStore: EventStore;
    eventBus: EventBus;
    providerRegistry: ProviderRegistry;
    defaultModel: string;
  };
}

export function createApp(deps: {
  taskStore: TaskStore;
  eventStore: EventStore;
  eventBus: EventBus;
  providerRegistry: ProviderRegistry;
  defaultModel: string;
  apiKey?: string;
  rateLimit?: { windowMs: number; max: number };
}) {
  const app = new Hono<AppEnv>();

  app.onError(errorHandler);

  app.use("*", cors());
  app.use("*", createAuthMiddleware(deps.apiKey));
  app.use("*", createRateLimitMiddleware(deps.rateLimit));

  app.use("*", async (c, next) => {
    c.set("taskStore", deps.taskStore);
    c.set("eventStore", deps.eventStore);
    c.set("eventBus", deps.eventBus);
    c.set("providerRegistry", deps.providerRegistry);
    c.set("defaultModel", deps.defaultModel);
    return next();
  });

  app.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  const api = new Hono<AppEnv>();
  api.route("/tasks", tasks);
  api.route("/tasks", events);
  api.route("/queues", queues);
  api.route("/providers", providers);

  app.route("/api/v1", api);

  return app;
}
