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
  payload: {
    deltas: CodexStreamDeltaLike[];
    streamWindows: Array<{
      streamId: string;
      status: "ok" | "rebased" | "stale";
      serverCursorStart: number;
      serverCursorEnd: number;
    }>;
    nextCheckpoints: Array<{ streamId: string; cursor: number }>;
  },
): StreamOverlayState {
  const { deltas, streamWindows, nextCheckpoints } = payload;
  if (deltas.length === 0) {
    const nextOnly = { ...state.cursorsByStreamId };
    const resetStreamIds = new Set<string>(
      streamWindows
        .filter((window) => window.status === "rebased" || window.status === "stale")
        .map((window) => window.streamId),
    );
    const nextDeltas = state.deltas.filter((delta) => !resetStreamIds.has(delta.streamId));
    for (const window of streamWindows) {
      if (window.status !== "ok") {
        nextOnly[window.streamId] = window.serverCursorStart;
      }
    }
    for (const checkpoint of nextCheckpoints) {
      nextOnly[checkpoint.streamId] = Math.max(
        nextOnly[checkpoint.streamId] ?? 0,
        checkpoint.cursor,
      );
    }
    if (nextCheckpoints.length === 0 && resetStreamIds.size === 0) {
      return state;
    }
    return { ...state, cursorsByStreamId: nextOnly, deltas: nextDeltas };
  }

  const nextCursors = { ...state.cursorsByStreamId };
  const resetStreamIds = new Set<string>(
    streamWindows
      .filter((window) => window.status === "rebased" || window.status === "stale")
      .map((window) => window.streamId),
  );
  let nextDeltas = state.deltas.filter((delta) => !resetStreamIds.has(delta.streamId));
  for (const window of streamWindows) {
    if (window.status !== "ok") {
      nextCursors[window.streamId] = window.serverCursorStart;
    }
  }
  const sorted = [...deltas].sort((a, b) => a.cursorEnd - b.cursorEnd);

  for (const delta of sorted) {
    const currentCursor = nextCursors[delta.streamId] ?? 0;
    if (delta.cursorEnd <= currentCursor) {
      continue;
    }
    if (delta.cursorStart > currentCursor) {
      nextDeltas = nextDeltas.filter((existing) => existing.streamId !== delta.streamId);
      nextCursors[delta.streamId] = delta.cursorStart;
    } else if (delta.cursorStart < currentCursor) {
      continue;
    }
    nextDeltas.push(delta);
    nextCursors[delta.streamId] = delta.cursorEnd;
  }
  for (const checkpoint of nextCheckpoints) {
    nextCursors[checkpoint.streamId] = Math.max(
      nextCursors[checkpoint.streamId] ?? 0,
      checkpoint.cursor,
    );
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

  const deltaPayload =
    streamDeltaQuery?.streams?.kind === "deltas"
      ? {
          deltas: streamDeltaQuery.streams.deltas,
          streamWindows: streamDeltaQuery.streams.streamWindows,
          nextCheckpoints: streamDeltaQuery.streams.nextCheckpoints,
        }
      : undefined;

  useEffect(() => {
    if (!deltaPayload) {
      return;
    }
    setOverlayState((current) => applyDeltaBatch(current, deltaPayload));
  }, [deltaPayload]);

  return {
    deltas: overlayState.deltas,
    streamIds,
    cursorsByStreamId: overlayState.cursorsByStreamId,
    reset: () => setOverlayState({ threadId, cursorsByStreamId: {}, deltas: [] }),
  };
}
