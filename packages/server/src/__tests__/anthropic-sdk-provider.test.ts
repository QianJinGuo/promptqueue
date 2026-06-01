import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicSDKProvider } from "../providers/anthropic-sdk.js";
import type { ToolExecutorFn } from "@promptqueue/core";

describe("AnthropicSDKProvider", () => {
  let provider: AnthropicSDKProvider;

  beforeEach(() => {
    provider = new AnthropicSDKProvider({
      apiKey: "test-key",
      defaultModel: "claude-sonnet-4-6",
    });
  });

  it("has correct name and models", () => {
    expect(provider.name).toBe("anthropic-sdk");
    expect(provider.models).toContain("claude-sonnet-4-6");
    expect(provider.models).toContain("claude-opus-4-7");
  });

  it("healthCheck returns down without valid API key", async () => {
    const health = await provider.healthCheck();
    expect(health.status).toBe("down");
  });
});