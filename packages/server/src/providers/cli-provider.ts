import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderHealth, AgentRequest, AgentEvent } from "@promptqueue/core";
import { logger } from "../logging.js";

export interface CliProviderConfig {
  command: string;
  defaultModel?: string;
  baseURL?: string;
  defaultTimeout?: number;
}

export abstract class CliProvider implements ProviderAdapter {
  abstract readonly name: string;
  abstract readonly models: readonly string[];

  protected abstract buildCommand(request: ProviderRequest): string[];
  protected abstract parseOutput(stdout: string): ProviderResponse;

  constructor(protected config: CliProviderConfig) {}

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const events = this.executeAgent(request);
    let finalResponse: ProviderResponse | undefined;

    for await (const event of events) {
      if (event.type === "completed") {
        finalResponse = event.response;
      }
    }

    if (!finalResponse) {
      throw new Error("CLI provider did not produce a completed event");
    }

    return finalResponse;
  }

  async *executeAgent(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const args = this.buildCommand(request);
    const timeoutMs = (request.timeout ?? this.config.defaultTimeout ?? 300) * 1000;

    if (args.length === 0) {
      yield { type: "error", error: "buildCommand returned empty command array" };
      return;
    }

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
    let rawStdout = "";
    let yieldedEvents = false;
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.stdout?.on("data", (data: Buffer) => {
      rawStdout += data.toString();
    });

    try {
      const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object" && "type" in parsed) {
            yieldedEvents = true;
            yield parsed as AgentEvent;
          }
        } catch {
          // Non-JSON line — skip, will fall back to parseOutput if no events
        }
      }

      // Wait for process exit after stdout closes
      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", resolve);
        child.on("error", () => resolve(1));
      });

      if (timedOut) {
        yield { type: "error", error: "Task exceeded timeout" };
      } else if (exitCode !== 0) {
        const errorMsg = stderr.trim() || `Process exited with code ${exitCode}`;
        yield { type: "error", error: errorMsg };
      } else if (!yieldedEvents && rawStdout.trim()) {
        // Stdout wasn't NDJSON — fall back to parseOutput
        try {
          const response = this.parseOutput(rawStdout);
          yield { type: "completed", response };
        } catch {
          yield { type: "error", error: "Failed to parse command output" };
        }
      }

      if (stderr.trim()) {
        logger.info(`CLI provider stderr: ${stderr.trim()}`);
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortHandler);
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const child = spawn(this.config.command, ["--version"], { timeout: 5000 });
      const result = await collectOutput(child, 5000);

      if (result.exitCode === 0) {
        return { status: "healthy", latencyMs: Date.now() - start };
      }
      return { status: "down", latencyMs: Date.now() - start, details: `Exit code ${result.exitCode}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: "down", latencyMs: Date.now() - start, details: message };
    }
  }
}

interface CollectedOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

function collectOutput(child: ChildProcess, timeoutMs: number): Promise<CollectedOutput> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* already exited */ }
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (stderr.trim()) {
        logger.info(`CLI provider stderr: ${stderr.trim()}`);
      }
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: 1, timedOut: false });
    });
  });
}
