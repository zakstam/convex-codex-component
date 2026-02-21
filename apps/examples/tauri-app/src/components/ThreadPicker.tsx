import { useState, useRef, useEffect } from "react";

type Thread = {
  threadHandle: string;
  status: string;
  preview: string;
  updatedAt?: number;
  scope?: "persisted" | "local_unsynced";
};

type Props = {
  threads: Thread[];
  selected: string;
  onSelect: (threadHandle: string) => void;
  disabled: boolean;
  showLocalThreads: boolean;
  onToggleShowLocalThreads: (next: boolean) => void;
};

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ThreadPicker({
  threads,
  selected,
  onSelect,
  disabled,
  showLocalThreads,
  onToggleShowLocalThreads,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedThread = threads.find((t) => t.threadHandle === selected);
  const displayLabel = selectedThread
    ? `${selectedThread.preview} • ${selectedThread.scope === "local_unsynced" ? "local unsynced" : selectedThread.status}`
    : "New thread";
  const persistedThreads = threads.filter((thread) => thread.scope !== "local_unsynced");
  const localUnsyncedThreads = threads.filter((thread) => thread.scope === "local_unsynced");

  return (
    <div
      className="thread-picker"
      ref={ref}
      role="listbox"
      aria-label="Thread selection"
    >
      <button
        className="thread-picker-trigger"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={`status-dot ${selectedThread ? "running" : "stopped"}`} aria-hidden="true" />
        <span className="thread-picker-label">{displayLabel}</span>
        <span className="thread-picker-chevron" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>
      <label className="thread-picker-local-toggle">
        <input
          type="checkbox"
          checked={showLocalThreads}
          onChange={(event) => onToggleShowLocalThreads(event.target.checked)}
        />
        <span>Show local unsynced threads</span>
      </label>
      {open && (
        <div className="thread-picker-dropdown">
          <button
            className={`thread-picker-option ${!selected ? "active" : ""}`}
            onClick={() => {
              onSelect("");
              setOpen(false);
            }}
            role="option"
            aria-selected={!selected}
          >
            <span className="status-dot stopped" aria-hidden="true" />
            <span>Start a new thread</span>
          </button>
          {persistedThreads.map((thread) => (
            <button
              key={thread.threadHandle}
              className={`thread-picker-option ${thread.threadHandle === selected ? "active" : ""}`}
              onClick={() => {
                onSelect(thread.threadHandle);
                setOpen(false);
              }}
              role="option"
              aria-selected={thread.threadHandle === selected}
            >
              <span
                className={`status-dot ${thread.status === "active" ? "running" : "stopped"}`}
                aria-hidden="true"
              />
              <span className="thread-option-id">
                {thread.preview}
              </span>
              <span className={`status-badge ${thread.status}`}>
                {thread.status}
              </span>
              {thread.updatedAt && (
                <span className="thread-option-time">
                  {formatRelativeTime(thread.updatedAt)}
                </span>
              )}
            </button>
          ))}
          {showLocalThreads && localUnsyncedThreads.length > 0 && (
            <div className="thread-picker-section">
              <p className="thread-picker-section-label">Local unsynced</p>
              {localUnsyncedThreads.map((thread) => (
                <button
                  key={thread.threadHandle}
                  className={`thread-picker-option ${thread.threadHandle === selected ? "active" : ""}`}
                  onClick={() => {
                    onSelect(thread.threadHandle);
                    setOpen(false);
                  }}
                  role="option"
                  aria-selected={thread.threadHandle === selected}
                >
                  <span className="status-dot running" aria-hidden="true" />
                  <span className="thread-option-id">
                    {thread.preview}
                  </span>
                  <span className="status-badge local-unsynced">local unsynced</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
