"use client";

import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
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

export function useCodexAutoResume<Query extends CodexResumeStreamQuery<unknown>>(
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

  const toQueryArgs = (): FunctionArgs<Query> | "skip" => {
    if (args === "skip" || options?.enabled === false) {
      return "skip";
    }
    return { ...args, fromCursor: cursor };
  };

  const result = useQuery(
    query,
    ...((toQueryArgs() === "skip" ? ["skip"] : [toQueryArgs()]) as unknown as OptionalRestArgsOrSkip<Query>),
  );

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
