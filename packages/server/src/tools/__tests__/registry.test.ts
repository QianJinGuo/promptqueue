import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../registry.js";
import type { ToolDefinition, ToolResult, ToolConfig } from "@promptqueue/core";

const MOCK_CONFIG: ToolConfig = {
  allowed: ["read_file", "execute_command"],
  denied: ["execute_command:rm -rf"],
  maxTurns: 10,
  timeout: 5,
};

const READ_FILE_DEF: ToolDefinition = {
  name: "read_file",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } } },
};

const EXEC_CMD_DEF: ToolDefinition = {
  name: "execute_command",
  description: "Execute a command",
  parameters: { type: "object", properties: { command: { type: "string" } } },
};

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry(MOCK_CONFIG);
  });

  it("registers and retrieves tool definitions", () => {
    registry.register(READ_FILE_DEF, async () => ({ content: "ok" }));
    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]!.name).toBe("read_file");
  });

  it("isAllowed returns true for whitelisted tools", () => {
    registry.register(READ_FILE_DEF, async () => ({ content: "ok" }));
    expect(registry.isAllowed("read_file")).toBe(true);
  });

  it("isAllowed returns false for non-whitelisted tools", () => {
    expect(registry.isAllowed("write_file")).toBe(false);
  });

  it("isAllowed returns false for denied patterns", () => {
    expect(registry.isAllowed("execute_command:rm -rf /")).toBe(false);
  });

  it("isAllowed returns true for allowed but not denied", () => {
    expect(registry.isAllowed("execute_command:ls")).toBe(true);
  });

  it("isAllowed returns true when allowed list is empty (allow all)", () => {
    const openRegistry = new ToolRegistry({ ...MOCK_CONFIG, allowed: [] });
    openRegistry.register(READ_FILE_DEF, async () => ({ content: "ok" }));
    expect(openRegistry.isAllowed("read_file")).toBe(true);
  });

  it("execute calls the registered executor", async () => {
    registry.register(READ_FILE_DEF, async (args) => ({
      content: `read ${JSON.stringify(args)}`,
    }));
    const result = await registry.execute("read_file", { path: "/tmp/test.txt" });
    expect(result.content).toContain("/tmp/test.txt");
  });

  it("execute returns isError for non-allowed tools", async () => {
    const result = await registry.execute("write_file", {});
    expect(result.isError).toBe(true);
  });

  it("execute returns isError for unregistered tools", async () => {
    const result = await registry.execute("read_file", {});
    expect(result.isError).toBe(true);
  });

  it("execute respects timeout", async () => {
    registry.register(READ_FILE_DEF, async () => {
      await new Promise((r) => setTimeout(r, 10000));
      return { content: "too late" };
    });
    const result = await registry.execute("read_file", {});
    expect(result.isError).toBe(true);
  }, 10000);

  it("createExecutor returns a bound function", async () => {
    registry.register(READ_FILE_DEF, async (args) => ({
      content: `result for ${JSON.stringify(args)}`,
    }));
    const executor = registry.createExecutor();
    const result = await executor("read_file", { path: "/a" });
    expect(result.content).toContain("/a");
  });

  it("createExecutor returns isError for denied tools", async () => {
    registry.register(EXEC_CMD_DEF, async () => ({ content: "ok" }));
    const executor = registry.createExecutor();
    const result = await executor("execute_command:rm -rf /", {});
    expect(result.isError).toBe(true);
  });
});