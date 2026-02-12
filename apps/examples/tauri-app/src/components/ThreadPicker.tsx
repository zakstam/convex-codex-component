import { useState, useRef, useEffect } from "react";

type Thread = {
  threadId: string;
  runtimeThreadId?: string | null;
  status: string;
  createdAt?: number;
};

type Props = {
  threads: Thread[];
  selected: string;
  onSelect: (threadId: string) => void;
  disabled: boolean;
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

export function ThreadPicker({ threads, selected, onSelect, disabled }: Props) {
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

  const filteredThreads = threads.filter((t) => !!t.runtimeThreadId);
  const selectedThread = filteredThreads.find((t) => t.threadId === selected);
  const displayLabel = selectedThread
    ? `${selectedThread.threadId.slice(0, 12)}... • ${selectedThread.status}`
    : "New thread";

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
          {filteredThreads.map((thread) => (
            <button
              key={thread.threadId}
              className={`thread-picker-option ${thread.threadId === selected ? "active" : ""}`}
              onClick={() => {
                onSelect(thread.threadId);
                setOpen(false);
              }}
              role="option"
              aria-selected={thread.threadId === selected}
            >
              <span
                className={`status-dot ${thread.status === "active" ? "running" : "stopped"}`}
                aria-hidden="true"
              />
              <span className="thread-option-id">
                {thread.threadId.slice(0, 16)}...
              </span>
              <span className={`status-badge ${thread.status}`}>
                {thread.status}
              </span>
              {thread.createdAt && (
                <span className="thread-option-time">
                  {formatRelativeTime(thread.createdAt)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
