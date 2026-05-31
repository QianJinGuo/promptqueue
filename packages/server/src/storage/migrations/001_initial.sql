CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 3,
  queue TEXT NOT NULL DEFAULT 'default',
  prompt TEXT NOT NULL,
  system_prompt TEXT,
  model TEXT NOT NULL,
  routing_strategy TEXT DEFAULT 'explicit',
  max_tokens INTEGER,
  temperature REAL,
  timeout INTEGER DEFAULT 300,
  max_retries INTEGER DEFAULT 3,
  retry_count INTEGER DEFAULT 0,
  callback_url TEXT,
  metadata TEXT,
  result TEXT,
  error TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX idx_tasks_status_priority ON tasks(status, priority, created_at);
CREATE INDEX idx_tasks_queue ON tasks(queue, status);

CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  event_type TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_events_task ON task_events(task_id, created_at);
