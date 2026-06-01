import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicProvider } from "../providers/anthropic.js";

vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  return { default: MockAnthropic, __mockCreate: mockCreate };
});

describe("AnthropicProvider", () => {
  let provider: AnthropicProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = (await import("@anthropic-ai/sdk")) as unknown as {
      __mockCreate: ReturnType<typeof vi.fn>;
    };
    mockCreate = mod.__mockCreate;
    mockCreate.mockReset();
    provider = new AnthropicProvider({ apiKey: "test-key" });
  });

  it("executes a prompt and returns structured response", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello world" }],
      usage: { input_tokens: 10, output_tokens: 5 },
      model: "claude-sonnet-4-6",
    });

    const result = await provider.execute({
      prompt: "Say hello",
      model: "claude-sonnet-4-6",
    });

    expect(result.result).toBe("Hello world");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
  });

  it("includes system prompt when provided", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Response" }],
      usage: { input_tokens: 15, output_tokens: 3 },
      model: "claude-sonnet-4-6",
    });

    await provider.execute({
      prompt: "Test",
      model: "claude-sonnet-4-6",
      systemPrompt: "You are a helper",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "You are a helper",
      })
    );
  });

  it("reports healthy on successful health check", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: "claude-haiku-4-5-20251001",
    });

    const health = await provider.healthCheck();
    expect(health.status).toBe("healthy");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports down on authentication error", async () => {
    const authError = new Error("Invalid API key");
    authError.name = "AuthenticationError";
    mockCreate.mockRejectedValue(authError);

    const health = await provider.healthCheck();
    expect(health.status).toBe("down");
    expect(health.details).toContain("Invalid API key");
  });

  it("lists supported models", () => {
    expect(provider.models).toContain("claude-sonnet-4-6");
    expect(provider.models).toContain("claude-opus-4-20250514");
    expect(provider.name).toBe("anthropic");
  });
});
