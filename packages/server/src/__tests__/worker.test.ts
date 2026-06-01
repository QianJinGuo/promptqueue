import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Worker } from '../worker/worker.js';
import { TaskStore } from '../storage/task-store.js';
import { ProviderRegistry } from '../providers/registry.js';
import { MockProvider } from '../providers/mock.js';
import { createDatabase, runMigrations, closeDatabase } from '../storage/database.js';
import { calculateBackoff } from '../worker/retry.js';

class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

describe('Worker', () => {
  let db: ReturnType<typeof createDatabase>;
  let store: TaskStore;
  let registry: ProviderRegistry;

  beforeEach(() => {
    db = createDatabase({ path: ':memory:' });
    runMigrations(db);
    store = new TaskStore(db);
    registry = new ProviderRegistry();
    registry.register(new MockProvider());
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('transitions timed out tasks to timed_out status', async () => {
    const task = store.create({
      prompt: 'test',
      model: 'mock-model',
      priority: 3,
      queue: 'default',
      routingStrategy: 'explicit',
      timeout: 1,
      maxRetries: 0,
    });

    const slowRegistry = new ProviderRegistry();
    slowRegistry.register({
      name: 'slow',
      models: ['mock-model'],
      execute: () => new Promise(() => {}),
      healthCheck: () => Promise.resolve({ status: 'healthy', latencyMs: 0 }),
    });

    const worker = new Worker(store, slowRegistry, {
      concurrency: 1,
      pollInterval: 50,
      retryBackoff: 'exponential',
      retryDelay: 100,
    });

    worker.start();
    await new Promise((r) => setTimeout(r, 2000));

    const updated = store.getById(task.id);
    expect(updated?.status).toBe('timed_out');

    await worker.stop();
  });

  it('applies retry backoff and sets nextRetryAt', async () => {
    const task = store.create({
      prompt: 'test',
      model: 'mock-model',
      priority: 3,
      queue: 'default',
      routingStrategy: 'explicit',
      timeout: 300,
      maxRetries: 3,
    });

    const failRegistry = new ProviderRegistry();
    failRegistry.register({
      name: 'fail',
      models: ['mock-model'],
      execute: () => Promise.reject(new Error('Server error')),
      healthCheck: () => Promise.resolve({ status: 'healthy', latencyMs: 0 }),
    });

    const worker = new Worker(store, failRegistry, {
      concurrency: 1,
      pollInterval: 50,
      retryBackoff: 'exponential',
      retryDelay: 1000,
    });

    worker.start();
    await new Promise((r) => setTimeout(r, 500));
    await worker.stop();

    const updated = store.getById(task.id);
    expect(updated?.retryCount).toBeGreaterThanOrEqual(1);
    expect(updated?.nextRetryAt).toBeGreaterThan(Date.now() - 1000);
  });

  it('does not retry non-retryable errors', async () => {
    const task = store.create({
      prompt: 'test',
      model: 'mock-model',
      priority: 3,
      queue: 'default',
      routingStrategy: 'explicit',
      timeout: 300,
      maxRetries: 3,
    });

    const failRegistry = new ProviderRegistry();
    failRegistry.register({
      name: 'auth-fail',
      models: ['mock-model'],
      execute: () => Promise.reject(new AuthenticationError('Invalid API key')),
      healthCheck: () => Promise.resolve({ status: 'healthy', latencyMs: 0 }),
    });

    const worker = new Worker(store, failRegistry, {
      concurrency: 1,
      pollInterval: 50,
      retryBackoff: 'exponential',
      retryDelay: 100,
    });

    worker.start();
    await new Promise((r) => setTimeout(r, 500));
    await worker.stop();

    const updated = store.getById(task.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.retryCount).toBe(0);
  });
});

describe('calculateBackoff', () => {
  it('returns exponential backoff with jitter', () => {
    const delays = new Set<number>();
    for (let i = 0; i < 10; i++) {
      delays.add(calculateBackoff(2, 'exponential', 1000));
    }
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(4000);
      expect(d).toBeLessThanOrEqual(4800);
    }
    expect(delays.size).toBeGreaterThan(1);
  });

  it('returns linear backoff', () => {
    const d = calculateBackoff(3, 'linear', 1000);
    expect(d).toBeGreaterThanOrEqual(4000);
    expect(d).toBeLessThanOrEqual(4800);
  });

  it('returns fixed backoff', () => {
    const d = calculateBackoff(5, 'fixed', 1000);
    expect(d).toBeGreaterThanOrEqual(1000);
    expect(d).toBeLessThanOrEqual(1200);
  });
});
