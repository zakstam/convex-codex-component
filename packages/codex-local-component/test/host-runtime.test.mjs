import test from "node:test";
import assert from "node:assert/strict";
import { createCodexHostRuntime } from "../dist/host/index.js";

async function waitForMessage(sent, predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = sent.find(predicate);
    if (message) {
      return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for message");
}

function createHarness(options = {}) {
  const sent = [];
  let handlers = null;
  const upserted = [];
  const resolved = [];
  const listPendingServerRequestCalls = [];
  const ingestCalls = [];
  const ensureThreadCalls = [];
  const dispatchQueue = [];
  const protocolErrors = [];
  const failedDispatches = [];
  const failedAcceptedTurnSends = [];
  const upsertErrors = [];
  const syncJobs = new Map();

  const runtime = createCodexHostRuntime({
    bridgeFactory: (_config, nextHandlers) => {
      handlers = nextHandlers;
      return {
        start: () => undefined,
        stop: () => undefined,
        send: (message) => {
          sent.push(message);
        },
      };
    },
    persistence: {
      ensureThread: async (args) => {
        ensureThreadCalls.push(args);
        return { threadId: "local-thread", created: true };
      },
      ensureSession: async () => ({ sessionId: "session", threadId: "local-thread", status: "created" }),
      ingestSafe: options.ingestSafe ?? (async (args) => {
        ingestCalls.push(args);
        return { status: "ok", errors: [] };
      }),
      upsertPendingServerRequest: async ({ request }) => {
        upserted.push(request);
        if (options.upsertPendingServerRequest) {
          try {
            await options.upsertPendingServerRequest({ request, upsertedCount: upserted.length });
          } catch (error) {
            upsertErrors.push(error);
            throw error;
          }
        }
      },
      resolvePendingServerRequest: async (args) => {
        resolved.push(args);
      },
      listPendingServerRequests: async (args) => {
        listPendingServerRequestCalls.push(args);
        if (options.listPendingServerRequests) {
          return options.listPendingServerRequests(args);
        }
        return [];
      },
      acceptTurnSend: async (args) => {
        const accepted = {
          dispatchId: `${args.turnId}-dispatch`,
          turnId: args.turnId,
          idempotencyKey: args.idempotencyKey,
          inputText: args.inputText,
          accepted: true,
        };
        dispatchQueue.push(accepted);
        return accepted;
      },
      failAcceptedTurnSend: async (args) => {
        failedAcceptedTurnSends.push(args);
      },
      claimNextTurnDispatch: async (args) => {
        if (options.claimNextTurnDispatch) {
          return options.claimNextTurnDispatch({ args, dispatchQueue });
        }
        const next = dispatchQueue.shift();
        if (!next) {
          return null;
        }
        return {
          dispatchId: next.dispatchId,
          turnId: next.turnId,
          idempotencyKey: next.idempotencyKey,
          inputText: next.inputText,
          claimToken: `${next.dispatchId}-claim`,
          leaseExpiresAt: Date.now() + 15_000,
          attemptCount: 1,
        };
      },
      markTurnDispatchStarted: async () => undefined,
      markTurnDispatchCompleted: async () => undefined,
      markTurnDispatchFailed: async (args) => {
        failedDispatches.push(args);
      },
      cancelTurnDispatch: async () => undefined,
      startConversationSyncSource: async (args) => {
        const sourceId = `source-${syncJobs.size + 1}`;
        syncJobs.set(sourceId, {
          actor: args.actor,
          conversationId: args.conversationId,
          threadId: args.threadId ?? "local-thread",
          chunks: [],
        });
        return {
          sourceId,
          conversationId: args.conversationId,
          threadId: args.threadId ?? "local-thread",
          sourceState: "collecting",
          policyVersion: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      },
      appendConversationSyncSourceChunk: async (args) => {
        const job = syncJobs.get(args.sourceId);
        job.chunks[args.chunkIndex] = JSON.parse(args.payloadJson);
        return { sourceId: args.sourceId, chunkIndex: args.chunkIndex, appended: true };
      },
      sealConversationSyncSource: async (args) => {
        const job = syncJobs.get(args.sourceId);
        job.sealed = true;
        job.jobId = `job-${args.sourceId}`;
        syncJobs.set(job.jobId, job);
        return {
          sourceId: args.sourceId,
          jobId: job.jobId,
          sourceState: "sealed",
          totalChunks: job.chunks.filter(Boolean).length,
          scheduled: true,
        };
      },
      cancelConversationSyncJob: async (args) => ({ jobId: args.jobId, state: "cancelled", cancelled: true }),
      getConversationSyncJob: async (args) => {
        const job = syncJobs.get(args.jobId ?? "");
        if (!job) {
          return null;
        }
        return {
          jobId: args.jobId ?? "",
          conversationId: job.conversationId,
          threadId: job.threadId,
          state: "syncing",
          sourceState: job.sealed ? "sealed" : "collecting",
          policyVersion: 1,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          lastCursor: 0,
          processedChunkIndex: 0,
          totalChunks: job.chunks.filter(Boolean).length,
          processedMessageCount: 0,
          retryCount: 0,
        };
      },
      waitForConversationSyncJobTerminal: async (args) => {
        const job = syncJobs.get(args.jobId);
        const chunks = (job?.chunks ?? []).filter(Boolean);
        const ingestFn = options.ingestSafe ?? (async (ingestArgs) => {
          ingestCalls.push(ingestArgs);
          return { status: "ok", errors: [] };
        });
        const runChunk = async (chunk) => {
          const ingest = await ingestFn({
            actor: args.actor,
            sessionId: "sync-job",
            threadId: job.threadId,
            deltas: chunk,
          });
          if (ingest.status !== "rejected") {
            return { ok: true };
          }
          const firstError = ingest.errors?.[0];
          const message = `${firstError?.code ?? ""} ${firstError?.message ?? ""}`.toLowerCase();
          if (chunk.length > 1 && message.includes("too many documents read")) {
            const splitAt = Math.max(1, Math.floor(chunk.length / 2));
            const left = await runChunk(chunk.slice(0, splitAt));
            if (!left.ok) {
              return left;
            }
            return runChunk(chunk.slice(splitAt));
          }
          return {
            ok: false,
            error: {
              code: firstError?.code ?? "UNKNOWN",
              message: firstError?.message ?? "rejected",
            },
          };
        };
        for (const chunk of chunks) {
          const result = await runChunk(chunk);
          if (!result.ok) {
            return {
              jobId: args.jobId,
              state: "failed",
              lastCursor: 0,
              processedMessageCount: 0,
              lastErrorCode: result.error.code,
              lastErrorMessage: result.error.message,
            };
          }
        }
        return {
          jobId: args.jobId,
          state: "synced",
          lastCursor: chunks.length,
          processedMessageCount: chunks.reduce(
            (count, chunk) => count + chunk.filter((delta) => delta.kind === "item/completed").length,
            0,
          ),
        };
      },
    },
    handlers: {
      onProtocolError: (error) => {
        protocolErrors.push(error);
      },
    },
  });

  const emitResponse = async (response) => {
    assert.ok(handlers, "bridge handlers not initialized");
    await handlers.onGlobalMessage(response, { scope: "global", kind: "response" });
  };

  const emitGlobalMessage = async (message) => {
    assert.ok(handlers, "bridge handlers not initialized");
    await handlers.onGlobalMessage(message, { scope: "global", kind: "message" });
  };

  const emitEvent = async (event) => {
    assert.ok(handlers, "bridge handlers not initialized");
    await handlers.onEvent(event);
  };
  const emitProcessExit = (code) => {
    assert.ok(handlers, "bridge handlers not initialized");
    handlers.onProcessExit(code);
  };

  const runtimeCompat = {
    ...runtime,
    start: async (startArgs = {}) => {
      await runtime.connect({
        actor: startArgs.actor,
        sessionId: startArgs.sessionId,
        model: startArgs.model,
        cwd: startArgs.cwd,
        runtime: startArgs.runtime,
        dynamicTools: startArgs.dynamicTools,
        ingestFlushMs: startArgs.ingestFlushMs,
      });
      void runtime.openThread({
        strategy: startArgs.threadStrategy ?? "start",
        conversationId: startArgs.conversationId,
        model: startArgs.model,
        cwd: startArgs.cwd,
        dynamicTools: startArgs.dynamicTools,
      }).catch(() => undefined);
    },
  };

  return {
    runtime: runtimeCompat,
    sent,
    emitResponse,
    emitGlobalMessage,
    emitEvent,
    emitProcessExit,
    upserted,
    resolved,
    listPendingServerRequestCalls,
    ingestCalls,
    ensureThreadCalls,
    protocolErrors,
    failedDispatches,
    failedAcceptedTurnSends,
    upsertErrors,
  };
}

test("runtime connect does not open a thread until openThread is called", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";
  await runtime.connect({
    actor: { userId: "u" },
    sessionId: "s",
  });
  assert.deepEqual(sent.map((message) => message.method), ["initialize", "initialized"]);

  const openPromise = runtime.openThread({ strategy: "start" });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });
  await openPromise;

  await runtime.stop();
});

