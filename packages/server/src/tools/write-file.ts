import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { ToolDefinition, ToolResult } from "@promptqueue/core";

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export const WRITE_FILE_DEFINITION: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  },
};

function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return true;
  const resolved = resolve(filePath);
  return allowedPaths.some((allowed) => resolved.startsWith(resolve(allowed)));
}

export async function writeFile(args: {
  path: string;
  content: string;
  allowedPaths?: string[];
}): Promise<ToolResult> {
  const { path, content, allowedPaths = [] } = args;

  const resolved = resolve(path);

  if (allowedPaths.length > 0 && !isPathAllowed(resolved, allowedPaths)) {
    return { content: `Path "${path}" is not in allowed directories`, isError: true };
  }

  if (content.length > MAX_FILE_SIZE) {
    return { content: `Content too large (${content.length} bytes, max ${MAX_FILE_SIZE} bytes)`, isError: true };
  }

  try {
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, content, "utf-8");
    return { content: `Wrote ${content.length} bytes to ${path}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: message, isError: true };
  }
}

export function createWriteFileTool(config?: { allowedPaths?: string[] }) {
  return {
    definition: WRITE_FILE_DEFINITION,
    executor: async (args: unknown) => {
      const typed = args as { path: string; content: string };
      return writeFile({
        path: typed.path,
        content: typed.content,
        allowedPaths: config?.allowedPaths,
      });
    },
  };
}