"use client";

import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

export type CodexThreadStateQuery<Args = Record<string, unknown>, Result = unknown> = FunctionReference<
  "query",
  "public",
  {
    threadId: string;
  } & Args,
  Result
>;

export function useCodexThreadState<Query extends CodexThreadStateQuery<unknown, unknown>>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): FunctionReturnType<Query> | undefined {
  const queryArgs = (args === "skip" ? ["skip"] : [args]) as unknown as OptionalRestArgsOrSkip<Query>;
  return useQuery(query, ...queryArgs);
}