test("runtime process exit fail-closes pending requests and transitions lifecycle", async () => {
  const { runtime, sent, emitProcessExit } = createHarness();
  await runtime.connect({
    actor: { userId: "u" },
    sessionId: "s",
  });

  const readPromise = runtime.readAccount({ refreshToken: true });
  await waitForMessage(sent, (message) => message.method === "account/read");
  emitProcessExit(137);

  await assert.rejects(readPromise, /Bridge stopped before request completed/);
  const state = runtime.getState();
  assert.equal(state.running, false);
  assert.equal(state.phase, "error");
  assert.equal(state.source, "process_exit");
  assert.match(state.lastError ?? "", /codex exited with code 137/);
});

test("runtime stop still tears down when ingest flush fails", async () => {
  const { runtime, sent, emitResponse, emitEvent } = createHarness({
    ingestSafe: async () => {
      throw new Error("ingest exploded");
    },
  });
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b72";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-stop-flush-fail",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "turn/started",
    payloadJson: JSON.stringify({
      method: "turn/started",
      params: {
        threadId,
        turn: { id: "turn-1", items: [], status: "inProgress", error: null },
      },
    }),
    createdAt: Date.now(),
  });

  await assert.rejects(runtime.stop(), /ingest exploded/);
  const state = runtime.getState();
  assert.equal(state.running, false);
  assert.equal(state.phase, "stopped");
});

