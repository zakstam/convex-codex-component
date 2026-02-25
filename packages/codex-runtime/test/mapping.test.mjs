import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateCodexReasoningSegments,
  extractCodexReasoningOverlaySegments,
  mergeCodexDurableAndStreamMessages,
} from "../dist/mapping.js";

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

test("mergeCodexDurableAndStreamMessages drops durable rows missing messageId", () => {
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

  assert.equal(merged.length, 0);
});

test("extractCodexReasoningOverlaySegments aggregates summary and filters raw by default", () => {
  const summaryText = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "reason-1",
      summaryIndex: 0,
      delta: "hello",
    },
  });
  const rawText = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/reasoning/textDelta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "reason-1",
      contentIndex: 1,
      delta: "raw",
    },
  });
  const map = extractCodexReasoningOverlaySegments([
    {
      streamId: "stream-1",
      cursorStart: 0,
      cursorEnd: 1,
      kind: "item/reasoning/summaryTextDelta",
      payloadJson: summaryText,
    },
    {
      streamId: "stream-1",
      cursorStart: 1,
      cursorEnd: 2,
      kind: "item/reasoning/textDelta",
      payloadJson: rawText,
    },
  ]);

  assert.equal(map.size, 1);
  const segment = Array.from(map.values())[0];
  assert.equal(segment.channel, "summary");
  assert.equal(segment.text, "hello");
});

test("aggregateCodexReasoningSegments merges repeated deltas per segment key", () => {
  const aggregated = aggregateCodexReasoningSegments([
    {
      turnId: "turn-1",
      itemId: "reason-1",
      channel: "summary",
      segmentType: "textDelta",
      summaryIndex: 0,
      text: "hel",
      createdAt: 1,
      cursorEnd: 1,
    },
    {
      turnId: "turn-1",
      itemId: "reason-1",
      channel: "summary",
      segmentType: "textDelta",
      summaryIndex: 0,
      text: "lo",
      createdAt: 2,
      cursorEnd: 2,
    },
  ]);

  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].text, "hello");
});
