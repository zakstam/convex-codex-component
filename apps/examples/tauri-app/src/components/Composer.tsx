import { useRef, useCallback, type KeyboardEvent } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  sending?: boolean;
};

export function Composer({ value, onChange, onSubmit, disabled, sending }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send a message... (Enter to send)"
        aria-label="Message input"
        disabled={disabled}
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim() || sending}
        aria-label="Send message"
      >
        {sending ? "Sending..." : "Send"}
      </button>
    </div>
  );
}