test("runtime listThreads preserves list messageCount and reports enrichment failure", async () => {
  const { runtime, sent, emitResponse, protocolErrors } = createHarness();
  await runtime.connect({
    actor: { userId: "u" },
    sessionId: "s",
  });

  const listPromise = runtime.listThreads({ limit: 10 });
  const listRequest = await waitForMessage(sent, (message) => message.method === "thread/list");
  await emitResponse({
    id: listRequest.id,
    result: {
      data: [
        {
          id: "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a",
          preview: "a",
          updatedAt: 2,
          messageCount: 7,
        },
      ],
      nextCursor: null,
    },
  });
  const readRequest = await waitForMessage(
    sent,
    (message) =>
      message.method === "thread/read" &&
      message.params?.threadId === "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a",
  );
  await emitResponse({
    id: readRequest.id,
    error: {
      code: 500,
      message: "read failed",
    },
  });

  const listed = await listPromise;
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].threadId, "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a");
  assert.equal(listed.data[0].messageCount, 7);
  assert.ok(protocolErrors.some((entry) => entry.message.includes("Failed to enrich thread messageCount")));

  await runtime.stop();
});

test("runtime can import local thread history into persistence using a single call", async () => {
  const { runtime, sent, emitResponse, ingestCalls } = createHarness();
  const runtimeThreadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";
  const persistedThreadHandle = "conv-thread-1";

  await runtime.connect({
    actor: { userId: "u" },
    sessionId: "s",
  });

  const importPromise = runtime.importLocalThreadToPersistence({
    runtimeThreadHandle: runtimeThreadId,
    conversationId: persistedThreadHandle,
  });
  const threadReadRequest = await waitForMessage(sent, (message) => message.method === "thread/read");
  await emitResponse({
    id: threadReadRequest.id,
    result: {
      thread: {
        id: runtimeThreadId,
        turns: [
          {
            id: "turn-1",
            status: "completed",
            error: null,
            items: [
              { type: "userMessage", id: "item-user-1", content: [{ type: "text", text: "hi" }] },
              { type: "agentMessage", id: "item-assistant-1", text: "hello" },
            ],
          },
        ],
      },
    },
  });

  const imported = await importPromise;
  assert.equal(imported.conversationId, persistedThreadHandle);
  assert.equal(imported.importedTurnCount, 1);
  assert.equal(imported.importedMessageCount, 2);
  assert.equal(imported.syncState, "synced");
  assert.equal(ingestCalls.length, 1);
  assert.ok(ingestCalls[0].deltas.some((delta) => delta.kind === "item/completed"));
  const cursorsByStream = new Map();
  for (const delta of ingestCalls[0].deltas) {
    const history = cursorsByStream.get(delta.streamId) ?? [];
    history.push([delta.cursorStart, delta.cursorEnd]);
    cursorsByStream.set(delta.streamId, history);
  }
  assert.equal(cursorsByStream.size, 1);
  const streamCursors = Array.from(cursorsByStream.values())[0];
  assert.deepEqual(streamCursors, [[0, 1], [1, 2], [2, 3], [3, 4]]);

  await runtime.stop();
});

test("runtime imports large local thread history using chunked ingest", async () => {
  const { runtime, sent, emitResponse, ingestCalls } = createHarness();
  const runtimeThreadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";
  const persistedThreadHandle = "conv-thread-large";
  const turns = Array.from({ length: 80 }, (_, index) => ({
    id: `turn-${index + 1}`,
    status: "completed",
    error: null,
    items: [
      { type: "userMessage", id: `item-user-${index + 1}`, text: `user-${index + 1}` },
      { type: "agentMessage", id: `item-assistant-${index + 1}`, text: `assistant-${index + 1}` },
    ],
  }));

  await runtime.connect({
    actor: { userId: "u" },
    sessionId: "s",
  });

  const importPromise = runtime.importLocalThreadToPersistence({
    runtimeThreadHandle: runtimeThreadId,
    conversationId: persistedThreadHandle,
  });
  const threadReadRequest = await waitForMessage(sent, (message) => message.method === "thread/read");
  await emitResponse({
    id: threadReadRequest.id,
    result: {
      thread: {
        id: runtimeThreadId,
        turns,
      },
    },
  });

  const imported = await importPromise;
  assert.equal(imported.conversationId, persistedThreadHandle);
  assert.equal(imported.importedTurnCount, turns.length);
  assert.equal(imported.importedMessageCount, turns.length * 2);
  assert.ok(ingestCalls.length > 1);
  for (const call of ingestCalls) {
    assert.ok(call.deltas.length <= 128);
  }

  await runtime.stop();
});

test("runtime import adaptively splits ingest chunks when Convex hits document read limits", async () => {
  const ingestCalls = [];
  const { runtime, sent, emitResponse } = createHarness({
    ingestSafe: async (args) => {
      ingestCalls.push(args);
      if (args.deltas.length > 40) {
        return {
          status: "rejected",
          errors: [
            {
              code: "UNKNOWN",
              message:
                "Too many documents read in a single function execution (limit: 32000). Consider using smaller limits in your queries.",
              recoverable: false,
            },
          ],
        };
      }
      return { status: "ok", errors: [] };
    },
  });
  const runtimeThreadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";
  const persistedThreadHandle = "conv-thread-adaptive";
  const turns = Array.from({ length: 80 }, (_, index) => ({
    id: `turn-${index + 1}`,
    status: "completed",
    error: null,
    items: [
      { type: "userMessage", id: `item-user-${index + 1}`, text: `user-${index + 1}` },
      { type: "agentMessage", id: `item-assistant-${index + 1}`, text: `assistant-${index + 1}` },
    ],
  }));

  await runtime.connect({
    actor: { userId: "u" },
    sessionId: "s",
  });

  const importPromise = runtime.importLocalThreadToPersistence({
    runtimeThreadHandle: runtimeThreadId,
    conversationId: persistedThreadHandle,
  });
  const threadReadRequest = await waitForMessage(sent, (message) => message.method === "thread/read");
  await emitResponse({
    id: threadReadRequest.id,
    result: {
      thread: {
        id: runtimeThreadId,
        turns,
      },
    },
  });

  const imported = await importPromise;
  assert.equal(imported.syncState, "synced");
  assert.ok(ingestCalls.some((call) => call.deltas.length > 40));
  assert.ok(ingestCalls.some((call) => call.deltas.length <= 40));

  await runtime.stop();
});

