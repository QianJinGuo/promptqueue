import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createWriteFileTool, writeFile } from "../write-file.js";

const TEST_DIR = join(process.cwd(), ".test-write-file");

describe("write_file tool", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("writes content to a file", async () => {
    const filePath = join(TEST_DIR, "output.txt");
    const result = await writeFile({ path: filePath, content: "hello" });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(filePath, "utf-8")).toBe("hello");
  });

  it("creates parent directories", async () => {
    const filePath = join(TEST_DIR, "sub", "dir", "output.txt");
    const result = await writeFile({ path: filePath, content: "nested" });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(filePath, "utf-8")).toBe("nested");
  });

  it("rejects path traversal", async () => {
    const result = await writeFile({ path: "../../../tmp/evil.txt", content: "nope", allowedPaths: [TEST_DIR] });
    expect(result.isError).toBe(true);
  });

  it("enforces allowed_paths", async () => {
    const result = await writeFile({ path: join(TEST_DIR, "out.txt"), content: "x", allowedPaths: ["/other/dir"] });
    expect(result.isError).toBe(true);
  });

  it("rejects files over 1MB", async () => {
    const bigContent = "x".repeat(1024 * 1024 + 1);
    const result = await writeFile({ path: join(TEST_DIR, "big.txt"), content: bigContent });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("too large");
  });

  it("createWriteFileTool returns definition and executor", () => {
    const { definition, executor } = createWriteFileTool({ allowedPaths: [TEST_DIR] });
    expect(definition.name).toBe("write_file");
    expect(typeof executor).toBe("function");
  });
});