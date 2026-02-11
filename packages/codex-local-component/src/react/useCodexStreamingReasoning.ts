"use client";

import { useMemo } from "react";
import {
  extractCodexReasoningOverlaySegments,
  type CodexOverlayReasoningSegment,
} from "../mapping.js";
import type { CodexMessagesQuery, CodexMessagesQueryArgs } from "./types.js";
import { useCodexStreamOverlay } from "./useCodexStreamOverlay.js";

export function useCodexStreamingReasoning<Query extends CodexMessagesQuery<unknown>>(
  query: Query,
  args: CodexMessagesQueryArgs<Query> | "skip",
  options?: { startOrder?: number; enabled?: boolean; includeRaw?: boolean },
): {
  results: CodexOverlayReasoningSegment[];
  streamIds: string[];
  reset: () => void;
} {
  const overlay = useCodexStreamOverlay(query, args, options?.enabled ?? true, {
    ...(options?.startOrder !== undefined ? { startOrder: options.startOrder } : {}),
  });

  const results = useMemo(() => {
    const byKey = extractCodexReasoningOverlaySegments(overlay.deltas, {
      includeRaw: options?.includeRaw ?? false,
    });
    return Array.from(byKey.values()).sort((a, b) => a.lastCursor - b.lastCursor);
  }, [overlay.deltas, options?.includeRaw]);

  return {
    results,
    streamIds: overlay.streamIds,
    reset: overlay.reset,
  };
}
