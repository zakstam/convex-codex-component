"use client";

import { usePaginatedQuery, type PaginatedQueryArgs, type UsePaginatedQueryResult } from "convex/react";
import { useMemo } from "react";
import {
  aggregateCodexReasoningSegments,
  type CodexReasoningSegmentLike,
} from "@zakstam/codex-runtime";
import type { CodexReasoningQuery, CodexReasoningQueryArgs } from "./types.js";

export function useCodexReasoning<Query extends CodexReasoningQuery<unknown>>(
  query: Query,
  args: CodexReasoningQueryArgs<Query> | "skip",
  options: { initialNumItems: number },
): UsePaginatedQueryResult<CodexReasoningSegmentLike> {
  const paginated = usePaginatedQuery(query, args as PaginatedQueryArgs<Query> | "skip", {
    initialNumItems: options.initialNumItems,
  });
  const includeRaw = args !== "skip" && "includeRaw" in args && !!args.includeRaw;
  const mergedResults = useMemo(
    () => aggregateCodexReasoningSegments(paginated.results, { includeRaw }),
    [includeRaw, paginated.results],
  );

  return {
    ...paginated,
    results: mergedResults,
  };
}
