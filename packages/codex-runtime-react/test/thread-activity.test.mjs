import test from "node:test";
import assert from "node:assert/strict";
import { deriveCodexThreadActivity } from "../dist/threadActivity.js";

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

// --- Stale dispatch/turn regression tests ---

test("deriveCodexThreadActivity returns idle when message completed but dispatch still in-flight (stale)", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-1",
        turnId: "turn-1",
        status: "completed",
        createdAt: 100,
      },
    ],
    dispatches: [
      {
        turnId: "turn-1",
        status: "started",
        updatedAt: 50,
      },
    ],
    streamStats: [],
    turns: [],
  });

  assert.equal(result.phase, "idle");
});

test("deriveCodexThreadActivity uses completedAt over createdAt for terminal boundary decisions", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-1",
        turnId: "turn-1",
        status: "completed",
        createdAt: 20,
        completedAt: 120,
      },
    ],
    dispatches: [
      {
        turnId: "turn-1",
        status: "started",
        updatedAt: 100,
      },
    ],
    streamStats: [],
    turns: [],
  });

  assert.equal(result.phase, "idle");
});

test("deriveCodexThreadActivity uses updatedAt when completedAt is missing", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-1",
        turnId: "turn-1",
        status: "completed",
        createdAt: 20,
        updatedAt: 130,
      },
    ],
    dispatches: [
      {
        turnId: "turn-1",
        status: "started",
        updatedAt: 100,
      },
    ],
    streamStats: [],
    turns: [],
  });

  assert.equal(result.phase, "idle");
});

test("deriveCodexThreadActivity ignores stale streaming message when completed boundary is newer", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-streaming-stale",
        turnId: "turn-1",
        status: "streaming",
        createdAt: 50,
      },
      {
        messageId: "msg-completed-newer",
        turnId: "turn-1",
        status: "completed",
        createdAt: 60,
        updatedAt: 180,
        completedAt: 180,
      },
    ],
    dispatches: [],
    streamStats: [{ state: "finished" }],
    activeStreams: [],
    turns: [{ turnId: "turn-1", status: "completed", startedAt: 40, completedAt: 180 }],
  });

  assert.equal(result.phase, "idle");
});

test("deriveCodexThreadActivity keeps streaming when streaming message is newer than terminal boundary", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-streaming-new",
        turnId: "turn-2",
        status: "streaming",
        createdAt: 220,
      },
      {
        messageId: "msg-completed-old",
        turnId: "turn-1",
        status: "completed",
        createdAt: 100,
        completedAt: 180,
      },
    ],
    dispatches: [],
    streamStats: [{ state: "finished" }],
    activeStreams: [],
    turns: [{ turnId: "turn-1", status: "completed", startedAt: 90, completedAt: 180 }],
  });

  assert.deepEqual(result, {
    phase: "streaming",
    activeTurnId: "turn-2",
    activeMessageId: "msg-streaming-new",
  });
});

test("deriveCodexThreadActivity treats equal streaming and terminal timestamps as terminal boundary", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-streaming-equal",
        turnId: "turn-1",
        status: "streaming",
        createdAt: 180,
      },
      {
        messageId: "msg-completed-equal",
        turnId: "turn-1",
        status: "completed",
        createdAt: 120,
        completedAt: 180,
      },
    ],
    dispatches: [],
    streamStats: [{ state: "finished" }],
    activeStreams: [],
    turns: [{ turnId: "turn-1", status: "completed", startedAt: 100, completedAt: 180 }],
  });

  assert.equal(result.phase, "idle");
});

test("deriveCodexThreadActivity treats turn-only completed boundary as terminal against stale streaming message", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-streaming-stale",
        turnId: "turn-1",
        status: "streaming",
        createdAt: 90,
      },
    ],
    dispatches: [],
    streamStats: [{ state: "finished" }],
    activeStreams: [],
    turns: [{ turnId: "turn-1", status: "completed", startedAt: 70, completedAt: 140 }],
  });

  assert.equal(result.phase, "idle");
});

test("deriveCodexThreadActivity keeps awaiting_approval precedence even with newer terminal boundary", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [{ itemId: "approval-1" }],
    recentMessages: [
      {
        messageId: "msg-streaming",
        turnId: "turn-1",
        status: "streaming",
        createdAt: 50,
      },
      {
        messageId: "msg-completed",
        turnId: "turn-1",
        status: "completed",
        createdAt: 60,
        completedAt: 180,
      },
    ],
    dispatches: [],
    streamStats: [{ state: "finished" }],
    activeStreams: [],
    turns: [{ turnId: "turn-1", status: "completed", startedAt: 40, completedAt: 180 }],
  });

  assert.equal(result.phase, "awaiting_approval");
});

