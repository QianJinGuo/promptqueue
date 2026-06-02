import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { createDatabase, runMigrations, closeDatabase } from "../storage/database.js";
import { TaskStore } from "../storage/task-store.js";
import { EventStore } from "../storage/event-store.js";
import { ProviderRegistry } from "../providers/registry.js";
import { MockProvider } from "../providers/mock.js";
import { EventBus } from "../worker/event-bus.js";
import { PendingInputStore } from "../tools/ask-user.js";

describe("POST /api/v1/tasks/:id/input", () => {
  let app: ReturnType<typeof createApp>;
  let taskStore: TaskStore;
  let pendingInputStore: PendingInputStore;

  beforeEach(() => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    taskStore = new TaskStore(db);
    const eventStore = new EventStore(db);
    const eventBus = new EventBus();
    const registry = new ProviderRegistry();
    registry.register(new MockProvider());
    pendingInputStore = new PendingInputStore();

    app = createApp({
      taskStore,
      eventStore,
      eventBus,
      providerRegistry: registry,
      defaultModel: "mock-model",
      pendingInputStore,
    });
  });

  it("returns 404 for non-existent task", async () => {
    const res = await app.request("/api/v1/tasks/t_nonexistent/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: "Yes" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when task is not waiting_for_input", async () => {
    const task = taskStore.create({
      prompt: "test",
      model: "mock-model",
      priority: 3,
      queue: "default",
      routingStrategy: "explicit",
      timeout: 300,
      maxRetries: 3,
    });

    const res = await app.request(`/api/v1/tasks/${task.id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: "Yes" }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 when response is missing", async () => {
    const task = taskStore.create({
      prompt: "test",
      model: "mock-model",
      priority: 3,
      queue: "default",
      routingStrategy: "explicit",
      timeout: 300,
      maxRetries: 3,
    });

    taskStore.updateStatus(task.id, "running", {});
    taskStore.updateStatus(task.id, "waiting_for_input", {});

    const res = await app.request(`/api/v1/tasks/${task.id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("resolves pending input and returns updated task", async () => {
    const task = taskStore.create({
      prompt: "test",
      model: "mock-model",
      priority: 3,
      queue: "default",
      routingStrategy: "explicit",
      timeout: 300,
      maxRetries: 3,
    });

    taskStore.updateStatus(task.id, "running", {});
    taskStore.updateStatus(task.id, "waiting_for_input", {});
    pendingInputStore.register(task.id, "Question?", undefined, 60);

    const res = await app.request(`/api/v1/tasks/${task.id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: "Yes, proceed" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("running");
  });
});
