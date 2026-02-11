import test from "node:test";
import assert from "node:assert/strict";
import {
  assertContinuousStreamDeltas,
  parseDurableMessageDeltaEvent,
  parseDurableMessageEvent,
  parseReasoningDeltaEvent,
  parseApprovalRequest,
  parseApprovalResolution,
  parseItemSnapshot,
  terminalStatusForEvent,
  pickHigherPriorityTerminalStatus,
} from "../dist/component/syncHelpers.js";

test("terminal status mapping works", () => {
  const completedPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "completed", error: null },
    },
  });
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
  const failedPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "error",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      willRetry: false,
      error: { message: "boom", additionalDetails: null, codexErrorInfo: null },
    },
  });

  assert.deepEqual(terminalStatusForEvent("turn/completed", completedPayload), { status: "completed" });
  assert.deepEqual(terminalStatusForEvent("turn/completed", interruptedPayload), {
    status: "interrupted",
    code: "E_TERMINAL_INTERRUPTED",
    error: "stopped",
  });
  assert.deepEqual(terminalStatusForEvent("error", failedPayload), {
    status: "failed",
    code: "E_TERMINAL_FAILED",
    error: "boom",
  });
  assert.equal(terminalStatusForEvent("codex/event/turn_aborted", "{}"), null);
  assert.equal(terminalStatusForEvent("other", completedPayload), null);
});

test("terminal status priority prefers failed over interrupted/completed", () => {
  assert.deepEqual(
    pickHigherPriorityTerminalStatus({ status: "completed" }, { status: "interrupted", error: "x" }),
    { status: "interrupted", error: "x" },
  );
  assert.deepEqual(
    pickHigherPriorityTerminalStatus({ status: "interrupted", error: "x" }, { status: "failed", error: "y" }),
    { status: "failed", error: "y" },
  );
});

test("approval request parsing for command execution", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      reason: "requires approval",
    },
  });
  assert.deepEqual(parseApprovalRequest("item/commandExecution/requestApproval", payload), {
    itemId: "item-1",
    kind: "commandExecution",
    reason: "requires approval",
  });
});

test("approval request parsing for file change", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-2",
    },
  });
  assert.deepEqual(parseApprovalRequest("item/fileChange/requestApproval", payload), {
    itemId: "item-2",
    kind: "fileChange",
  });
});

test("approval resolution parsing", () => {
  const declined = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "commandExecution",
        id: "item-1",
        command: "ls",
        cwd: "/tmp",
        processId: null,
        status: "declined",
        commandActions: [],
        aggregatedOutput: null,
        exitCode: null,
        durationMs: null,
      },
    },
  });
  const completed = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "fileChange",
        id: "item-2",
        changes: [],
        status: "completed",
      },
    },
  });
  assert.deepEqual(parseApprovalResolution("item/completed", declined), {
    itemId: "item-1",
    status: "declined",
  });
  assert.deepEqual(parseApprovalResolution("item/completed", completed), {
    itemId: "item-2",
    status: "accepted",
  });
});

test("item snapshot parsing", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "commandExecution",
        id: "item-9",
        command: "ls",
        cwd: "/tmp",
        processId: null,
        status: "inProgress",
        commandActions: [],
        aggregatedOutput: null,
        exitCode: null,
        durationMs: null,
      },
    },
  });
  assert.deepEqual(parseItemSnapshot("item/started", payload, 42), {
    itemId: "item-9",
    itemType: "commandExecution",
    status: "inProgress",
    payloadJson: payload,
    cursorEnd: 42,
  });
});

test("continuous delta assertion passes for contiguous cursors", () => {
  assert.deepEqual(
    assertContinuousStreamDeltas("stream-1", 0, [
      { cursorStart: 0, cursorEnd: 1 },
      { cursorStart: 1, cursorEnd: 2 },
    ]),
    { ok: true },
  );
});

test("continuous delta assertion reports replay gap", () => {
  assert.deepEqual(
    assertContinuousStreamDeltas("stream-1", 0, [{ cursorStart: 2, cursorEnd: 3 }]),
    { ok: false, expected: 0, actual: 2 },
  );
});

test("durable message parsing from item/started", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "agentMessage",
        id: "item-1",
        text: "hello",
      },
    },
  });

  assert.deepEqual(parseDurableMessageEvent("item/started", payload), {
    messageId: "item-1",
    role: "assistant",
    status: "streaming",
    sourceItemType: "agentMessage",
    text: "hello",
    payloadJson: JSON.stringify({
      type: "agentMessage",
      id: "item-1",
      text: "hello",
    }),
  });
});

test("durable message parsing from item/completed command failure keeps command text", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "commandExecution",
        id: "item-2",
        command: "ls",
        cwd: "/tmp",
        processId: null,
        status: "failed",
        commandActions: [],
        aggregatedOutput: "boom",
        exitCode: 1,
        durationMs: 10,
      },
    },
  });

  const parsed = parseDurableMessageEvent("item/completed", payload);
  assert.equal(parsed?.messageId, "item-2");
  assert.equal(parsed?.role, "tool");
  assert.equal(parsed?.status, "failed");
  assert.equal(parsed?.sourceItemType, "commandExecution");
  assert.equal(parsed?.text, "ls");
});

test("durable message delta parsing from item/agentMessage/delta", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-9",
      delta: "hel",
    },
  });

  assert.deepEqual(parseDurableMessageDeltaEvent("item/agentMessage/delta", payload), {
    messageId: "item-9",
    delta: "hel",
  });
});

test("durable message parsing from item/tool/call", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 77,
    method: "item/tool/call",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-9",
      tool: "tauri_get_runtime_snapshot",
      arguments: { includePendingRequests: true },
    },
  });

  assert.deepEqual(parseDurableMessageEvent("item/tool/call", payload), {
    messageId: "call-9",
    role: "tool",
    status: "completed",
    sourceItemType: "dynamicToolCall",
    text: "tauri_get_runtime_snapshot",
    payloadJson: JSON.stringify({
      type: "dynamicToolCall",
      id: "call-9",
      tool: "tauri_get_runtime_snapshot",
    }),
  });
});

test("reasoning delta parsing supports summary and raw channels", () => {
  const summaryTextPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "reason-1",
      summaryIndex: 0,
      delta: "thinking",
    },
  });
  const summaryPartPayload = JSON.stringify({
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
      contentIndex: 2,
      delta: "private",
    },
  });

  assert.deepEqual(parseReasoningDeltaEvent("item/reasoning/summaryTextDelta", summaryTextPayload), {
    itemId: "reason-1",
    channel: "summary",
    segmentType: "textDelta",
    summaryIndex: 0,
    delta: "thinking",
  });
  assert.deepEqual(parseReasoningDeltaEvent("item/reasoning/summaryPartAdded", summaryPartPayload), {
    itemId: "reason-1",
    channel: "summary",
    segmentType: "sectionBreak",
    summaryIndex: 1,
  });
  assert.deepEqual(parseReasoningDeltaEvent("item/reasoning/textDelta", rawPayload), {
    itemId: "reason-1",
    channel: "raw",
    segmentType: "textDelta",
    contentIndex: 2,
    delta: "private",
  });
});
