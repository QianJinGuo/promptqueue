import { describe, it, expect, beforeEach, vi } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any;
import BetterSqlite3 from "better-sqlite3";
import { createApp } from "../../app.js";
import { TaskStore } from "../../storage/task-store.js";
import { EventStore } from "../../storage/event-store.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { MockProvider } from "../../providers/mock.js";

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

  return { app, taskStore, eventStore, db };
}

const defaultTaskInput = {
  prompt: "Test prompt",
  model: "mock-model",
  priority: 3,
  queue: "default",
  routingStrategy: "explicit" as const,
  timeout: 300,
  maxRetries: 3,
};

describe("Full task lifecycle", () => {
  describe("Submit -> claim -> complete happy path", () => {
    it("completes the full lifecycle", async () => {
      const { app, taskStore } = setupTestApp();

      // Submit task
      const createRes = await app.request("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Hello world", model: "mock-model" }),
      });
      expect(createRes.status).toBe(202);
      const createBody = (await createRes.json()) as AnyJson;
      const taskId = createBody.data.id;
      expect(createBody.data.status).toBe("pending");

      // Verify pending
      const pendingRes = await app.request(`/api/v1/tasks/${taskId}`);
      expect(pendingRes.status).toBe(200);
      const pendingBody = (await pendingRes.json()) as AnyJson;
      expect(pendingBody.data.status).toBe("pending");

      // Claim (simulates worker picking up the task)
      const claimed = taskStore.claimNext();
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(taskId);
      expect(claimed!.status).toBe("running");

      // Verify running via API
      const runningRes = await app.request(`/api/v1/tasks/${taskId}`);
      expect(runningRes.status).toBe(200);
      const runningBody = (await runningRes.json()) as AnyJson;
      expect(runningBody.data.status).toBe("running");

      // Complete
      const completed = taskStore.updateStatus(taskId, "completed", {
        result: "Task result",
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.001,
      });
      expect(completed).not.toBeNull();
      expect(completed!.status).toBe("completed");
      expect(completed!.result).toBe("Task result");

      // Verify completed via API
      const completeRes = await app.request(`/api/v1/tasks/${taskId}`);
      expect(completeRes.status).toBe(200);
      const completeBody = (await completeRes.json()) as AnyJson;
      expect(completeBody.data.status).toBe("completed");
      expect(completeBody.data.result).toBe("Task result");
    });
  });

  describe("Submit -> fail -> retry -> claim again -> complete", () => {
    it("transitions through fail and retry back to complete", async () => {
      const { app, taskStore } = setupTestApp();

      // Submit task
      const createRes = await app.request("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Retry test", model: "mock-model" }),
      });
      expect(createRes.status).toBe(202);
      const createBody = (await createRes.json()) as AnyJson;
      const taskId = createBody.data.id;

      // Claim
      const claimed = taskStore.claimNext();
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(taskId);

      // Fail
      const failed = taskStore.updateStatus(taskId, "failed", {
        error: "Provider error",
        retryCount: 1,
      });
      expect(failed!.status).toBe("failed");
      expect(failed!.error).toBe("Provider error");

      // Verify failed via API
      const failedRes = await app.request(`/api/v1/tasks/${taskId}`);
      const failedBody = (await failedRes.json()) as AnyJson;
      expect(failedBody.data.status).toBe("failed");

      // Retry back to pending
      const retried = taskStore.updateStatus(taskId, "pending");
      expect(retried!.status).toBe("pending");

      // Verify back to pending via API
      const pendingRes = await app.request(`/api/v1/tasks/${taskId}`);
      const pendingBody = (await pendingRes.json()) as AnyJson;
      expect(pendingBody.data.status).toBe("pending");

      // Claim again
      const claimedAgain = taskStore.claimNext();
      expect(claimedAgain).not.toBeNull();
      expect(claimedAgain!.id).toBe(taskId);
      expect(claimedAgain!.status).toBe("running");

      // Complete
      const completed = taskStore.updateStatus(taskId, "completed", {
        result: "Final result",
        inputTokens: 20,
        outputTokens: 10,
        costUsd: 0.005,
      });
      expect(completed!.status).toBe("completed");
      expect(completed!.result).toBe("Final result");
    });
  });

  describe("Submit -> cancel before pickup", () => {
    it("cancels a pending task via DELETE endpoint", async () => {
      const { app, taskStore } = setupTestApp();

      // Submit task
      const task = taskStore.create({ ...defaultTaskInput, prompt: "Cancel me" });

      // Verify task is pending via API
      const getRes = await app.request(`/api/v1/tasks/${task.id}`);
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as AnyJson;
      expect(getBody.data.status).toBe("pending");

      // Cancel via DELETE endpoint
      const cancelRes = await app.request(`/api/v1/tasks/${task.id}`, {
        method: "DELETE",
      });
      expect(cancelRes.status).toBe(200);
      const cancelBody = (await cancelRes.json()) as AnyJson;
      expect(cancelBody.data.status).toBe("cancelled");

      // Verify final status via API
      const finalRes = await app.request(`/api/v1/tasks/${task.id}`);
      const finalBody = (await finalRes.json()) as AnyJson;
      expect(finalBody.data.status).toBe("cancelled");
    });
  });

  describe("Submit with callback URL", () => {
    it("stores the callback URL on the created task", async () => {
      const { app } = setupTestApp();

      const createRes = await app.request("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Callback test",
          model: "mock-model",
          callbackUrl: "https://example.com/callback",
        }),
      });
      expect(createRes.status).toBe(202);
      const createBody = (await createRes.json()) as AnyJson;
      expect(createBody.data.callbackUrl).toBe("https://example.com/callback");
    });
  });
});
