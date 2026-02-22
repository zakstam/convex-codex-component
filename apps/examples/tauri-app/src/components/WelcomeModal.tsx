import { useState, useRef, useEffect } from "react";
import { ACTOR_STORAGE_KEY } from "../hooks/useAppController";

type Props = {
  onSubmit: (username: string) => void;
};

export function WelcomeModal({ onSubmit }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    window.localStorage.setItem(ACTOR_STORAGE_KEY, trimmed);
    onSubmit(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="modal-card welcome-modal">
        <div className="header-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M7 8l4 4-4 4"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M13 16h4"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h2>Welcome to Codex Local</h2>
        <p>Enter a username to get started</p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="username"
          aria-label="Username"
          autoComplete="off"
          spellCheck={false}
        />
        <button disabled={!value.trim()} onClick={handleSubmit}>
          Continue
        </button>
      </div>
    </div>
  );
}
