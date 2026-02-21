import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveCodexDynamicToolCalls,
  parseCodexDynamicToolPayload,
} from "../dist/react/index.js";

test("parseCodexDynamicToolPayload parses item/tool/call payload", () => {
  const parsed = parseCodexDynamicToolPayload(
    JSON.stringify({
      id: 101,
      method: "item/tool/call",
      params: {
        tool: "search_docs",
        callId: "call-1",
        arguments: { query: "hello" },
      },
    }),
  );

  assert.deepEqual(parsed, {
    toolName: "search_docs",
    callId: "call-1",
    input: { query: "hello" },
  });
});

test("deriveCodexDynamicToolCalls filters and maps pending tool calls", () => {
  const calls = deriveCodexDynamicToolCalls([
    {
      requestId: 200,
      method: "item/tool/call",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      payloadJson: JSON.stringify({
        method: "item/tool/call",
        params: {
          tool: "search_docs",
          callId: "call-1",
          arguments: { query: "foo" },
        },
      }),
      createdAt: 1700000000000,
    },
    {
      requestId: 201,
      method: "item/tool/requestUserInput",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-2",
      payloadJson: "{}",
      createdAt: 1700000000001,
    },
  ]);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    requestId: 200,
    conversationId: undefined,
    turnId: "turn-1",
    itemId: "item-1",
    callId: "call-1",
    toolName: "search_docs",
    input: { query: "foo" },
    createdAt: 1700000000000,
    request: {
      requestId: 200,
      method: "item/tool/call",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      payloadJson: JSON.stringify({
        method: "item/tool/call",
        params: {
          tool: "search_docs",
          callId: "call-1",
          arguments: { query: "foo" },
        },
      }),
      createdAt: 1700000000000,
    },
  });
});
