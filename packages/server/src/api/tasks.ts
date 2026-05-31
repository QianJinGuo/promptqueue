import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createTaskSchema, taskQuerySchema } from "@promptqueue/core";
import type { TaskStore } from "../storage/task-store.js";
import type { EventStore } from "../storage/event-store.js";

interface Env {
  Variables: {
    taskStore: TaskStore;
    eventStore: EventStore;
    defaultModel: string;
  };
}

const tasks = new Hono<Env>();

tasks.post("/", zValidator("json", createTaskSchema), async (c) => {
  const input = c.req.valid("json");
  const store = c.get("taskStore");
  const defaultModel = c.get("defaultModel");

  const model = input.model ?? defaultModel;
  const task = store.create({ ...input, model });

  return c.json({ success: true, data: task, error: null }, 202);
});

tasks.get("/:id", async (c) => {
  const { id } = c.req.param();
  const store = c.get("taskStore");

  const task = store.getById(id);
  if (!task) {
    return c.json({ success: false, data: null, error: "Task not found" }, 404);
  }

  return c.json({ success: true, data: task, error: null });
});

tasks.get("/", zValidator("query", taskQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const store = c.get("taskStore");

  const { tasks: taskList, total } = store.list(query);
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  return c.json({
    success: true,
    data: taskList,
    error: null,
    meta: { page, limit, total },
  });
});

tasks.delete("/:id", async (c) => {
  const { id } = c.req.param();
  const store = c.get("taskStore");

  const task = store.getById(id);
  if (!task) {
    return c.json({ success: false, data: null, error: "Task not found" }, 404);
  }

  if (task.status !== "pending") {
    return c.json(
      { success: false, data: null, error: "Only pending tasks can be cancelled" },
      409
    );
  }

  const cancelled = store.cancel(id);
  return c.json({ success: true, data: cancelled, error: null });
});

export { tasks };
