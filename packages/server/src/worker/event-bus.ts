import type { AgentEvent } from "@promptqueue/core";

export type AgentEventListener = (event: AgentEvent) => void;

export class EventBus {
  private taskListeners = new Map<string, Set<AgentEventListener>>();

  subscribe(taskId: string, listener: AgentEventListener): () => void {
    if (!this.taskListeners.has(taskId)) {
      this.taskListeners.set(taskId, new Set());
    }
    this.taskListeners.get(taskId)!.add(listener);
    return () => {
      this.taskListeners.get(taskId)?.delete(listener);
      if (this.taskListeners.get(taskId)?.size === 0) {
        this.taskListeners.delete(taskId);
      }
    };
  }

  emit(taskId: string, event: unknown): void {
    const listeners = this.taskListeners.get(taskId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event as AgentEvent);
        } catch {
          // Isolate listener failures
        }
      }
    }
  }

  removeAllListeners(taskId: string): void {
    this.taskListeners.delete(taskId);
  }
}
