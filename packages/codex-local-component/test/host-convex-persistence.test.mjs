import test from "node:test";
import assert from "node:assert/strict";
import { createConvexPersistence } from "../dist/host/index.js";

function createChatApi() {
  return {
    startConversationSyncSource: Symbol("startConversationSyncSource"),
    appendConversationSyncSourceChunk: Symbol("appendConversationSyncSourceChunk"),
    sealConversationSyncSource: Symbol("sealConversationSyncSource"),
    cancelConversationSyncJob: Symbol("cancelConversationSyncJob"),
    getConversationSyncJob: Symbol("getConversationSyncJob"),
    listConversationSyncJobs: Symbol("listConversationSyncJobs"),
    syncOpenConversationBinding: Symbol("syncOpenConversationBinding"),
    markConversationSyncProgress: Symbol("markConversationSyncProgress"),
    forceRebindConversationSync: Symbol("forceRebindConversationSync"),
    ensureSession: Symbol("ensureSession"),
    ingestBatch: Symbol("ingestBatch"),
    upsertPendingServerRequest: Symbol("upsertPendingServerRequest"),
    resolvePendingServerRequest: Symbol("resolvePendingServerRequest"),
    listPendingServerRequests: Symbol("listPendingServerRequests"),
    acceptTurnSend: Symbol("acceptTurnSend"),
    failAcceptedTurnSend: Symbol("failAcceptedTurnSend"),
    upsertTokenUsage: Symbol("upsertTokenUsage"),
  };
}

test("createConvexPersistence.getConversationSyncJob uses query transport", async () => {
  const calls = [];
  const chatApi = createChatApi();
  const client = {
    mutation: async (fn, args) => {
      calls.push({ kind: "mutation", fn, args });
      return null;
    },
    query: async (fn, args) => {
      calls.push({ kind: "query", fn, args });
      return {
        jobId: "job-1",
        conversationId: "conv-1",
        threadId: "thread-1",
        state: "syncing",
        sourceState: "sealed",
        policyVersion: 1,
        startedAt: 1,
        updatedAt: 1,
        lastCursor: 0,
        processedChunkIndex: 0,
        totalChunks: 1,
        processedMessageCount: 0,
        retryCount: 0,
      };
    },
  };
  const persistence = createConvexPersistence(client, chatApi, { syncJobPollTimeoutMs: 25 });

  await persistence.getConversationSyncJob({
    actor: { userId: "u-1" },
    conversationId: "conv-1",
    jobId: "job-1",
  });

  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["query"],
  );
  assert.equal(calls[0].fn, chatApi.getConversationSyncJob);
});

test("createConvexPersistence.waitForConversationSyncJobTerminal polls with query transport", async () => {
  const calls = [];
  const chatApi = createChatApi();
  let pollCount = 0;
  const client = {
    mutation: async (fn, args) => {
      calls.push({ kind: "mutation", fn, args });
      return null;
    },
    query: async (fn, args) => {
      calls.push({ kind: "query", fn, args });
      pollCount += 1;
      if (pollCount === 1) {
        return {
          jobId: "job-1",
          state: "syncing",
          lastCursor: 0,
          processedMessageCount: 0,
        };
      }
      return {
        jobId: "job-1",
        state: "synced",
        lastCursor: 3,
        processedMessageCount: 8,
      };
    },
  };
  const persistence = createConvexPersistence(client, chatApi, {
    syncJobPollMs: 1,
    syncJobPollTimeoutMs: 100,
  });

  const terminal = await persistence.waitForConversationSyncJobTerminal({
    actor: { userId: "u-1" },
    conversationId: "conv-1",
    jobId: "job-1",
  });

  assert.equal(terminal.state, "synced");
  assert.ok(calls.every((call) => call.kind === "query"));
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((call) => call.fn === chatApi.getConversationSyncJob));
});

test("createConvexPersistence.listPendingServerRequests queries by conversation scope", async () => {
  const calls = [];
  const chatApi = createChatApi();
  const client = {
    mutation: async (fn, args) => {
      calls.push({ kind: "mutation", fn, args });
      return null;
    },
    query: async (fn, args) => {
      calls.push({ kind: "query", fn, args });
      return [{ requestId: "req-1" }];
    },
  };
  const persistence = createConvexPersistence(client, chatApi, { syncJobPollTimeoutMs: 25 });

  const pending = await persistence.listPendingServerRequests({
    actor: { userId: "u-1" },
    conversationId: "conv-1",
  });

  assert.deepEqual(pending, [{ requestId: "req-1" }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    kind: "query",
    fn: chatApi.listPendingServerRequests,
    args: {
      actor: { userId: "u-1" },
      conversationId: "conv-1",
      limit: 100,
    },
  });
});

test("createConvexPersistence.listPendingServerRequests returns [] for missing thread read errors with mapped threadId input", async () => {
  const calls = [];
  const chatApi = createChatApi();
  const client = {
    mutation: async (fn, args) => {
      calls.push({ kind: "mutation", fn, args });
      return null;
    },
    query: async (fn, args) => {
      calls.push({ kind: "query", fn, args });
      assert.equal(fn, chatApi.listPendingServerRequests);
      assert.deepEqual(args, {
        actor: { userId: "u-1" },
        conversationId: "conv-1",
        limit: 100,
      });
      throw new Error("[E_THREAD_NOT_FOUND] Thread not found: conv-1");
    },
  };
  const persistence = createConvexPersistence(client, chatApi, { syncJobPollTimeoutMs: 25 });

  const pending = await persistence.listPendingServerRequests({
    actor: { userId: "u-1" },
    conversationId: "conv-1",
  });

  assert.deepEqual(pending, []);
});

test("createConvexPersistence.listPendingServerRequests returns [] for missing thread read errors", async () => {
  const chatApi = createChatApi();
  const client = {
    mutation: async (fn) => {
      if (fn === chatApi.syncOpenConversationBinding) {
        return { threadId: "persisted-thread-1", created: true, rebindApplied: false };
      }
      return null;
    },
    query: async () => {
      throw new Error("[E_THREAD_NOT_FOUND] Thread not found: conv-1");
    },
  };
  const persistence = createConvexPersistence(client, chatApi, { syncJobPollTimeoutMs: 25 });

  await persistence.ensureThread({
    actor: { userId: "u-1" },
    conversationId: "conv-1",
  });
  const pending = await persistence.listPendingServerRequests({
    actor: { userId: "u-1" },
    threadId: "persisted-thread-1",
  });

  assert.deepEqual(pending, []);
});
