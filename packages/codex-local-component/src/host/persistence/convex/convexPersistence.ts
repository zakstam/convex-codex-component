/**
 * Factory that creates a HostRuntimePersistence adapter backed by a ConvexHttpClient.
 * Absorbs session rollover, dispatch queue management, and field mapping.
 */
import type { FunctionReference } from "convex/server";
import { hasRecoverableIngestErrors } from "../../ingestRecovery.js";
import type { HostRuntimePersistence, ActorContext, IngestDelta } from "../../runtime/runtimeTypes.js";
import { classifyThreadReadError } from "../../../errors.js";

type ConvexHttpClientLike = {
  mutation: (fn: FunctionReference<"mutation", "public">, args: Record<string, unknown>) => Promise<unknown>;
  query: (fn: FunctionReference<"query", "public">, args: Record<string, unknown>) => Promise<unknown>;
};

export type ConvexPersistenceChatApi = {
  startConversationSyncSource: FunctionReference<"mutation", "public">;
  appendConversationSyncSourceChunk: FunctionReference<"mutation", "public">;
  sealConversationSyncSource: FunctionReference<"mutation", "public">;
  cancelConversationSyncJob: FunctionReference<"mutation", "public">;
  getConversationSyncJob: FunctionReference<"query", "public">;
  listConversationSyncJobs?: FunctionReference<"query", "public">;
  syncOpenConversationBinding: FunctionReference<"mutation", "public">;
  markConversationSyncProgress: FunctionReference<"mutation", "public">;
  forceRebindConversationSync: FunctionReference<"mutation", "public">;
  ensureSession: FunctionReference<"mutation", "public">;
  ingestBatch: FunctionReference<"mutation", "public">;
  upsertPendingServerRequest: FunctionReference<"mutation", "public">;
  resolvePendingServerRequest: FunctionReference<"mutation", "public">;
  listPendingServerRequests: FunctionReference<"query", "public">;
  acceptTurnSend: FunctionReference<"mutation", "public">;
  failAcceptedTurnSend: FunctionReference<"mutation", "public">;
  upsertTokenUsage?: FunctionReference<"mutation", "public">;
};

export type ConvexPersistenceOptions = {
  runtimeOptions?: {
    saveStreamDeltas?: boolean;
    saveReasoningDeltas?: boolean;
    exposeRawReasoningDeltas?: boolean;
    maxDeltasPerStreamRead?: number;
    maxDeltasPerRequestRead?: number;
    finishedStreamDeleteDelayMs?: number;
  };
  onSessionRollover?: (args: { threadId: string; newSessionId: string; errors: Array<{ code: string; message: string }> }) => void;
  syncJobPollMs?: number;
  syncJobPollTimeoutMs?: number;
};

type DispatchQueueEntry = {
  dispatchId: string;
  claimToken: string;
  turnId: string;
  inputText: string;
  idempotencyKey: string;
};

type IngestBatchError = {
  code: unknown;
  message: string;
  recoverable: boolean;
};

function randomSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toErrorCode(value: unknown): string {
  return typeof value === "string" ? value : "UNKNOWN";
}

function mapIngestErrors(errors: IngestBatchError[]): Array<{ code: string; message: string; recoverable: boolean }> {
  return errors.map((e) => ({ code: toErrorCode(e.code), message: e.message, recoverable: e.recoverable }));
}

function maxCursorEnd(deltas: IngestDelta[]): number {
  let max = 0;
  for (const delta of deltas) {
    if (delta.type === "stream_delta" && delta.cursorEnd > max) {
      max = delta.cursorEnd;
    }
  }
  return max;
}

