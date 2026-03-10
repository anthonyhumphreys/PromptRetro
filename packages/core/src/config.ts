import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig, ProviderConfig } from "@prompt-retro/shared-types";
import { ensureAbsoluteProjectPath, safeJsonParse } from "./utils.js";

const APP_DIR_NAME = "prompt-retro";

function getGlobalAppDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) {
    return path.join(xdg, APP_DIR_NAME);
  }

  const codexMemoriesDir = path.join(os.homedir(), ".codex", "memories");
  if (fs.existsSync(codexMemoriesDir)) {
    return path.join(codexMemoriesDir, APP_DIR_NAME);
  }

  return path.join(os.homedir(), ".local", "share", APP_DIR_NAME);
}

export function getProjectConfigPath(projectPath = process.cwd()): string {
  return path.join(ensureAbsoluteProjectPath(projectPath), ".pretro", "config.json");
}

export function getGlobalConfigPath(): string {
  return path.join(getGlobalAppDir(), "config.json");
}

export function getDefaultGlobalDatabasePath(): string {
  return path.join(getGlobalAppDir(), "prompt-retro.db");
}

export function getDefaultProjectDatabasePath(projectPath = process.cwd()): string {
  return path.join(ensureAbsoluteProjectPath(projectPath), ".pretro", "prompt-retro.db");
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadConfigFile(configPath: string): Partial<AppConfig> {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, "utf8");
  return safeJsonParse<Partial<AppConfig>>(raw) ?? {};
}

export function resolveConfig(projectPath = process.cwd()): AppConfig {
  const resolvedProjectPath = ensureAbsoluteProjectPath(projectPath);
  const globalConfig = loadConfigFile(getGlobalConfigPath());
  const projectConfig = loadConfigFile(getProjectConfigPath(resolvedProjectPath));

  const storageMode = projectConfig.storageMode ?? globalConfig.storageMode ?? "global";
  const databasePath =
    projectConfig.databasePath ??
    globalConfig.databasePath ??
    (storageMode === "project"
      ? getDefaultProjectDatabasePath(resolvedProjectPath)
      : getDefaultGlobalDatabasePath());

  return {
    storageMode,
    projectPath: resolvedProjectPath,
    databasePath,
    retroProvider: projectConfig.retroProvider ?? globalConfig.retroProvider,
    serverPort: projectConfig.serverPort ?? globalConfig.serverPort ?? 4100
  };
}

export function writeConfig(
  config: Partial<AppConfig>,
  scope: "global" | "project",
  projectPath = process.cwd()
): string {
  const configPath =
    scope === "project" ? getProjectConfigPath(projectPath) : getGlobalConfigPath();

  ensureDir(path.dirname(configPath));
  const existing = loadConfigFile(configPath);
  const nextConfig = { ...existing, ...config };
  fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2));
  return configPath;
}

export function getProviderApiKey(config: ProviderConfig): string | undefined {
  if (config.apiKey) {
    return config.apiKey;
  }

  if (config.apiKeyEnvVar) {
    return process.env[config.apiKeyEnvVar];
  }

  const defaultEnvVar = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY"
  }[config.provider];

  return process.env[defaultEnvVar];
}
