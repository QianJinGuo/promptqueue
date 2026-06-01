import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { EventStore } from "../storage/event-store.js";
import type { EventBus } from "../worker/event-bus.js";
import type { AgentEvent } from "@promptqueue/core";

interface Env {
  Variables: {
    eventStore: EventStore;
    eventBus: EventBus;
  };
}

const events = new Hono<Env>();

events.get("/:taskId/events", async (c) => {
  const { taskId } = c.req.param();
  const eventStore = c.get("eventStore");
  const eventBus = c.get("eventBus");

  return streamSSE(c, async (stream) => {
    // Send all existing (persisted) events first — historical backfill
    const existingEvents = eventStore.getByTaskId(taskId);
    for (const event of existingEvents) {
      await stream.writeSSE({
        event: event.eventType,
        data: JSON.stringify(event),
      });
    }

    // Subscribe to real-time events via EventBus.
    // Normalize AgentEvent → TaskEvent-style SSE payload so dashboard
    // (which renders `event.payload.{name|content|args|result}`) shows
    // a consistent shape for both historical and real-time events.
    const unsubscribe = eventBus.subscribe(taskId, (agentEvent: AgentEvent) => {
      const sseEventType = agentEvent.type === "completed" ? "completed"
        : agentEvent.type === "error" ? "failed"
        : `agent_${agentEvent.type}`;

      let taskPayload: Record<string, unknown> = {};
      if (agentEvent.type === "text") {
        taskPayload = { content: agentEvent.content };
      } else if (agentEvent.type === "tool_call") {
        taskPayload = { name: agentEvent.name, args: agentEvent.args };
      } else if (agentEvent.type === "tool_result") {
        taskPayload = { name: agentEvent.name, result: agentEvent.result };
      } else if (agentEvent.type === "completed") {
        taskPayload = agentEvent.response as Record<string, unknown>;
      } else if (agentEvent.type === "error") {
        taskPayload = { error: agentEvent.error };
      }

      const taskEvent = {
        eventType: sseEventType,
        payload: taskPayload,
        createdAt: new Date().toISOString(),
      };

      stream.writeSSE({
        event: sseEventType,
        data: JSON.stringify(taskEvent),
      }).catch(() => {
        // Stream already closed
        unsubscribe();
      });
    });

    stream.onAbort(() => {
      unsubscribe();
    });

    // Keep-alive: prevent proxy timeouts
    while (true) {
      await stream.sleep(30000);
      try {
        await stream.writeSSE({ event: "keepalive", data: "" });
      } catch {
        break;
      }
    }
  });
});

export { events };
