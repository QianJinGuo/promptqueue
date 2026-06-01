import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AppConfig } from "@promptqueue/core";
import { configSchema, DEFAULT_CONFIG } from "@promptqueue/core";

const DEFAULT_CONFIG_PATHS = [
  join(process.cwd(), "promptqueue.config.yaml"),
  join(process.cwd(), "promptqueue.config.yml"),
  join(homedir(), ".promptqueue", "config.yaml"),
  join(homedir(), ".promptqueue", "config.yml"),
];

function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, varName: string) => {
    return process.env[varName] ?? "";
  });
}

function deepInterpolate(obj: unknown): unknown {
  if (typeof obj === "string") {
    return interpolateEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(deepInterpolate);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepInterpolate(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(configPath?: string): AppConfig {
  let rawConfig: Record<string, unknown> = {};

  const resolvedPath = configPath ?? findConfigFile();

  if (resolvedPath && existsSync(resolvedPath)) {
    const content = readFileSync(resolvedPath, "utf-8");
    rawConfig = parseYaml(content);
  }

  const interpolated = deepInterpolate(rawConfig) as Record<string, unknown>;

  const merged = deepMerge(DEFAULT_CONFIG, interpolated);

  return configSchema.parse(merged);
}

function findConfigFile(): string | undefined {
  for (const path of DEFAULT_CONFIG_PATHS) {
    if (existsSync(path)) return path;
  }
  return undefined;
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] !== null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function parseYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [
    { obj: result, indent: -1 },
  ];

  for (const line of content.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.search(/\S/);
    const match = trimmed.trimStart().match(/^(\w[\w-]*):\s*(.*)$/);
    if (!match) continue;

    const [, key, value] = match;

    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1]!.obj;

    if (value === "" || value === undefined) {
      const nested: Record<string, unknown> = {};
      current[key!] = nested;
      stack.push({ obj: nested, indent });
    } else {
      current[key!] = parseValue(value!);
    }
  }

  return result;
}

function parseValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) {
    return value.slice(1, -1);
  }
  return value;
}

export { deepMerge, interpolateEnvVars, parseYaml };