test("runtime sendTurn fail-closes when thread is not opened", async () => {
  const { runtime } = createHarness();
  await runtime.connect({
    actor: { userId: "u" },
    sessionId: "s",
  });
  await assert.rejects(
    runtime.sendTurn("hello"),
    /E_RUNTIME_THREAD_NOT_OPEN/,
  );
  await runtime.stop();
});

test("runtime start supports threadStrategy=resume", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
    threadStrategy: "resume",
    conversationId: threadId,
  });

  const methods = sent.map((message) => message.method);
  assert.deepEqual(methods, ["initialize", "initialized", "thread/resume"]);

  const resumeRequest = sent.find((message) => message.method === "thread/resume");
  await emitResponse({ id: resumeRequest.id, result: { thread: { id: threadId } } });

  await runtime.sendTurn("hello");
  const turnStartRequest = await waitForMessage(sent, (message) => message.method === "turn/start");
  assert.equal(turnStartRequest.params.threadId, threadId);

  await runtime.stop();
});

test("runtime resume can bind persisted conversation identity separately from runtime thread id", async () => {
  const { runtime, sent, emitResponse, ensureThreadCalls } = createHarness();
  const runtimeThreadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";
  const persistedConversationId = "conv-persisted-1";

  await runtime.connect({
    actor: { userId: "u" },
    sessionId: "s",
  });

  const openPromise = runtime.openThread({
    strategy: "resume",
    conversationId: runtimeThreadId,
    persistedConversationId,
  });
  const resumeRequest = sent.find((message) => message.method === "thread/resume");
  await emitResponse({ id: resumeRequest.id, result: { thread: { id: runtimeThreadId } } });
  await openPromise;

  await runtime.sendTurn("hello");
  assert.equal(ensureThreadCalls.length, 1);
  assert.equal(ensureThreadCalls[0].conversationId, persistedConversationId);

  await runtime.stop();
});

test("runtime start forwards dynamicTools in thread/start", async () => {
  const { runtime, sent } = createHarness();

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
    dynamicTools: [
      {
        name: "search_docs",
        description: "Search internal docs",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    ],
  });

  const startRequest = sent.find((message) => message.method === "thread/start");
  assert.equal(startRequest.params.dynamicTools?.[0]?.name, "search_docs");
  await runtime.stop();
});

test("runtime thread lifecycle mutations are blocked while turn is in flight", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await runtime.sendTurn("hello");
  await waitForMessage(sent, (message) => message.method === "turn/start");
  await assert.rejects(
    runtime.archiveThread(threadId),
    /Cannot change thread lifecycle while a turn is in flight/,
  );
  await assert.rejects(
    runtime.setThreadName(threadId, "Renamed during turn"),
    /Cannot change thread lifecycle while a turn is in flight/,
  );
  await assert.rejects(
    runtime.compactThread(threadId),
    /Cannot change thread lifecycle while a turn is in flight/,
  );

  await runtime.stop();
});

test("setThreadName and compactThread send thread requests and resolve responses", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  const setNamePromise = runtime.setThreadName(threadId, "Renamed from runtime");
  const setNameRequest = sent.find((message) => message.method === "thread/name/set");
  assert.equal(setNameRequest.params.threadId, threadId);
  assert.equal(setNameRequest.params.name, "Renamed from runtime");
  await emitResponse({ id: setNameRequest.id, result: {} });
  await setNamePromise;

  const compactPromise = runtime.compactThread(threadId);
  const compactRequest = sent.find((message) => message.method === "thread/compact/start");
  assert.equal(compactRequest.params.threadId, threadId);
  await emitResponse({ id: compactRequest.id, result: {} });
  await compactPromise;

  await runtime.stop();
});

test("conversation lifecycle helpers send conversation-scoped requests", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  const listPromise = runtime.listConversations({ pageSize: null, cursor: null, modelProviders: null });
  const listRequest = sent.find((message) => message.method === "listConversations");
  assert.ok(listRequest);
  await emitResponse({ id: listRequest.id, result: { items: [] } });
  await listPromise;

  const archivePromise = runtime.archiveConversation({ conversationId: "conv-1", rolloutPath: "/tmp/rollout" });
  const archiveRequest = sent.find((message) => message.method === "archiveConversation");
  assert.ok(archiveRequest);
  assert.equal(archiveRequest.params.conversationId, "conv-1");
  await emitResponse({ id: archiveRequest.id, result: {} });
  await archivePromise;

  await runtime.stop();
});

test("resumeThread updates active runtime thread id after response", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const initialThreadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";
  const resumedThreadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6b";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: initialThreadId } } });

  const resumePromise = runtime.resumeThread(resumedThreadId);
  const resumeRequest = sent.find((message) => message.method === "thread/resume");
  await emitResponse({ id: resumeRequest.id, result: { thread: { id: resumedThreadId } } });
  await resumePromise;

  await runtime.sendTurn("hello");
  await waitForMessage(sent, (message) => message.method === "turn/start");
  const turnStartRequests = sent.filter((message) => message.method === "turn/start");
  assert.equal(turnStartRequests[0].params.threadId, resumedThreadId);

  await runtime.stop();
});

