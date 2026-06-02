import BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import type { Task, TaskStatus, CreateTaskInput, TokenUsage } from "@promptqueue/core";
import { TASK_ID_PREFIX } from "@promptqueue/core";

interface TaskRow {
  id: string;
  status: TaskStatus;
  priority: number;
  queue: string;
  prompt: string;
  system_prompt: string | null;
  model: string;
  routing_strategy: string;
  max_tokens: number | null;
  temperature: number | null;
  timeout: number;
  max_retries: number;
  retry_count: number;
  callback_url: string | null;
  metadata: string | null;
  result: string | null;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  next_retry_at: number | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    queue: row.queue,
    prompt: row.prompt,
    systemPrompt: row.system_prompt ?? undefined,
    model: row.model,
    routingStrategy: row.routing_strategy as Task["routingStrategy"],
    maxTokens: row.max_tokens ?? undefined,
    temperature: row.temperature ?? undefined,
    timeout: row.timeout,
    maxRetries: row.max_retries,
    retryCount: row.retry_count,
    callbackUrl: row.callback_url ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    tokenUsage:
      row.input_tokens != null && row.output_tokens != null
        ? { inputTokens: row.input_tokens, outputTokens: row.output_tokens }
        : undefined,
    costUsd: row.cost_usd ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    nextRetryAt: row.next_retry_at ?? undefined,
  };
}

export interface TaskListFilters {
  status?: TaskStatus;
  queue?: string;
  priority?: number;
  page?: number;
  limit?: number;
}

export interface StatusTransitionPayload {
  result?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  retryCount?: number;
  nextRetryAt?: number | null;
}

export class TaskStore {
  private stmtGetById: BetterSqlite3.Statement;
  private stmtListByStatus: BetterSqlite3.Statement;
  private stmtCountByStatus: BetterSqlite3.Statement;

  constructor(private db: BetterSqlite3.Database) {
    this.stmtGetById = db.prepare("SELECT * FROM tasks WHERE id = ?");
    this.stmtListByStatus = db.prepare(`
      SELECT * FROM tasks
      WHERE (:status IS NULL OR status = :status)
        AND (:queue IS NULL OR queue = :queue)
        AND (:priority IS NULL OR priority = :priority)
      ORDER BY created_at DESC
      LIMIT :limit OFFSET :offset
    `);
    this.stmtCountByStatus = db.prepare(`
      SELECT COUNT(*) as total FROM tasks
      WHERE (:status IS NULL OR status = :status)
        AND (:queue IS NULL OR queue = :queue)
        AND (:priority IS NULL OR priority = :priority)
    `);
  }

