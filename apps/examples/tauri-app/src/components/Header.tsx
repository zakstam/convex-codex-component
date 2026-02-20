import type { BridgeState } from "../lib/tauriBridge";
import { useTheme } from "../hooks/useTheme";

type Props = {
  bridge: BridgeState;
  actorUserId: string;
  actorReady: boolean;
  preferredBoundUserId: string | null;
  onStart: () => void;
  onStop: () => void;
  onInterrupt: () => void;
};

export function Header({
  bridge,
  actorUserId,
  actorReady,
  preferredBoundUserId,
  onStart,
  onStop,
  onInterrupt,
}: Props) {
  const { theme, toggle } = useTheme();
  const actorStatus = actorReady
    ? `actor: ${actorUserId}`
    : preferredBoundUserId
      ? `actor: ${actorUserId} (waiting for actor lock)`
      : `actor: ${actorUserId}`;

  return (
    <header className="header" role="toolbar" aria-label="Runtime controls">
      <div className="header-brand">
        <div className="header-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M7 8l4 4-4 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M13 16h4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="header-title-group">
          <h1>
            Codex
            <span className="header-badge">local</span>
          </h1>
          <p className="meta">
            {bridge.threadHandle
              ? `thread ${bridge.threadHandle.slice(0, 10)}...`
              : "no active thread"}
          </p>
          <p className="meta" title="Actor used for host API calls">
            {actorStatus}
          </p>
        </div>
      </div>
      <div className="controls">
        <button
          onClick={onStart}
          disabled={bridge.running}
          aria-label="Start runtime"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 1.5l9 5.5-9 5.5V1.5z" fill="currentColor"/>
          </svg>
          Start
        </button>
        <button
          className="secondary"
          onClick={onStop}
          disabled={!bridge.running}
          aria-label="Stop runtime"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor"/>
          </svg>
          Stop
        </button>
        <button
          className="danger"
          onClick={onInterrupt}
          disabled={!bridge.turnId}
          aria-label="Interrupt current turn"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7.5 1L3 8h4l-1.5 5L11 6H7l.5-5z" fill="currentColor"/>
          </svg>
          Interrupt
        </button>
        <button
          className="ghost icon-btn"
          onClick={toggle}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 1.5v1.5M8 13v1.5M2.5 8H1M15 8h-1.5M3.87 3.87l1.06 1.06M11.07 11.07l1.06 1.06M3.87 12.13l1.06-1.06M11.07 4.93l1.06-1.06" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13.5 8.5a5.5 5.5 0 01-6-6 5.5 5.5 0 106 6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
