import type { BridgeState } from "../lib/tauriBridge";

type Props = {
  bridge: BridgeState;
};

export function BridgeStatus({ bridge }: Props) {
  const statusClass = bridge.lastError
    ? "error"
    : bridge.running
      ? "running"
      : "stopped";

  return (
    <section className="panel card bridge-status" role="status" aria-label="Bridge status">
      <h2>
        <span className={`status-dot ${statusClass}`} aria-hidden="true" />
        Bridge State
      </h2>
      <div className="bridge-fields">
        <div className="bridge-field">
          <span className="bridge-field-label">Status</span>
          <span className={`status-badge ${statusClass}`}>
            {bridge.lastError ? "Error" : bridge.running ? "Running" : "Stopped"}
          </span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Turn</span>
          <span className="code">{bridge.turnId ?? "—"}</span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Local Thread</span>
          <span className="code">{bridge.localThreadId ?? "—"}</span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Pending</span>
          <span className="code">{bridge.pendingServerRequestCount ?? 0}</span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Ingest Enqueued</span>
          <span className="code">{bridge.ingestEnqueuedEventCount ?? 0}</span>
        </div>
        <div className="bridge-field">
          <span className="bridge-field-label">Ingest Skipped</span>
          <span className="code">{bridge.ingestSkippedEventCount ?? 0}</span>
        </div>
        {bridge.lastError && (
          <div className="bridge-field error-field">
            <span className="bridge-field-label">Error</span>
            <span className="code error-text">
              {bridge.lastErrorCode ? `[${bridge.lastErrorCode}] ` : ""}
              {bridge.lastError}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
