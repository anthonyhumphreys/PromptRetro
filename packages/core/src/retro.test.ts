import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PromptRetroStore } from "./db.js";
import { runRetro } from "./retro.js";
import { createSessionEndedEvent, createSessionStartedEvent } from "./ingest.js";

function makeStore(): { store: PromptRetroStore; databasePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretro-core-"));
  const databasePath = path.join(dir, "prompt-retro.db");
  return { store: new PromptRetroStore(databasePath), databasePath };
}

test("runRetro produces deterministic metrics and actions", async () => {
  const { store } = makeStore();
  const sessionId = "session_test";
  store.recordEvent(createSessionStartedEvent(sessionId, "codex", process.cwd()));
  store.recordEvent({
    type: "turn.logged",
    sessionId,
    projectPath: process.cwd(),
    tool: "codex",
    timestamp: new Date().toISOString(),
    role: "user",
    content: "fix auth"
  });
  store.recordEvent({
    type: "turn.logged",
    sessionId,
    projectPath: process.cwd(),
    tool: "codex",
    timestamp: new Date().toISOString(),
    role: "assistant",
    content: "I updated the auth middleware."
  });
  store.recordEvent({
    type: "tool.logged",
    sessionId,
    projectPath: process.cwd(),
    tool: "codex",
    timestamp: new Date().toISOString(),
    toolName: "Bash",
    output: "tests failed with error",
    filePath: "src/auth.ts"
  });
  store.recordEvent({
    type: "correction.logged",
    sessionId,
    projectPath: process.cwd(),
    tool: "codex",
    timestamp: new Date().toISOString(),
    turnIndex: 1,
    note: "you forgot type safety",
    source: "manual"
  });
  store.recordEvent(createSessionEndedEvent(sessionId, "codex", process.cwd()));

  const report = await runRetro(store, sessionId);

  assert.equal(report.factual.turnCount, 2);
  assert.equal(report.factual.correctionCount, 1);
  assert.ok(report.patterns.some((pattern) => pattern.patternId === "type-safety-regression"));
  assert.ok(report.actions.length >= 1);
  store.close();
});
