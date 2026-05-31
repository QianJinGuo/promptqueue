import { Hono } from "hono";
import { tasks } from "./api/tasks.js";
import { queues } from "./api/queues.js";
import { providers } from "./api/providers.js";
import { events } from "./api/events.js";
import { errorHandler, createAuthMiddleware } from "./api/middleware/index.js";
import type { TaskStore } from "./storage/task-store.js";
import type { EventStore } from "./storage/event-store.js";
import type { ProviderRegistry } from "./providers/registry.js";

export interface AppEnv {
  Variables: {
    taskStore: TaskStore;
    eventStore: EventStore;
    providerRegistry: ProviderRegistry;
    defaultModel: string;
  };
}

export function createApp(deps: {
  taskStore: TaskStore;
  eventStore: EventStore;
  providerRegistry: ProviderRegistry;
  defaultModel: string;
  apiKey?: string;
}) {
  const app = new Hono<AppEnv>();

  app.onError(errorHandler);

  app.use("*", createAuthMiddleware(deps.apiKey));

  app.use("*", async (c, next) => {
    c.set("taskStore", deps.taskStore);
    c.set("eventStore", deps.eventStore);
    c.set("providerRegistry", deps.providerRegistry);
    c.set("defaultModel", deps.defaultModel);
    return next();
  });

  app.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  const api = new Hono<AppEnv>();
  api.route("/tasks", tasks);
  api.route("/queues", queues);
  api.route("/providers", providers);
  api.route("/", events);

  app.route("/api/v1", api);

  return app;
}
