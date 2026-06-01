import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { ProviderRequest, ProviderResponse, AgentRequest, AgentEvent } from "@promptqueue/core";
import { CliProvider, type CliProviderConfig } from "./cli-provider.js";
import { logger } from "../logging.js";

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
      "--output-format", "stream-json",
      "--verbose",
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
    // Try parsing the last result line from stream-json output
    const lines = stdout.trim().split("\n").filter(l => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]!);
        if (obj.type === "result") {
          return {
            result: obj.result ?? stdout,
            inputTokens: obj.usage?.input_tokens ?? 0,
            outputTokens: obj.usage?.output_tokens ?? 0,
            costUsd: obj.cost_usd ?? 0,
            model: obj.model ?? this.config.defaultModel ?? "claude-sonnet-4-6",
          };
        }
      } catch { /* not JSON, continue */ }
    }
    // Fallback: try single JSON object
    try {
      const json = JSON.parse(stdout.trim());
      return {
        result: json.result ?? json.content ?? stdout,
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
        costUsd: json.cost_usd ?? 0,
        model: json.model ?? this.config.defaultModel ?? "claude-sonnet-4-6",
      };
    } catch {
      return { result: stdout, inputTokens: 0, outputTokens: 0, costUsd: 0, model: this.config.defaultModel ?? "claude-sonnet-4-6" };
    }
  }

  async *executeAgent(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const args = this.buildCommand(request);
    const timeoutMs = (request.timeout ?? this.config.defaultTimeout ?? 300) * 1000;

    const child = spawn(args[0]!, args.slice(1), {
      cwd: request.workingDirectory,
      timeout: timeoutMs,
      killSignal: "SIGTERM",
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    }) as unknown as ChildProcess;

    const abortHandler = () => {
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* already exited */ }
    }, timeoutMs);

    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    try {
      const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue; // skip non-JSON
        }

        const mapped = this.mapClaudeEvent(parsed);
        if (mapped) yield mapped;
      }

      // Wait for exit
      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", resolve);
        child.on("error", () => resolve(1));
      });

      if (timedOut) {
        yield { type: "error", error: "Task exceeded timeout" };
      } else if (exitCode !== 0 && stderr.trim()) {
        yield { type: "error", error: stderr.trim() };
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortHandler);
    }
  }

  private mapClaudeEvent(obj: Record<string, unknown>): AgentEvent | null {
    const type = obj.type as string;

    // assistant message with content blocks
    if (type === "assistant" && obj.message && typeof obj.message === "object") {
      const msg = obj.message as Record<string, unknown>;
      const content = msg.content;
      if (!Array.isArray(content)) return null;

      for (const block of content) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          return { type: "text", content: b.text };
        }
        if (b.type === "thinking" && typeof b.thinking === "string") {
          return { type: "text", content: b.thinking };
        }
        if (b.type === "tool_use") {
          return { type: "tool_call", name: String(b.name ?? "unknown"), args: b.input };
        }
      }
      return null;
    }

    // tool result
    if (type === "tool_result") {
      return { type: "tool_result", name: String(obj.tool_use_id ?? "unknown"), result: obj.content };
    }

    // final result
    if (type === "result") {
      if (obj.subtype === "error") {
        return { type: "error", error: String(obj.error ?? obj.result ?? "Unknown error") };
      }
      return {
        type: "completed",
        response: {
          result: String(obj.result ?? ""),
          inputTokens: (obj.usage as Record<string, unknown>)?.input_tokens as number ?? 0,
          outputTokens: (obj.usage as Record<string, unknown>)?.output_tokens as number ?? 0,
          costUsd: obj.cost_usd as number ?? 0,
          model: obj.model as string ?? this.config.defaultModel ?? "claude-sonnet-4-6",
        },
      };
    }

    // Skip system events (hook_started, hook_response, init, api_retry)
    return null;
  }
}