export function createConvexPersistence(
  client: ConvexHttpClientLike,
  chatApi: ConvexPersistenceChatApi,
  options?: ConvexPersistenceOptions,
): HostRuntimePersistence & { activeSessionId: string | null } {
  let activeSessionId: string | null = null;
  const dispatchQueues = new Map<string, DispatchQueueEntry[]>();
  const threadHandleByPersistedThreadId = new Map<string, string>();
  const runtimeOpts = options?.runtimeOptions ?? {};
  const syncJobPollMs = options?.syncJobPollMs ?? 300;
  const syncJobPollTimeoutMs = options?.syncJobPollTimeoutMs ?? 180_000;

  function getDispatchQueue(threadId: string): DispatchQueueEntry[] {
    let queue = dispatchQueues.get(threadId);
    if (!queue) {
      queue = [];
      dispatchQueues.set(threadId, queue);
    }
    return queue;
  }

  function toIngestPayload(actor: ActorContext, sessionId: string, threadId: string, deltas: IngestDelta[]) {
    return {
      actor,
      sessionId,
      threadId,
      deltas: deltas.map((delta) =>
        delta.type === "stream_delta"
          ? {
              type: "stream_delta" as const,
              eventId: delta.eventId,
              turnId: delta.turnId,
              streamId: delta.streamId,
              kind: delta.kind,
              payloadJson: delta.payloadJson,
              cursorStart: delta.cursorStart,
              cursorEnd: delta.cursorEnd,
              createdAt: delta.createdAt,
            }
          : {
              type: "lifecycle_event" as const,
              eventId: delta.eventId,
              ...(delta.turnId ? { turnId: delta.turnId } : {}),
              kind: delta.kind,
              payloadJson: delta.payloadJson,
              createdAt: delta.createdAt,
            },
      ),
      runtime: runtimeOpts,
    };
  }

  const persistence: HostRuntimePersistence = {
    mode: "replica",
    ensureThread: async (args) => {
      const opened = await client.mutation(chatApi.syncOpenConversationBinding, {
        actor: args.actor,
        conversationId: args.conversationId,
        runtimeConversationId: args.conversationId,
        ...(args.model ? { model: args.model } : {}),
        ...(args.cwd ? { cwd: args.cwd } : {}),
      }) as { threadId: string; created?: boolean; rebindApplied?: boolean };
      if (opened.rebindApplied) {
        await client.mutation(chatApi.forceRebindConversationSync, {
          actor: args.actor,
          conversationId: args.conversationId,
          runtimeConversationId: args.conversationId,
          reasonCode: "AUTO_FORCE_REBIND_ON_OPEN",
        });
      }
      threadHandleByPersistedThreadId.set(opened.threadId, args.conversationId);
      return {
        threadId: opened.threadId,
        ...(typeof opened.created === "boolean" ? { created: opened.created } : {}),
      };
    },

    ensureSession: async (args) => {
      activeSessionId = args.sessionId;
      const threadHandle = threadHandleByPersistedThreadId.get(args.threadId) ?? args.threadId;
      const ensured = await client.mutation(chatApi.ensureSession, {
        actor: args.actor,
        sessionId: args.sessionId,
        threadId: args.threadId,
        lastEventCursor: args.lastEventCursor,
      }) as { sessionId: string; threadId: string; status: "created" | "active" };
      await client.mutation(chatApi.markConversationSyncProgress, {
        actor: args.actor,
        conversationId: threadHandle,
        runtimeConversationId: threadHandle,
        sessionId: args.sessionId,
        cursor: args.lastEventCursor,
        syncState: "syncing",
      });
      return ensured;
    },

    ingestSafe: async (args) => {
      const runIngest = async (sessionId: string) =>
        client.mutation(chatApi.ingestBatch, toIngestPayload(args.actor, sessionId, args.threadId, args.deltas)) as Promise<{
          status: "ok" | "partial" | "session_recovered" | "rejected";
          errors: IngestBatchError[];
        }>;

      const initial = await runIngest(args.sessionId);
      const initialCursor = maxCursorEnd(args.deltas);
      const threadHandle = threadHandleByPersistedThreadId.get(args.threadId) ?? args.threadId;
      if (initial.status !== "rejected") {
        await client.mutation(chatApi.markConversationSyncProgress, {
          actor: args.actor,
          conversationId: threadHandle,
          runtimeConversationId: threadHandle,
          sessionId: args.sessionId,
          cursor: initialCursor,
          syncState: initial.status === "partial" ? "syncing" : "synced",
        });
      }
      if (initial.status !== "rejected") {
        return { status: initial.status, errors: mapIngestErrors(initial.errors) };
      }

      const hasRecoverable = hasRecoverableIngestErrors(initial.errors);
      if (hasRecoverable && activeSessionId) {
        const nextSessionId = randomSessionId();
        activeSessionId = nextSessionId;
        await client.mutation(chatApi.ensureSession, {
          actor: args.actor,
          sessionId: nextSessionId,
          threadId: args.threadId,
          lastEventCursor: maxCursorEnd(args.deltas),
        });
        options?.onSessionRollover?.({
          threadId: args.threadId,
          newSessionId: nextSessionId,
          errors: initial.errors.map((e) => ({ code: toErrorCode(e.code), message: e.message })),
        });

        const retried = await runIngest(nextSessionId);
        if (retried.status === "rejected") {
          await client.mutation(chatApi.markConversationSyncProgress, {
            actor: args.actor,
            conversationId: threadHandle,
            runtimeConversationId: threadHandle,
            sessionId: nextSessionId,
            cursor: initialCursor,
            syncState: "drifted",
            errorCode: "INGEST_RETRY_REJECTED",
          });
          return {
            status: "partial" as const,
            errors: mapIngestErrors(retried.errors).map((e) => ({ ...e, recoverable: true })),
          };
        }
        await client.mutation(chatApi.markConversationSyncProgress, {
          actor: args.actor,
          conversationId: threadHandle,
          runtimeConversationId: threadHandle,
          sessionId: nextSessionId,
          cursor: initialCursor,
          syncState: retried.status === "partial" ? "syncing" : "synced",
        });
        return { status: retried.status, errors: mapIngestErrors(retried.errors) };
      }

      await client.mutation(chatApi.markConversationSyncProgress, {
        actor: args.actor,
        conversationId: threadHandle,
        runtimeConversationId: threadHandle,
        sessionId: args.sessionId,
        cursor: initialCursor,
        syncState: "drifted",
        errorCode: "INGEST_REJECTED",
      });
      return { status: initial.status, errors: mapIngestErrors(initial.errors) };
    },

    startConversationSyncSource: async (args) => {
      const started = await client.mutation(chatApi.startConversationSyncSource, {
        actor: args.actor,
        conversationId: args.conversationId,
        ...(args.runtimeConversationId !== undefined ? { runtimeConversationId: args.runtimeConversationId } : {}),
        ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
      }) as {
        sourceId: string;
        conversationId: string;
        threadId: string;
        sourceState: "collecting" | "sealed" | "failed";
        policyVersion: number;
        createdAt: number;
        updatedAt: number;
      };
      threadHandleByPersistedThreadId.set(started.threadId, args.conversationId);
      return started;
    },

    appendConversationSyncSourceChunk: async (args) =>
      client.mutation(chatApi.appendConversationSyncSourceChunk, {
        actor: args.actor,
        sourceId: args.sourceId,
        chunkIndex: args.chunkIndex,
        payloadJson: args.payloadJson,
        messageCount: args.messageCount,
        byteSize: args.byteSize,
      }) as Promise<{ sourceId: string; chunkIndex: number; appended: boolean }>,

    sealConversationSyncSource: async (args) =>
      client.mutation(chatApi.sealConversationSyncSource, {
        actor: args.actor,
        sourceId: args.sourceId,
        expectedManifestJson: args.expectedManifestJson,
        expectedChecksum: args.expectedChecksum,
        ...(args.expectedMessageCount !== undefined ? { expectedMessageCount: args.expectedMessageCount } : {}),
      }) as Promise<{
        sourceId: string;
        jobId: string;
        sourceState: "collecting" | "sealed" | "failed";
        totalChunks: number;
        scheduled: boolean;
      }>,

    cancelConversationSyncJob: async (args) =>
      client.mutation(chatApi.cancelConversationSyncJob, {
        actor: args.actor,
        jobId: args.jobId,
        ...(args.errorCode !== undefined ? { errorCode: args.errorCode } : {}),
        ...(args.errorMessage !== undefined ? { errorMessage: args.errorMessage } : {}),
      }) as Promise<{ jobId: string; state: "syncing" | "synced" | "failed" | "cancelled"; cancelled: boolean }>,

    getConversationSyncJob: async (args) =>
      client.query(chatApi.getConversationSyncJob, {
        actor: args.actor,
        conversationId: args.conversationId,
        ...(args.jobId !== undefined ? { jobId: args.jobId } : {}),
      }) as Promise<{
        jobId: string;
        conversationId: string;
        threadId: string;
        runtimeConversationId?: string;
        state: "syncing" | "synced" | "failed" | "cancelled";
        sourceState: "collecting" | "sealed" | "failed";
        policyVersion: number;
        startedAt: number;
        updatedAt: number;
        completedAt?: number;
        lastCursor: number;
        processedChunkIndex: number;
        totalChunks: number;
        processedMessageCount: number;
        retryCount: number;
        lastErrorCode?: string;
        lastErrorMessage?: string;
      } | null>,

    waitForConversationSyncJobTerminal: async (args) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < syncJobPollTimeoutMs) {
        const snapshot = await client.query(chatApi.getConversationSyncJob, {
          actor: args.actor,
          conversationId: args.conversationId,
          jobId: args.jobId,
        }) as {
          jobId: string;
          state: "syncing" | "synced" | "failed" | "cancelled";
          lastCursor: number;
          processedMessageCount: number;
          lastErrorCode?: string;
          lastErrorMessage?: string;
        } | null;
        if (!snapshot) {
          throw new Error(`[E_SYNC_JOB_NOT_FOUND] Sync job not found: ${args.jobId}`);
        }
        if (snapshot.state === "synced" || snapshot.state === "failed" || snapshot.state === "cancelled") {
          return snapshot;
        }
        await new Promise((resolve) => setTimeout(resolve, syncJobPollMs));
      }
      throw new Error(`[E_SYNC_JOB_TIMEOUT] Sync job ${args.jobId} did not reach terminal state within ${syncJobPollTimeoutMs}ms.`);
    },

    upsertPendingServerRequest: async ({ actor, request }) => {
      const requestedAt = (request as { createdAt?: number }).createdAt;
      await client.mutation(chatApi.upsertPendingServerRequest, {
        actor,
        requestId: request.requestId,
        threadId: request.threadId,
        turnId: request.turnId,
        itemId: request.itemId,
        method: request.method,
        payloadJson: request.payloadJson,
        ...(request.reason ? { reason: request.reason } : {}),
        ...(request.questions ? { questionsJson: JSON.stringify(request.questions) } : {}),
        requestedAt: typeof requestedAt === "number" ? requestedAt : Date.now(),
      });
    },

    resolvePendingServerRequest: async (args) => {
      await client.mutation(chatApi.resolvePendingServerRequest, {
        actor: args.actor,
        threadId: args.threadId,
        requestId: args.requestId,
        status: args.status,
        resolvedAt: args.resolvedAt,
        ...(args.responseJson ? { responseJson: args.responseJson } : {}),
      });
    },

    listPendingServerRequests: async (args) => {
      try {
        return await client.query(chatApi.listPendingServerRequests, {
          actor: args.actor,
          conversationId: args.conversationId,
          limit: 100,
        }) as Promise<HostRuntimePersistence["listPendingServerRequests"] extends (...a: never[]) => infer R ? Awaited<R> : never>;
      } catch (error) {
        if (classifyThreadReadError(error)?.threadStatus === "missing_thread") {
          return [];
        }
        throw error;
      }
    },

    acceptTurnSend: async (args) => {
      const result = await client.mutation(chatApi.acceptTurnSend, {
        actor: args.actor,
        threadId: args.threadId,
        turnId: args.turnId,
        inputText: args.inputText,
        idempotencyKey: args.idempotencyKey,
        ...(args.dispatchId ? { dispatchId: args.dispatchId } : {}),
      }) as { dispatchId: string; turnId: string; accepted: true };
      const claimToken = randomSessionId();
      const queue = getDispatchQueue(args.threadId);
      queue.push({
        dispatchId: result.dispatchId,
        claimToken,
        turnId: result.turnId,
        inputText: args.inputText,
        idempotencyKey: args.idempotencyKey,
      });
      return result;
    },

    failAcceptedTurnSend: async (args) => {
      await client.mutation(chatApi.failAcceptedTurnSend, {
        actor: args.actor,
        threadId: args.threadId,
        turnId: args.turnId,
        dispatchId: args.dispatchId,
        reason: args.reason,
        ...(args.code ? { code: args.code } : {}),
      });
    },

    claimNextTurnDispatch: async (args) => {
      const queue = getDispatchQueue(args.threadId);
      const entry = queue.shift();
      if (!entry) return null;
      return {
        dispatchId: entry.dispatchId,
        turnId: entry.turnId,
        idempotencyKey: entry.idempotencyKey,
        inputText: entry.inputText,
        claimToken: entry.claimToken,
        leaseExpiresAt: Date.now() + 60_000,
        attemptCount: 1,
      };
    },

    markTurnDispatchStarted: async () => {},
    markTurnDispatchCompleted: async () => {},
    markTurnDispatchFailed: async () => {},
    cancelTurnDispatch: async () => {},

    ...(chatApi.upsertTokenUsage
      ? {
          upsertTokenUsage: async (args: Parameters<NonNullable<HostRuntimePersistence["upsertTokenUsage"]>>[0]) => {
            await client.mutation(chatApi.upsertTokenUsage!, {
              actor: args.actor,
              threadId: args.threadId,
              turnId: args.turnId,
              totalTokens: args.totalTokens,
              inputTokens: args.inputTokens,
              cachedInputTokens: args.cachedInputTokens,
              outputTokens: args.outputTokens,
              reasoningOutputTokens: args.reasoningOutputTokens,
              lastTotalTokens: args.lastTotalTokens,
              lastInputTokens: args.lastInputTokens,
              lastCachedInputTokens: args.lastCachedInputTokens,
              lastOutputTokens: args.lastOutputTokens,
              lastReasoningOutputTokens: args.lastReasoningOutputTokens,
              ...(args.modelContextWindow != null ? { modelContextWindow: args.modelContextWindow } : {}),
            });
          },
        }
      : {}),
  };

  return Object.assign(persistence, {
    get activeSessionId() { return activeSessionId; },
    set activeSessionId(v: string | null) { activeSessionId = v; },
  });
}
