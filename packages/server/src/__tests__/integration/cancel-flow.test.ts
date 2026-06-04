import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any;
import BetterSqlite3 from "better-sqlite3";
import { createApp } from "../../app.js";
import { TaskStore } from "../../storage/task-store.js";
import { EventStore } from "../../storage/event-store.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { MockProvider } from "../../providers/mock.js";
import { EventBus } from "../../worker/event-bus.js";

function setupTestApp() {
  const db = new BetterSqlite3(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
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
      metadata TEXT,
      result TEXT,
      error TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      next_retry_at INTEGER DEFAULT NULL
    );
    CREATE INDEX idx_tasks_status_priority ON tasks(status, priority, created_at);
    CREATE INDEX idx_tasks_queue ON tasks(queue, status);
    CREATE TABLE task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      event_type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_events_task ON task_events(task_id, created_at);
  `);

  const taskStore = new TaskStore(db);
  const eventStore = new EventStore(db);
  const registry = new ProviderRegistry();
  registry.register(new MockProvider());

  const app = createApp({
    taskStore,
    eventStore,
    eventBus: new EventBus(),
    providerRegistry: registry,
    defaultModel: "mock-model",
  });

  return { app, taskStore, db };
}

const defaultTaskInput = {
  prompt: "Test",
  model: "mock-model",
  priority: 3,
  queue: "default",
  routingStrategy: "explicit" as const,
  timeout: 300,
  maxRetries: 3,
};

describe("Cancel flow", () => {
  it("cancels a pending task via API", async () => {
    const { app, taskStore } = setupTestApp();
    const task = taskStore.create({ ...defaultTaskInput, prompt: "Cancel me" });

    const res = await app.request(`/api/v1/tasks/${task.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.data.status).toBe("cancelled");
  });

  it("cancels a running task via API", async () => {
    const { app, taskStore } = setupTestApp();
    const task = taskStore.create({ ...defaultTaskInput, prompt: "Running" });
    taskStore.updateStatus(task.id, "running");

    const res = await app.request(`/api/v1/tasks/${task.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.data.status).toBe("cancelled");
  });

  it("returns 409 when cancelling a completed task", async () => {
    const { app, taskStore } = setupTestApp();
    const task = taskStore.create({ ...defaultTaskInput, prompt: "Done" });
    taskStore.updateStatus(task.id, "completed", { result: "ok" });

    const res = await app.request(`/api/v1/tasks/${task.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as AnyJson;
    expect(body.error).toContain("cannot be cancelled");
  });

  it("returns 404 when cancelling a nonexistent task", async () => {
    const { app } = setupTestApp();

    const res = await app.request("/api/v1/tasks/t_nonexistent", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyJson;
    expect(body.error).toContain("not found");
  });

  it("uses store.cancel directly and returns null for non-pending task", async () => {
    const { taskStore } = setupTestApp();
    const task = taskStore.create({ ...defaultTaskInput, prompt: "Running" });
    taskStore.updateStatus(task.id, "running");

    const result = taskStore.cancel(task.id);
    expect(result).toBeNull();
  });
});
