"use client";

import { useMemo } from "react";
import type { FunctionArgs } from "convex/server";
import { useCodexThreadState, type CodexThreadStateQuery } from "./useCodexThreadState.js";
import {
  deriveCodexBranchActivity,
  type CodexBranchActivityOptions,
} from "./branchActivity.js";
import type { CodexThreadActivity, CodexThreadActivityThreadState } from "./threadActivity.js";

export type CodexBranchActivityQuery<
  Args = Record<string, unknown>,
  Result extends CodexThreadActivityThreadState = CodexThreadActivityThreadState,
> = CodexThreadStateQuery<Args, Result>;

export function useCodexBranchActivity<Query extends CodexBranchActivityQuery<unknown, CodexThreadActivityThreadState>>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
  options?: CodexBranchActivityOptions,
): CodexThreadActivity {
  const threadState = useCodexThreadState(query, args);
  return useMemo(() => deriveCodexBranchActivity(threadState, options), [options, threadState]);
}
