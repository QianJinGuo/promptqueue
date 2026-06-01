import type { ToolDefinition, ToolResult, ToolExecutorFn, ToolConfig } from "@promptqueue/core";
import { logger } from "../logging.js";

interface RegisteredTool {
  definition: ToolDefinition;
  executor: (args: unknown) => Promise<ToolResult>;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  constructor(private config: ToolConfig) {}

  register(definition: ToolDefinition, executor: (args: unknown) => Promise<ToolResult>): void {
    this.tools.set(definition.name, { definition, executor });
    logger.info(`Registered tool: ${definition.name}`);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => this.isAllowed(t.definition.name))
      .map((t) => t.definition);
  }

  isAllowed(name: string): boolean {
    for (const pattern of this.config.denied) {
      if (name === pattern || name.startsWith(pattern)) {
        return false;
      }
    }

    if (this.config.allowed.length === 0) {
      return this.tools.has(name.split(":")[0]!);
    }

    const baseName = name.includes(":") ? name.split(":")[0]! : name;
    return this.config.allowed.includes(baseName);
  }

  async execute(name: string, args: unknown): Promise<ToolResult> {
    if (!this.isAllowed(name)) {
      return { content: `Tool "${name}" is not allowed`, isError: true };
    }

    const baseName = name.includes(":") ? name.split(":")[0]! : name;
    const tool = this.tools.get(baseName);
    if (!tool) {
      return { content: `Tool "${baseName}" is not registered`, isError: true };
    }

    const timeoutMs = this.config.timeout * 1000;
    try {
      const result = await Promise.race([
        tool.executor(args),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${baseName}" timed out after ${this.config.timeout}s`)), timeoutMs)
        ),
      ]);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Tool "${baseName}" error: ${message}`);
      return { content: message, isError: true };
    }
  }

  createExecutor(): ToolExecutorFn {
    return async (name: string, args: unknown) => this.execute(name, args);
  }
}