import type { BridgeState } from "../lib/tauriBridge";
import { useTheme } from "../hooks/useTheme";

type Props = {
  bridge: BridgeState;
  onStart: () => void;
  onStop: () => void;
  onInterrupt: () => void;
};

export function Header({ bridge, onStart, onStop, onInterrupt }: Props) {
  const { theme, toggle } = useTheme();

  return (
    <header className="header" role="toolbar" aria-label="Runtime controls">
      <div className="header-info">
        <h1>Codex Local Desktop</h1>
        <p className="meta">thread: {bridge.threadId ?? "(none yet)"}</p>
        <p className="meta">runtime: {bridge.runtimeThreadId ?? "(none yet)"}</p>
      </div>
      <div className="controls">
        <button
          onClick={onStart}
          disabled={bridge.running}
          aria-label="Start runtime"
        >
          Start Runtime
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
        <button
          className="ghost"
          onClick={toggle}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </header>
  );
}
