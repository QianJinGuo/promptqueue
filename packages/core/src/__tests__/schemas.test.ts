import { describe, test, expect } from "vitest";
import {
  createTaskSchema,
  taskQuerySchema,
  configSchema,
} from "../schemas.js";

describe("createTaskSchema", () => {
  test("accepts minimal valid input", () => {
    const result = createTaskSchema.parse({ prompt: "Hello" });
    expect(result.prompt).toBe("Hello");
    expect(result.routingStrategy).toBe("explicit");
    expect(result.priority).toBe(3);
    expect(result.queue).toBe("default");
    expect(result.timeout).toBe(300);
    expect(result.maxRetries).toBe(3);
  });

  test("accepts full valid input", () => {
    const result = createTaskSchema.parse({
      prompt: "Summarize this",
      model: "claude-sonnet-4-6",
      routingStrategy: "cost-optimize",
      priority: 1,
      queue: "high-priority",
      maxTokens: 2048,
      temperature: 0.7,
      timeout: 600,
      maxRetries: 5,
      callbackUrl: "https://example.com/hook",
      metadata: { source: "test" },
      systemPrompt: "You are helpful",
    });
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.priority).toBe(1);
    expect(result.maxTokens).toBe(2048);
  });

  test("rejects empty prompt", () => {
    expect(() => createTaskSchema.parse({ prompt: "" })).toThrow();
  });

  test("rejects missing prompt", () => {
    expect(() => createTaskSchema.parse({})).toThrow();
  });

  test("rejects invalid priority", () => {
    expect(() => createTaskSchema.parse({ prompt: "Hi", priority: 0 })).toThrow();
    expect(() => createTaskSchema.parse({ prompt: "Hi", priority: 6 })).toThrow();
  });

  test("rejects invalid routing strategy", () => {
    expect(() =>
      createTaskSchema.parse({ prompt: "Hi", routingStrategy: "unknown" })
    ).toThrow();
  });

  test("rejects negative maxTokens", () => {
    expect(() =>
      createTaskSchema.parse({ prompt: "Hi", maxTokens: -1 })
    ).toThrow();
  });

  test("rejects temperature out of range", () => {
    expect(() =>
      createTaskSchema.parse({ prompt: "Hi", temperature: -0.1 })
    ).toThrow();
    expect(() =>
      createTaskSchema.parse({ prompt: "Hi", temperature: 2.1 })
    ).toThrow();
  });

  test("coerces string numbers", () => {
    const result = createTaskSchema.parse({
      prompt: "Hi",
      priority: "2",
      timeout: "100",
    });
    expect(result.priority).toBe(2);
    expect(result.timeout).toBe(100);
  });

  test("rejects invalid callbackUrl", () => {
    expect(() =>
      createTaskSchema.parse({ prompt: "Hi", callbackUrl: "not-a-url" })
    ).toThrow();
  });
});

describe("taskQuerySchema", () => {
  test("provides defaults", () => {
    const result = taskQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  test("accepts valid status filter", () => {
    const result = taskQuerySchema.parse({ status: "pending" });
    expect(result.status).toBe("pending");
  });

  test("rejects invalid status", () => {
    expect(() => taskQuerySchema.parse({ status: "unknown" })).toThrow();
  });

  test("rejects limit over 100", () => {
    expect(() => taskQuerySchema.parse({ limit: 101 })).toThrow();
  });
});

describe("configSchema", () => {
  test("provides defaults for empty input", () => {
    const result = configSchema.parse({});
    expect(result.server.port).toBe(8080);
    expect(result.server.concurrency).toBe(10);
    expect(result.storage.type).toBe("sqlite");
    expect(result.routing.defaultStrategy).toBe("explicit");
    expect(result.worker.retryBackoff).toBe("exponential");
  });

  test("accepts full config", () => {
    const result = configSchema.parse({
      server: { port: 9090, concurrency: 20 },
      storage: { type: "sqlite", path: "/tmp/test.db" },
      providers: {
        anthropic: { apiKey: "sk-test", defaultModel: "claude-sonnet-4-6" },
      },
      routing: { defaultStrategy: "cost-optimize", fallbackModel: "gpt-4o" },
      worker: { pollInterval: 1000, retryBackoff: "linear", retryDelay: 2000, maxRetries: 5 },
    });
    expect(result.server.port).toBe(9090);
    expect(result.providers.anthropic?.apiKey).toBe("sk-test");
  });
});
