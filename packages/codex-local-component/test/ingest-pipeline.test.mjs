import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInboundEvents } from "../dist/component/ingest/normalize.js";
import { collectTurnSignals } from "../dist/component/ingest/applyTurns.js";
import {
  isRecoverableIngestErrorCode,
  mapIngestSafeCode,
  parseSyncErrorCode,
} from "../dist/component/ingest/sessionGuard.js";

test("normalizeInboundEvents sorts by createdAt and enriches event signals", () => {
  const turnCompletedPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        items: [],
        status: "interrupted",
        error: { message: "stopped", codexErrorInfo: null, additionalDetails: null },
      },
    },
  });

  const deltaPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-1",
      delta: "hello",
    },
  });

  const normalized = normalizeInboundEvents({
    streamDeltas: [
      {
        type: "lifecycle_event",
        eventId: "e2",
        turnId: "turn-1",
        kind: "turn/completed",
        payloadJson: turnCompletedPayload,
        createdAt: 20,
      },
      {
        type: "stream_delta",
        eventId: "e1",
        turnId: "turn-1",
        streamId: "stream-1",
        kind: "item/agentMessage/delta",
        payloadJson: deltaPayload,
        cursorStart: 0,
        cursorEnd: 5,
        createdAt: 10,
      },
    ],
  });

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].eventId, "e1");
  assert.equal(normalized[0].durableDelta?.messageId, "msg-1");
  assert.equal(normalized[0].syntheticTurnStatus, "inProgress");

  assert.equal(normalized[1].eventId, "e2");
  assert.equal(normalized[1].terminalTurnStatus?.status, "interrupted");
  assert.equal(normalized[1].terminalTurnStatus?.error, "stopped");
  assert.equal(normalized[1].syntheticTurnStatus, "interrupted");
});

test("normalizeInboundEvents canonicalizes turnId from payload", () => {
  const turnCompletedPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-real",
        items: [],
        status: "completed",
        error: null,
      },
    },
  });

  const normalized = normalizeInboundEvents({
    streamDeltas: [
      {
        type: "lifecycle_event",
        eventId: "e1",
        turnId: "0",
        kind: "turn/completed",
        payloadJson: turnCompletedPayload,
        createdAt: 10,
      },
    ],
  });

  assert.equal(normalized[0].turnId, "turn-real");
});

test("normalizeInboundEvents rejects codex/event payloads without canonical turn id", () => {
  const legacyPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "codex/event/task_complete",
    params: {
      conversationId: "thread-legacy",
      id: "0",
      msg: { type: "task_complete" },
    },
  });

  assert.throws(
    () =>
      normalizeInboundEvents({
        streamDeltas: [
          {
            type: "lifecycle_event",
            eventId: "e1",
            turnId: "0",
            kind: "codex/event/task_complete",
            payloadJson: legacyPayload,
            createdAt: 10,
          },
        ],
      }),
    /\[E_SYNC_TURN_ID_REQUIRED_FOR_CODEX_EVENT\]/,
  );
});

test("normalizeInboundEvents prefers payload turn id for stream deltas", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-real-stream",
        items: [],
        status: "completed",
        error: null,
      },
    },
  });

  const normalized = normalizeInboundEvents({
    streamDeltas: [
      {
        type: "stream_delta",
        eventId: "e1",
        turnId: "0",
        streamId: "stream-1",
        kind: "turn/completed",
        payloadJson: payload,
        cursorStart: 0,
        cursorEnd: 1,
        createdAt: 10,
      },
    ],
  });

  assert.equal(normalized[0]?.turnId, "turn-real-stream");
});

test("normalizeInboundEvents rejects turn/completed stream delta without canonical payload turn id", () => {
  const malformedPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        status: "completed",
      },
    },
  });

  assert.throws(
    () =>
      normalizeInboundEvents({
        streamDeltas: [
          {
            type: "stream_delta",
            eventId: "e1",
            turnId: "0",
            streamId: "stream-1",
            kind: "turn/completed",
            payloadJson: malformedPayload,
            cursorStart: 0,
            cursorEnd: 1,
            createdAt: 10,
          },
        ],
      }),
    /\[E_SYNC_TURN_ID_REQUIRED_FOR_TURN_EVENT\]/,
  );
});

