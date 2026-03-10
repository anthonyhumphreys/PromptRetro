# PROMPT RETRO

## High-Level Specification

---

| | |
|---|---|
| **Version** | 0.1.0 (Draft) |
| **Date** | 10 March 2026 |
| **Author** | Anth |
| **Status** | Proposal |
| **License** | MIT (proposed) |

A session recorder, pattern engine, and retrospective coach for AI-assisted coding workflows. Ships as a **Claude Code plugin** with **Codex CLI** support, and a clear path to **OpenCode** integration via shared MCP and plugin architectures.

> *"Git blame for your AI conversations."*

### Target Tools

| Tool | Role | Integration |
|------|------|-------------|
| Claude Code | Primary target | Native plugin (hooks, commands, subagent) |
| Codex CLI | Primary target | JSON output piping + CLI wrapper |
| OpenCode | Future expansion | Plugin system + MCP server + SDK events |

---

## 1. Problem Statement

AI coding tools have transformed how developers write code, but nobody is learning from the interaction itself. Every prompting session is fire-and-forget: the developer prompts, the model responds, the developer corrects, and the session vanishes. Three critical problems emerge:

- **The Correction Tax.** 66% of developers report their biggest frustration is AI output that is almost right but not quite. Every correction is an undocumented lesson that will need to be re-learned.
- **The Pattern Blindspot.** Developers using AI tools opened 98% more PRs, but reviews got 91% longer. The same classes of mistake recur across sessions with no mechanism to detect or prevent them.
- **The Knowledge Silo.** Each AI tool builds its own ephemeral context. When a developer switches from Claude Code to Codex or works across projects, all learned context is lost.

Prompt Retro solves these by recording sessions, extracting patterns, and running structured retrospectives that feed back into the developer's workflow as actionable rules and guardrails.

---

## 2. Solution Overview

Prompt Retro is a local-first developer tool comprising three layers:

