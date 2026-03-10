import test from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./index.js";

test("cli help runs", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (value?: unknown) => {
    logs.push(String(value ?? ""));
  };

  try {
    await runCli(["help"]);
  } finally {
    console.log = originalLog;
  }

  assert.ok(logs.join("\n").includes("pretro commands"));
});
