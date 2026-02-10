import { useRef, useEffect } from "react";
import { MessageBubble } from "./MessageBubble";
import { EmptyState } from "./EmptyState";

type Message = {
  messageId: string;
  role: string;
  status: string;
  text: string;
  createdAt: number;
};

type Props = {
  messages: Message[];
  status: string;
};

export function MessageList({ messages, status }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "LoadingFirstPage";

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
      {messages.map((message) => (
        <MessageBubble key={message.messageId} message={message} />
      ))}
    </div>
  );
}
