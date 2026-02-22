type Props = {
  conversationId: string;
  preview: string;
  status: string;
  scope: "persisted" | "local_unsynced";
  updatedAt?: number | undefined;
  messageCount?: number | undefined;
  active: boolean;
  onClick: () => void;
  onDelete?: (conversationId: string) => void;
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

function formatMessageCount(count?: number): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return null;
  }
  const rounded = Math.floor(count);
  return `${rounded} msg${rounded === 1 ? "" : "s"}`;
}

export function ThreadItem({
  conversationId,
  preview,
  status,
  scope,
  updatedAt,
  messageCount,
  active,
  onClick,
  onDelete,
}: Props) {
  const isLocal = scope === "local_unsynced";
  const dotClass = isLocal
    ? "thread-item-dot local"
    : status === "active"
      ? "thread-item-dot active"
      : "thread-item-dot inactive";

  const meta = isLocal
    ? formatMessageCount(messageCount)
    : formatRelativeTime(updatedAt);

  return (
    <div className={`thread-item-row${active ? " active" : ""}`}>
      <button
        className={`thread-item${active ? " active" : ""}`}
        onClick={onClick}
        type="button"
      >
        <span className={dotClass} aria-hidden="true" />
        <span className="thread-item-preview">{preview}</span>
        {meta && <span className="thread-item-meta">{meta}</span>}
      </button>
      {onDelete && (
        <button
          className="thread-item-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(conversationId);
          }}
          type="button"
          aria-label={`Delete conversation: ${preview}`}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
