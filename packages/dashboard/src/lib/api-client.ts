import type {
  ApiResponse,
  Task,
  TaskEvent,
  QueueStats,
  TaskStatus,
} from "@promptqueue/core";

interface ProviderInfo {
  name: string;
  models: readonly string[];
}

interface ProviderHealthResult {
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  details?: string;
}

interface ListTasksParams {
  status?: TaskStatus;
  queue?: string;
  priority?: number;
  page?: number;
  limit?: number;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE_URL = "http://localhost:9090/api/v1";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  const json: ApiResponse<T> = await response.json();

  if (!json.success || json.data === null) {
    throw new ApiError(json.error ?? "Unknown error", response.status);
  }

  return json.data;
}

export async function submitTask(input: {
  prompt: string;
  model?: string;
  routingStrategy?: string;
  priority?: number;
  queue?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  maxRetries?: number;
  callbackUrl?: string;
  systemPrompt?: string;
}): Promise<Task> {
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getTask(id: string): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(id)}`);
}

export async function listTasks(
  params: ListTasksParams = {}
): Promise<{ tasks: Task[]; meta: { page: number; limit: number; total: number } }> {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set("status", params.status);
  if (params.queue) searchParams.set("queue", params.queue);
  if (params.priority) searchParams.set("priority", String(params.priority));
  if (params.page) searchParams.set("page", String(params.page));
  if (params.limit) searchParams.set("limit", String(params.limit));

  const qs = searchParams.toString();
  const url = `/tasks${qs ? `?${qs}` : ""}`;
  const response = await fetch(`${BASE_URL}${url}`, {
    headers: { "Content-Type": "application/json" },
  });

  const json: ApiResponse<Task[]> & { meta?: { page: number; limit: number; total: number } } =
    await response.json();

  if (!json.success) {
    throw new ApiError(json.error ?? "Unknown error", response.status);
  }

  return {
    tasks: json.data ?? [],
    meta: json.meta ?? { page: 1, limit: 20, total: 0 },
  };
}

export async function cancelTask(id: string): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function submitTaskInput(
  taskId: string,
  response: string
): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/input`, {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}

export async function getQueues(): Promise<QueueStats[]> {
  return request<QueueStats[]>("/queues");
}

export async function getProviders(): Promise<ProviderInfo[]> {
  return request<ProviderInfo[]>("/providers");
}

export async function getProviderHealth(
  id: string
): Promise<ProviderHealthResult> {
  return request<ProviderHealthResult>(
    `/providers/${encodeURIComponent(id)}/health`
  );
}

export async function getTaskEvents(
  taskId: string,
  signal?: AbortSignal
): Promise<TaskEvent[]> {
  const response = await fetch(
    `${BASE_URL}/tasks/${encodeURIComponent(taskId)}/events`,
    {
      headers: { Accept: "text/event-stream" },
      signal,
    }
  );

  if (!response.ok) {
    throw new ApiError("Failed to fetch events", response.status);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return [];
  }

  const decoder = new TextDecoder();
  const events: TaskEvent[] = [];
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(line.slice(6)) as TaskEvent;
            events.push(parsed);
          } catch {
            // skip invalid JSON
          }
        }
      }
    }
  } catch {
    // Stream ended or aborted
  }

  return events;
}

export type StreamEvent = {
  type: string;
  data: unknown;
};

const SSE_EVENT_TYPES = [
  "created", "started", "completed", "failed",
  "retrying", "cancelled", "timed_out",
  "agent_text", "agent_thinking", "agent_tool_call", "agent_tool_result",
];

export function subscribeToTaskEvents(
  taskId: string,
  onEvent: (event: StreamEvent) => void
): EventSource {
  const url = `${BASE_URL}/tasks/${encodeURIComponent(taskId)}/events`;
  const es = new EventSource(url);

  for (const eventType of SSE_EVENT_TYPES) {
    es.addEventListener(eventType, (e: MessageEvent) => {
      try {
        onEvent({ type: eventType, data: JSON.parse(e.data) });
      } catch {
        // skip malformed
      }
    });
  }

  return es;
}

/** Fetch overview stats: queue depth grouped by status */
export async function getOverviewStats(): Promise<{
  pending: number;
  running: number;
  failed: number;
  total: number;
}> {
  const queues = await getQueues();
  return queues.reduce(
    (acc, q) => ({
      pending: acc.pending + q.pending,
      running: acc.running + q.running,
      failed: acc.failed + q.failed,
      total: acc.total + q.total,
    }),
    { pending: 0, running: 0, failed: 0, total: 0 }
  );
}
