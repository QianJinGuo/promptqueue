import type { Task, RetryBackoff, ProviderAdapter, ProviderRequest, ProviderResponse, AgentRequest, AgentEvent } from "@promptqueue/core";
import type { TaskStore } from "../storage/task-store.js";
import type { EventStore } from "../storage/event-store.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ToolRegistry } from "../tools/registry.js";
import { EventBus } from "./event-bus.js";
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
    private eventStore: EventStore,
    private eventBus: EventBus,
    private registry: ProviderRegistry,
    private toolRegistry: ToolRegistry | null,
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
    const provider = this.registry.resolve(task.model);

    if (typeof provider.executeAgent === "function") {
      await this.executeTaskStreaming(provider, task);
    } else {
      await this.executeTaskLegacy(provider, task);
    }
  }

  private async executeTaskStreaming(
    provider: ProviderAdapter,
    task: Task
  ): Promise<void> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), task.timeout * 1000);

    let finalResponse: ProviderResponse | undefined;
    let errorMessage: string | undefined;

    try {
      const agentRequest: AgentRequest = {
        prompt: task.prompt,
        systemPrompt: task.systemPrompt,
        model: task.model,
        maxTokens: task.maxTokens,
        temperature: task.temperature,
        timeout: task.timeout,
      };

      const toolExecutor = this.toolRegistry ? this.toolRegistry.createExecutor() : undefined;
      if (toolExecutor && this.toolRegistry) {
        agentRequest.tools = this.toolRegistry.getDefinitions();
        agentRequest.maxTurns = agentRequest.maxTurns ?? 10;
      }

      for await (const event of provider.executeAgent!(agentRequest, abortController.signal, toolExecutor)) {
        this.eventBus.emit(task.id, event);
        this.eventStore.appendAgentEvent(task.id, event);

        if (event.type === "completed") {
          finalResponse = event.response;
          break;
        }
        if (event.type === "error") {
          errorMessage = event.error;
          break;
        }
      }
    } catch (err: unknown) {
      if (err instanceof TimeoutError) {
        this.store.updateStatus(task.id, "timed_out", { error: "Task exceeded timeout" });
        this.eventBus.emit(task.id, { type: "error", error: "Task exceeded timeout" });
        this.fireCallback(task, "timed_out");
        return;
      }
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timeoutId);
    }

    if (finalResponse) {
      this.store.updateStatus(task.id, "completed", {
        result: finalResponse.result,
        inputTokens: finalResponse.inputTokens,
        outputTokens: finalResponse.outputTokens,
        costUsd: finalResponse.costUsd,
      });
      this.fireCallback(task, "completed");
    } else if (errorMessage) {
      // Check retryability — errors from executeAgent may be generic strings
      // so we use the same logic as the legacy path
      const isAuthError = /authentication|permission|auth.*error|invalid.*api.*key/i.test(errorMessage);
      if (!isAuthError && task.retryCount < task.maxRetries) {
        const delay = calculateBackoff(task.retryCount, this.config.retryBackoff, this.config.retryDelay);
        this.store.updateStatus(task.id, "pending", {
          retryCount: task.retryCount + 1,
          nextRetryAt: Date.now() + delay,
        });
      } else {
        this.store.updateStatus(task.id, "failed", { error: errorMessage });
        this.fireCallback(task, "failed");
      }
    }
  }

  private async executeTaskLegacy(
    provider: ProviderAdapter,
    task: Task
  ): Promise<void> {
    try {
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
      await this.handleTaskError(task, message);
    }
  }

  private async handleTaskError(task: Task, message: string): Promise<void> {
    const retryable = this.isRetryable(new Error(message));

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
      if (["AuthenticationError", "PermissionDeniedError", "NotFoundError"].includes(name)) {
        return false;
      }
      if (/authentication|permission|auth.*error|invalid.*api.*key/i.test(error.message)) {
        return false;
      }
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
      // Fire-and-forget
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
