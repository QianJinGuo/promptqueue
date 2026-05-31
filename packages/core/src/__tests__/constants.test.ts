import { describe, test, expect } from "vitest";
import {
  TASK_ID_PREFIX,
  TASK_STATUSES,
  ROUTING_STRATEGIES,
  PRIORITY_LEVELS,
  DEFAULT_CONFIG,
} from "../constants.js";

describe("constants", () => {
  test("TASK_ID_PREFIX is 't_'", () => {
    expect(TASK_ID_PREFIX).toBe("t_");
  });

  test("TASK_STATUSES contains all statuses", () => {
    expect(TASK_STATUSES).toContain("pending");
    expect(TASK_STATUSES).toContain("running");
    expect(TASK_STATUSES).toContain("completed");
    expect(TASK_STATUSES).toContain("failed");
    expect(TASK_STATUSES).toContain("cancelled");
    expect(TASK_STATUSES).toContain("timed_out");
    expect(TASK_STATUSES).toHaveLength(6);
  });

  test("ROUTING_STRATEGIES contains all strategies", () => {
    expect(ROUTING_STRATEGIES).toContain("explicit");
    expect(ROUTING_STRATEGIES).toContain("cost-optimize");
    expect(ROUTING_STRATEGIES).toContain("speed-optimize");
    expect(ROUTING_STRATEGIES).toContain("quality-optimize");
    expect(ROUTING_STRATEGIES).toHaveLength(4);
  });

  test("PRIORITY_LEVELS has correct mapping", () => {
    expect(PRIORITY_LEVELS.CRITICAL).toBe(1);
    expect(PRIORITY_LEVELS.HIGH).toBe(2);
    expect(PRIORITY_LEVELS.NORMAL).toBe(3);
    expect(PRIORITY_LEVELS.LOW).toBe(4);
    expect(PRIORITY_LEVELS.BEST_EFFORT).toBe(5);
  });

  test("DEFAULT_CONFIG has sensible defaults", () => {
    expect(DEFAULT_CONFIG.server.port).toBe(8080);
    expect(DEFAULT_CONFIG.server.concurrency).toBe(10);
    expect(DEFAULT_CONFIG.storage.type).toBe("sqlite");
    expect(DEFAULT_CONFIG.routing.defaultStrategy).toBe("explicit");
    expect(DEFAULT_CONFIG.worker.pollInterval).toBe(500);
    expect(DEFAULT_CONFIG.worker.retryBackoff).toBe("exponential");
    expect(DEFAULT_CONFIG.worker.retryDelay).toBe(1000);
    expect(DEFAULT_CONFIG.worker.maxRetries).toBe(3);
  });
});
