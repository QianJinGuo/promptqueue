import { Hono } from "hono";
import type { TaskStore } from "../storage/task-store.js";

interface Env {
  Variables: {
    taskStore: TaskStore;
  };
}

const queues = new Hono<Env>();

queues.get("/", async (c) => {
  const store = c.get("taskStore");
  const stats = store.getQueueStats();

  const result = Object.entries(stats).map(([name, s]) => ({
    name,
    ...s,
  }));

  return c.json({ success: true, data: result, error: null });
});

queues.get("/:name", async (c) => {
  const { name } = c.req.param();
  const store = c.get("taskStore");
  const stats = store.getQueueStats();

  const queueStats = stats[name];
  if (!queueStats) {
    return c.json({ success: true, data: { name, pending: 0, running: 0, completed: 0, failed: 0, total: 0 }, error: null });
  }

  return c.json({ success: true, data: { name, ...queueStats }, error: null });
});

export { queues };
