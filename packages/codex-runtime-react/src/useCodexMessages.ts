"use client";

import { usePaginatedQuery, type PaginatedQueryArgs, type UsePaginatedQueryResult } from "convex/react";
import { useMemo } from "react";
import { mergeCodexDurableAndStreamMessages } from "@zakstam/codex-runtime";
import type { CodexUIMessage } from "@zakstam/codex-runtime";
import type { CodexMessagesQuery, CodexMessagesQueryArgs } from "./types.js";
import { useCodexStreamOverlay } from "./useCodexStreamOverlay.js";

export function useCodexMessages<Query extends CodexMessagesQuery<unknown>>(
  query: Query,
  args: CodexMessagesQueryArgs<Query> | "skip",
  options: { initialNumItems: number; stream?: boolean },
): UsePaginatedQueryResult<CodexUIMessage> {
  const paginated = usePaginatedQuery(query, args as PaginatedQueryArgs<Query> | "skip", {
    initialNumItems: options.initialNumItems,
  });
  const overlay = useCodexStreamOverlay(
    query,
    args,
    !!options.stream && paginated.status !== "LoadingFirstPage",
    { startOrder: 0 },
  );

  const mergedResults = useMemo(() => {
    return mergeCodexDurableAndStreamMessages(
      paginated.results,
      options.stream ? overlay.deltas : [],
    );
  }, [paginated.results, options.stream, overlay.deltas]);

  return {
    ...paginated,
    results: mergedResults,
  };
}