test("normalizeInboundEvents fails closed for turn-scoped lifecycle events without payload turn id", () => {
  const malformedTurnCompletedPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        status: "completed",
      },
    },
  });

  const normalized = normalizeInboundEvents({
    streamDeltas: [
      {
        type: "lifecycle_event",
        eventId: "e1",
        turnId: "0",
        kind: "turn/completed",
        payloadJson: malformedTurnCompletedPayload,
        createdAt: 10,
      },
    ],
  });

  assert.equal(normalized[0]?.turnId, undefined);
});

test("collectTurnSignals tracks started turns and terminal priority by stream", () => {
  const ingest = {
    collected: {
      startedTurns: new Set(),
      terminalTurns: new Map(),
    },
  };

  collectTurnSignals(ingest, {
    type: "stream_delta",
    eventId: "e1",
    turnId: "turn-1",
    streamId: "stream-1",
    kind: "turn/started",
    payloadJson: "{}",
    cursorStart: 0,
    cursorEnd: 1,
    createdAt: 1,
    syntheticTurnStatus: "inProgress",
    terminalTurnStatus: null,
    approvalRequest: null,
    approvalResolution: null,
    durableMessage: null,
    durableDelta: null,
  });

  collectTurnSignals(ingest, {
    type: "stream_delta",
    eventId: "e2",
    turnId: "turn-1",
    streamId: "stream-1",
    kind: "turn/completed",
    payloadJson: "{}",
    cursorStart: 1,
    cursorEnd: 2,
    createdAt: 2,
    syntheticTurnStatus: "completed",
    terminalTurnStatus: { status: "completed" },
    approvalRequest: null,
    approvalResolution: null,
    durableMessage: null,
    durableDelta: null,
  });

  collectTurnSignals(ingest, {
    type: "stream_delta",
    eventId: "e3",
    turnId: "turn-1",
    streamId: "stream-1",
    kind: "error",
    payloadJson: "{}",
    cursorStart: 2,
    cursorEnd: 3,
    createdAt: 3,
    syntheticTurnStatus: "failed",
    terminalTurnStatus: { status: "failed", code: "E_TERMINAL_FAILED", error: "boom" },
    approvalRequest: null,
    approvalResolution: null,
    durableMessage: null,
    durableDelta: null,
  });

  assert.deepEqual(Array.from(ingest.collected.startedTurns), ["turn-1"]);
  assert.deepEqual(ingest.collected.terminalTurns.get("turn-1"), {
    status: "failed",
    code: "E_TERMINAL_FAILED",
    error: "boom",
  });
});

test("sessionGuard error parsing and recoverable mapping", () => {
  assert.equal(parseSyncErrorCode(new Error("[E_SYNC_SESSION_NOT_FOUND] missing")), "E_SYNC_SESSION_NOT_FOUND");
  assert.equal(parseSyncErrorCode(new Error("plain message")), null);

  assert.equal(mapIngestSafeCode("E_SYNC_SESSION_THREAD_MISMATCH"), "SESSION_THREAD_MISMATCH");
  assert.equal(
    mapIngestSafeCode("E_SYNC_TURN_ID_REQUIRED_FOR_TURN_EVENT"),
    "TURN_ID_REQUIRED_FOR_TURN_EVENT",
  );
  assert.equal(
    mapIngestSafeCode("E_SYNC_TURN_ID_REQUIRED_FOR_CODEX_EVENT"),
    "TURN_ID_REQUIRED_FOR_CODEX_EVENT",
  );
  assert.equal(mapIngestSafeCode("E_SYNC_OUT_OF_ORDER"), "OUT_OF_ORDER");
  assert.equal(mapIngestSafeCode("E_WHATEVER"), "UNKNOWN");

  assert.equal(isRecoverableIngestErrorCode("E_SYNC_SESSION_NOT_FOUND"), true);
  assert.equal(isRecoverableIngestErrorCode("E_SYNC_OUT_OF_ORDER"), false);
  assert.equal(isRecoverableIngestErrorCode(null), false);
});
