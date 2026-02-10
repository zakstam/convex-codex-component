type Props = {
  message: {
    messageId: string;
    role: string;
    status: string;
    text: string;
    createdAt: number;
  };
};

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
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
      className={`msg ${isUser ? "user" : "assistant"}`}
      data-status={message.status}
      aria-label={`${message.role} message`}
    >
      <p className="label">
        {message.role}
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
