import test from "node:test";
import assert from "node:assert/strict";
import { runConversationSyncJobChunk } from "../dist/component/threads.js";

function createSyncJobCtx(options = {}) {
  const patches = [];
  const job = {
    _id: "job-ref",
    jobId: "job-1",
    userId: "u",
    conversationId: "conv-1",
    threadId: "thread-1",
    state: "syncing",
    sourceState: "sealed",
    processedChunkIndex: 0,
    totalChunks: 1,
    retryCount: 0,
    lastCursor: 12,
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
                return job;
              }
              if (tableName === "codex_sync_job_chunks") {
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

test("runConversationSyncJobChunk marks binding drifted when chunk is missing", async () => {
  const { ctx, patches } = createSyncJobCtx();

  await runConversationSyncJobChunk._handler(ctx, {
    actor: { userId: "u" },
    jobId: "job-1",
  });

  const bindingPatch = patches.find((entry) => entry.id === "binding-ref");
  assert.ok(bindingPatch);
  assert.equal(bindingPatch.value.syncState, "drifted");
  assert.equal(bindingPatch.value.syncJobState, "failed");
  assert.equal(bindingPatch.value.syncJobErrorCode, "E_SYNC_JOB_CHUNK_MISSING");
  assert.equal(bindingPatch.value.lastErrorCode, "E_SYNC_JOB_CHUNK_MISSING");
});

test("runConversationSyncJobChunk marks binding drifted when chunk payload is malformed", async () => {
  const { ctx, patches } = createSyncJobCtx({
    chunk: {
      payloadJson: "{",
      messageCount: 0,
    },
  });

  await runConversationSyncJobChunk._handler(ctx, {
    actor: { userId: "u" },
    jobId: "job-1",
  });

  const bindingPatch = patches.find((entry) => entry.id === "binding-ref");
  assert.ok(bindingPatch);
  assert.equal(bindingPatch.value.syncState, "drifted");
  assert.equal(bindingPatch.value.syncJobState, "failed");
  assert.equal(bindingPatch.value.syncJobErrorCode, "E_SYNC_JOB_CHUNK_PARSE_FAILED");
  assert.equal(bindingPatch.value.lastErrorCode, "E_SYNC_JOB_CHUNK_PARSE_FAILED");
});
