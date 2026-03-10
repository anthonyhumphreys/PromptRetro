# Prompt Retro

Prompt Retro records AI coding sessions, classifies recurring correction patterns, and turns them into actionable retrospectives.

## What ships here

- `pretro` CLI for capture, replay, retro, config, and local UI serving
- shared TypeScript core with SQLite-backed session storage
- optional BYOK provider support for OpenAI, Anthropic, and OpenRouter
- read-focused React dashboard
- Claude Code plugin assets that forward hooks into the local CLI

## Workspace layout

- `packages/shared-types`: shared domain contracts
- `packages/core`: SQLite store, ingestion, pattern engine, retro orchestration
- `packages/cli`: executable CLI and local API server
- `packages/claude-plugin`: Claude Code plugin assets and helper scripts
- `apps/dashboard`: local React dashboard

## Getting started

```bash
pnpm install
pnpm build
```

Configure storage and optionally a retro provider:

```bash
pretro config set --storage-mode global
pretro config set --provider openai --model gpt-4.1 --api-key-env OPENAI_API_KEY
```

## CLI examples

Capture JSON output:

```bash
codex --output-format json | pretro log
```

Wrap a Codex session:

```bash
pretro wrap -- codex
```

Run a retrospective:

```bash
pretro retro
```

Run batch retros for recent sessions:

```bash
pretro retro --batch --since 2026-03-01
```

Serve the local dashboard:

```bash
pretro serve
```

Delete one session or purge all local history:

```bash
pretro delete --session <id>
pretro purge
```

## Notes

- Session data is local only.
- SQLite databases live either in a global app directory or in `.pretro/` within a project.
- Codex OAuth is not implemented yet, but the provider/auth layer is structured to allow a later token-based integration.
