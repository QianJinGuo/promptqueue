import OpenAI from "openai";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderHealth } from "@promptqueue/core";
import { calculateCost } from "./pricing.js";

export interface OpenAIProviderConfig {
  apiKey: string;
  defaultModel?: string;
  baseURL?: string;
}

const SUPPORTED_MODELS = [
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "o3",
  "o3-mini",
  "o4-mini",
  "gpt-4-turbo",
  "gpt-3.5-turbo",
] as const;

export class OpenAIProvider implements ProviderAdapter {
  readonly name = "openai";
  readonly models = SUPPORTED_MODELS;
  private client: OpenAI;

  constructor(config: OpenAIProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }

    messages.push({ role: "user", content: request.prompt });

    const completion = await this.client.chat.completions.create({
      model: request.model,
      messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
    });

    const choice = completion.choices[0];
    const result = choice?.message?.content ?? "";

    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;

    return {
      result,
      inputTokens,
      outputTokens,
      costUsd: calculateCost(request.model, inputTokens, outputTokens),
      model: completion.model,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.client.chat.completions.create({
        model: "gpt-4o-mini",
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