test("runtime rebinds persistence when runtime conversation switches on resume", async () => {
  const { runtime, sent, emitResponse, emitEvent, ensureThreadCalls } = createHarness();
  const initialThreadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";
  const resumedThreadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6b";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: initialThreadId } } });

  await runtime.sendTurn("first");
  assert.equal(ensureThreadCalls.length, 1);
  assert.equal(ensureThreadCalls[0].conversationId, initialThreadId);
  await emitEvent({
    eventId: "evt-turn-completed-initial",
    threadId: initialThreadId,
    turnId: "turn-initial",
    streamId: `${initialThreadId}:turn-initial:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "turn/completed",
    payloadJson: JSON.stringify({
      method: "turn/completed",
      params: {
        threadId: initialThreadId,
        turn: { id: "turn-initial", items: [], status: "completed", error: null },
      },
    }),
    createdAt: Date.now(),
  });

  const resumePromise = runtime.resumeThread(resumedThreadId);
  const resumeRequest = sent.find((message) => message.method === "thread/resume");
  await emitResponse({ id: resumeRequest.id, result: { thread: { id: resumedThreadId } } });
  await resumePromise;

  await runtime.sendTurn("second");
  assert.equal(ensureThreadCalls.length, 2);
  assert.equal(ensureThreadCalls[1].conversationId, resumedThreadId);

  await runtime.stop();
});

test("openThread rejects blank conversationId for resume and fork", async () => {
  const { runtime } = createHarness();

  await runtime.connect({
    actor: { userId: "u" },
    sessionId: "s",
  });

  await assert.rejects(
    runtime.openThread({ strategy: "resume", conversationId: "   " }),
    /conversationId is required when strategy="resume"\./,
  );
  await assert.rejects(
    runtime.openThread({ strategy: "fork", conversationId: "" }),
    /conversationId is required when strategy="fork"\./,
  );

  await runtime.stop();
});

test("respondCommandApproval sends JSON-RPC response for pending command approval request", async () => {
  const { runtime, sent, emitResponse, emitEvent, upserted, resolved } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-1",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "item/commandExecution/requestApproval",
    payloadJson: JSON.stringify({
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "cmd-1",
        reason: "network required",
      },
    }),
    createdAt: Date.now(),
  });

  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].requestId, 99);
  assert.equal(runtime.getState().pendingServerRequestCount, 1);

  await runtime.respondCommandApproval({
    requestId: 99,
    decision: "accept",
  });

  const responseMessage = sent.find((message) => message.id === 99 && "result" in message);
  assert.deepEqual(responseMessage, {
    id: 99,
    result: {
      decision: "accept",
    },
  });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].status, "answered");
  assert.equal(runtime.getState().pendingServerRequestCount, 0);

  await runtime.stop();
});

test("respondToolUserInput rejects unknown request id", async () => {
  const { runtime } = createHarness();
  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });

  await assert.rejects(
    runtime.respondToolUserInput({
      requestId: "missing",
      answers: { q1: { answers: ["A"] } },
    }),
    /No pending server request found/,
  );

  await runtime.stop();
});

test("respondDynamicToolCall responds to pending item/tool/call request", async () => {
  const { runtime, sent, emitResponse, emitEvent, upserted, resolved } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-tool-call-1",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "item/tool/call",
    payloadJson: JSON.stringify({
      id: 201,
      method: "item/tool/call",
      params: {
        threadId,
        turnId: "turn-1",
        callId: "call-1",
        tool: "search_docs",
        arguments: { query: "hello" },
      },
    }),
    createdAt: Date.now(),
  });

  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].method, "item/tool/call");
  assert.equal(upserted[0].itemId, "call-1");

  await runtime.respondDynamicToolCall({
    requestId: 201,
    success: true,
    contentItems: [{ type: "inputText", text: "result" }],
  });

  const responseMessage = sent.find((message) => message.id === 201 && "result" in message);
  assert.deepEqual(responseMessage, {
    id: 201,
    result: {
      success: true,
      contentItems: [{ type: "inputText", text: "result" }],
    },
  });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].status, "answered");

  await runtime.stop();
});

test("runtime infers itemId for item/tool/call requests using callId", async () => {
  const { runtime, sent, emitResponse, emitEvent, upserted } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-tool-call-callid-only",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "item/tool/call",
    payloadJson: JSON.stringify({
      id: 202,
      method: "item/tool/call",
      params: {
        threadId,
        turnId: "turn-1",
        callId: "call-1",
        tool: "search_docs",
        arguments: { query: "hello" },
      },
    }),
    createdAt: Date.now(),
  });

  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].itemId, "call-1");

  await runtime.stop();
});

test("runtime ignores non-turn thread-scoped events for ingest", async () => {
  const { runtime, sent, emitResponse, emitEvent, ingestCalls } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-thread-started",
    threadId,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "thread/started",
    payloadJson: JSON.stringify({
      method: "thread/started",
      params: { thread: { id: threadId } },
    }),
    createdAt: Date.now(),
  });

  assert.equal(ingestCalls.length, 0);
  const state = runtime.getState();
  assert.equal(state.ingestMetrics.enqueuedEventCount, 0);
  assert.equal(state.ingestMetrics.skippedEventCount, 1);
  assert.deepEqual(state.ingestMetrics.skippedByKind, [{ kind: "thread/started", count: 1 }]);
  await runtime.stop();
});

test("runtime ingests turn-scoped events", async () => {
  const { runtime, sent, emitResponse, emitEvent, ingestCalls } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-turn-completed",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "turn/completed",
    payloadJson: JSON.stringify({
      method: "turn/completed",
      params: {
        threadId,
        turn: { id: "turn-1", items: [], status: "completed", error: null },
      },
    }),
    createdAt: Date.now(),
  });

  assert.equal(ingestCalls.length, 1);
  assert.equal(ingestCalls[0].deltas.length, 1);
  assert.equal(ingestCalls[0].deltas[0].type, "stream_delta");
  const state = runtime.getState();
  assert.equal(state.ingestMetrics.enqueuedEventCount, 1);
  assert.equal(state.ingestMetrics.skippedEventCount, 0);
  assert.deepEqual(state.ingestMetrics.enqueuedByKind, [{ kind: "turn/completed", count: 1 }]);

  await runtime.stop();
});

test("runtime remaps runtime turnId 0 to claimed persisted turn id for ingest", async () => {
  const { runtime, sent, emitResponse, emitEvent, ingestCalls } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await runtime.sendTurn("hello");
  const turnStartRequest = await waitForMessage(sent, (message) => message.method === "turn/start");
  const claimedTurnId = runtime.getState().turnId;
  assert.ok(claimedTurnId);
  await emitResponse({
    id: turnStartRequest.id,
    result: {
      thread: { id: threadId },
      turn: { id: "0", status: "in_progress", items: [] },
    },
  });

  await emitEvent({
    eventId: "evt-turn-started-runtime-zero",
    threadId,
    turnId: "0",
    streamId: `${threadId}:0:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "turn/started",
    payloadJson: JSON.stringify({
      method: "turn/started",
      params: {
        threadId,
        turn: { id: "0", items: [], status: "inProgress", error: null },
      },
    }),
    createdAt: Date.now(),
  });

  await emitEvent({
    eventId: "evt-turn-completed-runtime-zero",
    threadId,
    turnId: "0",
    streamId: `${threadId}:0:0`,
    cursorStart: 1,
    cursorEnd: 2,
    kind: "turn/completed",
    payloadJson: JSON.stringify({
      method: "turn/completed",
      params: {
        threadId,
        turn: { id: "0", items: [], status: "completed", error: null },
      },
    }),
    createdAt: Date.now(),
  });

  assert.equal(ingestCalls.length, 1);
  assert.equal(ingestCalls[0].deltas.length, 2);
  assert.equal(ingestCalls[0].deltas[0].turnId, claimedTurnId);
  assert.equal(ingestCalls[0].deltas[1].turnId, claimedTurnId);
  assert.equal(ingestCalls[0].deltas[0].streamId, `${threadId}:${claimedTurnId}:0`);
  assert.equal(ingestCalls[0].deltas[1].streamId, `${threadId}:${claimedTurnId}:0`);

  const startedPayload = JSON.parse(ingestCalls[0].deltas[0].payloadJson);
  const completedPayload = JSON.parse(ingestCalls[0].deltas[1].payloadJson);
  assert.equal(startedPayload.params.turn.id, claimedTurnId);
  assert.equal(completedPayload.params.turn.id, claimedTurnId);

  await runtime.stop();
});

