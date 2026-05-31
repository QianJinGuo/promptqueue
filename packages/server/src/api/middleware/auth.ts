import type { MiddlewareHandler } from "hono";

export function createAuthMiddleware(apiKey: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!apiKey) {
      return next();
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json(
        { success: false, data: null, error: "Missing Authorization header" },
        401
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token !== apiKey) {
      return c.json(
        { success: false, data: null, error: "Invalid API key" },
        401
      );
    }

    return next();
  };
}
