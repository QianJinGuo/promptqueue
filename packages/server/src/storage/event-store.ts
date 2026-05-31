import BetterSqlite3 from "better-sqlite3";
import type { TaskEvent, TaskEventType } from "@promptqueue/core";

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

  getByTaskId(taskId: string): TaskEvent[] {
    const rows = this.stmtGetByTaskId.all(taskId) as EventRow[];
    return rows.map(rowToEvent);
  }

  getRecent(limit: number = 50): TaskEvent[] {
    const rows = this.stmtGetRecent.all(limit) as EventRow[];
    return rows.map(rowToEvent);
  }
}
