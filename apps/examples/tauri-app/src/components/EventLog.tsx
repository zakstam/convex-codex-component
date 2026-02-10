type Props = {
  threadState:
    | { recentMessages: unknown[]; streamStats: unknown[] }
    | undefined;
  runtimeLog: Array<{ id: string; line: string }>;
};

export function EventLog({ threadState, runtimeLog }: Props) {
  return (
    <section className="panel card event-log" aria-label="Event log">
      <h2>Thread Snapshot</h2>
      <div className="event-log-stats">
        <div className="bridge-field">
          <span className="bridge-field-label">Messages</span>
          <span className="code">
            {threadState?.recentMessages.length ?? 0}
          </span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Streams</span>
          <span className="code">{threadState?.streamStats.length ?? 0}</span>
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
