import { useTheme } from "../hooks/useTheme";

type Props = {
  running: boolean;
  hasError: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onToggleDrawer: () => void;
};

export function Header({
  running,
  hasError,
  sidebarOpen,
  onToggleSidebar,
  onToggleDrawer,
}: Props) {
  const { theme, toggle } = useTheme();

  const statusClass = hasError ? "error" : running ? "running" : "stopped";

  return (
    <header className="header" role="toolbar" aria-label="App controls">
      <div className="header-brand">
        <button
          className="ghost icon-btn"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          aria-expanded={sidebarOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="header-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M7 8l4 4-4 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M13 16h4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </div>
        <h1 className="header-title">
          Codex Local
          <span className={`status-dot ${statusClass}`} aria-label={hasError ? "Error" : running ? "Connected" : "Disconnected"} />
        </h1>
      </div>
      <div className="controls">
        <button
          className="ghost icon-btn"
          onClick={onToggleDrawer}
          aria-label="Open settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6.86 2h2.28l.32 1.6a5.5 5.5 0 011.18.68l1.54-.52.98 1.7-1.22 1.08a5.5 5.5 0 010 1.36l1.22 1.08-.98 1.7-1.54-.52a5.5 5.5 0 01-1.18.68L9.14 14H6.86l-.32-1.6a5.5 5.5 0 01-1.18-.68l-1.54.52-.98-1.7 1.22-1.08a5.5 5.5 0 010-1.36L2.84 7.02l.98-1.7 1.54.52A5.5 5.5 0 016.54 5.16L6.86 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
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
