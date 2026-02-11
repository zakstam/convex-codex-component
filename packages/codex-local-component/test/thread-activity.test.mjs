import test from "node:test";
import assert from "node:assert/strict";
import { deriveCodexThreadActivity } from "../dist/react/threadActivity.js";

test("deriveCodexThreadActivity returns idle when state is missing", () => {
  assert.deepEqual(deriveCodexThreadActivity(undefined), { phase: "idle" });
});

test("deriveCodexThreadActivity prefers awaiting_approval over streaming signals", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [{ itemId: "approval-1" }],
    recentMessages: [
      {
        messageId: "msg-1",
        turnId: "turn-1",
        status: "streaming",
        createdAt: 5,
      },
    ],
    dispatches: [],
    streamStats: [{ state: "streaming" }],
    turns: [],
  });

  assert.deepEqual(result, {
    phase: "awaiting_approval",
    activeTurnId: "turn-1",
    activeMessageId: "msg-1",
  });
});

test("deriveCodexThreadActivity reports streaming from in-flight dispatch before first message", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [],
    dispatches: [
      {
        turnId: "turn-2",
        status: "started",
        updatedAt: 15,
      },
    ],
    streamStats: [],
    turns: [],
  });

  assert.deepEqual(result, {
    phase: "streaming",
    activeTurnId: "turn-2",
  });
});

test("deriveCodexThreadActivity uses most recent terminal state when idle", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-3",
        turnId: "turn-3",
        status: "failed",
        createdAt: 30,
      },
      {
        messageId: "msg-2",
        turnId: "turn-2",
        status: "interrupted",
        createdAt: 20,
      },
    ],
    dispatches: [],
    streamStats: [{ state: "finished" }],
    turns: [],
  });

  assert.deepEqual(result, {
    phase: "failed",
    activeTurnId: "turn-3",
    activeMessageId: "msg-3",
  });
});

test("deriveCodexThreadActivity surfaces interrupted from turn status when no terminal message exists", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [],
    dispatches: [],
    streamStats: [],
    turns: [{ turnId: "turn-4", status: "interrupted", startedAt: 99 }],
  });

  assert.deepEqual(result, {
    phase: "interrupted",
    activeTurnId: "turn-4",
  });
});

test("deriveCodexThreadActivity keeps streaming when a new in-flight turn exists after prior failure", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-old",
        turnId: "turn-old",
        status: "failed",
        createdAt: 10,
      },
    ],
    dispatches: [{ turnId: "turn-new", status: "claimed", updatedAt: 20 }],
    streamStats: [],
    turns: [],
  });

  assert.deepEqual(result, {
    phase: "streaming",
    activeTurnId: "turn-new",
  });
});
