import test from "node:test";
import assert from "node:assert/strict";
import { runConversationSyncJob } from "../dist/component/threads.js";

function createSyncJobCtx(options = {}) {
  const patches = [];
  const job = {
    _id: "job-ref",
    jobId: "job-1",
    sourceRef: "source-ref",
    userId: "u",
    conversationId: "conv-1",
    threadId: "thread-1",
    state: "running",
    processedChunkIndex: 0,
    totalChunks: 1,
    retryCount: 0,
    lastCursor: 12,
  };
  const source = {
    _id: "source-ref",
    state: "sealed",
    expectedManifestJson: "[]",
    expectedMessageCount: 0,
    expectedChecksum: "1:0:1",
  };
  const binding = {
    _id: "binding-ref",
    conversationId: "conv-1",
    userId: "u",
  };
  const chunk = options.chunk ?? null;

  return {
    ctx: {
      db: {
        query: (tableName) => ({
          withIndex: () => ({
            first: async () => {
              if (tableName === "codex_sync_jobs") {
                return null;
              }
              if (tableName === "codex_sync_import_jobs") {
                return job;
              }
              if (tableName === "codex_sync_job_chunks") {
                return null;
              }
              if (tableName === "codex_sync_import_source_chunks") {
                return chunk;
              }
              if (tableName === "codex_thread_bindings") {
                return binding;
              }
              return null;
            },
            collect: async () => [],
          }),
        }),
        get: async (id) => {
          if (id === "source-ref") {
            return source;
          }
          return null;
        },
        patch: async (id, value) => {
          patches.push({ id, value });
        },
      },
      scheduler: {
        runAfter: async () => "scheduled-id",
      },
    },
    patches,
  };
}

test("runConversationSyncJob marks binding drifted when chunk is missing", async () => {
  const { ctx, patches } = createSyncJobCtx();

  await runConversationSyncJob._handler(ctx, {
    actor: { userId: "u" },
    jobId: "job-1",
  });

  const bindingPatch = patches.find((entry) => entry.id === "binding-ref");
  assert.ok(bindingPatch);
  assert.equal(bindingPatch.value.syncState, "drifted");
  assert.equal(bindingPatch.value.syncJobState, "failed");
  assert.equal(bindingPatch.value.syncJobErrorCode, "E_SYNC_SOURCE_CHUNK_INDEX_GAP");
  assert.equal(bindingPatch.value.lastErrorCode, "E_SYNC_SOURCE_CHUNK_INDEX_GAP");
});

test("runConversationSyncJob marks binding drifted when chunk payload is malformed", async () => {
  const { ctx, patches } = createSyncJobCtx({
    chunk: {
      payloadJson: "{",
      messageCount: 0,
    },
  });

  await runConversationSyncJob._handler(ctx, {
    actor: { userId: "u" },
    jobId: "job-1",
  });

  const bindingPatch = patches.find((entry) => entry.id === "binding-ref");
  assert.ok(bindingPatch);
  assert.equal(bindingPatch.value.syncState, "drifted");
  assert.equal(bindingPatch.value.syncJobState, "failed");
  assert.equal(bindingPatch.value.syncJobErrorCode, "E_SYNC_SOURCE_INVALID");
  assert.equal(bindingPatch.value.lastErrorCode, "E_SYNC_SOURCE_INVALID");
});
