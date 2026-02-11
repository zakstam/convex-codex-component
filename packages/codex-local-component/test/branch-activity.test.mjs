import test from "node:test";
import assert from "node:assert/strict";
import { deriveCodexBranchActivity } from "../dist/react/branchActivity.js";

test("deriveCodexBranchActivity returns thread-level activity without a branch selection", () => {
  const activity = deriveCodexBranchActivity({
    pendingApprovals: [{ turnId: "turn-1" }],
    recentMessages: [],
    dispatches: [],
    streamStats: [],
    turns: [],
  });
  assert.equal(activity.phase, "awaiting_approval");
});

test("deriveCodexBranchActivity scopes streaming to the selected branch turn", () => {
  const activity = deriveCodexBranchActivity(
    {
      pendingApprovals: [],
      recentMessages: [
        { turnId: "turn-a", messageId: "m-a", status: "streaming", createdAt: 2 },
        { turnId: "turn-b", messageId: "m-b", status: "streaming", createdAt: 3 },
      ],
      dispatches: [],
      streamStats: [],
      turns: [],
    },
    { turnId: "turn-a", includeDescendants: false },
  );
  assert.deepEqual(activity, {
    phase: "streaming",
    activeTurnId: "turn-a",
    activeMessageId: "m-a",
  });
});

test("deriveCodexBranchActivity infers descendants by startedAt when requested", () => {
  const activity = deriveCodexBranchActivity(
    {
      pendingApprovals: [],
      recentMessages: [],
      dispatches: [{ turnId: "turn-2", status: "started", updatedAt: 3 }],
      streamStats: [],
      turns: [
        { turnId: "turn-1", status: "completed", startedAt: 1 },
        { turnId: "turn-2", status: "inProgress", startedAt: 2 },
      ],
    },
    { turnId: "turn-1", includeDescendants: true },
  );
  assert.deepEqual(activity, {
    phase: "streaming",
    activeTurnId: "turn-2",
  });
});

test("deriveCodexBranchActivity uses approval projection for selected turn set", () => {
  const activity = deriveCodexBranchActivity(
    {
      pendingApprovals: [{ turnId: "turn-z" }],
      recentMessages: [],
      dispatches: [],
      streamStats: [],
      turns: [],
    },
    { turnIds: ["turn-z"] },
  );
  assert.equal(activity.phase, "awaiting_approval");
});

test("deriveCodexBranchActivity returns idle for empty branch selection without fallback", () => {
  const activity = deriveCodexBranchActivity(
    {
      pendingApprovals: [],
      recentMessages: [{ turnId: "turn-1", messageId: "m-1", status: "streaming", createdAt: 1 }],
      dispatches: [],
      streamStats: [],
      turns: [],
    },
    { turnIds: ["turn-missing"], fallbackToThread: false },
  );
  assert.deepEqual(activity, { phase: "idle" });
});
