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

    // Note: don't pass `timeout` to spawn — Node's spawn-kill and our
    // manual SIGTERM timer can race on some Node versions (CI ubuntu
    // + Node 20), leaving the test blocked on the natural exit of
    // `sleep 60`. Manual timer alone is the reliable signal.
    //
    // `detached: true` puts the child in its own process group so we
    // can kill the whole group (sh + its sleep grandchild) with
    // process.kill(-pid, signal). Without this, killing `sh` on
    // ubuntu leaves the `sleep` grandchild orphaned and unkillable,
    // and the test hangs for 60s.
    const child = spawn("sh", ["-c", command], { detached: true });

    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the whole process group: sh + its sleep grandchild.
      // On ubuntu, dash (the default /bin/sh) ignores SIGTERM but
      // the process group kill still goes through. Escalate to
      // SIGKILL if SIGTERM doesn't take effect within 200ms.
      try { process.kill(-child.pid!, "SIGTERM"); } catch { /* already exited */ }
      setTimeout(() => {
        try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already exited */ }
      }, 200).unref();
    }, timeoutMs);

    child.on("close", (code: number | null) => {
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