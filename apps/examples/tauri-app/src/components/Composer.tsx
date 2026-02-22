import { useRef, useCallback, type KeyboardEvent } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onInsertToolPrompt?: () => void;
  disabled: boolean;
  sending?: boolean;
  syncProgressLabel?: string;
  syncProgressState?: "idle" | "syncing" | "synced" | "partial" | "drifted" | "cancelled" | "failed" | null;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  onInsertToolPrompt,
  disabled,
  sending,
  syncProgressLabel,
  syncProgressState,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const syncSuffix = syncProgressState === "syncing"
    ? "syncing"
    : syncProgressState === "partial"
      ? "partial"
      : syncProgressState === "failed" || syncProgressState === "drifted" || syncProgressState === "cancelled"
        ? "failed"
        : null;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!disabled && value.trim()) {
          onSubmit();
        }
      }
    },
    [disabled, value, onSubmit],
  );

  const handleSubmit = useCallback(() => {
    onSubmit();
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [onSubmit]);

  return (
    <div className="composer" role="form" aria-label="Message composer">
      <div className="composer-toolbar">
        <button
          className="secondary"
          type="button"
          onClick={onInsertToolPrompt}
          disabled={disabled || sending}
          aria-label="Insert dynamic tool prompt"
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7.5 1L3 8h4l-1.5 5L11 6H7l.5-5z" fill="currentColor"/>
          </svg>
          Snapshot
        </button>
      </div>
      {syncProgressLabel && (
        <div
          className={`composer-sync-badge ${syncSuffix ?? "synced"}`}
          aria-live="polite"
          aria-label="Conversation sync progress"
        >
          {syncProgressLabel}
          {syncSuffix ? ` • ${syncSuffix}` : ""}
        </div>
      )}
      <div className="composer-input-wrap">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          aria-label="Message input"
          disabled={disabled}
        />
        <button
          className="composer-send"
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !value.trim() || sending}
          aria-label={sending ? "Sending message" : "Send message"}
        >
          {sending ? (
            <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 8h12M9 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>
      <p className="composer-hint">Enter to send, Shift+Enter for newline</p>
    </div>
  );
}
