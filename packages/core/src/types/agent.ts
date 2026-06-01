import type { ToolDefinition } from "./tools.js";
export type { ToolDefinition };

export interface AgentRequest {
  prompt: string;
  systemPrompt?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
  tools?: ToolDefinition[];
  maxTurns?: number;
  workingDirectory?: string;
  timeout?: number;
}

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "completed"; response: { result: string; inputTokens: number; outputTokens: number; costUsd: number; model: string } }
  | { type: "error"; error: string };
