import { describe, it, expect } from "vitest";
import type { ToolDefinition, ToolResult, ToolExecutorFn, ToolConfig } from "../types/tools.js";

describe("Tool types", () => {
  it("ToolDefinition has required fields", () => {
    const def: ToolDefinition = {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    };
    expect(def.name).toBe("read_file");
  });

  it("ToolResult has content and optional isError", () => {
    const ok: ToolResult = { content: "file contents" };
    const err: ToolResult = { content: "not found", isError: true };
    expect(ok.isError).toBeUndefined();
    expect(err.isError).toBe(true);
  });

  it("ToolExecutorFn is a function type", () => {
    const executor: ToolExecutorFn = async (name, args) => ({
      content: `${name} result`,
    });
    expect(typeof executor).toBe("function");
  });

  it("ToolConfig has governance fields", () => {
    const config: ToolConfig = {
      allowed: ["read_file"],
      denied: [],
      maxTurns: 10,
      timeout: 30,
    };
    expect(config.maxTurns).toBe(10);
  });
});