test("runtime uses runtime turn id for interrupt and steer after remap", async () => {
  const { runtime, sent, emitResponse, emitEvent } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6c";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await runtime.sendTurn("hello");
  const turnStartRequest = await waitForMessage(sent, (message) => message.method === "turn/start");
  const persistedTurnId = runtime.getState().turnId;
  assert.ok(persistedTurnId);
  await emitResponse({
    id: turnStartRequest.id,
    result: {
      thread: { id: threadId },
      turn: { id: "0", status: "in_progress", items: [] },
    },
  });

  await emitEvent({
    eventId: "evt-turn-started-remapped-control",
    threadId,
    turnId: "0",
    streamId: `${threadId}:0:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "turn/started",
    payloadJson: JSON.stringify({
      method: "turn/started",
      params: {
        threadId,
        turn: { id: "0", items: [], status: "inProgress", error: null },
      },
    }),
    createdAt: Date.now(),
  });

  await runtime.steerTurn("go on");
  runtime.interrupt();

  const steerRequest = sent.find((message) => message.method === "turn/steer");
  const interruptRequest = sent.find((message) => message.method === "turn/interrupt");
  assert.equal(steerRequest.params.expectedTurnId, "0");
  assert.equal(interruptRequest.params.turnId, "0");
  assert.notEqual(interruptRequest.params.turnId, persistedTurnId);

  await runtime.stop();
});

test("runtime retries pending server request persistence and rewrites runtime turn id to persisted turn id", async () => {
  const { runtime, sent, emitResponse, emitEvent, upserted, protocolErrors, upsertErrors } = createHarness({
    upsertPendingServerRequest: async ({ upsertedCount }) => {
      if (upsertedCount === 1) {
        throw new Error("Turn not found: 1");
      }
    },
  });
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6e";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await runtime.sendTurn("hello");
  const turnStartRequest = await waitForMessage(sent, (message) => message.method === "turn/start");
  const claimedTurnId = runtime.getState().turnId;
  assert.ok(claimedTurnId);
  await emitResponse({
    id: turnStartRequest.id,
    result: {
      thread: { id: threadId },
      turn: { id: "1", status: "in_progress", items: [] },
    },
  });

  await emitEvent({
    eventId: "evt-managed-server-request-runtime-one",
    threadId,
    turnId: "1",
    streamId: `${threadId}:1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "item/commandExecution/requestApproval",
    payloadJson: JSON.stringify({
      id: 301,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "1",
        itemId: "cmd-1",
        reason: "network required",
      },
    }),
    createdAt: Date.now(),
  });

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(upserted.length >= 2);
  const persistedAttempt = upserted[upserted.length - 1];
  assert.equal(persistedAttempt.turnId, claimedTurnId);
  const payload = JSON.parse(persistedAttempt.payloadJson);
  assert.equal(payload.params.turnId, claimedTurnId);
  assert.equal(upsertErrors.length, 1);
  assert.equal(protocolErrors.length, 0);

  await runtime.stop();
});

