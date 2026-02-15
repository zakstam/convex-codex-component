"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import {
  deriveCodexTokenUsage,
  type CodexTokenUsage,
  type CodexTurnTokenUsage,
} from "./tokenUsage.js";
import { toOptionalRestArgsOrSkip } from "./queryArgs.js";

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
  const queryArgs = toOptionalRestArgsOrSkip<Query>(args);
  const rawTurns = useQuery(query, ...queryArgs);
  return useMemo(() => deriveCodexTokenUsage(rawTurns), [rawTurns]);
}