  create(input: CreateTaskInput & { model: string }): Task {
    const id = `${TASK_ID_PREFIX}${ulid()}`;
    const now = new Date().toISOString();

    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO tasks (id, status, priority, queue, prompt, system_prompt, model,
            routing_strategy, max_tokens, temperature, timeout, max_retries, callback_url, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          "pending",
          input.priority,
          input.queue,
          input.prompt,
          input.systemPrompt ?? null,
          input.model,
          input.routingStrategy,
          input.maxTokens ?? null,
          input.temperature ?? null,
          input.timeout,
          input.maxRetries,
          input.callbackUrl ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          now
        );

      this.db
        .prepare(
          `INSERT INTO task_events (task_id, event_type, payload, created_at)
           VALUES (?, 'created', ?, ?)`
        )
        .run(id, JSON.stringify({ priority: input.priority, model: input.model }), now);
    });

    txn();
    return this.getById(id)!;
  }

  getById(id: string): Task | null {
    const row = this.stmtGetById.get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  list(filters: TaskListFilters = {}): { tasks: Task[]; total: number } {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const countRow = this.stmtCountByStatus.get({
      status: filters.status ?? null,
      queue: filters.queue ?? null,
      priority: filters.priority ?? null,
    }) as { total: number };

    const rows = this.stmtListByStatus.all({
      status: filters.status ?? null,
      queue: filters.queue ?? null,
      priority: filters.priority ?? null,
      limit,
      offset,
    }) as TaskRow[];

    return {
      tasks: rows.map(rowToTask),
      total: countRow.total,
    };
  }

  updateStatus(
    id: string,
    newStatus: TaskStatus,
    payload: StatusTransitionPayload = {}
  ): Task | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = new Date().toISOString();

    const txn = this.db.transaction(() => {
      const updates: string[] = ["status = ?"];
      const values: unknown[] = [newStatus];

      if (newStatus === "running") {
        updates.push("started_at = ?");
        values.push(now);
      }

      if (newStatus === "completed" || newStatus === "failed" || newStatus === "cancelled" || newStatus === "timed_out") {
        updates.push("completed_at = ?");
        values.push(now);
      }

      if (payload.result !== undefined) {
        updates.push("result = ?");
        values.push(payload.result);
      }
      if (payload.error !== undefined) {
        updates.push("error = ?");
        values.push(payload.error);
      }
      if (payload.inputTokens !== undefined) {
        updates.push("input_tokens = ?");
        values.push(payload.inputTokens);
      }
      if (payload.outputTokens !== undefined) {
        updates.push("output_tokens = ?");
        values.push(payload.outputTokens);
      }
      if (payload.costUsd !== undefined) {
        updates.push("cost_usd = ?");
        values.push(payload.costUsd);
      }
      if (payload.retryCount !== undefined) {
        updates.push("retry_count = ?");
        values.push(payload.retryCount);
      }
      if (payload.nextRetryAt !== undefined) {
        updates.push("next_retry_at = ?");
        values.push(payload.nextRetryAt);
      }

      values.push(id);

      this.db
        .prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`)
        .run(...values);

      const eventType = newStatus === "running" ? "started" : newStatus;
      this.db
        .prepare(
          `INSERT INTO task_events (task_id, event_type, payload, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(id, eventType, JSON.stringify(payload), now);
    });

    txn();
    return this.getById(id);
  }

  claimNext(): Task | null {
    const claim = this.db.transaction(() => {
      const now = Date.now();
      const row = this.db
        .prepare(
          `SELECT id FROM tasks
           WHERE status = 'pending'
             AND (next_retry_at IS NULL OR next_retry_at <= ?)
           ORDER BY priority ASC, created_at ASC
           LIMIT 1`
        )
        .get(now) as { id: string } | undefined;

      if (!row) return null;

      const startedAt = new Date().toISOString();
      this.db
        .prepare(`UPDATE tasks SET status = 'running', started_at = ?, next_retry_at = NULL WHERE id = ? AND status = 'pending'`)
        .run(startedAt, row.id);

      this.db
        .prepare(
          `INSERT INTO task_events (task_id, event_type, payload, created_at)
           VALUES (?, 'started', ?, ?)`
        )
        .run(row.id, JSON.stringify({ startedAt: now }), now);

      return row.id;
    });

    const id = claim();
    return id ? this.getById(id) : null;
  }

  cancel(id: string): Task | null {
    const existing = this.getById(id);
    if (!existing || existing.status !== "pending") return null;
    return this.updateStatus(id, "cancelled");
  }

  getQueueStats(): Record<string, { pending: number; running: number; waitingForInput: number; completed: number; failed: number; total: number }> {
    const rows = this.db
      .prepare(
        `SELECT queue,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
           SUM(CASE WHEN status = 'waiting_for_input' THEN 1 ELSE 0 END) as waiting_for_input,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
           COUNT(*) as total
         FROM tasks
         GROUP BY queue`
      )
      .all() as Array<{
      queue: string;
      pending: number;
      running: number;
      waiting_for_input: number;
      completed: number;
      failed: number;
      total: number;
    }>;

    const result: Record<string, { pending: number; running: number; waitingForInput: number; completed: number; failed: number; total: number }> = {};
    for (const row of rows) {
      result[row.queue] = {
        pending: row.pending,
        running: row.running,
        waitingForInput: row.waiting_for_input,
        completed: row.completed,
        failed: row.failed,
        total: row.total,
      };
    }
    return result;
  }
}
