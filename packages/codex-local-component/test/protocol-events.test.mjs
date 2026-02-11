import test from "node:test";
import assert from "node:assert/strict";
import {
  approvalRequestForPayload,
  durableMessageDeltaForPayload,
  durableMessageForPayload,
  itemSnapshotForPayload,
  reasoningDeltaForPayload,
  terminalStatusForPayload,
  turnIdForPayload,
} from "../dist/protocol/events.js";
import { assertValidClientMessage, parseWireMessage } from "../dist/protocol/parser.js";

test("terminalStatusForPayload maps modern turn/completed statuses", () => {
  const interruptedPayload = JSON.stringify({
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

  assert.deepEqual(terminalStatusForPayload("turn/completed", interruptedPayload), {
    status: "interrupted",
    code: "E_TERMINAL_INTERRUPTED",
    error: "stopped",
  });
});

test("terminalStatusForPayload fail-closes on malformed terminal payload", () => {
  assert.deepEqual(terminalStatusForPayload("turn/completed", "{"), {
    status: "failed",
    code: "E_TERMINAL_PAYLOAD_PARSE_FAILED",
    error: "Failed to parse payload for turn/completed terminal status",
  });
});

test("payload helpers extract turn id, durable message, and item snapshot", () => {
  const startedPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "agentMessage",
        id: "msg-1",
        text: "hello",
      },
    },
  });

  assert.equal(turnIdForPayload("item/started", startedPayload), "turn-1");
  assert.deepEqual(durableMessageForPayload("item/started", startedPayload), {
    messageId: "msg-1",
    role: "assistant",
    status: "streaming",
    sourceItemType: "agentMessage",
    text: "hello",
    payloadJson: JSON.stringify({
      type: "agentMessage",
      id: "msg-1",
      text: "hello",
    }),
  });
  assert.deepEqual(itemSnapshotForPayload("item/started", startedPayload, 3), {
    itemId: "msg-1",
    itemType: "agentMessage",
    status: "inProgress",
    payloadJson: startedPayload,
    cursorEnd: 3,
  });
});

test("payload helpers extract approval requests and deltas", () => {
  const approvalPayload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "cmd-1",
      reason: "network required",
    },
  });
  const deltaPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-1",
      delta: " world",
    },
  });

  assert.deepEqual(approvalRequestForPayload("item/commandExecution/requestApproval", approvalPayload), {
    itemId: "cmd-1",
    kind: "commandExecution",
    reason: "network required",
  });
  assert.deepEqual(durableMessageDeltaForPayload("item/agentMessage/delta", deltaPayload), {
    messageId: "msg-1",
    delta: " world",
  });
});

test("payload helpers synthesize durable messages for dynamic tool calls", () => {
  const dynamicToolPayload = JSON.stringify({
    jsonrpc: "2.0",
    id: 22,
    method: "item/tool/call",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      tool: "tauri_get_runtime_snapshot",
      arguments: { includePendingRequests: true },
    },
  });

  assert.deepEqual(durableMessageForPayload("item/tool/call", dynamicToolPayload), {
    messageId: "call-1",
    role: "tool",
    status: "completed",
    sourceItemType: "dynamicToolCall",
    text: "tauri_get_runtime_snapshot",
    payloadJson: JSON.stringify({
      type: "dynamicToolCall",
      id: "call-1",
      tool: "tauri_get_runtime_snapshot",
    }),
  });
});

test("payload helpers extract reasoning summary/raw deltas", () => {
  const summaryPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "reason-1",
      delta: "plan",
      summaryIndex: 0,
    },
  });
  const sectionPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/reasoning/summaryPartAdded",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "reason-1",
      summaryIndex: 1,
    },
  });
  const rawPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/reasoning/textDelta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "reason-1",
      delta: "raw",
      contentIndex: 2,
    },
  });

  assert.deepEqual(reasoningDeltaForPayload("item/reasoning/summaryTextDelta", summaryPayload), {
    itemId: "reason-1",
    channel: "summary",
    segmentType: "textDelta",
    summaryIndex: 0,
    delta: "plan",
  });
  assert.deepEqual(reasoningDeltaForPayload("item/reasoning/summaryPartAdded", sectionPayload), {
    itemId: "reason-1",
    channel: "summary",
    segmentType: "sectionBreak",
    summaryIndex: 1,
  });
  assert.deepEqual(reasoningDeltaForPayload("item/reasoning/textDelta", rawPayload), {
    itemId: "reason-1",
    channel: "raw",
    segmentType: "textDelta",
    contentIndex: 2,
    delta: "raw",
  });
});

test("parseWireMessage accepts legacy codex/event envelopes", () => {
  const legacy = JSON.stringify({
    jsonrpc: "2.0",
    method: "codex/event/task_complete",
    params: {
      conversationId: "thread-legacy",
      msg: { type: "task_complete" },
    },
  });

  const parsed = parseWireMessage(legacy);
  assert.equal(parsed.method, "codex/event/task_complete");
});

test("parseWireMessage accepts unknown modern JSON-RPC server notifications", () => {
  const unknownModern = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/newExperimentalSignal",
    params: {
      threadId: "thread-1",
      value: 1,
    },
  });

  const parsed = parseWireMessage(unknownModern);
  assert.equal(parsed.method, "item/newExperimentalSignal");
});

test("parseWireMessage accepts unknown JSON-RPC notifications without params", () => {
  const unknownNoParams = JSON.stringify({
    jsonrpc: "2.0",
    method: "session/heartbeat",
  });

  const parsed = parseWireMessage(unknownNoParams);
  assert.equal(parsed.method, "session/heartbeat");
});

test("parseWireMessage accepts unknown JSON-RPC responses", () => {
  const unknownResponse = JSON.stringify({
    jsonrpc: "2.0",
    id: 999,
    result: {
      experimental: true,
    },
  });

  const parsed = parseWireMessage(unknownResponse);
  assert.equal(parsed.id, 999);
});

test("assertValidClientMessage accepts server-request response envelopes", () => {
  assert.doesNotThrow(() =>
    assertValidClientMessage({
      id: 55,
      result: {
        decision: "accept",
      },
    }),
  );

  assert.doesNotThrow(() =>
    assertValidClientMessage({
      id: "req-1",
      result: {
        answers: {
          q1: { answers: ["A"] },
        },
      },
    }),
  );
});
