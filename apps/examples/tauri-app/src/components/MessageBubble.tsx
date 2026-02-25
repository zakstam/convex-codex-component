import { memo } from "react";

type Props = {
  message: {
    messageId: string;
    turnId: string;
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

function formatToolCallText(sourceItemType: string | undefined, messageText: string): string {
  switch (sourceItemType) {
    case "commandExecution":
      return messageText.trim() ? `Command: ${messageText}` : "Command execution";
    case "fileChange":
      return "File change";
    case "mcpToolCall":
      return "MCP tool call";
    case "collabAgentToolCall":
      return "Collab agent tool call";
    case "dynamicToolCall":
      return messageText.trim() ? `Dynamic tool: ${messageText}` : "Dynamic tool call";
    case "toolUserInputRequest":
      return "Tool requested user input";
    case "webSearch":
      return "Web search";
    case "imageView":
      return "Image view";
    default:
      return sourceItemType ? sourceItemType : "Tool call";
  }
}

export const MessageBubble = memo(
  function MessageBubble({ message }: Props) {
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
            {isTool ? formatToolCallText(message.sourceItemType, message.text) : message.text || "(empty)"}
          </div>
        </div>
      </div>
    </article>
  );
  },
  (prev, next) =>
    prev.message.messageId === next.message.messageId &&
    prev.message.status === next.message.status &&
    prev.message.text === next.message.text,
);
