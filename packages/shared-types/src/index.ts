export type ToolKind = "claude-code" | "codex";

export type SessionStatus = "active" | "completed" | "failed";

export type OutcomeTag = "success" | "partial" | "failed" | "unknown";

export interface SessionRecord {
  id: string;
  parentSessionId?: string | undefined;
  projectPath: string;
  tool: ToolKind;
  startedAt: string;
  endedAt?: string | undefined;
  status: SessionStatus;
  outcomeTag: OutcomeTag;
  note?: string | undefined;
  meta?: Record<string, unknown> | undefined;
}

export interface TurnRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  turnIndex: number;
  meta?: Record<string, unknown> | undefined;
}

export interface ToolCallRecord {
  id: string;
  sessionId: string;
  turnId?: string | undefined;
  toolName: string;
  input?: string | undefined;
  output?: string | undefined;
  filePath?: string | undefined;
  timestamp: string;
  meta?: Record<string, unknown> | undefined;
}

export interface CorrectionRecord {
  id: string;
  sessionId: string;
  turnIndex: number;
  note: string;
  timestamp: string;
  source: "manual" | "auto";
  patternIds: string[];
}

export interface PatternMatch {
  patternId: string;
  name: string;
  category: string;
  severity: "low" | "medium" | "high";
  reason: string;
}

export interface PatternRecord {
  id: string;
  name: string;
  category: string;
  description: string;
  severity: "low" | "medium" | "high";
  toolAffinity: ToolKind[];
  count: number;
}

export interface RetroActionSuggestion {
  kind: "rule" | "hook" | "playbook";
  title: string;
  content: string;
  source: "deterministic" | "llm";
}

export interface RetroMetrics {
  turnCount: number;
  toolCallCount: number;
  correctionCount: number;
  totalDurationMs: number;
  filesTouched: string[];
  toolUsage: Record<string, number>;
  errorSignals: string[];
}

export interface RetroInsight {
  summary: string;
  whatWorked: string[];
  whatToImprove: string[];
  suggestions: RetroActionSuggestion[];
}

export interface RetroReportRecord {
  id: string;
  sessionIds: string[];
  createdAt: string;
  factual: RetroMetrics;
  patterns: PatternMatch[];
  insights?: RetroInsight | undefined;
  actions: RetroActionSuggestion[];
}

export interface PlaybookEntry {
  id: string;
  taskType: string;
  promptTemplate: string;
  successRate: number;
  sourceRetroId: string;
}

export interface SessionBundle {
  session: SessionRecord;
  turns: TurnRecord[];
  toolCalls: ToolCallRecord[];
  corrections: CorrectionRecord[];
  reports: RetroReportRecord[];
}

export interface NormalizedEventBase {
  sessionId: string;
  projectPath: string;
  tool: ToolKind;
  timestamp: string;
  parentSessionId?: string | undefined;
  meta?: Record<string, unknown> | undefined;
}

export interface SessionStartedEvent extends NormalizedEventBase {
  type: "session.started";
}

export interface SessionEndedEvent extends NormalizedEventBase {
  type: "session.ended";
  status?: SessionStatus | undefined;
  outcomeTag?: OutcomeTag | undefined;
  note?: string | undefined;
}

export interface TurnLoggedEvent extends NormalizedEventBase {
  type: "turn.logged";
  role: TurnRecord["role"];
  content: string;
}

export interface ToolCallLoggedEvent extends NormalizedEventBase {
  type: "tool.logged";
  turnId?: string | undefined;
  toolName: string;
  input?: string | undefined;
  output?: string | undefined;
  filePath?: string | undefined;
}

export interface CorrectionLoggedEvent extends NormalizedEventBase {
  type: "correction.logged";
  turnIndex: number;
  note: string;
  source: CorrectionRecord["source"];
}

export type NormalizedEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | TurnLoggedEvent
  | ToolCallLoggedEvent
  | CorrectionLoggedEvent;

export interface ProviderConfig {
  provider: "anthropic" | "openai" | "openrouter";
  model: string;
  apiKeyEnvVar?: string | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}

export interface AppConfig {
  storageMode: "global" | "project";
  projectPath?: string | undefined;
  databasePath?: string | undefined;
  retroProvider?: ProviderConfig | undefined;
  serverPort: number;
}
