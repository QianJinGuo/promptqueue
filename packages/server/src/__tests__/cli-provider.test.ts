import { describe, it, expect } from "vitest";
import type { ProviderRequest, ProviderResponse } from "@promptqueue/core";
import { CliProvider, type CliProviderConfig } from "../providers/cli-provider.js";

class EchoProvider extends CliProvider {
  readonly name = "echo";
  readonly models = ["echo-model"] as const;

  protected buildCommand(request: ProviderRequest): string[] {
    return ["echo", JSON.stringify({ result: request.prompt, tokens: 10 })];
  }

  protected parseOutput(stdout: string): ProviderResponse {
    const json = JSON.parse(stdout.trim());
    return {
      result: json.result,
      inputTokens: json.tokens,
      outputTokens: json.tokens,
      costUsd: 0,
      model: "echo-model",
    };
  }
}

class SleepProvider extends CliProvider {
  readonly name = "sleep";
  readonly models = ["sleep-model"] as const;

  protected buildCommand(): string[] {
    return ["sleep", "30"];
  }

  protected parseOutput(): ProviderResponse {
    return { result: "", inputTokens: 0, outputTokens: 0, costUsd: 0, model: "sleep-model" };
  }
}

class FailProvider extends CliProvider {
  readonly name = "fail";
  readonly models = ["fail-model"] as const;

  protected buildCommand(): string[] {
    return ["sh", "-c", "echo 'fatal error' >&2 && exit 1"];
  }

  protected parseOutput(): ProviderResponse {
    return { result: "", inputTokens: 0, outputTokens: 0, costUsd: 0, model: "fail-model" };
  }
}

describe("CliProvider", () => {
  const config: CliProviderConfig = { command: "echo" };

  it("executes a command and parses output", async () => {
    const provider = new EchoProvider(config);
    const result = await provider.execute({
      prompt: "hello world",
      model: "echo-model",
    });

    expect(result.result).toBe("hello world");
    expect(result.inputTokens).toBe(10);
  });

  it("times out when command takes too long", async () => {
    const provider = new SleepProvider(config);
    const events: unknown[] = [];

    for await (const event of provider.executeAgent({
      prompt: "test",
      model: "sleep-model",
      timeout: 1,
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "error", error: expect.stringContaining("timeout") });
  });

  it("reports error on non-zero exit code", async () => {
    const provider = new FailProvider(config);
    const events: unknown[] = [];

    for await (const event of provider.executeAgent({
      prompt: "test",
      model: "fail-model",
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "error", error: expect.any(String) });
  });

  it("health check returns healthy for available command", async () => {
    const provider = new EchoProvider(config);
    const health = await provider.healthCheck();
    expect(health.status).toBe("healthy");
  });

  it("health check returns down for missing command", async () => {
    const provider = new EchoProvider({ command: "nonexistent-command-xyz" });
    const health = await provider.healthCheck();
    expect(health.status).toBe("down");
  });

  it("streams completed event on success", async () => {
    const provider = new EchoProvider(config);
    const events: unknown[] = [];

    for await (const event of provider.executeAgent({
      prompt: "stream test",
      model: "echo-model",
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    const completed = events[0] as { type: string; response: ProviderResponse };
    expect(completed.type).toBe("completed");
    expect(completed.response.result).toBe("stream test");
  });
});
