import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolDefinition, ToolResult } from "@promptqueue/core";

export const READ_FILE_DEFINITION: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to read" },
      offset: { type: "number", description: "Line number to start from (0-based)" },
      limit: { type: "number", description: "Maximum number of lines to read" },
    },
    required: ["path"],
  },
};

function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return true;
  const resolved = resolve(filePath);
  return allowedPaths.some((allowed) => resolved.startsWith(resolve(allowed)));
}

export async function readFile(args: {
  path: string;
  offset?: number;
  limit?: number;
  allowedPaths?: string[];
}): Promise<ToolResult> {
  const { path, offset = 0, limit, allowedPaths = [] } = args;

  const resolved = resolve(path);

  if (allowedPaths.length > 0 && !isPathAllowed(resolved, allowedPaths)) {
    return { content: `Path "${path}" is not in allowed directories`, isError: true };
  }

  try {
    const content = readFileSync(resolved, "utf-8");
    const lines = content.split("\n");
    const sliced = lines.slice(offset, limit ? offset + limit : undefined);
    return { content: sliced.join("\n") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: message, isError: true };
  }
}

export function createReadFileTool(config?: { allowedPaths?: string[] }) {
  return {
    definition: READ_FILE_DEFINITION,
    executor: async (args: unknown) => {
      const typed = args as { path: string; offset?: number; limit?: number };
      return readFile({
        path: typed.path,
        offset: typed.offset,
        limit: typed.limit,
        allowedPaths: config?.allowedPaths,
      });
    },
  };
}