test("runtime expires remapped pending server requests on terminal event", async () => {
  const { runtime, sent, emitResponse, emitEvent, resolved } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6f";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await runtime.sendTurn("hello");
  const turnStartRequest = await waitForMessage(sent, (message) => message.method === "turn/start");
  await emitResponse({
    id: turnStartRequest.id,
    result: {
      thread: { id: threadId },
      turn: { id: "0", status: "in_progress", items: [] },
    },
  });

  await emitEvent({
    eventId: "evt-managed-server-request-remapped-expire",
    threadId,
    turnId: "0",
    streamId: `${threadId}:0:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "item/commandExecution/requestApproval",
    payloadJson: JSON.stringify({
      id: 401,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "0",
        itemId: "cmd-1",
        reason: "network required",
      },
    }),
    createdAt: Date.now(),
  });

  await emitEvent({
    eventId: "evt-turn-completed-remapped-expire",
    threadId,
    turnId: "0",
    streamId: `${threadId}:0:0`,
    cursorStart: 1,
    cursorEnd: 2,
    kind: "turn/completed",
    payloadJson: JSON.stringify({
      method: "turn/completed",
      params: {
        threadId,
        turn: { id: "0", items: [], status: "completed", error: null },
      },
    }),
    createdAt: Date.now(),
  });

  assert.ok(resolved.some((entry) => entry.requestId === 401 && entry.status === "expired"));

  await runtime.stop();
});

test("runtime clears queued interrupt when turn/start fails", async () => {
  const { runtime, sent, emitResponse, emitEvent } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b70";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  runtime.interrupt();
  await runtime.sendTurn("first turn");
  const firstTurnStart = await waitForMessage(sent, (message) => message.method === "turn/start");
  await emitResponse({
    id: firstTurnStart.id,
    error: {
      code: 500,
      message: "turn start failed",
    },
  });

  await runtime.sendTurn("second turn");
  const turnStartRequests = sent.filter((message) => message.method === "turn/start");
  const secondTurnStart = turnStartRequests[1];
  await emitResponse({
    id: secondTurnStart.id,
    result: {
      thread: { id: threadId },
      turn: { id: "runtime-turn-2", status: "in_progress", items: [] },
    },
  });

  await emitEvent({
    eventId: "evt-turn-started-no-stale-interrupt",
    threadId,
    turnId: "runtime-turn-2",
    streamId: `${threadId}:runtime-turn-2:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "turn/started",
    payloadJson: JSON.stringify({
      method: "turn/started",
      params: {
        threadId,
        turn: { id: "runtime-turn-2", items: [], status: "inProgress", error: null },
      },
    }),
    createdAt: Date.now(),
  });

  const interruptRequests = sent.filter((message) => message.method === "turn/interrupt");
  assert.equal(interruptRequests.length, 0);

  await runtime.stop();
});

test("runtime fail-closes accepted turn send when dispatch claim fails", async () => {
  const { runtime, sent, emitResponse, failedAcceptedTurnSends } = createHarness({
    claimNextTurnDispatch: async () => {
      throw new Error("claim failed");
    },
  });
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b71";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await assert.rejects(runtime.sendTurn("hello"), /claim failed/);
  assert.equal(failedAcceptedTurnSends.length, 1);
  assert.equal(failedAcceptedTurnSends[0].code, "TURN_DISPATCH_CLAIM_FAILED");

  await runtime.stop();
});

test("runtime drops OUT_OF_ORDER rejected ingest batches without protocol error", async () => {
  const { runtime, sent, emitResponse, emitEvent, protocolErrors, ingestCalls } = createHarness({
    ingestSafe: async (args) => {
      ingestCalls.push(args);
      return {
        status: "rejected",
        errors: [{ code: "OUT_OF_ORDER", message: "cursor out of order", recoverable: false }],
      };
    },
  });
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6d";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-turn-completed-out-of-order",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "turn/completed",
    payloadJson: JSON.stringify({
      method: "turn/completed",
      params: {
        threadId,
        turn: { id: "turn-1", items: [], status: "completed", error: null },
      },
    }),
    createdAt: Date.now(),
  });

  assert.equal(ingestCalls.length, 1);
  assert.equal(protocolErrors.length, 0);
  assert.equal(runtime.getState().lastErrorCode, null);

  await runtime.stop();
});

test("runtime fail-closes malformed managed server request payloads", async () => {
  const { runtime, sent, emitResponse, emitEvent, protocolErrors } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-malformed-managed",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "item/commandExecution/requestApproval",
    payloadJson: "{",
    createdAt: Date.now(),
  });

  const state = runtime.getState();
  assert.equal(state.lastErrorCode, "E_RUNTIME_PROTOCOL_EVENT_INVALID");
  assert.match(state.lastError ?? "", /Failed to process event "item\/commandExecution\/requestApproval"/);
  assert.equal(protocolErrors.length, 1);
  assert.match(protocolErrors[0].message, /E_RUNTIME_PROTOCOL_EVENT_INVALID/);
  await runtime.stop();
});

