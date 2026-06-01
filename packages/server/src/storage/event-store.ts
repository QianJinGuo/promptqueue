import BetterSqlite3 from "better-sqlite3";
import type { TaskEvent, TaskEventType, AgentEvent } from "@promptqueue/core";

interface EventRow {
  id: number;
  task_id: string;
  event_type: string;
  payload: string | null;
  created_at: string;
}

function rowToEvent(row: EventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type as TaskEventType,
    payload: row.payload ? JSON.parse(row.payload) : undefined,
    createdAt: row.created_at,
  };
}

export class EventStore {
  private stmtGetByTaskId: BetterSqlite3.Statement;
  private stmtGetRecent: BetterSqlite3.Statement;

  constructor(private db: BetterSqlite3.Database) {
    this.stmtGetByTaskId = db.prepare(
      "SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC"
    );
    this.stmtGetRecent = db.prepare(
      "SELECT * FROM task_events ORDER BY created_at DESC LIMIT ?"
    );
  }

  append(taskId: string, eventType: TaskEventType, payload?: Record<string, unknown>): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO task_events (task_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(taskId, eventType, payload ? JSON.stringify(payload) : null, now);
  }

  appendAgentEvent(taskId: string, agentEvent: AgentEvent): void {
    if (agentEvent.type === "completed") {
      this.append(taskId, "completed", agentEvent.response as Record<string, unknown>);
      return;
    }
    if (agentEvent.type === "error") {
      this.append(taskId, "failed", { error: agentEvent.error });
      return;
    }

    const eventType = (agentEvent.type === "text"
      ? "agent_text"
      : agentEvent.type === "tool_call"
        ? "agent_tool_call"
        : "agent_tool_result") as TaskEventType;

    const payload: Record<string, unknown> = {};
    if (agentEvent.type === "text") {
      payload.content = agentEvent.content;
    } else if (agentEvent.type === "tool_call") {
      payload.name = agentEvent.name;
      payload.args = agentEvent.args;
    } else if (agentEvent.type === "tool_result") {
      payload.name = agentEvent.name;
      payload.result = agentEvent.result;
    }

    this.append(taskId, eventType, payload);
  }

  getByTaskId(taskId: string): TaskEvent[] {
    const rows = this.stmtGetByTaskId.all(taskId) as EventRow[];
    return rows.map(rowToEvent);
  }

  getRecent(limit: number = 50): TaskEvent[] {
    const rows = this.stmtGetRecent.all(limit) as EventRow[];
    return rows.map(rowToEvent);
  }
}
