"use client";

import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { toOptionalRestArgsOrSkip } from "./queryArgs.js";

export type CodexThreadStateQuery<Args = Record<string, unknown>, Result = unknown> = FunctionReference<
  "query",
  "public",
  { conversationId: string } & Args,
  Result
>;

export function useCodexThreadState<Query extends CodexThreadStateQuery<unknown, unknown>>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): FunctionReturnType<Query> | undefined {
  const queryArgs = toOptionalRestArgsOrSkip<Query>(args);
  return useQuery(query, ...queryArgs);
}
