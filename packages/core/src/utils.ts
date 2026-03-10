import crypto from "node:crypto";
import path from "node:path";

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function ensureAbsoluteProjectPath(projectPath?: string): string {
  return path.resolve(projectPath ?? process.cwd());
}

export function safeJsonParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function stringifyRecord(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}
