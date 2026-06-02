export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export type ToolExecutorFn = (name: string, args: unknown) => Promise<ToolResult>;

export interface ToolConfig {
  allowed: string[];
  denied: string[];
  maxTurns: number;
  timeout: number;
  waitingForInputTimeout: number;
}