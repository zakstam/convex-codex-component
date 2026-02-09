import test from "node:test";
import assert from "node:assert/strict";
import { mergeCodexDurableAndStreamMessages } from "../dist/mapping.js";

test("mergeCodexDurableAndStreamMessages keeps durable-only rows", () => {
  const merged = mergeCodexDurableAndStreamMessages(
    [
      {
        turnId: "turn-1",
        messageId: "m-1",
        role: "assistant",
        status: "completed",
        text: "hello",
        orderInTurn: 1,
        createdAt: 10,
        updatedAt: 10,
        completedAt: 10,
      },
    ],
    [],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, "hello");
  assert.equal(merged[0].status, "completed");
});

test("mergeCodexDurableAndStreamMessages applies longer overlay while streaming", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/agentMessage/delta",
    params: { threadId: "thread-1", turnId: "turn-1", itemId: "m-1", delta: " world" },
  });
  const merged = mergeCodexDurableAndStreamMessages(
    [
      {
        turnId: "turn-1",
        messageId: "m-1",
        role: "assistant",
        status: "streaming",
        text: "hello",
        orderInTurn: 1,
        createdAt: 10,
        updatedAt: 10,
      },
    ],
    [
      {
        streamId: "stream-1",
        cursorStart: 0,
        cursorEnd: 1,
        kind: "item/agentMessage/delta",
        payloadJson: payload,
      },
    ],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, "hello world");
  assert.equal(merged[0].status, "streaming");
});

test("mergeCodexDurableAndStreamMessages prioritizes terminal statuses", () => {
  const completedPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: { type: "agentMessage", id: "m-1", text: "done" },
    },
  });
  const merged = mergeCodexDurableAndStreamMessages(
    [
      {
        turnId: "turn-1",
        messageId: "m-1",
        role: "assistant",
        status: "streaming",
        text: "do",
        orderInTurn: 1,
        createdAt: 10,
        updatedAt: 10,
      },
    ],
    [
      {
        streamId: "stream-1",
        cursorStart: 0,
        cursorEnd: 1,
        kind: "item/completed",
        payloadJson: completedPayload,
      },
    ],
  );

  assert.equal(merged[0].status, "completed");
  assert.equal(merged[0].text, "done");
});

test("mergeCodexDurableAndStreamMessages dedupes by message key fallback", () => {
  const merged = mergeCodexDurableAndStreamMessages(
    [
      {
        turnId: "turn-1",
        role: "assistant",
        status: "streaming",
        text: "a",
        orderInTurn: 1,
        createdAt: 10,
        updatedAt: 10,
      },
      {
        turnId: "turn-1",
        role: "assistant",
        status: "completed",
        text: "ab",
        orderInTurn: 1,
        createdAt: 10,
        updatedAt: 11,
        completedAt: 11,
      },
    ],
    [],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "completed");
  assert.equal(merged[0].text, "ab");
});
