import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config/loader.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('merges with default config when no file found', () => {
    const config = loadConfig();
    expect(config.server.port).toBe(9090);
    expect(config.server.concurrency).toBe(10);
    expect(config.worker.retryBackoff).toBe('exponential');
  });

  it('has rateLimit defaults', () => {
    const config = loadConfig();
    expect(config.server.rateLimit).toBeDefined();
  });
});
