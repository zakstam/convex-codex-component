import test from "node:test";
import assert from "node:assert/strict";
import * as host from "../dist/host/index.js";

function createComponentRefs() {
  return {
    codexLocal: {
      approvals: {},
      messages: {},
      reasoning: {},
      serverRequests: {},
      sync: {},
      threads: {
        resolveByConversationId: Symbol("threads.resolveByConversationId"),
      },
      turns: {},
    },
  };
}

test("runtime-owned host surface is conversation-only", () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  const mutationKeys = Object.keys(defs.mutations);
  const queryKeys = Object.keys(defs.queries);

  assert.ok(mutationKeys.includes("ensureConversationBinding"));
  assert.ok(mutationKeys.includes("syncOpenConversationBinding"));
  assert.ok(mutationKeys.includes("markConversationSyncProgress"));
  assert.ok(mutationKeys.includes("forceRebindConversationSync"));
  assert.ok(mutationKeys.includes("startConversationSyncJob"));
  assert.ok(mutationKeys.includes("appendConversationSyncChunk"));
  assert.ok(mutationKeys.includes("sealConversationSyncJobSource"));
  assert.ok(mutationKeys.includes("cancelConversationSyncJob"));
  assert.equal(mutationKeys.includes("getConversationSyncJob"), false);
  assert.equal(mutationKeys.includes("listConversationSyncJobs"), false);

  assert.ok(queryKeys.includes("getConversationSyncJob"));
  assert.ok(queryKeys.includes("listConversationSyncJobs"));

  assert.ok(queryKeys.includes("threadSnapshotByConversation"));
  assert.ok(queryKeys.includes("listThreadMessagesByConversation"));
  assert.ok(queryKeys.includes("listTurnMessagesByConversation"));
  assert.ok(queryKeys.includes("listPendingServerRequestsByConversation"));

  for (const key of queryKeys) {
    assert.equal(key.includes("ByThreadHandle"), false, `query key must not include ByThreadHandle: ${key}`);
  }

  assert.deepEqual(
    [...host.HOST_SURFACE_MANIFEST.runtimeOwned.queries].sort(),
    queryKeys.sort(),
  );
  assert.deepEqual(
    [...host.HOST_SURFACE_MANIFEST.runtimeOwned.mutations].sort(),
    mutationKeys.sort(),
  );
});
