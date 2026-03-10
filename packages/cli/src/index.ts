import fs from "node:fs";
import readline from "node:readline";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  PromptRetroStore,
  createSessionEndedEvent,
  createSessionStartedEvent,
  normalizeClaudeHookEvent,
  normalizeCodexJsonLine,
  nowIso,
  resolveConfig,
  runRetro,
  writeConfig
} from "@prompt-retro/core";
import type { AppConfig, NormalizedEvent, ProviderConfig, SessionRecord } from "@prompt-retro/shared-types";
import { startServer } from "./server.js";

type ParsedArgs = {
  command?: string | undefined;
  positionals: string[];
  flags: Map<string, string | boolean>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === "--") {
      positionals.push(...argv.slice(index));
      break;
    }

    if (token.startsWith("--")) {
      const [flag, inlineValue] = token.slice(2).split("=");
      if (!flag) {
        continue;
      }

      if (inlineValue !== undefined) {
        flags.set(flag, inlineValue);
        continue;
      }

      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        flags.set(flag, next);
        index += 1;
      } else {
        flags.set(flag, true);
      }
      continue;
    }

    if (!positionals.length) {
      positionals.push(token);
    } else {
      positionals.push(token);
    }
  }

  return {
    command: positionals[0],
    positionals: positionals.slice(1),
    flags
  };
}

function getFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function getBooleanFlag(parsed: ParsedArgs, key: string): boolean {
  return parsed.flags.get(key) === true;
}

function getStore(projectPath = process.cwd()): { config: AppConfig; store: PromptRetroStore } {
  const config = resolveConfig(projectPath);
  return {
    config,
    store: new PromptRetroStore(config.databasePath!)
  };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function createSessionId(): string {
  return `session_${Date.now()}`;
}

async function recordEvents(store: PromptRetroStore, events: NormalizedEvent[]): Promise<void> {
  for (const event of events) {
    store.recordEvent(event);
  }
}

async function commandLog(parsed: ParsedArgs): Promise<void> {
  const sessionId = getFlag(parsed, "session") ?? createSessionId();
  const projectPath = getFlag(parsed, "project") ?? process.cwd();
  const { store } = getStore(projectPath);
  store.recordEvent(createSessionStartedEvent(sessionId, "codex", projectPath));

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    await recordEvents(store, normalizeCodexJsonLine(line, sessionId, projectPath));
  }

  store.recordEvent(createSessionEndedEvent(sessionId, "codex", projectPath, "Captured via pretro log"));
  printJson({ ok: true, sessionId });
  store.close();
}

async function commandWrap(parsed: ParsedArgs): Promise<void> {
  const separatorIndex = process.argv.indexOf("--");
  const wrapped = separatorIndex >= 0 ? process.argv.slice(separatorIndex + 1) : [];
  if (wrapped.length === 0) {
    throw new Error("Usage: pretro wrap -- <command>");
  }

  const sessionId = createSessionId();
  const projectPath = process.cwd();
  const { store } = getStore(projectPath);
  store.recordEvent(createSessionStartedEvent(sessionId, "codex", projectPath));

  const command = wrapped[0];
  if (!command) {
    throw new Error("Missing wrapped command.");
  }

  const child = spawn(command, wrapped.slice(1), {
    cwd: projectPath,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  }) as unknown as ChildProcessWithoutNullStreams;

  process.stdin.pipe(child.stdin);

  const forward = (chunk: Buffer, stream: NodeJS.WriteStream): void => {
    const text = chunk.toString("utf8");
    stream.write(text);
    for (const line of text.split("\n")) {
      const events = normalizeCodexJsonLine(line.trim(), sessionId, projectPath);
      for (const event of events) {
        store.recordEvent(event);
      }
    }
  };

  child.stdout.on("data", (chunk: Buffer) => forward(chunk, process.stdout));
  child.stderr.on("data", (chunk: Buffer) => forward(chunk, process.stderr));

  const exitCode: number = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  store.recordEvent(createSessionEndedEvent(sessionId, "codex", projectPath, `Wrapped command exited with ${exitCode}`));
  store.close();
  process.exitCode = exitCode ?? 0;
}

async function commandRetro(parsed: ParsedArgs): Promise<void> {
  const { config, store } = getStore();
  if (getBooleanFlag(parsed, "batch")) {
    const projectPath = getFlag(parsed, "project");
    const since = getFlag(parsed, "since");
    const sessions = store
      .listSessions(projectPath ? { projectPath } : {})
      .filter((session) => (since ? session.startedAt >= since : true));

    const reports = [];
    for (const session of sessions) {
      reports.push(await runRetro(store, session.id, config));
    }

    printJson({ ok: true, count: reports.length, reports });
    store.close();
    return;
  }

  const sessionId = getFlag(parsed, "session") ?? store.listSessions()[0]?.id;
  if (!sessionId) {
    throw new Error("No session found to run retro against.");
  }

  const report = await runRetro(store, sessionId, config);
  printJson(report);
  store.close();
}

