import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createTaskSchema, taskQuerySchema } from "@promptqueue/core";
import type { TaskStore } from "../storage/task-store.js";
import type { EventStore } from "../storage/event-store.js";
import type { PendingInputStore } from "../tools/ask-user.js";

interface Env {
  Variables: {
    taskStore: TaskStore;
    eventStore: EventStore;
    defaultModel: string;
    eventBus: { emit: (taskId: string, event: unknown) => void };
    pendingInputStore: PendingInputStore;
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

  if (task.status !== "pending" && task.status !== "waiting_for_input") {
    return c.json(
      { success: false, data: null, error: "Only pending or waiting_for_input tasks can be cancelled" },
      409
    );
  }

  if (task.status === "waiting_for_input") {
    const pendingInputStore = c.get("pendingInputStore");
    pendingInputStore.cancel(id);
  }

  const cancelled = store.updateStatus(id, "cancelled");
  return c.json({ success: true, data: cancelled, error: null });
});

tasks.post("/:id/input", async (c) => {
  const { id } = c.req.param();
  const store = c.get("taskStore");
  const eventBus = c.get("eventBus");
  const pendingInputStore = c.get("pendingInputStore");

  const body = await c.req.json<{ response?: string }>();

  if (!body.response || typeof body.response !== "string") {
    return c.json(
      { success: false, data: null, error: "response is required and must be a string" },
      400
    );
  }

  const task = store.getById(id);
  if (!task) {
    return c.json({ success: false, data: null, error: "Task not found" }, 404);
  }

  if (task.status !== "waiting_for_input") {
    return c.json(
      { success: false, data: null, error: "Task is not waiting for input" },
      409
    );
  }

  const resolved = pendingInputStore.resolve(id, body.response);
  if (!resolved) {
    return c.json(
      { success: false, data: null, error: "No pending input request for this task" },
      409
    );
  }

  store.updateStatus(id, "running", {});

  eventBus.emit(id, {
    type: "tool_result",
    name: "ask_user",
    result: body.response,
  });

  const updated = store.getById(id);
  return c.json({ success: true, data: updated, error: null });
});

export { tasks };
