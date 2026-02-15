import test from "node:test";
import assert from "node:assert/strict";
import {
  approvalRequestForPayload,
  classifyMessage,
  durableMessageForPayload,
  durableMessageDeltaForPayload,
  extractThreadId,
  extractTurnId,
  itemSnapshotForPayload,
  turnIdForPayload,
  reasoningDeltaForPayload,
  terminalStatusForPayload,
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

test("classifyMessage accepts global and thread scoped methods", () => {
  assert.deepEqual(
    classifyMessage({
      jsonrpc: "2.0",
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1" },
    }),
    {
      scope: "thread",
      kind: "item/started",
      threadId: "thread-1",
    },
  );

  assert.deepEqual(
    classifyMessage({
      jsonrpc: "2.0",
      method: "session/heartbeat",
    }),
    {
      scope: "global",
      kind: "session/heartbeat",
    },
  );
});

test("classifyMessage rejects thread-scoped messages missing threadId", () => {
  assert.throws(
    () =>
      classifyMessage({
        jsonrpc: "2.0",
        method: "item/started",
        params: {},
      }),
    /Thread-scoped protocol message missing threadId/,
  );
});

test("extractThreadId reads thread.id and fallback conversationId", () => {
  const fromThread = extractThreadId({
    jsonrpc: "2.0",
    method: "thread/start",
    params: { thread: { id: "thread-2" } },
  });
  const fromConversation = extractThreadId({
    jsonrpc: "2.0",
    method: "thread/tokenUsage/updated",
    params: { conversationId: "thread-legacy" },
  });
  assert.equal(fromThread, "thread-2");
  assert.equal(fromConversation, "thread-legacy");
});

test("extractTurnId supports legacy codex/event payloads", () => {
  assert.equal(
    extractTurnId({
      jsonrpc: "2.0",
      method: "codex/event/task_complete",
      params: { conversationId: "thread-1", msg: { type: "task_complete", turn_id: "legacy-turn" } },
    }),
    "legacy-turn",
  );
});

test("terminalStatusForPayload reports payload parse failures when turn payload malformed", () => {
  assert.deepEqual(terminalStatusForPayload("turn/completed", "{"), {
    status: "failed",
    code: "E_TERMINAL_PAYLOAD_PARSE_FAILED",
    error: "Failed to parse payload for turn/completed terminal status",
  });
});

test("terminalStatusForPayload requires error message for terminal errors", () => {
  assert.deepEqual(
    terminalStatusForPayload(
      "turn/completed",
      JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            items: [],
            status: "interrupted",
            error: { message: "" },
          },
        },
      }),
    ),
    {
      status: "interrupted",
      code: "E_TERMINAL_ERROR_MISSING",
      error: "turn/completed interrupted status missing error.message",
    },
  );
});

test("durableMessageForPayload supports tool user input requests", () => {
  assert.deepEqual(
    durableMessageForPayload(
      "item/tool/requestUserInput",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 31,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "tool-1",
          tool: "tauri_demo",
        },
      }),
    ),
    {
      messageId: "tool-1",
      role: "tool",
      status: "completed",
      sourceItemType: "toolUserInputRequest",
      text: "Tool requested user input",
      payloadJson: JSON.stringify({
        type: "toolUserInputRequest",
        id: "tool-1",
      }),
    },
  );
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

test("parseWireMessage rejects invalid json", () => {
  assert.throws(() => parseWireMessage("{"), /Invalid JSON from codex app-server/);
});

test("parseWireMessage rejects non-codex server message shapes", () => {
  assert.throws(
    () =>
      parseWireMessage(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "codex/event/task_complete",
          foo: 1,
        }),
      ),
    /Message is valid JSON-RPC but not a supported codex server notification\/request\/response shape\./,
  );
});

test("assertValidClientMessage rejects malformed outbound message", () => {
  assert.throws(() => assertValidClientMessage({ id: "1", method: "turn/start" }), /Invalid outbound codex client message/);
});

test("turnIdForPayload ignores legacy params.id fallback for codex/event envelopes", () => {
  const payloadWithoutTurn = JSON.stringify({
    jsonrpc: "2.0",
    method: "codex/event/task_complete",
    params: {
      conversationId: "thread-legacy",
      id: "0",
      msg: { type: "task_complete" },
    },
  });

  const payloadWithTurn = JSON.stringify({
    jsonrpc: "2.0",
    method: "codex/event/task_complete",
    params: {
      conversationId: "thread-legacy",
      id: "0",
      msg: { type: "task_complete", turn_id: "turn-legacy-1" },
    },
  });

  assert.equal(turnIdForPayload("codex/event/task_complete", payloadWithoutTurn), null);
  assert.equal(turnIdForPayload("codex/event/task_complete", payloadWithTurn), "turn-legacy-1");
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
