import type { ToolDefinition, ToolResult } from "@promptqueue/core";
import { logger } from "../logging.js";

export const ASK_USER_DEFINITION: ToolDefinition = {
  name: "ask_user",
  description:
    "Ask the user a question and wait for their response. Use when you need clarification, confirmation, or approval before proceeding.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask the user",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional list of suggested responses the user can choose from",
      },
    },
    required: ["question"],
  },
};

export interface PendingInput {
  taskId: string;
  question: string;
  options?: string[];
  resolve: (result: ToolResult) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  createdAt: number;
}

export class PendingInputStore {
  private pending = new Map<string, PendingInput>();

  register(
    taskId: string,
    question: string,
    options: string[] | undefined,
    timeout: number
  ): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(taskId);
        logger.info(`ask_user timed out for task ${taskId}`);
        resolve({
          content: "User did not respond within the timeout period.",
          isError: true,
        });
      }, timeout * 1000);

      this.pending.set(taskId, {
        taskId,
        question,
        options,
        resolve,
        timeoutId,
        createdAt: Date.now(),
      });

      logger.info(`ask_user registered for task ${taskId}: ${question}`);
    });
  }

  resolve(taskId: string, response: string): boolean {
    const pending = this.pending.get(taskId);
    if (!pending) return false;

    clearTimeout(pending.timeoutId);
    this.pending.delete(taskId);
    pending.resolve({ content: response });
    logger.info(`ask_user resolved for task ${taskId}`);
    return true;
  }

  cancel(taskId: string): boolean {
    const pending = this.pending.get(taskId);
    if (!pending) return false;

    clearTimeout(pending.timeoutId);
    this.pending.delete(taskId);
    pending.resolve({
      content: "Input request was cancelled.",
      isError: true,
    });
    logger.info(`ask_user cancelled for task ${taskId}`);
    return true;
  }

  get(taskId: string): PendingInput | undefined {
    return this.pending.get(taskId);
  }
}

export interface AskUserDeps {
  pendingInputStore: PendingInputStore;
  taskStore: { updateStatus: (id: string, status: "waiting_for_input" | "running", payload?: Record<string, unknown>) => unknown };
  eventBus: { emit: (taskId: string, event: unknown) => void };
  releaseSlot: () => void;
  reclaimSlot: () => void;
  timeout: number;
}

export function createAskUserTool(
  deps: AskUserDeps
): { definition: ToolDefinition; executor: (args: unknown) => Promise<ToolResult> } {
  return {
    definition: ASK_USER_DEFINITION,
    executor: async (args: unknown): Promise<ToolResult> => {
      const { question, options } = args as {
        question: string;
        options?: string[];
      };

      const taskId = (args as { __taskId?: string }).__taskId;
      if (!taskId) {
        return { content: "No task context available for ask_user", isError: true };
      }

      deps.releaseSlot();

      deps.taskStore.updateStatus(taskId, "waiting_for_input", {});

      deps.eventBus.emit(taskId, {
        type: "tool_call",
        name: "ask_user",
        args: { question, options },
      });

      const result = await deps.pendingInputStore.register(
        taskId,
        question,
        options,
        deps.timeout
      );

      if (!result.isError) {
        deps.reclaimSlot();
        deps.taskStore.updateStatus(taskId, "running", {});
      }

      return result;
    },
  };
}
