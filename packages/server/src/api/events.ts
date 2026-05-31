import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { EventStore } from "../storage/event-store.js";

interface Env {
  Variables: {
    eventStore: EventStore;
  };
}

const events = new Hono<Env>();

events.get("/:taskId/events", async (c) => {
  const { taskId } = c.req.param();
  const eventStore = c.get("eventStore");

  return streamSSE(c, async (stream) => {
    const existingEvents = eventStore.getByTaskId(taskId);
    for (const event of existingEvents) {
      await stream.writeSSE({
        event: event.eventType,
        data: JSON.stringify(event),
      });
    }

    const pollInterval = setInterval(() => {
      const currentEvents = eventStore.getByTaskId(taskId);
      const newEvents = currentEvents.slice(existingEvents.length);
      for (const event of newEvents) {
        stream.writeSSE({
          event: event.eventType,
          data: JSON.stringify(event),
        });
      }
      existingEvents.length = 0;
      existingEvents.push(...currentEvents);
    }, 1000);

    stream.onAbort(() => {
      clearInterval(pollInterval);
    });

    while (true) {
      await stream.sleep(1000);
    }
  });
});

export { events };
