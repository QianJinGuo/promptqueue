import { z } from "zod";

export const createTaskSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  routingStrategy: z
    .enum(["explicit", "cost-optimize", "speed-optimize", "quality-optimize"])
    .default("explicit"),
  priority: z.coerce.number().int().min(1).max(5).default(3),
  queue: z.string().default("default"),
  maxTokens: z.coerce.number().int().positive().optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  timeout: z.coerce.number().int().positive().default(300),
  maxRetries: z.coerce.number().int().min(0).max(10).default(3),
  callbackUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
  systemPrompt: z.string().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const taskQuerySchema = z.object({
  status: z
    .enum(["pending", "running", "completed", "failed", "cancelled", "timed_out"])
    .optional(),
  queue: z.string().optional(),
  priority: z.coerce.number().int().min(1).max(5).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type TaskQueryInput = z.infer<typeof taskQuerySchema>;

export const configSchema = z.object({
  server: z.object({
    port: z.coerce.number().int().positive().default(8080),
    concurrency: z.coerce.number().int().positive().default(10),
  }).default({}),
  storage: z.object({
    type: z.literal("sqlite").default("sqlite"),
    path: z.string().default("~/.promptqueue/data.db"),
  }).default({}),
  providers: z.record(
    z.object({
      apiKey: z.string().optional(),
      defaultModel: z.string().optional(),
      baseURL: z.string().optional(),
    })
  ).default({}),
  routing: z.object({
    defaultStrategy: z
      .enum(["explicit", "cost-optimize", "speed-optimize", "quality-optimize"])
      .default("explicit"),
    fallbackModel: z.string().default("claude-haiku-4-5-20251001"),
  }).default({}),
  worker: z.object({
    pollInterval: z.coerce.number().int().positive().default(500),
    retryBackoff: z.enum(["exponential", "linear", "fixed"]).default("exponential"),
    retryDelay: z.coerce.number().int().positive().default(1000),
    maxRetries: z.coerce.number().int().min(0).max(10).default(3),
  }).default({}),
});
