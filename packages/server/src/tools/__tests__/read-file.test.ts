import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createReadFileTool, readFile } from "../read-file.js";

const TEST_DIR = join(process.cwd(), ".test-read-file");

describe("read_file tool", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, "test.txt"), "hello world\nline 2\nline 3");
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("reads a file and returns contents", async () => {
    const result = await readFile({ path: join(TEST_DIR, "test.txt") });
    expect(result.content).toContain("hello world");
    expect(result.isError).toBeUndefined();
  });

  it("returns error for non-existent file", async () => {
    const result = await readFile({ path: join(TEST_DIR, "nope.txt") });
    expect(result.isError).toBe(true);
  });

  it("supports offset and limit", async () => {
    const result = await readFile({ path: join(TEST_DIR, "test.txt"), offset: 1, limit: 1 });
    expect(result.content).toContain("line 2");
    expect(result.content).not.toContain("line 3");
  });

  it("rejects path traversal", async () => {
    const result = await readFile({ path: "../../../etc/passwd", allowedPaths: [TEST_DIR] });
    expect(result.isError).toBe(true);
  });

  it("enforces allowed_paths", async () => {
    const result = await readFile({ path: join(TEST_DIR, "test.txt"), allowedPaths: ["/other/dir"] });
    expect(result.isError).toBe(true);
  });

  it("createReadFileTool returns definition and executor", () => {
    const { definition, executor } = createReadFileTool({ allowedPaths: [TEST_DIR] });
    expect(definition.name).toBe("read_file");
    expect(typeof executor).toBe("function");
  });
});