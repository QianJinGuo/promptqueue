import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any;
import BetterSqlite3 from "better-sqlite3";
import { createApp } from "../app.js";
import { TaskStore } from "../storage/task-store.js";
import { EventStore } from "../storage/event-store.js";
import { ProviderRegistry } from "../providers/registry.js";
import { MockProvider } from "../providers/mock.js";

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
      completed_at TEXT
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

describe("API routes", () => {
  describe("POST /api/v1/tasks", () => {
    it("creates a task and returns 202", async () => {
      const { app } = setupTestApp();

      const res = await app.request("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Hello world", model: "mock-model" }),
      });

      expect(res.status).toBe(202);
      const body = (await res.json()) as AnyJson;
      expect(body.success).toBe(true);
      expect(body.data.id).toMatch(/^t_/);
      expect(body.data.status).toBe("pending");
      expect(body.data.prompt).toBe("Hello world");
    });

    it("uses default model when model is not specified", async () => {
      const { app } = setupTestApp();

      const res = await app.request("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Test" }),
      });

      const body = (await res.json()) as AnyJson;
      expect(body.data.model).toBe("mock-model");
    });
  });

  describe("GET /api/v1/tasks/:id", () => {
    it("returns a task by id", async () => {
      const { app, taskStore } = setupTestApp();
      const task = taskStore.create({ ...defaultTaskInput, prompt: "Test" });

      const res = await app.request(`/api/v1/tasks/${task.id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as AnyJson;
      expect(body.data.id).toBe(task.id);
    });

    it("returns 404 for nonexistent task", async () => {
      const { app } = setupTestApp();

      const res = await app.request("/api/v1/tasks/t_nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/tasks", () => {
    it("lists tasks", async () => {
      const { app, taskStore } = setupTestApp();
      taskStore.create({ ...defaultTaskInput, prompt: "A" });
      taskStore.create({ ...defaultTaskInput, prompt: "B" });

      const res = await app.request("/api/v1/tasks");
      const body = (await res.json()) as AnyJson;
      expect(body.data).toHaveLength(2);
      expect(body.meta.total).toBe(2);
    });
  });

  describe("DELETE /api/v1/tasks/:id", () => {
    it("cancels a pending task", async () => {
      const { app, taskStore } = setupTestApp();
      const task = taskStore.create({ ...defaultTaskInput, prompt: "Test" });

      const res = await app.request(`/api/v1/tasks/${task.id}`, { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as AnyJson;
      expect(body.data.status).toBe("cancelled");
    });

    it("returns 409 for non-pending task", async () => {
      const { app, taskStore } = setupTestApp();
      const task = taskStore.create({ ...defaultTaskInput, prompt: "Test" });
      taskStore.updateStatus(task.id, "running");

      const res = await app.request(`/api/v1/tasks/${task.id}`, { method: "DELETE" });
      expect(res.status).toBe(409);
    });
  });

  describe("GET /health", () => {
    it("returns ok", async () => {
      const { app } = setupTestApp();

      const res = await app.request("/health");
      const body = (await res.json()) as AnyJson;
      expect(body.status).toBe("ok");
    });
  });
});
