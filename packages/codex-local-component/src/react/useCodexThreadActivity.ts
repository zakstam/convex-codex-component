"use client";

import { useMemo } from "react";
import type { FunctionArgs } from "convex/server";
import { useCodexThreadState, type CodexThreadStateQuery } from "./useCodexThreadState.js";
import { deriveCodexThreadActivity, type CodexThreadActivity, type CodexThreadActivityThreadState } from "./threadActivity.js";

export type CodexThreadActivityQuery<
  Args = Record<string, unknown>,
  Result extends CodexThreadActivityThreadState = CodexThreadActivityThreadState,
> = CodexThreadStateQuery<Args, Result>;

export function useCodexThreadActivity<Query extends CodexThreadActivityQuery<unknown, CodexThreadActivityThreadState>>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): CodexThreadActivity {
  const threadState = useCodexThreadState(query, args);
  return useMemo(() => deriveCodexThreadActivity(threadState), [threadState]);
}
