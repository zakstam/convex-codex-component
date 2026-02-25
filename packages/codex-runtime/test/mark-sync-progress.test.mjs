import test from "node:test";
import assert from "node:assert/strict";
import { markSyncProgress } from "../dist/component/threads.js";

function createCtx(binding) {
  const patches = [];
  return {
    ctx: {
      db: {
        query: () => ({
          withIndex: () => ({
            first: async () => binding,
          }),
        }),
        patch: async (id, value) => {
          patches.push({ id, value });
        },
      },
    },
    patches,
  };
}

test("markSyncProgress ignores stale update when expectedSyncJobId does not match missing binding syncJobId", async () => {
  const binding = {
    _id: "binding-1",
    threadId: "thread-1",
    conversationId: "conv-1",
    syncState: "syncing",
    lastSyncedCursor: 11,
  };
  const { ctx, patches } = createCtx(binding);

  const result = await markSyncProgress._handler(ctx, {
    actor: { userId: "u-1" },
    conversationId: "conv-1",
    expectedSyncJobId: "job-expected",
    cursor: 12,
  });

  assert.equal(result.staleIgnored, true);
  assert.equal(result.lastSyncedCursor, 11);
  assert.equal(patches.length, 0);
});

test("markSyncProgress clears stale syncJobErrorCode when no new syncJobErrorCode is provided", async () => {
  const binding = {
    _id: "binding-2",
    threadId: "thread-2",
    conversationId: "conv-2",
    syncState: "drifted",
    syncJobErrorCode: "E_SYNC_OLD_FAILURE",
    lastSyncedCursor: 20,
  };
  const { ctx, patches } = createCtx(binding);

  const result = await markSyncProgress._handler(ctx, {
    actor: { userId: "u-1" },
    conversationId: "conv-2",
    cursor: 21,
    syncState: "synced",
  });

  assert.equal(result.staleIgnored, false);
  assert.equal(result.syncState, "synced");
  assert.ok(patches.length > 0);
  const patch = patches[0];
  assert.ok(patch);
  assert.equal(Object.prototype.hasOwnProperty.call(patch.value, "syncJobErrorCode"), true);
  assert.equal(patch.value.syncJobErrorCode, undefined);
});

test("markSyncProgress return validator allows idle syncJobState", () => {
  const returnsJson = JSON.parse(markSyncProgress.exportReturns());
  const syncJobStateField = returnsJson.value.syncJobState;
  assert.ok(syncJobStateField);
  assert.equal(syncJobStateField.optional, true);
  const flattenLiterals = (entries) => entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    if (entry.type === "literal") {
      return [entry.value];
    }
    if (entry.type === "union" && Array.isArray(entry.value)) {
      return flattenLiterals(entry.value);
    }
    return [];
  });
  assert.deepEqual(
    flattenLiterals(syncJobStateField.fieldType.value),
    ["idle", "syncing", "synced", "failed", "cancelled"],
  );
});
