import type { NormalizedEvent, ToolKind } from "@prompt-retro/shared-types";
import { ensureAbsoluteProjectPath, nowIso, safeJsonParse, stringifyRecord } from "./utils.js";

interface CodexJsonLine {
  type?: string;
  role?: "user" | "assistant" | "system";
  content?: string;
  text?: string;
  message?: string;
  tool_name?: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
  file_path?: string;
  cwd?: string;
  session_id?: string;
  timestamp?: string;
}

export function createSessionStartedEvent(
  sessionId: string,
  tool: ToolKind,
  projectPath = process.cwd(),
  parentSessionId?: string
): NormalizedEvent {
  return {
    type: "session.started",
    sessionId,
    parentSessionId,
    projectPath: ensureAbsoluteProjectPath(projectPath),
    tool,
    timestamp: nowIso()
  };
}

export function createSessionEndedEvent(
  sessionId: string,
  tool: ToolKind,
  projectPath = process.cwd(),
  note?: string
): NormalizedEvent {
  return {
    type: "session.ended",
    sessionId,
    projectPath: ensureAbsoluteProjectPath(projectPath),
    tool,
    timestamp: nowIso(),
    status: "completed",
    outcomeTag: "unknown",
    note
  };
}

export function normalizeCodexJsonLine(
  line: string,
  sessionId: string,
  projectPath = process.cwd()
): NormalizedEvent[] {
  const parsed = safeJsonParse<CodexJsonLine>(line);
  if (!parsed) {
    return [];
  }

  const timestamp = parsed.timestamp ?? nowIso();
  const resolvedProjectPath = ensureAbsoluteProjectPath(parsed.cwd ?? projectPath);
  const events: NormalizedEvent[] = [];

  const textContent = parsed.content ?? parsed.text ?? parsed.message;
  if (parsed.role && textContent) {
    events.push({
      type: "turn.logged",
      sessionId,
      projectPath: resolvedProjectPath,
      tool: "codex",
      timestamp,
      role: parsed.role,
      content: textContent
    });
  }

  if (parsed.tool_name || parsed.tool) {
    events.push({
      type: "tool.logged",
      sessionId,
      projectPath: resolvedProjectPath,
      tool: "codex",
      timestamp,
      toolName: parsed.tool_name ?? parsed.tool ?? "unknown",
      input: stringifyRecord(parsed.input),
      output: stringifyRecord(parsed.output),
      filePath: parsed.file_path
    });
  }

  return events;
}

export interface ClaudeHookPayload {
  sessionId: string;
  parentSessionId?: string;
  projectPath?: string;
  timestamp?: string;
  prompt?: string;
  role?: "user" | "assistant" | "system" | "tool";
  toolName?: string;
  input?: unknown;
  output?: unknown;
  filePath?: string;
  note?: string;
  turnIndex?: number;
}

export function normalizeClaudeHookEvent(
  hookEvent: string,
  payload: ClaudeHookPayload
): NormalizedEvent[] {
  const projectPath = ensureAbsoluteProjectPath(payload.projectPath ?? process.cwd());
  const timestamp = payload.timestamp ?? nowIso();
  const base = {
    sessionId: payload.sessionId,
    parentSessionId: payload.parentSessionId,
    projectPath,
    tool: "claude-code" as const,
    timestamp
  };

  switch (hookEvent) {
    case "UserPromptSubmit":
      return [
        {
          type: "turn.logged",
          ...base,
          role: "user",
          content: payload.prompt ?? ""
        }
      ];
    case "PostToolUse":
      return [
        {
          type: "tool.logged",
          ...base,
          toolName: payload.toolName ?? "unknown",
          input: stringifyRecord(payload.input),
          output: stringifyRecord(payload.output),
          filePath: payload.filePath
        }
      ];
    case "Stop":
      return [
        {
          type: "session.ended",
          ...base,
          status: "completed",
          outcomeTag: "unknown",
          note: payload.note
        }
      ];
    case "SubagentStop":
      return [
        {
          type: "session.ended",
          ...base,
          status: "completed",
          outcomeTag: "unknown",
          note: payload.note
        }
      ];
    default:
      return [];
  }
}
