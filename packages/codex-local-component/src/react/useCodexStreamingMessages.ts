"use client";

import { useMemo } from "react";
import { extractCodexOverlayMessages, type CodexOverlayMessage } from "../mapping.js";
import type { CodexMessagesQuery, CodexMessagesQueryArgs } from "./types.js";
import { useCodexStreamOverlay } from "./useCodexStreamOverlay.js";

export function useCodexStreamingMessages<Query extends CodexMessagesQuery<unknown>>(
  query: Query,
  args: CodexMessagesQueryArgs<Query> | "skip",
  options?: { startOrder?: number; enabled?: boolean },
): {
  results: CodexOverlayMessage[];
  streamIds: string[];
  reset: () => void;
} {
  const overlay = useCodexStreamOverlay(query, args, options?.enabled ?? true, {
    ...(options?.startOrder !== undefined ? { startOrder: options.startOrder } : {}),
  });

  const results = useMemo(() => {
    const byKey = extractCodexOverlayMessages(overlay.deltas);
    return Array.from(byKey.values()).sort((a, b) => a.lastCursor - b.lastCursor);
  }, [overlay.deltas]);

  return {
    results,
    streamIds: overlay.streamIds,
    reset: overlay.reset,
  };
}