| Layer | Function | Implementation |
|-------|----------|----------------|
| Session Store | Records every prompt, response, tool call, and correction as a structured transcript | SQLite database, local filesystem |
| Pattern Engine | Deterministic analysis of sessions to detect recurring mistake classes, prompt anti-patterns, and cost/time metrics | Rule-based classifier with configurable taxonomy |
| Retro Agent | AI-powered retrospective coach that analyses sessions and generates actionable insights, rules, and hooks | LLM metaconversation (user's own API key) |

The tool ships as a Claude Code plugin with parallel Codex CLI support. A lightweight web dashboard provides visual exploration. An MCP server enables future cross-tool compatibility including OpenCode.

---

## 3. User Journey

A typical session flows through four phases:

### Phase 1: Passive Recording

Hooks (Claude Code) or output interception (Codex) automatically capture session data. The developer's workflow is unchanged. No manual tagging, no export steps. Structured transcripts are written to the local store as the session progresses.

### Phase 2: Session Close

When a session ends, the plugin presents a quick summary: prompt count, tool calls, files modified, corrections made, and time elapsed. The developer can optionally tag the outcome (success, partial, failed) and add a brief note.

### Phase 3: Retrospective

The developer runs `/retro` (Claude Code) or `pretro retro` (CLI) to trigger a structured retrospective. This can happen immediately or later in batch. The retro runs in three passes:

1. **Factual Pass (deterministic).** Extracts metrics: turn count, correction count, time-between-turns, tools used, files changed, error categories. No LLM required.
2. **Pattern Pass (deterministic).** Compares the session against the local pattern database. Flags known anti-patterns, recurring mistake classes, and prompt structures that historically correlate with failures.
3. **Insight Pass (LLM-powered).** Feeds the transcript, metrics, and pattern matches to a model with a retrospective-coach system prompt. The model identifies what went well, what the developer could have prompted differently, and what guardrails should be added.

### Phase 4: Action

The retrospective produces concrete outputs:

- **Rules:** Auto-generated entries for `.claude/settings.json`, `CLAUDE.md`, or OpenCode's instructions config that prevent a class of mistake from recurring.
- **Hooks:** Suggested `PreToolUse` or `PostToolUse` hooks that catch known failure patterns before they ship.
- **Playbook Entries:** Prompt templates added to the developer's personal library of what works for specific task types.

---

## 4. Architecture

### 4.1 System Diagram

```
┌────────────────────────────────────────────────┐
│  Claude Code            │  Codex CLI           │
│  (native plugin)        │  (JSON pipe)         │
│                         │                      │
│  Hooks:                 │  Output:             │
│   UserPromptSubmit      │   --format json      │
│   PostToolUse      ─────┼──────────────────────┤
│   Stop                  │                      │
│                         │                      │
│  /replay  /retro        │  pretro retro        │
└───────────────────┬─────┼──────────────────────┘
                    │     │
                    ▼     ▼
┌────────────────────────────────────────────────┐
│  Prompt Retro Core (local)                     │
│                                                │
│  Session Store    (SQLite)                     │
│  Pattern Engine   (rules + stats)              │
│  Retro Agent      (LLM, BYOK)                 │
│  MCP Server       (:4100)                      │
│  Web Dashboard    (:4100/ui)                   │
│                                                │
│  Future: OpenCode plugin + SDK events          │
└────────────────────────────────────────────────┘
```

### 4.2 Plugin Structure (Claude Code)

```
prompt-retro/
  .claude-plugin/
    plugin.json
  commands/
    replay.md           # /replay slash command
    retro.md            # /retro slash command
    retro-batch.md      # /retro-batch command
  agents/
    retro-coach.md      # retrospective subagent
  hooks/
    hooks.json
    capture.py          # session recording logic
    on_stop.py          # end-of-session handler
  src/
    store.ts            # SQLite session store
    patterns.ts         # pattern engine
    retro.ts            # retro orchestrator
    mcp-server.ts       # MCP server for cross-tool
    dashboard/          # web UI (Vite + React)
  bin/
    pretro              # standalone CLI entry point
    pretro-wrap         # Codex output interceptor
  .mcp.json             # MCP server definition
```

### 4.3 Data Model

| Entity | Key Fields | Notes |
|--------|-----------|-------|
| Session | id, project, tool, started_at, ended_at, status, outcome_tag, note | One per coding session. tool = claude-code \| codex \| opencode |
| Turn | id, session_id, role, content, timestamp, turn_index | Each prompt or response |
| ToolCall | id, turn_id, tool_name, input, output, file_path | Captures file edits, bash calls, etc. |
| Correction | id, session_id, turn_index, note, pattern_ids[] | Developer-flagged or auto-detected |
| Pattern | id, name, description, count, tool_affinity[], severity | Accumulated across sessions |
| RetroReport | id, session_ids[], factual, patterns, insights, actions[] | Output of /retro or pretro retro |
| PlaybookEntry | id, task_type, prompt_template, success_rate, source_retro_id | What works for what |

---

## 5. Integration: Claude Code

Claude Code is the primary target. Integration uses three officially supported extension points: hooks for passive capture, slash commands for interaction, and a subagent for the insight pass.

### 5.1 Hook Events

| Hook Event | Purpose | Behaviour |
|------------|---------|-----------|
| UserPromptSubmit | Capture prompts | Logs the user's prompt text and timestamp. Exit 0, no modification to the prompt. |
| PostToolUse | Capture tool calls | Logs tool name, input, output, and affected file paths. Matcher: `Edit\|Write\|Bash`. |
| Stop | Session close | Writes final transcript to store. Presents summary. Offers `/retro`. |
| PreCompact | Context preservation | Backs up transcript before compaction to prevent data loss. |
| SubagentStop | Track delegated work | Captures subagent completions for sessions that use Task tools. |

### 5.2 Slash Commands

| Command | Description |
|---------|-------------|
| `/replay` | Opens the web dashboard in the browser, or prints a session transcript to the terminal. |
| `/retro` | Runs a retrospective on the current or most recent session. |
| `/retro-batch` | Runs a retrospective across multiple sessions filtered by date, project, or tag. |
| `/patterns` | Prints the top recurring patterns for the current project. |

### 5.3 Retro Coach Subagent

The insight pass runs as a Claude Code **subagent** with an isolated context window and a custom system prompt. This keeps the retro conversation separate from the coding session and avoids polluting the developer's main context. The subagent receives:

- The full session transcript (from the store, not from context).
- Factual pass output (metrics, timings, tool call summary).
- Pattern pass output (matched patterns with historical frequency).
- The developer's existing rules and playbook entries for context.

The subagent's system prompt frames it as a retrospective coach, not a code assistant. It is instructed to focus on developer behaviour, be specific and actionable, reference the pattern data, and avoid blame framing. Output is structured JSON alongside natural language.

---

## 6. Integration: Codex CLI

Codex CLI outputs structured JSON when run with `--output-format json`. Prompt Retro captures this via two mechanisms:

### 6.1 Output Pipe

The simplest integration. The developer pipes Codex output into the Prompt Retro CLI:

```bash
$ codex -p "fix the auth bug" --output-format json | pretro log
```

This is low-friction but only captures single-shot prompts. It misses multi-turn sessions and tool calls.

### 6.2 Session Wrapper

For full multi-turn capture, the developer uses the `pretro wrap` command to spawn Codex as a child process:

```bash
$ pretro wrap -- codex
```

The wrapper intercepts stdin/stdout, parses Codex's JSON output stream, and logs turns and tool calls to the session store in real time. When the Codex process exits, the wrapper triggers the same session-close flow as the Claude Code Stop hook.

Retrospectives are run via the standalone CLI: `pretro retro` (latest session) or `pretro retro --batch --since 7d` (batch mode). The CLI shares the same store and pattern engine as the Claude Code plugin.

---

## 7. Future: OpenCode Integration

OpenCode is the planned third target. Its extensibility model is well-suited to Prompt Retro, with three integration paths available:

### 7.1 OpenCode Plugin

OpenCode supports plugins via `.opencode/plugins/` or npm packages. Plugins can subscribe to lifecycle events including tool execution hooks with before/after callbacks, session events via the SDK, and compaction hooks. A Prompt Retro plugin for OpenCode would mirror the Claude Code plugin's functionality: capture turns on tool execution, trigger session close on idle/exit, and expose `/retro` as a custom command.

### 7.2 MCP Server

OpenCode has native MCP support for both local and remote servers. The same MCP server that Prompt Retro exposes for cross-tool use (`localhost:4100`) can be registered in OpenCode's config:

```json
{
  "mcp": {
    "prompt-retro": {
      "type": "local",
      "command": ["pretro", "mcp-serve"],
      "enabled": true
    }
  }
}
```

This gives OpenCode's LLM direct access to Prompt Retro tools (log turns, query patterns, run retros) as callable functions.

### 7.3 SDK Event Stream

OpenCode's SDK exposes an SSE event stream from its server mode. An external Prompt Retro process could subscribe to session events, capturing turns and tool calls without requiring a plugin installation. This is the lightest-touch integration and could serve as a bridge before a full plugin is built.

---

## 8. The Retrospective

The retrospective is the core differentiator. It transforms passive session logs into an active feedback loop. This is the metaconversation layer: using AI to analyse your AI interactions.

### 8.1 Trigger Modes

| Mode | Trigger | Scope |
|------|---------|-------|
| Immediate | `/retro` or `pretro retro` after session end | Single session |
| Batch | `/retro-batch` or `pretro retro --batch` | Multiple sessions by date/tag/project |
| Scheduled | Cron-style via `pretro retro --cron` | All sessions in time window |
| Threshold | Auto-trigger when correction count exceeds N | Single session, auto-detected |

### 8.2 The Three Passes

#### Pass 1: Factual (deterministic)

Pure data extraction, no LLM. Produces a structured summary:

- Turn count, correction count, time-to-first-response, total session duration.
- Tools used with call counts (Edit: 12, Bash: 5, Write: 3).
- Files modified with change volume (lines added/removed).
- Error signals: test failures in Bash output, rejected responses, reverts.

#### Pass 2: Pattern (deterministic)

Cross-references the session against the local pattern database:

- Exact matches: known anti-patterns detected in correction text or user prompts.
- Statistical matches: tool/task combinations that historically have high correction rates.
- Novel signals: correction types that don't match any known pattern (candidates for new patterns).

#### Pass 3: Insight (LLM-powered)

The metaconversation. The retro-coach subagent (or standalone LLM call) receives the transcript plus pass 1 and 2 outputs. It analyses:

- **What Worked.** Specific prompting strategies that led to good first-pass output.
- **What To Improve.** Identified anti-patterns with references to exact turn numbers.
- **Suggested Rules.** Concrete `.claude/settings.json` or `CLAUDE.md` entries, ready to copy.
- **Suggested Hooks.** `PreToolUse` or `PostToolUse` hook definitions to catch the issues.
- **Playbook Updates.** New or revised prompt templates for the task types encountered.

### 8.3 Retro Coach Prompt Design

Key constraints for the system prompt:

- **Developer behaviour, not code quality.** The retro analyses how the developer interacted with the AI, not the code itself.
- **Specific and actionable.** Every insight must map to a concrete action. No vague "consider improving your prompts."
- **Grounded in data.** The model must reference the factual and pattern pass outputs, not speculate.
- **No blame framing.** Language like "next time, try..." rather than "you should have..."
- **Structured output.** JSON alongside natural language, enabling automatic rule and hook generation.

---

## 9. Pattern Engine

The pattern engine is entirely deterministic. It classifies corrections and failures into a taxonomy of known AI coding mistakes.

### 9.1 Built-in Taxonomy

| Category | Example Patterns | Detection |
|----------|-----------------|-----------|
| Type Safety | Missing type declarations, incorrect generics, any-casting | Correction text + file diff |
| Error Handling | Incomplete catch blocks, missing error types, swallowed errors | AST-level heuristics |
| Database | Transaction misuse, CONCURRENTLY in transactions, missing indices | SQL keyword analysis |
| Framework Pitfalls | Stale closures, missing cleanup, wrong lifecycle methods | Framework-specific rules |
| API Hallucination | Non-existent methods, wrong signatures, deprecated API usage | Import/usage cross-reference |
| Prompt Anti-patterns | Ambiguous scope, missing constraints, no examples provided | Prompt structure analysis |

The taxonomy is extensible. Developers add custom patterns via config or let the retro agent suggest new ones.

### 9.2 Auto-Detection Signals

Not all corrections require manual tagging. The engine auto-detects using:

- Consecutive user turns (developer rejected the response without engaging).
- Rejection phrases: "that's wrong", "you forgot", "start over", "this would crash."
- File reverts detected via tool call analysis.
- Test failures in Bash output immediately following code generation.

---

## 10. Web Dashboard

A local web UI served at `localhost:4100/ui`. Three views:

### Sessions

Filterable list with status indicators, tool badges, tags, and correction counts. Click through to the full transcript with inline code blocks, correction annotations, and pattern badges per turn.

### Patterns

Aggregated view of all detected patterns with frequency bars, tool affinity breakdowns, and trend lines. Each pattern links to the sessions where it appeared.

### Retro Reports

Chronological list of retrospective outputs with generated rules, hooks, and playbook entries. One-click copy for rules and hook JSON. Links back to source sessions.

---

## 11. Design Principles

1. **Local-first.** All data stays on the developer's machine. No telemetry, no cloud sync, no accounts. SQLite database stored in the project directory or global config.
2. **Zero-friction recording.** Hooks and wrappers capture everything passively. The developer changes nothing about their workflow.
3. **BYOK for AI features.** The retro agent uses the developer's own API key. No additional subscriptions.
4. **Actionable over informational.** Every insight maps to a concrete output: a rule, a hook, or a playbook entry.
5. **Tool-agnostic core.** The session store, pattern engine, and retro orchestrator are independent of any specific AI tool. Integrations are thin adapters.
6. **Progressive disclosure.** Useful from day one with passive recording. Patterns emerge over time. Retros are opt-in. Rules are suggested, never forced.

---

## 12. Milestones

### v0.1 — MVP

- Claude Code plugin with `UserPromptSubmit`, `PostToolUse`, and `Stop` hooks.
- SQLite session store with turn and tool call recording.
- `/replay` command for terminal-based session review.
- `/retro` with factual pass and basic pattern matching.
- `pretro log` and `pretro wrap` for Codex CLI capture.
- Web dashboard with sessions list and detail view.

### v0.2 — Retro Agent

- LLM-powered insight pass via retro-coach subagent.
- Auto-generated rules and hooks from retro output.
- Full built-in pattern taxonomy with auto-detection.
- Playbook system for prompt templates.
- Batch retro mode (`/retro-batch` and `pretro retro --batch`).

### v0.3 — Cross-Tool

- MCP server for tool-agnostic access.
- OpenCode plugin (alpha) with tool execution hooks.
- Patterns view and trend analysis in dashboard.
- Threshold-based auto-retro triggers.
- Scheduled retros via cron mode.

### v1.0 — Stable

- OpenCode plugin (stable) with full SDK event integration.
- Plugin marketplace listings for both Claude Code and OpenCode.
- Export to Obsidian/Notion for personal knowledge management.
- Team mode: anonymised pattern sharing (opt-in, self-hosted).

---

## 13. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Hook API changes in Claude Code | Medium | Pin to stable hook events. Maintain compatibility shim. Subscribe to release notes. |
| Codex output format changes | Medium | Abstract the parser behind a versioned adapter. Test against Codex releases. |
| Session transcripts contain sensitive code | High | All data local-only. `.gitignore` store by default. Provide purge commands. |
| Retro agent produces low-quality insights | Medium | Iterate on system prompt. Ground in factual data. Allow users to rate quality. |
| Storage growth over time | Low | Auto-archive old sessions. Compress transcripts. Summarise rather than store full output. |
| OpenCode plugin system instability | Medium | OpenCode is actively maintained with 60k+ GitHub stars. Build behind abstraction layer. Ship as v0.3, not MVP. |

---

## 14. Open Questions

1. Should the retro agent be a Claude Code subagent or a separate process calling the API directly? Subagent benefits from integration; separate process works across all tools.
2. What is the right default for auto-detection sensitivity? Too aggressive produces false corrections; too conservative misses patterns.
3. Should playbook entries be per-project or global? Likely both, with project entries taking precedence.
4. How should the tool handle multi-agent sessions (e.g., parallel tasks in Claude Code with Task tools)? Each subagent thread should map to a separate session with a shared parent.
5. For Codex integration, is the wrapper approach sufficient long-term or should we push for native hook support upstream?
6. Is there appetite for a hosted/team version, or is local-only sufficient for v1?
