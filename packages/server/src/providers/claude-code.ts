import type { ProviderRequest, ProviderResponse } from "@promptqueue/core";
import { CliProvider, type CliProviderConfig } from "./cli-provider.js";

const CLAUDE_CODE_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const;

export class ClaudeCodeProvider extends CliProvider {
  readonly name = "claude-code";
  readonly models = CLAUDE_CODE_MODELS;

  constructor(config: CliProviderConfig) {
    super(config);
  }

  protected buildCommand(request: ProviderRequest): string[] {
    const args = [
      this.config.command,
      "-p", request.prompt,
      "--model", request.model,
      "--output-format", "json",
    ];

    if (request.systemPrompt) {
      args.push("--system-prompt", request.systemPrompt);
    }

    if (request.maxTokens) {
      args.push("--max-tokens", String(request.maxTokens));
    }

    return args;
  }

  protected parseOutput(stdout: string): ProviderResponse {
    const json = JSON.parse(stdout.trim());
    return {
      result: json.result ?? json.content ?? stdout,
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      costUsd: json.cost_usd ?? 0,
      model: json.model ?? this.config.defaultModel ?? "claude-sonnet-4-6",
    };
  }
}
