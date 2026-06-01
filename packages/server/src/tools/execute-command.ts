import { spawn } from "node:child_process";
import type { ToolDefinition, ToolResult } from "@promptqueue/core";

export const EXECUTE_COMMAND_DEFINITION: ToolDefinition = {
  name: "execute_command",
  description: "Execute a shell command and return stdout and stderr",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
      timeout: { type: "number", description: "Timeout in seconds (default 30)" },
    },
    required: ["command"],
  },
};

export async function executeCommand(args: {
  command: string;
  timeout?: number;
  allowedCommands?: string[];
}): Promise<ToolResult> {
  const { command, timeout = 30, allowedCommands } = args;

  if (allowedCommands && allowedCommands.length > 0) {
    const binary = command.trim().split(/\s+/)[0]!;
    if (!allowedCommands.includes(binary)) {
      return { content: `Command "${binary}" is not allowed: ${allowedCommands.join(", ")}`, isError: true };
    }
  }

  return new Promise((resolve) => {
    const timeoutMs = timeout * 1000;
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn("sh", ["-c", command], { timeout: timeoutMs });

    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* already exited */ }
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ content: `Command timed out after ${timeout}s\n${stdout}`, isError: true });
      } else if (code !== 0) {
        resolve({ content: stderr.trim() || `Exit code ${code}\n${stdout}`, isError: true });
      } else {
        const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
        resolve({ content: output });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ content: err.message, isError: true });
    });
  });
}

export function createExecuteCommandTool(config?: { allowedCommands?: string[] }) {
  return {
    definition: EXECUTE_COMMAND_DEFINITION,
    executor: async (args: unknown) => {
      const typed = args as { command: string; timeout?: number };
      return executeCommand({
        command: typed.command,
        timeout: typed.timeout,
        allowedCommands: config?.allowedCommands,
      });
    },
  };
}