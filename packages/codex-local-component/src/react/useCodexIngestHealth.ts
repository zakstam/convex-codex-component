"use client";

import { useMemo } from "react";
import type { FunctionArgs } from "convex/server";
import { useCodexThreadState, type CodexThreadStateQuery } from "./useCodexThreadState.js";
import {
  deriveCodexIngestHealth,
  type CodexIngestHealth,
  type CodexIngestHealthThreadState,
} from "./ingestHealth.js";

export type CodexIngestHealthQuery<
  Args = Record<string, unknown>,
  Result extends CodexIngestHealthThreadState = CodexIngestHealthThreadState,
> = CodexThreadStateQuery<Args, Result>;

export function useCodexIngestHealth<Query extends CodexIngestHealthQuery<unknown, CodexIngestHealthThreadState>>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): CodexIngestHealth {
  const threadState = useCodexThreadState(query, args);
  return useMemo(() => deriveCodexIngestHealth(threadState), [threadState]);
}
