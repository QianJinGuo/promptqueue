import type { ErrorHandler } from "hono";
import type { ApiResponse } from "@promptqueue/core";

export const errorHandler: ErrorHandler = (err, c) => {
  const status = "status" in err ? (err.status as number) : 500;
  const message =
    status === 500 ? "Internal server error" : (err.message ?? "Unknown error");

  const response: ApiResponse<never> = {
    success: false,
    data: null,
    error: message,
  };

  return c.json(response, status as 400);
};
