import type { MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  /** Maximum requests per window per IP. Default: 100. */
  maxRequests?: number;
  /** Window duration in milliseconds. Default: 60000 (1 minute). */
  windowMs?: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Creates a Hono middleware that enforces per-IP rate limiting.
 *
 * Uses an in-memory Map. Entries are lazily evicted on expiry.
 * Returns 429 with a `Retry-After` header when the limit is exceeded.
 */
export function createRateLimitMiddleware(
  options: RateLimitOptions = {}
): MiddlewareHandler {
  const { maxRequests = 100, windowMs = 60_000 } = options;
  const clients = new Map<string, RateLimitEntry>();

  // Periodic cleanup to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of clients) {
      if (now >= entry.resetAt) {
        clients.delete(ip);
      }
    }
  }, windowMs * 10);

  // Allow the timer to keep the process alive only if there are tracked clients
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
    const now = Date.now();

    let entry = clients.get(ip);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      clients.set(ip, entry);
    }

    entry.count++;

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(resetSeconds));

    if (entry.count > maxRequests) {
      c.header("Retry-After", String(resetSeconds));
      return c.json(
        {
          success: false,
          data: null,
          error: `Rate limit exceeded. Retry after ${resetSeconds} seconds.`,
        },
        429
      );
    }

    return next();
  };
}
