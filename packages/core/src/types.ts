import type { AgentRequest, AgentEvent } from "./types/agent.js";
import type { ToolExecutorFn, ToolConfig } from "./types/tools.js";

export type { AgentRequest, AgentEvent } from "./types/agent.js";
export type { ToolDefinition, ToolResult, ToolExecutorFn, ToolConfig } from "./types/tools.js";

// --- Task Types ---

export type TaskStatus =
  | "pending"
  | "running"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export type RoutingStrategy =
  | "explicit"
  | "cost-optimize"
  | "speed-optimize"
  | "quality-optimize";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface Task {
  id: string;
  status: TaskStatus;
  priority: number;
  queue: string;
  prompt: string;
  systemPrompt?: string;
  model: string;
  routingStrategy: RoutingStrategy;
  maxTokens?: number;
  temperature?: number;
  timeout: number;
  maxRetries: number;
  retryCount: number;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  result?: string;
  error?: string;
  tokenUsage?: TokenUsage;
  costUsd?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  nextRetryAt?: number | null;
}

// --- Provider Types ---

export interface ProviderRequest {
  prompt: string;
  systemPrompt?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderResponse {
  result: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

export interface ProviderHealth {
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  details?: string;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly models: readonly string[];
  execute(request: ProviderRequest): Promise<ProviderResponse>;
  healthCheck(): Promise<ProviderHealth>;
  executeAgent?(request: AgentRequest, signal?: AbortSignal, toolExecutor?: ToolExecutorFn): AsyncIterable<AgentEvent>;
}

// --- Router Types ---

export interface Router {
  resolve(task: Task, providers: ProviderAdapter[]): ProviderAdapter;
}

// --- Event Types ---

export type TaskEventType =
  | "created"
  | "started"
  | "completed"
  | "failed"
  | "retrying"
  | "cancelled"
  | "timed_out"
  | "agent_text"
  | "agent_thinking"
  | "agent_tool_call"
  | "agent_tool_result";

export interface TaskEvent {
  id: number;
  taskId: string;
  eventType: TaskEventType;
  payload?: Record<string, unknown>;
  createdAt: string;
}

// --- API Types ---

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

// --- Retry Types ---

export type RetryBackoff = "exponential" | "linear" | "fixed";

export interface RetryPolicy {
  maxRetries: number;
  backoff: RetryBackoff;
  baseDelayMs: number;
}

// --- Queue Types ---

export interface QueueStats {
  name: string;
  pending: number;
  running: number;
  waitingForInput: number;
  completed: number;
  failed: number;
  total: number;
}

// --- Config Types ---

export interface ServerConfig {
  port: number;
  concurrency: number;
  rateLimit?: {
    windowMs: number;
    max: number;
  };
}

export interface StorageConfig {
  type: "sqlite";
  path: string;
}

export interface ProviderConfig {
  type?: "api" | "cli" | "anthropic-sdk";
  apiKey?: string;
  defaultModel?: string;
  baseURL?: string;
  command?: string;
}

export interface RoutingConfig {
  defaultStrategy: RoutingStrategy;
  fallbackModel: string;
}

export interface WorkerConfig {
  pollInterval: number;
  retryBackoff: RetryBackoff;
  retryDelay: number;
  maxRetries: number;
}

export interface AppConfig {
  server: ServerConfig;
  storage: StorageConfig;
  providers: Record<string, ProviderConfig>;
  routing: RoutingConfig;
  worker: WorkerConfig;
  tools?: ToolConfig;
}
