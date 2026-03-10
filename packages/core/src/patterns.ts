import type {
  CorrectionRecord,
  PatternMatch,
  PatternRecord,
  SessionBundle,
  TurnRecord
} from "@prompt-retro/shared-types";
import { unique } from "./utils.js";

const BUILTIN_PATTERNS: Omit<PatternRecord, "count">[] = [
  {
    id: "prompt-ambiguous-scope",
    name: "Ambiguous Scope",
    category: "Prompt Anti-patterns",
    description: "Prompt asks for changes without enough constraints or success criteria.",
    severity: "medium",
    toolAffinity: ["claude-code", "codex"]
  },
  {
    id: "api-hallucination",
    name: "API Hallucination",
    category: "API Hallucination",
    description: "Response references methods or behavior that likely do not exist.",
    severity: "high",
    toolAffinity: ["claude-code", "codex"]
  },
  {
    id: "error-handling-gaps",
    name: "Error Handling Gaps",
    category: "Error Handling",
    description: "Generated code or follow-up leaves error paths under-specified.",
    severity: "medium",
    toolAffinity: ["claude-code", "codex"]
  },
  {
    id: "type-safety-regression",
    name: "Type Safety Regression",
    category: "Type Safety",
    description: "The solution weakens typing or introduces unsafe casts.",
    severity: "medium",
    toolAffinity: ["claude-code", "codex"]
  },
  {
    id: "database-transaction-risk",
    name: "Database Transaction Risk",
    category: "Database",
    description: "The workflow shows a risky SQL or transaction pattern.",
    severity: "high",
    toolAffinity: ["claude-code", "codex"]
  },
  {
    id: "framework-lifecycle-pitfall",
    name: "Framework Lifecycle Pitfall",
    category: "Framework Pitfalls",
    description: "A framework-specific lifecycle or closure issue appears likely.",
    severity: "medium",
    toolAffinity: ["claude-code", "codex"]
  }
];

const REJECTION_PHRASES = [
  "that's wrong",
  "you forgot",
  "start over",
  "this would crash",
  "that won't work",
  "incorrect",
  "broken",
  "fix it"
];

export function getBuiltinPatterns(): PatternRecord[] {
  return BUILTIN_PATTERNS.map((pattern) => ({ ...pattern, count: 0 }));
}

export function autoDetectCorrections(turns: TurnRecord[]): CorrectionRecord[] {
  const corrections: CorrectionRecord[] = [];
  let userCorrectionIndex = 0;

  for (const turn of turns) {
    if (turn.role !== "user") {
      continue;
    }

    const lower = turn.content.toLowerCase();
    const matchedPhrase = REJECTION_PHRASES.find((phrase) => lower.includes(phrase));
    if (!matchedPhrase) {
      continue;
    }

    corrections.push({
      id: `auto_correction_${userCorrectionIndex += 1}`,
      sessionId: turn.sessionId,
      turnIndex: turn.turnIndex,
      note: matchedPhrase,
      timestamp: turn.timestamp,
      source: "auto",
      patternIds: []
    });
  }

  return corrections;
}

function collectPromptSignals(turns: TurnRecord[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const firstUserTurn = turns.find((turn) => turn.role === "user");

  if (firstUserTurn && firstUserTurn.content.split(/\s+/).length < 6) {
    matches.push({
      patternId: "prompt-ambiguous-scope",
      name: "Ambiguous Scope",
      category: "Prompt Anti-patterns",
      severity: "medium",
      reason: "The opening prompt is very short and likely underspecified."
    });
  }

  return matches;
}

function collectCorrectionSignals(corrections: CorrectionRecord[]): PatternMatch[] {
  return corrections.flatMap((correction) => {
    const note = correction.note.toLowerCase();
    const matches: PatternMatch[] = [];

    if (note.includes("type") || note.includes("any")) {
      matches.push({
        patternId: "type-safety-regression",
        name: "Type Safety Regression",
        category: "Type Safety",
        severity: "medium",
        reason: "Correction text references unsafe or missing typing."
      });
    }

    if (note.includes("error") || note.includes("catch")) {
      matches.push({
        patternId: "error-handling-gaps",
        name: "Error Handling Gaps",
        category: "Error Handling",
        severity: "medium",
        reason: "Correction text points at missing or weak error handling."
      });
    }

    if (note.includes("sql") || note.includes("transaction") || note.includes("index")) {
      matches.push({
        patternId: "database-transaction-risk",
        name: "Database Transaction Risk",
        category: "Database",
        severity: "high",
        reason: "Correction text references a risky database behavior."
      });
    }

    if (note.includes("react") || note.includes("effect") || note.includes("cleanup")) {
      matches.push({
        patternId: "framework-lifecycle-pitfall",
        name: "Framework Lifecycle Pitfall",
        category: "Framework Pitfalls",
        severity: "medium",
        reason: "Correction text points at a framework lifecycle issue."
      });
    }

    if (note.includes("method") || note.includes("doesn't exist") || note.includes("wrong api")) {
      matches.push({
        patternId: "api-hallucination",
        name: "API Hallucination",
        category: "API Hallucination",
        severity: "high",
        reason: "Correction text suggests the model invented or misused an API."
      });
    }

    return matches;
  });
}

export function matchPatterns(bundle: SessionBundle): PatternMatch[] {
  const matches = [...collectPromptSignals(bundle.turns), ...collectCorrectionSignals(bundle.corrections)];
  const seen = new Set<string>();

  return matches.filter((match) => {
    const key = `${match.patternId}:${match.reason}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function summarizePatternCounts(bundles: SessionBundle[]): PatternRecord[] {
  const counts = new Map<string, number>();

  for (const bundle of bundles) {
    for (const match of matchPatterns(bundle)) {
      counts.set(match.patternId, (counts.get(match.patternId) ?? 0) + 1);
    }
  }

  return getBuiltinPatterns()
    .map((pattern) => ({ ...pattern, count: counts.get(pattern.id) ?? 0 }))
    .filter((pattern) => pattern.count > 0)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function inferWhatWorked(bundle: SessionBundle): string[] {
  const worked: string[] = [];

  if (bundle.toolCalls.length > 0) {
    worked.push("You used tools instead of relying only on prose, which keeps the session grounded.");
  }

  if (bundle.turns.filter((turn) => turn.role === "user").length <= 3) {
    worked.push("The session stayed fairly concise, which usually helps preserve clear intent.");
  }

  return unique(worked);
}
