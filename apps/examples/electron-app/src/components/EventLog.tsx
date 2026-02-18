import type { CodexIngestHealth, CodexThreadActivity, CodexThreadActivityThreadState } from "@zakstam/codex-local-component/react";

type Props = {
  threadState: CodexThreadActivityThreadState | null | undefined;
  threadActivity: CodexThreadActivity;
  ingestHealth: CodexIngestHealth;
  runtimeLog: Array<{ id: string; line: string }>;
};

export function EventLog({ threadState, threadActivity, ingestHealth, runtimeLog }: Props) {
  return (
    <section className="panel card event-log" aria-label="Event log">
      <h2>Thread Snapshot</h2>
      <div className="event-log-stats">
        <div className="bridge-field">
          <span className="bridge-field-label">Activity</span>
          <span className="code">{threadActivity.phase}</span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Ingest Health</span>
          <span className="code">{ingestHealth.status}</span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Messages</span>
          <span className="code">
            {threadState?.recentMessages?.length ?? 0}
          </span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Streams</span>
          <span className="code">{threadState?.streamStats?.length ?? 0}</span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Active Turn</span>
          <span className="code">{threadActivity.activeTurnId ?? "—"}</span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Health Issues</span>
          <span className="code">
            {ingestHealth.issues.length > 0 ? ingestHealth.issues.join(", ") : "none"}
          </span>
        </div>
      </div>
      <h3>Runtime Events</h3>
      <div className="event-log-entries">
        {runtimeLog.length === 0 && (
          <p className="code ink-muted">No events yet</p>
        )}
        {runtimeLog.map((entry) => (
          <p className="code event-entry" key={entry.id}>
            {entry.line}
          </p>
        ))}
      </div>
    </section>
  );
}
