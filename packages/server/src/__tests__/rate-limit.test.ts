import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../app.js';
import { createDatabase, runMigrations } from '../storage/database.js';
import { TaskStore } from '../storage/task-store.js';
import { EventStore } from '../storage/event-store.js';
import { ProviderRegistry } from '../providers/registry.js';
import { MockProvider } from '../providers/mock.js';

describe('Rate limiting', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const db = createDatabase({ path: ':memory:' });
    runMigrations(db);
    const taskStore = new TaskStore(db);
    const eventStore = new EventStore(db);
    const registry = new ProviderRegistry();
    registry.register(new MockProvider());

    app = createApp({
      taskStore,
      eventStore,
      providerRegistry: registry,
      defaultModel: 'mock-model',
      rateLimit: { windowMs: 1000, max: 5 },
    });
  });

  it('allows requests under the limit', async () => {
    const res = await app.request('/api/v1/tasks');
    expect(res.status).toBe(200);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    for (let i = 0; i < 5; i++) {
      await app.request('/api/v1/tasks');
    }

    const res = await app.request('/api/v1/tasks');
    expect(res.status).toBe(429);
  });
});
