"use client";

export type CodexTokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type CodexTurnTokenUsage = {
  turnId: string;
  total: CodexTokenUsageBreakdown;
  last: CodexTokenUsageBreakdown;
  modelContextWindow?: number;
  updatedAt: number;
};

export type CodexTokenUsage =
  | { status: "loading"; turns: []; cumulative: null; modelContextWindow: null }
  | { status: "empty"; turns: []; cumulative: null; modelContextWindow: null }
  | {
      status: "ready";
      turns: CodexTurnTokenUsage[];
      cumulative: CodexTokenUsageBreakdown;
      modelContextWindow: number | null;
    };

export function deriveCodexTokenUsage(
  rawTurns: CodexTurnTokenUsage[] | null | undefined,
): CodexTokenUsage {
  if (rawTurns === undefined) {
    return { status: "loading", turns: [], cumulative: null, modelContextWindow: null };
  }
  if (rawTurns === null || rawTurns.length === 0) {
    return { status: "empty", turns: [], cumulative: null, modelContextWindow: null };
  }

  const latest = rawTurns[rawTurns.length - 1]!;

  return {
    status: "ready",
    turns: rawTurns,
    cumulative: latest.total,
    modelContextWindow: latest.modelContextWindow ?? null,
  };
}
