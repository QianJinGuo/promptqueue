import type { RetryBackoff } from "@promptqueue/core";

export function calculateBackoff(
  retryCount: number,
  backoff: RetryBackoff,
  baseDelayMs: number
): number {
  let delay: number;

  switch (backoff) {
    case "exponential":
      delay = baseDelayMs * Math.pow(2, retryCount);
      break;
    case "linear":
      delay = baseDelayMs * (retryCount + 1);
      break;
    case "fixed":
      delay = baseDelayMs;
      break;
  }

  const jitter = delay * 0.2 * Math.random();
  return Math.floor(delay + jitter);
}
