import Anthropic from "@anthropic-ai/sdk";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderHealth } from "@promptqueue/core";
import { calculateCost } from "./pricing.js";

export interface AnthropicProviderConfig {
  apiKey: string;
  defaultModel?: string;
  baseURL?: string;
}

const SUPPORTED_MODELS = [
  "claude-opus-4-20250514",
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
  "claude-3-haiku-20240307",
] as const;

export class AnthropicProvider implements ProviderAdapter {
  readonly name = "anthropic";
  readonly models = SUPPORTED_MODELS;
  private client: Anthropic;

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const message = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: [{ role: "user", content: request.prompt }],
      system: request.systemPrompt ?? undefined,
      temperature: request.temperature,
    });

    const result = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;

    return {
      result,
      inputTokens,
      outputTokens,
      costUsd: calculateCost(request.model, inputTokens, outputTokens),
      model: message.model,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
      return {
        status: "healthy",
        latencyMs: Date.now() - start,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "down",
        latencyMs: Date.now() - start,
        details: message,
      };
    }
  }
}
