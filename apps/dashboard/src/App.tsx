import { useEffect, useState } from "react";
import type { PatternRecord, RetroReportRecord, SessionBundle, SessionRecord } from "@prompt-retro/shared-types";

type Tab = "sessions" | "reports" | "patterns";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>("sessions");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [reports, setReports] = useState<RetroReportRecord[]>([]);
  const [patterns, setPatterns] = useState<PatternRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      fetchJson<SessionRecord[]>("/api/sessions"),
      fetchJson<RetroReportRecord[]>("/api/reports"),
      fetchJson<PatternRecord[]>("/api/patterns")
    ])
      .then(([nextSessions, nextReports, nextPatterns]) => {
        setSessions(nextSessions);
        setReports(nextReports);
        setPatterns(nextPatterns);
        if (nextSessions[0]) {
          return fetchJson<SessionBundle>(`/api/sessions/${nextSessions[0].id}`);
        }

        return null;
      })
      .then((bundle) => {
        if (bundle) {
          setSelectedSession(bundle);
        }
      })
      .catch((nextError: unknown) => {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
  }, []);

  const openSession = async (sessionId: string): Promise<void> => {
    setSelectedSession(await fetchJson<SessionBundle>(`/api/sessions/${sessionId}`));
    setTab("sessions");
  };

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Prompt Retro</p>
          <h1>Retrospectives for AI coding sessions</h1>
          <p className="lede">
            Review captured sessions, inspect recurring patterns, and turn corrections into reusable rules.
          </p>
        </div>
        <nav className="tabs" aria-label="Sections">
          {(["sessions", "reports", "patterns"] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              className={tab === item ? "tab active" : "tab"}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>
      </section>

      {error ? <p className="error">Failed to load Prompt Retro data: {error}</p> : null}

      {tab === "sessions" ? (
        <section className="grid">
          <div className="panel list">
            <h2>Sessions</h2>
            {sessions.length === 0 ? <p className="muted">No sessions captured yet.</p> : null}
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={
                  selectedSession?.session.id === session.id ? "session-card active" : "session-card"
                }
                onClick={() => void openSession(session.id)}
              >
                <strong>{session.tool}</strong>
                <span>{session.projectPath}</span>
                <span>{new Date(session.startedAt).toLocaleString()}</span>
              </button>
            ))}
          </div>

          <div className="panel detail">
            <h2>Session detail</h2>
            {!selectedSession ? <p className="muted">Select a session to inspect it.</p> : null}
            {selectedSession ? (
              <>
                <div className="stats">
                  <article>
                    <span>Turns</span>
                    <strong>{selectedSession.turns.length}</strong>
                  </article>
                  <article>
                    <span>Tool calls</span>
                    <strong>{selectedSession.toolCalls.length}</strong>
                  </article>
                  <article>
                    <span>Corrections</span>
                    <strong>{selectedSession.corrections.length}</strong>
                  </article>
                </div>

                <div className="timeline">
                  {selectedSession.turns.map((turn) => (
                    <article key={turn.id} className={`turn turn-${turn.role}`}>
                      <header>
                        <strong>{turn.role}</strong>
                        <span>Turn {turn.turnIndex}</span>
                      </header>
                      <p>{turn.content}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "reports" ? (
        <section className="panel report-list">
          <h2>Retro reports</h2>
          {reports.length === 0 ? <p className="muted">No retros have been run yet.</p> : null}
          {reports.map((report) => (
            <article key={report.id} className="report-card">
              <header>
                <strong>{new Date(report.createdAt).toLocaleString()}</strong>
                <span>{formatDuration(report.factual.totalDurationMs)}</span>
              </header>
              <p>{report.insights?.summary ?? "Deterministic report only."}</p>
              <div className="chips">
                {report.patterns.map((pattern) => (
                  <span key={`${report.id}-${pattern.patternId}`} className="chip">
                    {pattern.name}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {tab === "patterns" ? (
        <section className="panel pattern-list">
          <h2>Patterns</h2>
          {patterns.length === 0 ? <p className="muted">No patterns have been recorded yet.</p> : null}
          {patterns.map((pattern) => (
            <article key={pattern.id} className="pattern-card">
              <header>
                <strong>{pattern.name}</strong>
                <span>{pattern.count}</span>
              </header>
              <p>{pattern.description}</p>
              <small>
                {pattern.category} · {pattern.severity}
              </small>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
