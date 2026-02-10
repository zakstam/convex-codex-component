"use client";

import { useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useEffect, useState } from "react";
import type { CodexStreamDeltaLike } from "../mapping.js";
import type { CodexMessagesQuery, CodexMessagesQueryArgs, CodexStreamsResult } from "./types.js";

type StreamOverlayState = {
  threadId: string | undefined;
  streamIds: string[];
  cursorsByStreamId: Record<string, number>;
  deltas: CodexStreamDeltaLike[];
};

function areStreamIdsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((streamId, index) => streamId === b[index]);
}

function areCursorsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => a[key] === b[key]);
}

function areDeltasEqual(a: CodexStreamDeltaLike[], b: CodexStreamDeltaLike[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (!left || !right) {
      return false;
    }
    if (
      left.streamId !== right.streamId ||
      left.cursorStart !== right.cursorStart ||
      left.cursorEnd !== right.cursorEnd ||
      left.kind !== right.kind ||
      left.payloadJson !== right.payloadJson
    ) {
      return false;
    }
  }
  return true;
}

function applyDeltaBatch(
  state: StreamOverlayState,
  payload: {
    streams: Array<{ streamId: string; state: string }>;
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
  const { streams, deltas, streamWindows, nextCheckpoints } = payload;
  const nextStreamIds = streams.map((stream) => stream.streamId);
  const activeStreamIds = new Set(nextStreamIds);

  if (deltas.length === 0) {
    const nextOnly = Object.fromEntries(
      Object.entries(state.cursorsByStreamId).filter(([streamId]) => activeStreamIds.has(streamId)),
    );
    const resetStreamIds = new Set<string>(
      streamWindows
        .filter((window) => window.status === "rebased" || window.status === "stale")
        .map((window) => window.streamId),
    );
    const nextDeltas = state.deltas.filter(
      (delta) => activeStreamIds.has(delta.streamId) && !resetStreamIds.has(delta.streamId),
    );
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
    const streamIdsChanged =
      nextStreamIds.length !== state.streamIds.length ||
      nextStreamIds.some((streamId, index) => streamId !== state.streamIds[index]);
    if (nextCheckpoints.length === 0 && resetStreamIds.size === 0 && !streamIdsChanged) {
      return state;
    }
    const nextState: StreamOverlayState = {
      ...state,
      streamIds: nextStreamIds,
      cursorsByStreamId: nextOnly,
      deltas: nextDeltas,
    };
    if (
      areStreamIdsEqual(nextState.streamIds, state.streamIds) &&
      areCursorsEqual(nextState.cursorsByStreamId, state.cursorsByStreamId) &&
      areDeltasEqual(nextState.deltas, state.deltas)
    ) {
      return state;
    }
    return nextState;
  }

  const nextCursors = Object.fromEntries(
    Object.entries(state.cursorsByStreamId).filter(([streamId]) => activeStreamIds.has(streamId)),
  );
  const resetStreamIds = new Set<string>(
    streamWindows
      .filter((window) => window.status === "rebased" || window.status === "stale")
      .map((window) => window.streamId),
  );
  let nextDeltas = state.deltas.filter(
    (delta) => activeStreamIds.has(delta.streamId) && !resetStreamIds.has(delta.streamId),
  );
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

  const nextState: StreamOverlayState = {
    threadId: state.threadId,
    streamIds: nextStreamIds,
    cursorsByStreamId: nextCursors,
    deltas: nextDeltas.slice(-5000),
  };
  if (
    areStreamIdsEqual(nextState.streamIds, state.streamIds) &&
    areCursorsEqual(nextState.cursorsByStreamId, state.cursorsByStreamId) &&
    areDeltasEqual(nextState.deltas, state.deltas)
  ) {
    return state;
  }
  return nextState;
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
    streamIds: [],
    cursorsByStreamId: {},
    deltas: [],
  });

  useEffect(() => {
    setOverlayState({ threadId, streamIds: [], cursorsByStreamId: {}, deltas: [] });
  }, [threadId]);

  const streamDeltaQuery = useQuery(
    query,
    !enabled || args === "skip"
      ? ("skip" as const)
      : ({
          ...args,
          paginationOpts: { cursor: null, numItems: 0 },
          streamArgs: {
            kind: "deltas",
            cursors: overlayState.streamIds.map((streamId) => ({
              streamId,
              cursor: overlayState.cursorsByStreamId[streamId] ?? 0,
            })),
          },
        } as FunctionArgs<Query>),
  ) as ({ streams?: CodexStreamsResult } & unknown) | undefined;

  const deltaPayload =
    streamDeltaQuery?.streams?.kind === "deltas"
      ? {
          streams: streamDeltaQuery.streams.streams,
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
    streamIds: overlayState.streamIds,
    cursorsByStreamId: overlayState.cursorsByStreamId,
    reset: () => setOverlayState({ threadId, streamIds: [], cursorsByStreamId: {}, deltas: [] }),
  };
}
