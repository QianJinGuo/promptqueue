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

describe("Priority ordering", () => {
  it("claimNext returns highest priority (lowest number) first", async () => {
    const { taskStore } = setupTestApp();

    taskStore.create({ ...defaultTaskInput, priority: 5, prompt: "Low priority" });
    taskStore.create({ ...defaultTaskInput, priority: 1, prompt: "Critical" });
    taskStore.create({ ...defaultTaskInput, priority: 3, prompt: "Normal" });

    const first = taskStore.claimNext();
    expect(first!.priority).toBe(1);
    expect(first!.prompt).toBe("Critical");

    const second = taskStore.claimNext();
    expect(second!.priority).toBe(3);
    expect(second!.prompt).toBe("Normal");

    const third = taskStore.claimNext();
    expect(third!.priority).toBe(5);
    expect(third!.prompt).toBe("Low priority");
  });

  it("same priority follows FIFO ordering", async () => {
    const { taskStore } = setupTestApp();

    taskStore.create({ ...defaultTaskInput, priority: 3, prompt: "First" });
    taskStore.create({ ...defaultTaskInput, priority: 3, prompt: "Second" });
    taskStore.create({ ...defaultTaskInput, priority: 3, prompt: "Third" });

    const first = taskStore.claimNext();
    expect(first!.prompt).toBe("First");

    const second = taskStore.claimNext();
    expect(second!.prompt).toBe("Second");

    const third = taskStore.claimNext();
    expect(third!.prompt).toBe("Third");
  });

  it("mix of priorities always picks lowest number first", async () => {
    const { taskStore } = setupTestApp();

    taskStore.create({ ...defaultTaskInput, priority: 3, prompt: "Normal A" });
    taskStore.create({ ...defaultTaskInput, priority: 1, prompt: "Critical A" });
    taskStore.create({ ...defaultTaskInput, priority: 2, prompt: "High" });
    taskStore.create({ ...defaultTaskInput, priority: 5, prompt: "Low A" });
    taskStore.create({ ...defaultTaskInput, priority: 1, prompt: "Critical B" });
    taskStore.create({ ...defaultTaskInput, priority: 5, prompt: "Low B" });

    // Should claim in priority order: 1, 1, 2, 3, 5, 5
    const first = taskStore.claimNext();
    expect(first!.priority).toBe(1);
    expect(first!.prompt).toBe("Critical A");

    const second = taskStore.claimNext();
    expect(second!.priority).toBe(1);
    expect(second!.prompt).toBe("Critical B");

    const third = taskStore.claimNext();
    expect(third!.priority).toBe(2);
    expect(third!.prompt).toBe("High");

    const fourth = taskStore.claimNext();
    expect(fourth!.priority).toBe(3);
    expect(fourth!.prompt).toBe("Normal A");

    const fifth = taskStore.claimNext();
    expect(fifth!.priority).toBe(5);
    expect(fifth!.prompt).toBe("Low A");

    const sixth = taskStore.claimNext();
    expect(sixth!.priority).toBe(5);
    expect(sixth!.prompt).toBe("Low B");
  });
});