test("runtime fail-closes malformed turn/completed payloads by marking dispatch failed", async () => {
  const { runtime, sent, emitResponse, emitEvent, protocolErrors, failedDispatches } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await runtime.sendTurn("hello");
  const turnStartRequest = await waitForMessage(sent, (message) => message.method === "turn/start");
  await emitResponse({
    id: turnStartRequest.id,
    result: {
      thread: { id: threadId },
      turn: { id: "turn-1", status: "in_progress", items: [] },
    },
  });

  await emitEvent({
    eventId: "evt-bad-turn-completed",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "turn/completed",
    payloadJson: "{",
    createdAt: Date.now(),
  });

  const state = runtime.getState();
  assert.equal(state.lastErrorCode, null);
  assert.equal(protocolErrors.length, 0);
  assert.equal(failedDispatches.length, 1);
  assert.equal(failedDispatches[0].code, "TURN_COMPLETED_FAILED");
  assert.equal(failedDispatches[0].reason, "turn/completed reported failed status");
  await runtime.stop();
});

test("runtime account/auth helper methods send account requests and resolve responses", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  const readAccountPromise = runtime.readAccount({ refreshToken: true });
  const readAccountRequest = sent.find((message) => message.method === "account/read");
  await emitResponse({
    id: readAccountRequest.id,
    result: { account: null, requiresOpenaiAuth: true },
  });
  await readAccountPromise;

  const loginPromise = runtime.loginAccount({ type: "apiKey", apiKey: "sk-test" });
  const loginRequest = sent.find((message) => message.method === "account/login/start");
  await emitResponse({ id: loginRequest.id, result: { type: "apiKey" } });
  await loginPromise;

  const cancelPromise = runtime.cancelAccountLogin({ loginId: "login-1" });
  const cancelRequest = sent.find((message) => message.method === "account/login/cancel");
  await emitResponse({ id: cancelRequest.id, result: { status: "canceled" } });
  await cancelPromise;

  const logoutPromise = runtime.logoutAccount();
  const logoutRequest = sent.find((message) => message.method === "account/logout");
  await emitResponse({ id: logoutRequest.id, result: {} });
  await logoutPromise;

  const rateLimitPromise = runtime.readAccountRateLimits();
  const rateLimitRequest = sent.find((message) => message.method === "account/rateLimits/read");
  await emitResponse({ id: rateLimitRequest.id, result: { rateLimits: {} } });
  await rateLimitPromise;

  assert.equal(readAccountRequest.params.refreshToken, true);
  assert.equal(logoutRequest.params, undefined);
  assert.equal(rateLimitRequest.params, undefined);

  await runtime.stop();
});

test("respondChatgptAuthTokensRefresh responds to pending auth token refresh request", async () => {
  const { runtime, sent, emitGlobalMessage } = createHarness();

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });

  await emitGlobalMessage({
    method: "account/chatgptAuthTokens/refresh",
    id: 501,
    params: { reason: "unauthorized", previousAccountId: "acct_123" },
  });

  await runtime.respondChatgptAuthTokensRefresh({
    requestId: 501,
    accessToken: "access-token",
    chatgptAccountId: "acct_123",
    chatgptPlanType: "plus",
  });

  const responseMessage = sent.find((message) => message.id === 501 && "result" in message);
  assert.deepEqual(responseMessage, {
    id: 501,
    result: {
      accessToken: "access-token",
      chatgptAccountId: "acct_123",
      chatgptPlanType: "plus",
    },
  });

  await runtime.stop();
});

test("respondChatgptAuthTokensRefresh rejects unknown request id", async () => {
  const { runtime } = createHarness();
  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });

  await assert.rejects(
    runtime.respondChatgptAuthTokensRefresh({
      requestId: "missing",
      accessToken: "access-token",
      chatgptAccountId: "acct_123",
    }),
    /No pending auth token refresh request found/,
  );

  await runtime.stop();
});

test("runtime exposes canonical lifecycle subscription and snapshot", async () => {
  const { runtime } = createHarness();
  const snapshots = [];
  const unsubscribe = runtime.subscribeLifecycle((state) => {
    snapshots.push(state);
  });

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].phase, "idle");
  assert.equal(snapshots[0].source, "runtime");
  assert.equal(runtime.getLifecycleState().phase, "idle");

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });

  assert.ok(snapshots.some((state) => state.phase === "starting"));
  assert.equal(runtime.getLifecycleState().phase, "running");
  assert.equal(runtime.getLifecycleState().source, "runtime");

  await runtime.stop();
  assert.equal(runtime.getLifecycleState().phase, "stopped");

  unsubscribe();
});

test("runtime listPendingServerRequests uses conversation-scoped lookup", async () => {
  const { runtime, sent, emitResponse, listPendingServerRequestCalls } = createHarness({
    listPendingServerRequests: async () => [{ requestId: "req-1", method: "item/tool/call" }],
  });
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { userId: "u" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  const pending = await runtime.listPendingServerRequests();
  assert.equal(pending.length, 1);
  assert.equal(listPendingServerRequestCalls.length, 1);
  assert.deepEqual(listPendingServerRequestCalls[0], {
    actor: { userId: "u" },
    conversationId: threadId,
  });

  await runtime.stop();
});
