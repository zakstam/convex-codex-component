import { useRef, useEffect } from "react";
import { MessageBubble } from "./MessageBubble";
import { EmptyState } from "./EmptyState";

type Message = {
  messageId: string;
  turnId: string;
  role: string;
  status: string;
  sourceItemType?: string;
  text: string;
  createdAt: number;
};

type TokenBreakdown = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
};

type Props = {
  messages: Message[];
  status: string;
  tokenByTurnId: Map<string, TokenBreakdown>;
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function MessageList({ messages, status, tokenByTurnId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "LoadingFirstPage";

  // Build a set of messageIds that are the last assistant message per turn
  const lastAssistantByTurn = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant") {
      lastAssistantByTurn.set(msg.turnId, msg.messageId);
    }
  }

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages.length]);

  return (
    <div
      className="messages"
      ref={containerRef}
      role="log"
      aria-label="Message history"
      aria-live="polite"
      aria-busy={isLoading}
    >
      {isLoading && (
        <div className="loading-container">
          <div className="spinner" aria-label="Loading messages" />
        </div>
      )}
      {!isLoading && messages.length === 0 && (
        <EmptyState
          title="No messages yet"
          description="Start the runtime and send a message to begin."
        />
      )}
      {messages.map((message) => {
        const isLastAssistant = lastAssistantByTurn.get(message.turnId) === message.messageId;
        const tokens = isLastAssistant ? tokenByTurnId.get(message.turnId) : undefined;
        return (
          <div key={message.messageId}>
            <MessageBubble message={message} />
            {tokens && (
              <div className="msg-tokens">
                {formatTokens(tokens.totalTokens)} tokens ({formatTokens(tokens.inputTokens)} in / {formatTokens(tokens.outputTokens)} out)
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
