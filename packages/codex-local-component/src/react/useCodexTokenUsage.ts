"use client";

import { useMemo } from "react";
import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import {
  deriveCodexTokenUsage,
  type CodexTokenUsage,
  type CodexTurnTokenUsage,
} from "./tokenUsage.js";

export type CodexTokenUsageQuery<
  Args = Record<string, unknown>,
> = FunctionReference<
  "query",
  "public",
  {
    threadId: string;
  } & Args,
  CodexTurnTokenUsage[]
>;

export function useCodexTokenUsage<Query extends CodexTokenUsageQuery<unknown>>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): CodexTokenUsage {
  const queryArgs = (args === "skip" ? ["skip"] : [args]) as unknown as OptionalRestArgsOrSkip<Query>;
  const rawTurns = useQuery(query, ...queryArgs);
  return useMemo(() => deriveCodexTokenUsage(rawTurns), [rawTurns]);
}
