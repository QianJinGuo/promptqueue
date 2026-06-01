import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIProvider } from "../providers/openai.js";

vi.mock("openai", () => {
  const mockCreate = vi.fn();
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
  return { default: MockOpenAI, __mockCreate: mockCreate };
});

describe("OpenAIProvider", () => {
  let provider: OpenAIProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = (await import("openai")) as unknown as {
      __mockCreate: ReturnType<typeof vi.fn>;
    };
    mockCreate = mod.__mockCreate;
    mockCreate.mockReset();
    provider = new OpenAIProvider({ apiKey: "test-key" });
  });

  it("executes a prompt and returns structured response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Hello world" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: "gpt-4o",
    });

    const result = await provider.execute({
      prompt: "Say hello",
      model: "gpt-4o",
    });

    expect(result.result).toBe("Hello world");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
  });

  it("reports healthy on successful health check", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: "gpt-4o-mini",
    });

    const health = await provider.healthCheck();
    expect(health.status).toBe("healthy");
  });

  it("reports down on authentication error", async () => {
    const authError = new Error("Invalid API key");
    authError.name = "AuthenticationError";
    mockCreate.mockRejectedValue(authError);

    const health = await provider.healthCheck();
    expect(health.status).toBe("down");
  });

  it("lists supported models", () => {
    expect(provider.models).toContain("gpt-4o");
    expect(provider.name).toBe("openai");
  });
});
