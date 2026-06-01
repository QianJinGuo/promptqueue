import type { Task, RetryBackoff, ProviderAdapter, ProviderRequest, ProviderResponse } from "@promptqueue/core";
import type { TaskStore } from "../storage/task-store.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { TimeoutError } from "./errors.js";
import { calculateBackoff } from "./retry.js";

export interface WorkerConfig {
  concurrency: number;
  pollInterval: number;
  retryBackoff: RetryBackoff;
  retryDelay: number;
}

export class Worker {
  private running = false;
  private activeCount = 0;

  constructor(
    private store: TaskStore,
    private registry: ProviderRegistry,
    private config: WorkerConfig
  ) {}

  start(): void {
    this.running = true;
    this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    while (this.activeCount > 0) {
      await sleep(100);
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (this.activeCount >= this.config.concurrency) {
        await sleep(this.config.pollInterval);
        continue;
      }

      const task = this.store.claimNext();
      if (!task) {
        await sleep(this.config.pollInterval);
        continue;
      }

      this.activeCount++;
      this.executeTask(task).finally(() => {
        this.activeCount--;
      });
    }
  }

  private async executeTask(task: Task): Promise<void> {
    try {
      const provider = this.registry.resolve(task.model);
      const result = await this.executeWithTimeout(provider, {
        prompt: task.prompt,
        systemPrompt: task.systemPrompt,
        model: task.model,
        maxTokens: task.maxTokens,
        temperature: task.temperature,
      }, task.timeout);

      this.store.updateStatus(task.id, "completed", {
        result: result.result,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      });

      this.fireCallback(task, "completed");
    } catch (error: unknown) {
      if (error instanceof TimeoutError) {
        this.store.updateStatus(task.id, "timed_out", {
          error: "Task exceeded timeout",
        });
        this.fireCallback(task, "timed_out");
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      const retryable = this.isRetryable(error);

      if (retryable && task.retryCount < task.maxRetries) {
        const delay = calculateBackoff(
          task.retryCount,
          this.config.retryBackoff,
          this.config.retryDelay
        );
        this.store.updateStatus(task.id, "pending", {
          retryCount: task.retryCount + 1,
          nextRetryAt: Date.now() + delay,
        });
      } else {
        this.store.updateStatus(task.id, "failed", { error: message });
        this.fireCallback(task, "failed");
      }
    }
  }

  private async executeWithTimeout(
    provider: ProviderAdapter,
    request: ProviderRequest,
    timeoutSeconds: number
  ): Promise<ProviderResponse> {
    const timeoutMs = timeoutSeconds * 1000;
    let timer: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
    });

    try {
      return await Promise.race([
        provider.execute(request),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof Error) {
      const name = error.constructor.name;
      return !["AuthenticationError", "PermissionDeniedError", "NotFoundError"].includes(name);
    }
    return true;
  }

  private fireCallback(task: Task, event: string): void {
    if (!task.callbackUrl) return;

    fetch(task.callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, task }),
    }).catch(() => {
      // Fire-and-forget: log failure but don't block
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
