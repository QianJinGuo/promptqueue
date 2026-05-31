import type { TaskStatus, RoutingStrategy } from "./types.js";

export const TASK_ID_PREFIX = "t_";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export const ROUTING_STRATEGIES: readonly RoutingStrategy[] = [
  "explicit",
  "cost-optimize",
  "speed-optimize",
  "quality-optimize",
] as const;

export const PRIORITY_LEVELS = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 3,
  LOW: 4,
  BEST_EFFORT: 5,
} as const;

export const DEFAULT_CONFIG = {
  server: {
    port: 8080,
    concurrency: 10,
  },
  storage: {
    type: "sqlite" as const,
    path: "~/.promptqueue/data.db",
  },
  providers: {},
  routing: {
    defaultStrategy: "explicit" as const,
    fallbackModel: "claude-haiku-4-5-20251001",
  },
  worker: {
    pollInterval: 500,
    retryBackoff: "exponential" as const,
    retryDelay: 1000,
    maxRetries: 3,
  },
};
