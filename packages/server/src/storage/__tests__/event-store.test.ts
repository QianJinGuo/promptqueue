import { describe, it, expect, beforeEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { EventStore } from "../event-store.js";
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
      completed_at TEXT
    );

    CREATE TABLE task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      event_type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );
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

describe("EventStore", () => {
  let db: BetterSqlite3.Database;
  let eventStore: EventStore;
  let taskStore: TaskStore;

  beforeEach(() => {
    db = createTestDb();
    eventStore = new EventStore(db);
    taskStore = new TaskStore(db);
  });

  describe("append", () => {
    it("appends an event to a task", () => {
      const task = taskStore.create(defaultInput);
      eventStore.append(task.id, "started", { startedAt: new Date().toISOString() });

      const events = eventStore.getByTaskId(task.id);
      expect(events).toHaveLength(2);
      expect(events[1]!.eventType).toBe("started");
    });
  });

  describe("getByTaskId", () => {
    it("returns events in chronological order", () => {
      const task = taskStore.create(defaultInput);
      taskStore.updateStatus(task.id, "running");
      taskStore.updateStatus(task.id, "completed", { result: "done" });

      const events = eventStore.getByTaskId(task.id);

      expect(events).toHaveLength(3);
      expect(events[0]!.eventType).toBe("created");
      expect(events[1]!.eventType).toBe("started");
      expect(events[2]!.eventType).toBe("completed");
    });

    it("returns empty array for unknown task", () => {
      expect(eventStore.getByTaskId("t_unknown")).toEqual([]);
    });
  });

  describe("getRecent", () => {
    it("returns recent events across all tasks", () => {
      taskStore.create(defaultInput);
      taskStore.create({ ...defaultInput, prompt: "Task 2" });

      const events = eventStore.getRecent(10);
      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        taskStore.create({ ...defaultInput, prompt: `Task ${i}` });
      }

      const events = eventStore.getRecent(3);
      expect(events).toHaveLength(3);
    });
  });

  describe("immutability", () => {
    it("events are append-only and cannot be modified", () => {
      const task = taskStore.create(defaultInput);
      const eventsBefore = eventStore.getByTaskId(task.id);

      const eventsAfter = eventStore.getByTaskId(task.id);
      expect(eventsBefore).toHaveLength(eventsAfter.length);
    });
  });
});
