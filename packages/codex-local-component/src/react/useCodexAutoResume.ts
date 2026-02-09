"use client";

import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CodexStreamDeltaLike } from "../mapping.js";

export type CodexResumeStreamQuery<Args = Record<string, unknown>> = FunctionReference<
  "query",
  "public",
  {
    threadId: string;
    turnId: string;
    fromCursor: number;
  } & Args,
  {
    deltas: CodexStreamDeltaLike[];
    nextCursor: number;
  }
>;

export type CodexResumeStreamQueryArgs<Query extends CodexResumeStreamQuery<unknown>> =
  Query extends CodexResumeStreamQuery<unknown>
    ? Omit<FunctionArgs<Query>, "fromCursor">
    : never;

export function useCodexAutoResume<Query extends CodexResumeStreamQuery<any>>(
  query: Query,
  args: CodexResumeStreamQueryArgs<Query> | "skip",
  options?: {
    enabled?: boolean;
    initialCursor?: number;
    maxDeltas?: number;
  },
): {
  deltas: CodexStreamDeltaLike[];
  cursor: number;
  resetToDurable: () => void;
} {
  const [cursor, setCursor] = useState(options?.initialCursor ?? 0);
  const [deltas, setDeltas] = useState<CodexStreamDeltaLike[]>([]);

  const threadTurnKey =
    args === "skip" ? "skip" : `${args.threadId}:${args.turnId}`;
  useEffect(() => {
    setCursor(options?.initialCursor ?? 0);
    setDeltas([]);
  }, [threadTurnKey, options?.initialCursor]);

  const result = useQuery(
    query,
    args === "skip" || options?.enabled === false
      ? ("skip" as const)
      : ({ ...args, fromCursor: cursor } as FunctionArgs<Query>),
  ) as FunctionReturnType<Query> | undefined;

  useEffect(() => {
    if (!result || result.deltas.length === 0) {
      return;
    }
    setCursor((current) => Math.max(current, result.nextCursor));
    setDeltas((current) => {
      const merged = [...current, ...result.deltas];
      const maxDeltas = options?.maxDeltas ?? 5000;
      return merged.slice(-maxDeltas);
    });
  }, [options?.maxDeltas, result]);

  const resetToDurable = useCallback(() => {
    setCursor(options?.initialCursor ?? 0);
    setDeltas([]);
  }, [options?.initialCursor]);

  return useMemo(
    () => ({ deltas, cursor, resetToDurable }),
    [deltas, cursor, resetToDurable],
  );
}
