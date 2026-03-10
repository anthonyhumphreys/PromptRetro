import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CorrectionRecord,
  NormalizedEvent,
  PatternRecord,
  RetroReportRecord,
  SessionBundle,
  SessionRecord,
  ToolCallRecord,
  TurnRecord
} from "@prompt-retro/shared-types";
import { ensureDir } from "./config.js";
import { getBuiltinPatterns } from "./patterns.js";
import { createId } from "./utils.js";

interface SessionListFilters {
  projectPath?: string;
  tool?: SessionRecord["tool"];
  status?: SessionRecord["status"];
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) {
    return undefined;
  }

  return JSON.parse(value) as T;
}

export class PromptRetroStore {
  readonly db: DatabaseSync;

  constructor(readonly databasePath: string) {
    ensureDir(path.dirname(databasePath));
    this.db = new DatabaseSync(databasePath);
    this.migrate();
    this.seedPatterns();
  }

  migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        parent_session_id TEXT,
        project_path TEXT NOT NULL,
        tool TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL,
        outcome_tag TEXT NOT NULL,
        note TEXT,
        meta TEXT
      );

      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        meta TEXT
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        tool_name TEXT NOT NULL,
        input TEXT,
        output TEXT,
        file_path TEXT,
        timestamp TEXT NOT NULL,
        meta TEXT
      );

      CREATE TABLE IF NOT EXISTS corrections (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        note TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        pattern_ids TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT NOT NULL,
        tool_affinity TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS retro_reports (
        id TEXT PRIMARY KEY,
        session_ids TEXT NOT NULL,
        created_at TEXT NOT NULL,
        factual TEXT NOT NULL,
        patterns TEXT NOT NULL,
        insights TEXT,
        actions TEXT NOT NULL
      );
    `);
  }

  seedPatterns(): void {
    const stmt = this.db.prepare(`
      INSERT INTO patterns (id, name, category, description, severity, tool_affinity, count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        description = excluded.description,
        severity = excluded.severity,
        tool_affinity = excluded.tool_affinity
    `);

    for (const pattern of getBuiltinPatterns()) {
      stmt.run(
        pattern.id,
        pattern.name,
        pattern.category,
        pattern.description,
        pattern.severity,
        JSON.stringify(pattern.toolAffinity),
        pattern.count
      );
    }
  }

  close(): void {
    this.db.close();
  }

  recordEvent(event: NormalizedEvent): void {
    switch (event.type) {
      case "session.started":
        this.upsertSession({
          id: event.sessionId,
          parentSessionId: event.parentSessionId,
          projectPath: event.projectPath,
          tool: event.tool,
          startedAt: event.timestamp,
          status: "active",
          outcomeTag: "unknown",
          meta: event.meta
        });
        return;
      case "session.ended":
        this.upsertSession({
          id: event.sessionId,
          parentSessionId: event.parentSessionId,
          projectPath: event.projectPath,
          tool: event.tool,
          startedAt: this.getSession(event.sessionId)?.startedAt ?? event.timestamp,
          endedAt: event.timestamp,
          status: event.status ?? "completed",
          outcomeTag: event.outcomeTag ?? "unknown",
          note: event.note,
          meta: event.meta
        });
        return;
      case "turn.logged":
        this.insertTurn(event);
        return;
      case "tool.logged":
        this.insertToolCall(event);
        return;
      case "correction.logged":
        this.insertCorrection({
          id: createId("correction"),
          sessionId: event.sessionId,
          turnIndex: event.turnIndex,
          note: event.note,
          timestamp: event.timestamp,
          source: event.source,
          patternIds: []
        });
    }
  }

  upsertSession(record: SessionRecord): void {
    this.db.prepare(`
      INSERT INTO sessions (
        id, parent_session_id, project_path, tool, started_at, ended_at, status, outcome_tag, note, meta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        parent_session_id = excluded.parent_session_id,
        project_path = excluded.project_path,
        tool = excluded.tool,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        status = excluded.status,
        outcome_tag = excluded.outcome_tag,
        note = excluded.note,
        meta = excluded.meta
    `).run(
      record.id,
      record.parentSessionId ?? null,
      record.projectPath,
      record.tool,
      record.startedAt,
      record.endedAt ?? null,
      record.status,
      record.outcomeTag,
      record.note ?? null,
      record.meta ? JSON.stringify(record.meta) : null
    );
  }

  insertTurn(event: Extract<NormalizedEvent, { type: "turn.logged" }>): TurnRecord {
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM turns WHERE session_id = ?`)
      .get(event.sessionId) as { count: number };
    const turnIndex = Number(countRow.count) + 1;

    const turn: TurnRecord = {
      id: createId("turn"),
      sessionId: event.sessionId,
      role: event.role,
      content: event.content,
      timestamp: event.timestamp,
      turnIndex,
      meta: event.meta
    };

    this.db.prepare(`
      INSERT INTO turns (id, session_id, role, content, timestamp, turn_index, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      turn.id,
      turn.sessionId,
      turn.role,
      turn.content,
      turn.timestamp,
      turn.turnIndex,
      turn.meta ? JSON.stringify(turn.meta) : null
    );

    return turn;
  }

  insertToolCall(event: Extract<NormalizedEvent, { type: "tool.logged" }>): ToolCallRecord {
    const toolCall: ToolCallRecord = {
      id: createId("tool"),
      sessionId: event.sessionId,
      turnId: event.turnId,
      toolName: event.toolName,
      input: event.input,
      output: event.output,
      filePath: event.filePath,
      timestamp: event.timestamp,
      meta: event.meta
    };

    this.db.prepare(`
      INSERT INTO tool_calls (id, session_id, turn_id, tool_name, input, output, file_path, timestamp, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      toolCall.id,
      toolCall.sessionId,
      toolCall.turnId ?? null,
      toolCall.toolName,
      toolCall.input ?? null,
      toolCall.output ?? null,
      toolCall.filePath ?? null,
      toolCall.timestamp,
      toolCall.meta ? JSON.stringify(toolCall.meta) : null
    );

    return toolCall;
  }

  insertCorrection(correction: CorrectionRecord): void {
    this.db.prepare(`
      INSERT INTO corrections (id, session_id, turn_index, note, timestamp, source, pattern_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      correction.id,
      correction.sessionId,
      correction.turnIndex,
      correction.note,
      correction.timestamp,
      correction.source,
      JSON.stringify(correction.patternIds)
    );
  }

  saveRetroReport(report: RetroReportRecord): void {
    this.db.prepare(`
      INSERT INTO retro_reports (id, session_ids, created_at, factual, patterns, insights, actions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.id,
      JSON.stringify(report.sessionIds),
      report.createdAt,
      JSON.stringify(report.factual),
      JSON.stringify(report.patterns),
      report.insights ? JSON.stringify(report.insights) : null,
      JSON.stringify(report.actions)
    );
  }

  incrementPatternCount(patternIds: string[]): void {
    const stmt = this.db.prepare(`UPDATE patterns SET count = count + 1 WHERE id = ?`);
    for (const patternId of patternIds) {
      stmt.run(patternId);
    }
  }

  getSession(sessionId: string): SessionRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id as string,
      parentSessionId: (row.parent_session_id as string | null) ?? undefined,
      projectPath: row.project_path as string,
      tool: row.tool as SessionRecord["tool"],
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string | null) ?? undefined,
      status: row.status as SessionRecord["status"],
      outcomeTag: row.outcome_tag as SessionRecord["outcomeTag"],
      note: (row.note as string | null) ?? undefined,
      meta: parseJson<Record<string, unknown>>(row.meta as string | null)
    };
  }

  listSessions(filters: SessionListFilters = {}): SessionRecord[] {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (filters.projectPath) {
      clauses.push("project_path = ?");
      values.push(filters.projectPath);
    }

    if (filters.tool) {
      clauses.push("tool = ?");
      values.push(filters.tool);
    }

    if (filters.status) {
      clauses.push("status = ?");
      values.push(filters.status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM sessions ${where} ORDER BY started_at DESC`)
      .all(...(values as (string | number)[])) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      parentSessionId: (row.parent_session_id as string | null) ?? undefined,
      projectPath: row.project_path as string,
      tool: row.tool as SessionRecord["tool"],
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string | null) ?? undefined,
      status: row.status as SessionRecord["status"],
      outcomeTag: row.outcome_tag as SessionRecord["outcomeTag"],
      note: (row.note as string | null) ?? undefined,
      meta: parseJson<Record<string, unknown>>(row.meta as string | null)
    }));
  }

  getSessionBundle(sessionId: string): SessionBundle | undefined {
    const session = this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    const turns = this.db
      .prepare(`SELECT * FROM turns WHERE session_id = ? ORDER BY turn_index ASC`)
      .all(sessionId) as Record<string, unknown>[];
    const toolCalls = this.db
      .prepare(`SELECT * FROM tool_calls WHERE session_id = ? ORDER BY timestamp ASC`)
      .all(sessionId) as Record<string, unknown>[];
    const corrections = this.db
      .prepare(`SELECT * FROM corrections WHERE session_id = ? ORDER BY turn_index ASC`)
      .all(sessionId) as Record<string, unknown>[];
    const reports = this.db
      .prepare(`SELECT * FROM retro_reports WHERE session_ids LIKE ? ORDER BY created_at DESC`)
      .all(`%${sessionId}%`) as Record<string, unknown>[];

    return {
      session,
      turns: turns.map((row) => ({
        id: row.id as string,
        sessionId: row.session_id as string,
        role: row.role as TurnRecord["role"],
        content: row.content as string,
        timestamp: row.timestamp as string,
        turnIndex: row.turn_index as number,
        meta: parseJson<Record<string, unknown>>(row.meta as string | null)
      })),
      toolCalls: toolCalls.map((row) => ({
        id: row.id as string,
        sessionId: row.session_id as string,
        turnId: (row.turn_id as string | null) ?? undefined,
        toolName: row.tool_name as string,
        input: (row.input as string | null) ?? undefined,
        output: (row.output as string | null) ?? undefined,
        filePath: (row.file_path as string | null) ?? undefined,
        timestamp: row.timestamp as string,
        meta: parseJson<Record<string, unknown>>(row.meta as string | null)
      })),
      corrections: corrections.map((row) => ({
        id: row.id as string,
        sessionId: row.session_id as string,
        turnIndex: row.turn_index as number,
        note: row.note as string,
        timestamp: row.timestamp as string,
        source: row.source as CorrectionRecord["source"],
        patternIds: parseJson<string[]>(row.pattern_ids as string | null) ?? []
      })),
      reports: reports.map((row) => ({
        id: row.id as string,
        sessionIds: parseJson<string[]>(row.session_ids as string | null) ?? [],
        createdAt: row.created_at as string,
        factual: parseJson<RetroReportRecord["factual"]>(row.factual as string | null)!,
        patterns: parseJson<RetroReportRecord["patterns"]>(row.patterns as string | null) ?? [],
        insights: parseJson<RetroReportRecord["insights"]>(row.insights as string | null),
        actions: parseJson<RetroReportRecord["actions"]>(row.actions as string | null) ?? []
      }))
    };
  }

  listRetroReports(): RetroReportRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM retro_reports ORDER BY created_at DESC`)
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      sessionIds: parseJson<string[]>(row.session_ids as string | null) ?? [],
      createdAt: row.created_at as string,
      factual: parseJson<RetroReportRecord["factual"]>(row.factual as string | null)!,
      patterns: parseJson<RetroReportRecord["patterns"]>(row.patterns as string | null) ?? [],
      insights: parseJson<RetroReportRecord["insights"]>(row.insights as string | null),
      actions: parseJson<RetroReportRecord["actions"]>(row.actions as string | null) ?? []
    }));
  }

  listPatterns(): PatternRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM patterns ORDER BY count DESC, name ASC`)
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      category: row.category as string,
      description: row.description as string,
      severity: row.severity as PatternRecord["severity"],
      toolAffinity: parseJson<PatternRecord["toolAffinity"]>(row.tool_affinity as string | null) ?? [],
      count: row.count as number
    }));
  }

  deleteSession(sessionId: string): void {
    for (const table of ["turns", "tool_calls", "corrections"]) {
      this.db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
    }

    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  purge(): void {
    this.db.exec(`
      DELETE FROM retro_reports;
      DELETE FROM corrections;
      DELETE FROM tool_calls;
      DELETE FROM turns;
      DELETE FROM sessions;
      UPDATE patterns SET count = 0;
    `);
  }
}
