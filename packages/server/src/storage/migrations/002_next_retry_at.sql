ALTER TABLE tasks ADD COLUMN next_retry_at INTEGER DEFAULT NULL;
CREATE INDEX idx_tasks_next_retry ON tasks(status, next_retry_at);
