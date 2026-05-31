import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderHealth } from "@promptqueue/core";

export class MockProvider implements ProviderAdapter {
  readonly name = "mock";
  readonly models = ["mock-model"];

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    return {
      result: `Mock response for: ${request.prompt}`,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.0,
      model: request.model,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      latencyMs: 0,
    };
  }
}