async function commandReplay(parsed: ParsedArgs): Promise<void> {
  const { config, store } = getStore();
  const sessionId = getFlag(parsed, "session") ?? store.listSessions()[0]?.id;
  if (!sessionId) {
    throw new Error("No session found to replay.");
  }

  if (getBooleanFlag(parsed, "web")) {
    const server = await startServer(store, config);
    console.log(`Prompt Retro UI available at http://127.0.0.1:${config.serverPort}/ui`);
    process.on("SIGINT", () => {
      server.close();
      store.close();
      process.exit(0);
    });
    return;
  }

  const bundle = store.getSessionBundle(sessionId);
  printJson(bundle);
  store.close();
}

async function commandPatterns(): Promise<void> {
  const { store } = getStore();
  printJson(store.listPatterns());
  store.close();
}

async function commandDelete(parsed: ParsedArgs): Promise<void> {
  const sessionId = getFlag(parsed, "session");
  if (!sessionId) {
    throw new Error("Usage: pretro delete --session <id>");
  }

  const { store } = getStore();
  store.deleteSession(sessionId);
  store.close();
  printJson({ ok: true, deletedSessionId: sessionId });
}

async function commandPurge(): Promise<void> {
  const { store } = getStore();
  store.purge();
  store.close();
  printJson({ ok: true, purged: true });
}

async function commandServe(): Promise<void> {
  const { config, store } = getStore();
  await startServer(store, config);
  console.log(`Prompt Retro UI available at http://127.0.0.1:${config.serverPort}/ui`);
}

async function commandConfig(parsed: ParsedArgs): Promise<void> {
  const action = parsed.positionals[0] ?? "show";
  if (action === "show") {
    printJson(resolveConfig());
    return;
  }

  if (action !== "set") {
    throw new Error("Usage: pretro config [show|set]");
  }

  const scope = (getFlag(parsed, "scope") ?? "global") as "global" | "project";
  const storageMode = getFlag(parsed, "storage-mode") as AppConfig["storageMode"] | undefined;
  const serverPortValue = getFlag(parsed, "server-port");
  const provider = getFlag(parsed, "provider") as ProviderConfig["provider"] | undefined;
  const model = getFlag(parsed, "model");
  const apiKeyEnvVar = getFlag(parsed, "api-key-env");
  const baseUrl = getFlag(parsed, "base-url");

  const payload: Partial<AppConfig> = {};
  if (storageMode) {
    payload.storageMode = storageMode;
  }

  if (serverPortValue) {
    payload.serverPort = Number(serverPortValue);
  }

  if (provider && model) {
    payload.retroProvider = {
      provider,
      model,
      apiKeyEnvVar,
      baseUrl
    };
  }

  const writtenPath = writeConfig(payload, scope);
  printJson({ ok: true, path: writtenPath, config: resolveConfig() });
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return chunks.join("");
}

async function commandClaudeHook(parsed: ParsedArgs): Promise<void> {
  const hookEvent = parsed.positionals[0];
  if (!hookEvent) {
    throw new Error("Usage: pretro claude-hook <HookEvent>");
  }

  const rawPayload = await readStdin();
  const payload = JSON.parse(rawPayload) as Parameters<typeof normalizeClaudeHookEvent>[1];
  const projectPath = payload.projectPath ?? process.cwd();
  const { store } = getStore(projectPath);

  if (!store.getSession(payload.sessionId) && hookEvent !== "Stop" && hookEvent !== "SubagentStop") {
    store.recordEvent(
      createSessionStartedEvent(payload.sessionId, "claude-code", projectPath, payload.parentSessionId)
    );
  }

  const events = normalizeClaudeHookEvent(hookEvent, payload);
  await recordEvents(store, events);
  printJson({ ok: true, hookEvent, timestamp: nowIso() });
  store.close();
}

function printHelp(): void {
  console.log(`pretro commands:
  pretro log [--session id] [--project path]
  pretro wrap -- <command>
  pretro retro [--session id] [--batch --project path --since YYYY-MM-DD]
  pretro replay [--session id] [--web]
  pretro patterns
  pretro delete --session id
  pretro purge
  pretro serve
  pretro config [show|set] [--scope global|project] [--storage-mode global|project]
  pretro claude-hook <HookEvent>`);
}

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  switch (parsed.command) {
    case "log":
      await commandLog(parsed);
      return;
    case "wrap":
      await commandWrap(parsed);
      return;
    case "retro":
      await commandRetro(parsed);
      return;
    case "replay":
      await commandReplay(parsed);
      return;
    case "patterns":
      await commandPatterns();
      return;
    case "delete":
      await commandDelete(parsed);
      return;
    case "purge":
      await commandPurge();
      return;
    case "serve":
      await commandServe();
      return;
    case "config":
      await commandConfig(parsed);
      return;
    case "claude-hook":
      await commandClaudeHook(parsed);
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}
