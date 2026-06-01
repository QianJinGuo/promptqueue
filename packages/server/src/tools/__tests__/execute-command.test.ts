import { describe, it, expect } from "vitest";
import { createExecuteCommandTool, executeCommand } from "../execute-command.js";

describe("execute_command tool", () => {
  it("executes a command and returns stdout", async () => {
    const result = await executeCommand({ command: "echo hello" });
    expect(result.content).toContain("hello");
    expect(result.isError).toBeUndefined();
  });

  it("returns isError for non-zero exit codes", async () => {
    const result = await executeCommand({ command: "exit 1" });
    expect(result.isError).toBe(true);
  });

  it("captures stderr", async () => {
    const result = await executeCommand({ command: "echo error >&2" });
    expect(result.content).toContain("error");
  });

  it("respects timeout", async () => {
    const result = await executeCommand({ command: "sleep 60", timeout: 1 });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("timed out");
  }, 10000);

  it("createExecuteCommandTool returns definition and executor", () => {
    const { definition, executor } = createExecuteCommandTool();
    expect(definition.name).toBe("execute_command");
    expect(typeof executor).toBe("function");
  });

  it("executor rejects commands not in allowed list", async () => {
    const { executor } = createExecuteCommandTool({ allowedCommands: ["ls", "cat"] });
    const result = await executor({ command: "rm -rf /" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not allowed");
  });
});