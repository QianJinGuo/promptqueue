import { describe, it, expect, beforeEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { TaskStore } from "../task-store.js";
import type { CreateTaskInput } from "@promptqueue/core";

function createTestDb(): BetterSqlite3.Database {
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

  return db;
}

const defaultInput: CreateTaskInput & { model: string } = {
  prompt: "Test prompt",
  model: "claude-sonnet-4-6",
  priority: 3,
  queue: "default",
  routingStrategy: "explicit",
  timeout: 300,
  maxRetries: 3,
};

describe("TaskStore", () => {
  let db: BetterSqlite3.Database;
  let store: TaskStore;

  beforeEach(() => {
    db = createTestDb();
    store = new TaskStore(db);
  });

  describe("create", () => {
    it("creates a task with pending status", () => {
      const task = store.create(defaultInput);

      expect(task.id).toMatch(/^t_/);
      expect(task.status).toBe("pending");
      expect(task.prompt).toBe("Test prompt");
      expect(task.model).toBe("claude-sonnet-4-6");
      expect(task.priority).toBe(3);
      expect(task.queue).toBe("default");
      expect(task.createdAt).toBeTruthy();
    });

    it("creates a 'created' event", () => {
      const task = store.create(defaultInput);

      const events = db
        .prepare("SELECT * FROM task_events WHERE task_id = ?")
        .all(task.id) as Array<{ event_type: string }>;

      expect(events).toHaveLength(1);
      expect(events[0]!.event_type).toBe("created");
    });

    it("stores metadata as JSON", () => {
      const task = store.create({
        ...defaultInput,
        metadata: { userId: "abc", source: "api" },
      });

      const retrieved = store.getById(task.id);
      expect(retrieved!.metadata).toEqual({ userId: "abc", source: "api" });
    });
  });

  describe("getById", () => {
    it("returns null for nonexistent task", () => {
      expect(store.getById("t_nonexistent")).toBeNull();
    });

    it("returns the task by id", () => {
      const task = store.create(defaultInput);
      const retrieved = store.getById(task.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(task.id);
    });
  });

  describe("list", () => {
    it("returns empty list when no tasks", () => {
      const result = store.list();
      expect(result.tasks).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("returns tasks with total count", () => {
      store.create(defaultInput);
      store.create({ ...defaultInput, prompt: "Second task" });

      const result = store.list();
      expect(result.tasks).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by status", () => {
      const task1 = store.create(defaultInput);
      store.updateStatus(task1.id, "completed", { result: "done" });

      const result = store.list({ status: "completed" });
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]!.id).toBe(task1.id);
    });

    it("paginates results", () => {
      for (let i = 0; i < 5; i++) {
        store.create({ ...defaultInput, prompt: `Task ${i}` });
      }

      const page1 = store.list({ page: 1, limit: 2 });
      const page2 = store.list({ page: 2, limit: 2 });

      expect(page1.tasks).toHaveLength(2);
      expect(page2.tasks).toHaveLength(2);
      expect(page1.total).toBe(5);
    });
  });

  describe("updateStatus", () => {
    it("transitions from pending to running", () => {
      const task = store.create(defaultInput);
      const updated = store.updateStatus(task.id, "running");

      expect(updated!.status).toBe("running");
      expect(updated!.startedAt).toBeTruthy();
    });

    it("transitions from running to completed", () => {
      const task = store.create(defaultInput);
      store.updateStatus(task.id, "running");
      const completed = store.updateStatus(task.id, "completed", {
        result: "The answer",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
      });

      expect(completed!.status).toBe("completed");
      expect(completed!.result).toBe("The answer");
      expect(completed!.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(completed!.costUsd).toBe(0.01);
      expect(completed!.completedAt).toBeTruthy();
    });

    it("creates an event for each transition", () => {
      const task = store.create(defaultInput);
      store.updateStatus(task.id, "running");
      store.updateStatus(task.id, "completed", { result: "done" });

      const events = db
        .prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY id")
        .all(task.id) as Array<{ event_type: string }>;

      expect(events).toHaveLength(3);
      expect(events[0]!.event_type).toBe("created");
      expect(events[1]!.event_type).toBe("started");
      expect(events[2]!.event_type).toBe("completed");
    });
  });

  describe("claimNext", () => {
    it("returns null when no pending tasks", () => {
      expect(store.claimNext()).toBeNull();
    });

    it("claims the highest priority task first", () => {
      store.create({ ...defaultInput, priority: 5, prompt: "Low priority" });
      store.create({ ...defaultInput, priority: 1, prompt: "Critical" });
      store.create({ ...defaultInput, priority: 3, prompt: "Normal" });

      const claimed = store.claimNext();
      expect(claimed!.priority).toBe(1);
      expect(claimed!.prompt).toBe("Critical");
      expect(claimed!.status).toBe("running");
    });

    it("claims FIFO within same priority", () => {
      store.create({ ...defaultInput, prompt: "First" });
      store.create({ ...defaultInput, prompt: "Second" });

      const claimed = store.claimNext();
      expect(claimed!.prompt).toBe("First");
    });

    it("does not claim already running tasks", () => {
      store.create(defaultInput);
      store.claimNext();
      expect(store.claimNext()).toBeNull();
    });

    it("is atomic — concurrent claims get different tasks", () => {
      store.create({ ...defaultInput, prompt: "Task A" });
      store.create({ ...defaultInput, prompt: "Task B" });

      const claimed1 = store.claimNext();
      const claimed2 = store.claimNext();

      expect(claimed1!.id).not.toBe(claimed2!.id);
    });
  });

  describe("cancel", () => {
    it("cancels a pending task", () => {
      const task = store.create(defaultInput);
      const cancelled = store.cancel(task.id);

      expect(cancelled!.status).toBe("cancelled");
    });

    it("returns null for non-pending task", () => {
      const task = store.create(defaultInput);
      store.updateStatus(task.id, "running");

      expect(store.cancel(task.id)).toBeNull();
    });
  });

  describe("getQueueStats", () => {
    it("returns stats per queue", () => {
      store.create({ ...defaultInput, queue: "default" });
      store.create({ ...defaultInput, queue: "emails" });
      const task = store.create({ ...defaultInput, queue: "default" });
      store.updateStatus(task.id, "running");

      const stats = store.getQueueStats();

      expect(stats["default"]).toEqual({
        pending: 1,
        running: 1,
        completed: 0,
        failed: 0,
        total: 2,
      });
      expect(stats["emails"]).toEqual({
        pending: 1,
        running: 0,
        completed: 0,
        failed: 0,
        total: 1,
      });
    });
  });
});
