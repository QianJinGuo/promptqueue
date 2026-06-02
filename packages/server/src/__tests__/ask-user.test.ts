import { describe, it, expect, vi, beforeEach } from "vitest";
import { PendingInputStore } from "../tools/ask-user.js";

describe("PendingInputStore", () => {
  let store: PendingInputStore;

  beforeEach(() => {
    store = new PendingInputStore();
  });

  it("registers a pending input and resolves when resolve() is called", async () => {
    const promise = store.register("t_001", "Should I proceed?", undefined, 30);

    expect(store.get("t_001")).toBeDefined();
    expect(store.get("t_001")!.question).toBe("Should I proceed?");

    store.resolve("t_001", "Yes");

    const result = await promise;
    expect(result.content).toBe("Yes");
    expect(result.isError).toBeUndefined();
  });

  it("resolves with error on timeout", async () => {
    vi.useFakeTimers();
    const promise = store.register("t_002", "Quick question", undefined, 1);

    vi.advanceTimersByTime(1500);

    const result = await promise;
    expect(result.content).toBe("User did not respond within the timeout period.");
    expect(result.isError).toBe(true);

    vi.useRealTimers();
  });

  it("resolves with error on cancel", async () => {
    const promise = store.register("t_003", "Cancel me", undefined, 30);

    const cancelled = store.cancel("t_003");
    expect(cancelled).toBe(true);

    const result = await promise;
    expect(result.content).toBe("Input request was cancelled.");
    expect(result.isError).toBe(true);
  });

  it("returns false when resolving non-existent task", () => {
    const result = store.resolve("t_999", "Nope");
    expect(result).toBe(false);
  });

  it("returns false when cancelling non-existent task", () => {
    const result = store.cancel("t_999");
    expect(result).toBe(false);
  });

  it("cleans up after resolve", async () => {
    const promise = store.register("t_004", "Clean up test", undefined, 30);
    store.resolve("t_004", "Done");
    await promise;

    expect(store.get("t_004")).toBeUndefined();
  });
});