test("deriveCodexThreadActivity returns idle when message completed but turn still in-flight (stale)", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-1",
        turnId: "turn-1",
        status: "completed",
        createdAt: 100,
      },
    ],
    dispatches: [],
    streamStats: [],
    turns: [
      {
        turnId: "turn-1",
        status: "inProgress",
        startedAt: 50,
      },
    ],
  });

  assert.equal(result.phase, "idle");
});

test("deriveCodexThreadActivity keeps streaming when dispatch is newer than completed message (new turn)", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-1",
        turnId: "turn-1",
        status: "completed",
        createdAt: 100,
      },
    ],
    dispatches: [
      {
        turnId: "turn-2",
        status: "queued",
        createdAt: 200,
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

test("deriveCodexThreadActivity returns idle when both dispatch and terminal message have timestamp 0", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-1",
        turnId: "turn-1",
        status: "completed",
      },
    ],
    dispatches: [
      {
        turnId: "turn-1",
        status: "started",
      },
    ],
    streamStats: [],
    turns: [],
  });

  // When timestamps are missing (both default to 0), a terminal message
  // should win to avoid the stuck-streaming bug.
  assert.equal(result.phase, "idle");
});

test("deriveCodexThreadActivity returns idle with stale dispatch and stale turn simultaneously", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [
      {
        messageId: "msg-1",
        turnId: "turn-1",
        status: "completed",
        createdAt: 100,
      },
    ],
    dispatches: [
      {
        turnId: "turn-1",
        status: "started",
        updatedAt: 40,
      },
    ],
    streamStats: [],
    turns: [
      {
        turnId: "turn-1",
        status: "streaming",
        startedAt: 30,
      },
    ],
  });

  assert.equal(result.phase, "idle");
});

test("deriveCodexThreadActivity does not force streaming from streamStats without activeStreams", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [],
    dispatches: [],
    streamStats: [{ state: "streaming" }],
    activeStreams: [],
    turns: [],
  });

  assert.deepEqual(result, { phase: "idle" });
});

test("deriveCodexThreadActivity exits streaming when stream drain marker is newer than stale in-flight rows", () => {
  const result = deriveCodexThreadActivity({
    pendingApprovals: [],
    recentMessages: [],
    dispatches: [{ turnId: "turn-1", status: "started", updatedAt: 10 }],
    streamStats: [{ state: "streaming" }],
    activeStreams: [{ streamId: "stream-1", turnId: "turn-1", startedAt: 8 }],
    lifecycleMarkers: [{ kind: "stream/drain_complete", turnId: "turn-1", createdAt: 20 }],
    turns: [{ turnId: "turn-1", status: "inProgress", startedAt: 9 }],
  });

  assert.deepEqual(result, { phase: "idle" });
});

test("deriveCodexThreadActivity keeps behavior consistent with a queued in-flight dispatch row", () => {
  const snapshots = [
    {
      pendingApprovals: [],
      recentMessages: [{ messageId: "m-1", turnId: "turn-1", status: "streaming", createdAt: 10 }],
      dispatches: [{ turnId: "turn-1", status: "started", updatedAt: 10 }],
      turns: [{ turnId: "turn-1", status: "inProgress", startedAt: 9 }],
      streamStats: [{ state: "streaming" }],
      activeStreams: [{ streamId: "stream-1", turnId: "turn-1", startedAt: 10 }],
    },
    {
      pendingApprovals: [],
      recentMessages: [{ messageId: "m-1", turnId: "turn-1", status: "completed", createdAt: 30 }],
      dispatches: [{ turnId: "turn-1", status: "started", updatedAt: 15 }],
      turns: [{ turnId: "turn-1", status: "inProgress", startedAt: 14 }],
      streamStats: [{ state: "streaming" }],
      activeStreams: [],
      lifecycleMarkers: [{ kind: "stream/drain_complete", turnId: "turn-1", createdAt: 31 }],
    },
    {
      pendingApprovals: [],
      recentMessages: [{ messageId: "m-1", turnId: "turn-1", status: "completed", createdAt: 30 }],
      dispatches: [{ turnId: "turn-2", status: "started", updatedAt: 40 }],
      turns: [{ turnId: "turn-2", status: "inProgress", startedAt: 39 }],
      streamStats: [{ state: "streaming" }],
      activeStreams: [{ streamId: "stream-2", turnId: "turn-2", startedAt: 40 }],
    },
  ];
  const phases = snapshots.map((snapshot) => deriveCodexThreadActivity(snapshot).phase);
  assert.deepEqual(phases, ["streaming", "idle", "streaming"]);
});
