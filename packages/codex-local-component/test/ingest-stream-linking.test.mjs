import test from "node:test";
import assert from "node:assert/strict";
import { applyStreamEvent } from "../dist/component/ingest/applyStreams.js";

test("applyStreamEvent fail-closes when a streamId is already bound to a different turn", async () => {
  const turnDoc = {
    _id: "turn_ref_1",
    userScope: "user-1",
    userId: "user-1",
    threadId: "thread-1",
    threadRef: "thread_ref_1",
    turnId: "turn-1",
    status: "inProgress",
    idempotencyKey: "k1",
    startedAt: 1,
  };

  const collidingStreamDoc = {
    _id: "stream_ref_collision",
    userScope: "user-1",
    threadId: "thread-1",
    threadRef: "thread_ref_1",
    turnId: "turn-2",
    turnRef: "turn_ref_2",
    streamId: "stream-shared",
    state: { kind: "streaming", lastHeartbeatAt: 1 },
    startedAt: 1,
  };

  const ctx = {
    db: {
      query: (table) => {
        if (table === "codex_turns") {
          return {
            withIndex: () => ({
              filter: () => ({
                first: async () => turnDoc,
              }),
            }),
          };
        }
        if (table === "codex_streams") {
          return {
            withIndex: () => ({
              first: async () => collidingStreamDoc,
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    },
  };

  const ingest = {
    ctx,
    args: {
      actor: { userId: "user-1" },
      threadId: "thread-1",
    },
    thread: { _id: "thread_ref_1" },
    runtime: {
      saveStreamDeltas: false,
      saveReasoningDeltas: false,
      exposeRawReasoningDeltas: false,
    },
    collected: { inBatchEventIds: new Set() },
    streamState: {
      expectedCursorByStreamId: new Map(),
      streamCheckpointCursorByStreamId: new Map(),
      persistedStatsByStreamId: new Map(),
    },
    progress: {
      ingestStatus: "ok",
      lastPersistedCursor: 0,
      persistedAnyEvent: false,
    },
  };

  const cache = {
    getStreamRecord: async () => null,
    setStreamRecord: () => {},
  };

  await assert.rejects(
    () =>
      applyStreamEvent(
        ingest,
        {
          type: "stream_delta",
          eventId: "e1",
          threadId: "thread-1",
          turnId: "turn-1",
          streamId: "stream-shared",
          kind: "item/agentMessage/delta",
          payloadJson: JSON.stringify({
            jsonrpc: "2.0",
            method: "item/agentMessage/delta",
            params: {
              threadId: "thread-1",
              turnId: "turn-1",
              itemId: "msg-1",
              delta: "hello",
            },
          }),
          cursorStart: 0,
          cursorEnd: 1,
          createdAt: 1,
          syntheticTurnStatus: "inProgress",
          terminalTurnStatus: null,
          approvalRequest: null,
          approvalResolution: null,
          durableMessage: null,
          durableDelta: null,
          reasoningDelta: null,
        },
        cache,
      ),
    /\[E_SYNC_STREAM_ID_COLLISION\]/,
  );
});
