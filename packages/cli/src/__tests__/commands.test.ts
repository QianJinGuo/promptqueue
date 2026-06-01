import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { submitTask } from "../commands/submit.js";
import { checkStatus } from "../commands/status.js";
import { listTasks } from "../commands/list.js";

const originalFetch = globalThis.fetch;

function mockFetchResponse(data: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? "OK",
    json: async () => data,
  };
}

class ExitEarly extends Error {
  code: number;
  constructor(code: number) {
    super(`Process exited with code ${code}`);
    this.code = code;
    this.name = "ExitEarly";
  }
}

describe("submitTask", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("submits a task and prints the ID", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({ data: { id: "t_01TEST123", status: "pending" } })
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await submitTask("Hello world", { apiUrl: "http://localhost:9090" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:9090/api/v1/tasks",
      expect.objectContaining({ method: "POST" })
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("t_01TEST123"));

    logSpy.mockRestore();
  });

  test("handles submission failure", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({ error: "Invalid input" }, { ok: false, statusText: "Bad Request" })
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      // @ts-ignore
      throw new ExitEarly(code);
    });

    await expect(
      submitTask("", { apiUrl: "http://localhost:9090" })
    ).rejects.toThrow(ExitEarly);

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("checkStatus", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("displays task status", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({
        data: {
          id: "t_01TEST123",
          status: "completed",
          prompt: "Hello",
          model: "mock-model",
          result: "Mock response",
          tokenUsage: { inputTokens: 10, outputTokens: 5 },
          costUsd: 0.001,
          createdAt: "2026-05-30T12:00:00Z",
          completedAt: "2026-05-30T12:00:01Z",
        },
      })
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await checkStatus("t_01TEST123", { apiUrl: "http://localhost:9090" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("completed"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Mock response"));

    logSpy.mockRestore();
  });

  test("handles 404", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({}, { ok: false, status: 404, statusText: "Not Found" })
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      // @ts-ignore
      throw new ExitEarly(code);
    });

    await expect(
      checkStatus("t_nonexistent", { apiUrl: "http://localhost:9090" })
    ).rejects.toThrow(ExitEarly);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("listTasks", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("displays task list", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({
        data: [
          { id: "t_01A", status: "pending", prompt: "Task 1", model: "mock", priority: 1, queue: "default", createdAt: "2026-05-30T12:00:00Z" },
          { id: "t_01B", status: "running", prompt: "Task 2", model: "mock", priority: 3, queue: "default", createdAt: "2026-05-30T12:00:01Z" },
        ],
        meta: { total: 2, page: 1, limit: 20 },
      })
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listTasks({ apiUrl: "http://localhost:9090" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("2 total"));

    logSpy.mockRestore();
  });

  test("shows empty message when no tasks", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({ data: [], meta: { total: 0, page: 1, limit: 20 } })
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listTasks({ apiUrl: "http://localhost:9090" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No tasks found"));

    logSpy.mockRestore();
  });

  test("passes filter params", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({ data: [], meta: { total: 0, page: 1, limit: 20 } })
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listTasks({ status: "pending", priority: 1, apiUrl: "http://localhost:9090" });

    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("status=pending"));
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("priority=1"));

    logSpy.mockRestore();
  });
});
