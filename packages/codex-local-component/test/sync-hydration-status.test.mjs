import test from "node:test";
import assert from "node:assert/strict";
import { computeCodexConversationSyncProgress } from "../dist/react/syncHydration.js";

test("sync progress counts displayed non-reasoning messages only", () => {
  const progress = computeCodexConversationSyncProgress({
    messages: [
      {
        messageId: "durable-1",
        turnId: "turn-1",
        role: "user",
        status: "completed",
        sourceItemType: "userMessage",
        text: "hello",
        orderInTurn: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        messageId: "reasoning-1",
        turnId: "turn-1",
        role: "assistant",
        status: "completed",
        sourceItemType: "reasoning",
        text: "thinking",
        orderInTurn: 1,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        messageId: "optimistic:user:123",
        turnId: "optimistic:123",
        role: "user",
        status: "completed",
        sourceItemType: "userMessage",
        text: "pending",
        orderInTurn: 0,
        createdAt: 3,
        updatedAt: 3,
      },
    ],
    unsyncedMessageIds: new Set(),
    syncState: "synced",
  });
  assert.equal(progress.totalCount, 1);
  assert.equal(progress.syncedCount, 1);
  assert.equal(progress.label, "1/1 synced");
});

test("sync progress excludes unsynced local snapshot messages from synced count", () => {
  const progress = computeCodexConversationSyncProgress({
    messages: [
      {
        messageId: "durable-1",
        turnId: "turn-1",
        role: "assistant",
        status: "completed",
        sourceItemType: "agentMessage",
        text: "done",
        orderInTurn: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        messageId: "local-1",
        turnId: "turn-2",
        role: "assistant",
        status: "streaming",
        sourceItemType: "agentMessage",
        text: "pending",
        orderInTurn: 0,
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    unsyncedMessageIds: new Set(["local-1"]),
    syncState: "syncing",
  });
  assert.equal(progress.totalCount, 2);
  assert.equal(progress.syncedCount, 1);
  assert.equal(progress.label, "1/2 synced");
  assert.equal(progress.syncState, "syncing");
});
