import test from "node:test";
import assert from "node:assert/strict";
import { deriveCodexIngestHealth } from "../dist/ingestHealth.js";

test("deriveCodexIngestHealth returns unknown before first snapshot", () => {
  const result = deriveCodexIngestHealth(undefined);
  assert.equal(result.status, "unknown");
});

test("deriveCodexIngestHealth returns missing_thread for safe-missing snapshots", () => {
  const result = deriveCodexIngestHealth(null);
  assert.equal(result.status, "missing_thread");
});

test("deriveCodexIngestHealth reports healthy for normal streaming signals", () => {
  const result = deriveCodexIngestHealth({
    streamStats: [{ state: "streaming", latestCursor: 12 }],
    recentMessages: [{ status: "streaming", createdAt: 123 }],
    pendingApprovals: [],
    dispatches: [{ status: "started" }],
    turns: [{ startedAt: 100 }],
  });
  assert.equal(result.status, "healthy");
  assert.equal(result.activeStreamCount, 1);
  assert.equal(result.latestStreamCursor, 12);
});

test("deriveCodexIngestHealth reports degraded for aborted/orphan ingest signals", () => {
  const result = deriveCodexIngestHealth({
    streamStats: [{ state: "aborted", latestCursor: 1 }],
    recentMessages: [],
    pendingApprovals: [],
    dispatches: [],
    turns: [],
  });
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.issues.includes("aborted_streams"), true);
});
