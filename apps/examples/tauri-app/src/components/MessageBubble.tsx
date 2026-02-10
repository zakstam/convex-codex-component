type Props = {
  message: {
    messageId: string;
    role: string;
    status: string;
    sourceItemType?: string;
    text: string;
    createdAt: number;
  };
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";
  const isReasoning = message.sourceItemType === "reasoning";
  const isStreaming = message.status === "streaming";

  const statusClass =
    message.status === "streaming"
      ? "streaming"
      : message.status === "completed"
        ? "completed"
        : message.status === "failed"
          ? "failed"
          : message.status === "interrupted"
            ? "interrupted"
            : "";

  const roleLabel = isReasoning
    ? "thinking"
    : isUser
      ? "you"
      : isTool
        ? "tool"
        : isSystem
          ? "system"
          : "codex";
  const avatarLetter = isReasoning ? "R" : isUser ? "U" : isTool ? "T" : isSystem ? "S" : "C";

  return (
    <article
      className={`msg ${isUser ? "user" : isTool ? "tool" : isSystem ? "system" : "assistant"} ${isReasoning ? "reasoning" : ""}`}
      data-status={message.status}
      aria-label={`${isReasoning ? "reasoning" : message.role} message`}
    >
      <span className="msg-avatar">{avatarLetter}</span>
      <div className="msg-content">
        <div className="msg-meta">
          <span className="msg-role">{roleLabel}</span>
          <span className={`status-badge ${statusClass}`}>{message.status}</span>
          <span className="msg-time">{formatTime(message.createdAt)}</span>
        </div>
        <div className="msg-bubble">
          <div className={`msg-body ${isStreaming ? "streaming" : ""}`}>
            {message.text || "(empty)"}
          </div>
        </div>
      </div>
    </article>
  );
}
