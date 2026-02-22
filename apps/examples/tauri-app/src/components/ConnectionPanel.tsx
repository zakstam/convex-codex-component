import type { BridgeState } from "../lib/tauriBridge";

type Props = {
  bridge: BridgeState;
  onStart: () => void;
  onStop: () => void;
  onInterrupt: () => void;
};

export function ConnectionPanel({ bridge, onStart, onStop, onInterrupt }: Props) {
  const statusClass = bridge.lastError
    ? "error"
    : bridge.running
      ? "running"
      : "stopped";

  const statusLabel = bridge.lastError
    ? "Error"
    : bridge.running
      ? "Connected"
      : "Disconnected";

  return (
    <div className="connection-panel">
      <div className="connection-panel-status">
        <span className={`status-dot ${statusClass}`} aria-hidden="true" />
        <span className="connection-panel-status-label">{statusLabel}</span>
      </div>

      {bridge.lastError && (
        <div className="connection-panel-error" role="alert">
          <span className="code" style={{ fontSize: "0.75rem", color: "var(--danger)" }}>
            {bridge.lastErrorCode ? `[${bridge.lastErrorCode}] ` : ""}
            {bridge.lastError}
          </span>
        </div>
      )}

      <div className="connection-panel-controls">
        <button
          onClick={onStart}
          disabled={bridge.running}
          aria-label="Start runtime"
        >
          Start
        </button>
        <button
          className="secondary"
          onClick={onStop}
          disabled={!bridge.running}
          aria-label="Stop runtime"
        >
          Stop
        </button>
        <button
          className="danger"
          onClick={onInterrupt}
          disabled={!bridge.turnId}
          aria-label="Interrupt current turn"
        >
          Interrupt
        </button>
      </div>
    </div>
  );
}
