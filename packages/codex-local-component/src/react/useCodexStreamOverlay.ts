"use client";

import { useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useEffect, useState } from "react";
import type { CodexStreamDeltaLike } from "../mapping.js";
import type { CodexMessagesQuery, CodexMessagesQueryArgs, CodexStreamsResult } from "./types.js";

type StreamOverlayState = {
  threadId: string | undefined;
  cursorsByStreamId: Record<string, number>;
  deltas: CodexStreamDeltaLike[];
};

function applyDeltaBatch(
  state: StreamOverlayState,
  deltas: CodexStreamDeltaLike[],
): StreamOverlayState {
  if (deltas.length === 0) {
    return state;
  }

  const nextCursors = { ...state.cursorsByStreamId };
  const nextDeltas = [...state.deltas];
  const sorted = [...deltas].sort((a, b) => a.cursorEnd - b.cursorEnd);

  for (const delta of sorted) {
    const currentCursor = nextCursors[delta.streamId] ?? 0;
    if (delta.cursorEnd <= currentCursor) {
      continue;
    }
    if (delta.cursorStart !== currentCursor) {
      continue;
    }
    nextDeltas.push(delta);
    nextCursors[delta.streamId] = delta.cursorEnd;
  }

  return {
    threadId: state.threadId,
    cursorsByStreamId: nextCursors,
    deltas: nextDeltas.slice(-5000),
  };
}

export function useCodexStreamOverlay<Query extends CodexMessagesQuery<any>>(
  query: Query,
  args: CodexMessagesQueryArgs<Query> | "skip",
  enabled: boolean,
  options?: { startOrder?: number },
): {
  deltas: CodexStreamDeltaLike[];
  streamIds: string[];
  cursorsByStreamId: Record<string, number>;
  reset: () => void;
} {
  const threadId = args === "skip" ? undefined : args.threadId;
  const [overlayState, setOverlayState] = useState<StreamOverlayState>({
    threadId,
    cursorsByStreamId: {},
    deltas: [],
  });

  useEffect(() => {
    setOverlayState({ threadId, cursorsByStreamId: {}, deltas: [] });
  }, [threadId]);

  const streamListQuery = useQuery(
    query,
    !enabled || args === "skip"
      ? ("skip" as const)
      : ({
          ...args,
          paginationOpts: { cursor: null, numItems: 0 },
          streamArgs: { kind: "list", ...(options?.startOrder !== undefined ? { startOrder: options.startOrder } : {}) },
        } as FunctionArgs<Query>),
  ) as ({ streams?: CodexStreamsResult } & unknown) | undefined;

  const streamIds =
    streamListQuery?.streams?.kind === "list"
      ? streamListQuery.streams.streams.map((stream) => stream.streamId)
      : [];

  const streamDeltaQuery = useQuery(
    query,
    !enabled || args === "skip" || streamIds.length === 0
      ? ("skip" as const)
      : ({
          ...args,
          paginationOpts: { cursor: null, numItems: 0 },
          streamArgs: {
            kind: "deltas",
            cursors: streamIds.map((streamId) => ({
              streamId,
              cursor: overlayState.cursorsByStreamId[streamId] ?? 0,
            })),
          },
        } as FunctionArgs<Query>),
  ) as ({ streams?: CodexStreamsResult } & unknown) | undefined;

  const newDeltas =
    streamDeltaQuery?.streams?.kind === "deltas" ? streamDeltaQuery.streams.deltas : undefined;

  useEffect(() => {
    if (!newDeltas || newDeltas.length === 0) {
      return;
    }
    setOverlayState((current) => applyDeltaBatch(current, newDeltas));
  }, [newDeltas]);

  return {
    deltas: overlayState.deltas,
    streamIds,
    cursorsByStreamId: overlayState.cursorsByStreamId,
    reset: () => setOverlayState({ threadId, cursorsByStreamId: {}, deltas: [] }),
  };
}
