import { useState } from "react";
import type { CodexTokenUsage, CodexTokenUsageBreakdown } from "@zakstam/codex-runtime-react";

type Props = {
  tokenUsage: CodexTokenUsage | null;
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function BreakdownFields({ breakdown, label }: { breakdown: CodexTokenUsageBreakdown; label?: string }) {
  return (
    <div className="token-usage-summary">
      {label && <h3>{label}</h3>}
      <div className="bridge-field">
        <span className="bridge-field-label">Total</span>
        <span className="code">{formatTokens(breakdown.totalTokens)}</span>
      </div>
      <div className="bridge-field">
        <span className="bridge-field-label">Input</span>
        <span className="code">{formatTokens(breakdown.inputTokens)}</span>
      </div>
      <div className="bridge-field">
        <span className="bridge-field-label">Cached Input</span>
        <span className="code">{formatTokens(breakdown.cachedInputTokens)}</span>
      </div>
      <div className="bridge-field">
        <span className="bridge-field-label">Output</span>
        <span className="code">{formatTokens(breakdown.outputTokens)}</span>
      </div>
      <div className="bridge-field">
        <span className="bridge-field-label">Reasoning</span>
        <span className="code">{formatTokens(breakdown.reasoningOutputTokens)}</span>
      </div>
    </div>
  );
}

export function TokenUsagePanel({ tokenUsage }: Props) {
  const [expandedTurnId, setExpandedTurnId] = useState<string | null>(null);

  if (!tokenUsage || tokenUsage.status === "loading") {
    return (
      <section className="panel card" aria-label="Token usage">
        <h2>Token Usage</h2>
        <p className="code ink-muted">Loading token data…</p>
      </section>
    );
  }

  if (tokenUsage.status === "empty") {
    return (
      <section className="panel card" aria-label="Token usage">
        <h2>Token Usage</h2>
        <p className="code ink-muted">No token data yet</p>
      </section>
    );
  }

  return (
    <section className="panel card" aria-label="Token usage">
      <h2>Token Usage</h2>

      <BreakdownFields breakdown={tokenUsage.cumulative} label="Cumulative" />

      {tokenUsage.modelContextWindow !== null && (
        <div className="token-usage-summary">
          <div className="bridge-field">
            <span className="bridge-field-label">Context Window</span>
            <span className="code">{formatTokens(tokenUsage.modelContextWindow)}</span>
          </div>
        </div>
      )}

      {tokenUsage.turns.length > 0 && (
        <div className="token-turns">
          <h3>Per-Turn Breakdown ({tokenUsage.turns.length})</h3>
          {tokenUsage.turns.map((turn) => {
            const isExpanded = expandedTurnId === turn.turnId;
            return (
              <div className="token-turn" key={turn.turnId}>
                <button
                  className="token-turn-header"
                  onClick={() => setExpandedTurnId(isExpanded ? null : turn.turnId)}
                  aria-expanded={isExpanded}
                >
                  <span className="token-turn-id">{turn.turnId.slice(0, 8)}…</span>
                  <span className="code">{formatTokens(turn.last.totalTokens)} this turn</span>
                  <span className="token-turn-chevron">{isExpanded ? "▾" : "▸"}</span>
                </button>
                {isExpanded && (
                  <div className="token-turn-details">
                    <BreakdownFields breakdown={turn.last} label="This Turn" />
                    <BreakdownFields breakdown={turn.total} label="Cumulative at Turn" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
