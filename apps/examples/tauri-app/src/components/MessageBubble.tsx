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

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
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

  return (
    <article
      className={`msg ${isUser ? "user" : "assistant"} ${isReasoning ? "reasoning" : ""}`}
      data-status={message.status}
      aria-label={`${isReasoning ? "reasoning" : message.role} message`}
    >
      <p className="label">
        {isReasoning ? "reasoning" : message.role}
        <span className={`status-badge ${statusClass}`} data-status={message.status}>
          {message.status}
        </span>
      </p>
      <div className={`msg-body ${isStreaming ? "streaming" : ""}`}>
        {message.text || "(empty)"}
      </div>
    </article>
  );
}
