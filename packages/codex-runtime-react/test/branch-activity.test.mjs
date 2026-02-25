import test from "node:test";
import assert from "node:assert/strict";
import { deriveCodexBranchActivity } from "../dist/branchActivity.js";

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

test("deriveCodexBranchActivity ignores stale streamStats when selected branch has no active stream", () => {
  const activity = deriveCodexBranchActivity(
    {
      pendingApprovals: [],
      recentMessages: [{ turnId: "turn-a", messageId: "m-a", status: "completed", createdAt: 10 }],
      dispatches: [{ turnId: "turn-a", status: "started", updatedAt: 5 }],
      streamStats: [{ state: "streaming" }],
      activeStreams: [],
      lifecycleMarkers: [{ kind: "stream/drain_complete", turnId: "turn-a", createdAt: 11 }],
      turns: [{ turnId: "turn-a", status: "inProgress", startedAt: 6 }],
    },
    { turnId: "turn-a" },
  );

  assert.deepEqual(activity, { phase: "idle" });
});

test("deriveCodexBranchActivity keeps expected phases for in-flight dispatch scenarios", () => {
  const snapshots = [
    {
      pendingApprovals: [],
      recentMessages: [{ turnId: "turn-a", messageId: "m-a", status: "streaming", createdAt: 2 }],
      dispatches: [{ turnId: "turn-a", status: "started", updatedAt: 2 }],
      streamStats: [{ state: "streaming" }],
      activeStreams: [{ streamId: "stream-a", turnId: "turn-a", startedAt: 2 }],
      turns: [{ turnId: "turn-a", status: "inProgress", startedAt: 1 }],
    },
    {
      pendingApprovals: [],
      recentMessages: [{ turnId: "turn-a", messageId: "m-a", status: "completed", createdAt: 10 }],
      dispatches: [{ turnId: "turn-a", status: "started", updatedAt: 5 }],
      streamStats: [{ state: "streaming" }],
      activeStreams: [],
      lifecycleMarkers: [{ kind: "stream/drain_complete", turnId: "turn-a", createdAt: 11 }],
      turns: [{ turnId: "turn-a", status: "inProgress", startedAt: 6 }],
    },
  ];
  const selection = { turnId: "turn-a", includeDescendants: false };
  const phases = snapshots.map((snapshot) => deriveCodexBranchActivity(snapshot, selection).phase);

  assert.deepEqual(phases, ["streaming", "idle"]);
});
