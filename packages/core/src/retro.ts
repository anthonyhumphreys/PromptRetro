import type {
  AppConfig,
  RetroActionSuggestion,
  RetroInsight,
  RetroMetrics,
  RetroReportRecord,
  SessionBundle
} from "@prompt-retro/shared-types";
import { autoDetectCorrections, inferWhatWorked, matchPatterns } from "./patterns.js";
import { createRetroProvider } from "./providers.js";
import { createId, nowIso, unique } from "./utils.js";
import { PromptRetroStore } from "./db.js";

function inferErrorSignals(bundle: SessionBundle): string[] {
  const signals: string[] = [];

  for (const toolCall of bundle.toolCalls) {
    const output = (toolCall.output ?? "").toLowerCase();
    if (output.includes("error") || output.includes("failed") || output.includes("exception")) {
      signals.push(`${toolCall.toolName} emitted an error-like output`);
    }
  }

  return unique(signals);
}

export function buildFactualMetrics(bundle: SessionBundle): RetroMetrics {
  const correctionCount = bundle.corrections.length;
  const filesTouched = unique(bundle.toolCalls.map((toolCall) => toolCall.filePath).filter(Boolean) as string[]);
  const toolUsage = bundle.toolCalls.reduce<Record<string, number>>((usage, toolCall) => {
    usage[toolCall.toolName] = (usage[toolCall.toolName] ?? 0) + 1;
    return usage;
  }, {});

  const endedAt = bundle.session.endedAt ? new Date(bundle.session.endedAt).getTime() : Date.now();
  const startedAt = new Date(bundle.session.startedAt).getTime();

  return {
    turnCount: bundle.turns.length,
    toolCallCount: bundle.toolCalls.length,
    correctionCount,
    totalDurationMs: Math.max(0, endedAt - startedAt),
    filesTouched,
    toolUsage,
    errorSignals: inferErrorSignals(bundle)
  };
}

function buildDeterministicActions(bundle: SessionBundle): RetroActionSuggestion[] {
  const actions: RetroActionSuggestion[] = [];
  const userTurns = bundle.turns.filter((turn) => turn.role === "user");

  if (userTurns[0] && userTurns[0].content.split(/\s+/).length < 6) {
    actions.push({
      kind: "playbook",
      title: "Use a scoped prompt opener",
      content: "Template: Goal, constraints, files in scope, and how to verify success.",
      source: "deterministic"
    });
  }

  if (bundle.toolCalls.some((toolCall) => (toolCall.output ?? "").toLowerCase().includes("error"))) {
    actions.push({
      kind: "hook",
      title: "Require failing command summary",
      content: "Add a post-tool reminder that any failing command must be summarized before more edits.",
      source: "deterministic"
    });
  }

  if (bundle.corrections.length > 0) {
    actions.push({
      kind: "rule",
      title: "Restate acceptance criteria after correction",
      content: "When the user corrects a solution, restate the updated constraint before proposing changes.",
      source: "deterministic"
    });
  }

  return actions;
}

function buildFallbackInsights(bundle: SessionBundle): RetroInsight {
  const corrections = bundle.corrections.map((correction) => correction.note);
  return {
    summary:
      corrections.length > 0
        ? "The session needed corrections, so the strongest leverage is tightening prompts and verification loops."
        : "The session appears healthy, with no explicit correction signals detected.",
    whatWorked: inferWhatWorked(bundle),
    whatToImprove:
      corrections.length > 0
        ? corrections.map((note) => `Address the repeated correction theme: ${note}`)
        : ["Capture one explicit success pattern from this session into the playbook."],
    suggestions: []
  };
}

export async function runRetro(
  store: PromptRetroStore,
  sessionId: string,
  config?: Pick<AppConfig, "retroProvider">
): Promise<RetroReportRecord> {
  const bundle = store.getSessionBundle(sessionId);
  if (!bundle) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const autoCorrections = autoDetectCorrections(bundle.turns).filter(
    (autoCorrection) =>
      !bundle.corrections.some(
        (correction) => correction.turnIndex === autoCorrection.turnIndex && correction.note === autoCorrection.note
      )
  );

  for (const correction of autoCorrections) {
    store.insertCorrection(correction);
  }

  const refreshedBundle = store.getSessionBundle(sessionId)!;
  const patterns = matchPatterns(refreshedBundle);
  const factual = buildFactualMetrics(refreshedBundle);
  const deterministicActions = buildDeterministicActions(refreshedBundle);
  const provider = config?.retroProvider ? createRetroProvider(config.retroProvider) : undefined;

  let insights = buildFallbackInsights(refreshedBundle);
  if (provider) {
    try {
      const providerInsights = await provider.analyze({
        bundle: refreshedBundle,
        metrics: factual,
        patterns
      });
      insights = providerInsights;
    } catch (error) {
      insights = {
        ...insights,
        whatToImprove: [
          ...insights.whatToImprove,
          `LLM insight pass failed: ${error instanceof Error ? error.message : String(error)}`
        ]
      };
    }
  }

  const report: RetroReportRecord = {
    id: createId("retro"),
    sessionIds: [sessionId],
    createdAt: nowIso(),
    factual,
    patterns,
    insights,
    actions: [...deterministicActions, ...(insights.suggestions ?? [])]
  };

  store.saveRetroReport(report);
  store.incrementPatternCount(patterns.map((pattern) => pattern.patternId));
  return report;
}
