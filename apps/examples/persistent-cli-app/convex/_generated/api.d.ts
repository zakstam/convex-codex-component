/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as chat from "../chat.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  chat: typeof chat;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  codexLocal: {
    approvals: {
      listPending: FunctionReference<
        "query",
        "internal",
        {
          actor: { userId?: string };
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          threadId?: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            createdAt: number;
            itemId: string;
            kind: string;
            reason?: string;
            threadId: string;
            turnId: string;
          }>;
        }
      >;
      respond: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          decision: "accepted" | "declined";
          itemId: string;
          threadId: string;
          turnId: string;
        },
        null
      >;
    };
    messages: {
      getByTurn: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; threadId: string; turnId: string },
        Array<{
          completedAt?: number;
          createdAt: number;
          error?: string;
          messageId: string;
          orderInTurn: number;
          payloadJson: string;
          role: "user" | "assistant" | "system" | "tool";
          sourceItemType: string;
          status: "streaming" | "completed" | "failed" | "interrupted";
          text: string;
          turnId: string;
          updatedAt: number;
        }>
      >;
      listByThread: FunctionReference<
        "query",
        "internal",
        {
          actor: { userId?: string };
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          threadId: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            completedAt?: number;
            createdAt: number;
            error?: string;
            messageId: string;
            orderInTurn: number;
            payloadJson: string;
            role: "user" | "assistant" | "system" | "tool";
            sourceItemType: string;
            status: "streaming" | "completed" | "failed" | "interrupted";
            text: string;
            turnId: string;
            updatedAt: number;
          }>;
        }
      >;
    };
    reasoning: {
      listByThread: FunctionReference<
        "query",
        "internal",
        {
          actor: { userId?: string };
          includeRaw?: boolean;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          threadId: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            channel: "summary" | "raw";
            contentIndex?: number;
            createdAt: number;
            cursorEnd: number;
            cursorStart: number;
            eventId: string;
            itemId: string;
            segmentId: string;
            segmentType: "textDelta" | "sectionBreak";
            summaryIndex?: number;
            text: string;
            turnId: string;
          }>;
        }
      >;
    };
    serverRequests: {
      listPending: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; limit?: number; threadId?: string },
        Array<{
          createdAt: number;
          itemId: string;
          method:
            | "item/commandExecution/requestApproval"
            | "item/fileChange/requestApproval"
            | "item/tool/requestUserInput"
            | "item/tool/call";
          payloadJson: string;
          questions?: Array<{
            header: string;
            id: string;
            isOther: boolean;
            isSecret: boolean;
            options: null | Array<{ description: string; label: string }>;
            question: string;
          }>;
          reason?: string;
          requestId: string | number;
          resolvedAt?: number;
          responseJson?: string;
          status: "pending" | "answered" | "expired";
          threadId: string;
          turnId: string;
          updatedAt: number;
        }>
      >;
      resolve: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          requestId: string | number;
          resolvedAt: number;
          responseJson?: string;
          status: "answered" | "expired";
          threadId: string;
        },
        null
      >;
      upsertPending: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          itemId: string;
          method:
            | "item/commandExecution/requestApproval"
            | "item/fileChange/requestApproval"
            | "item/tool/requestUserInput"
            | "item/tool/call";
          payloadJson: string;
          questionsJson?: string;
          reason?: string;
          requestId: string | number;
          requestedAt: number;
          threadId: string;
          turnId: string;
        },
        null
      >;
    };
    sync: {
      ensureSession: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          lastEventCursor: number;
          sessionId: string;
          threadId: string;
        },
        { sessionId: string; status: "created" | "active"; threadId: string }
      >;
      heartbeat: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          lastEventCursor: number;
          sessionId: string;
          threadId: string;
        },
        null
      >;
      ingest: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          lifecycleEvents: Array<{
            createdAt: number;
            eventId: string;
            kind: string;
            payloadJson: string;
            turnId?: string;
            type: "lifecycle_event";
          }>;
          runtime?: {
            exposeRawReasoningDeltas?: boolean;
            finishedStreamDeleteDelayMs?: number;
            maxDeltasPerRequestRead?: number;
            maxDeltasPerStreamRead?: number;
            saveReasoningDeltas?: boolean;
            saveStreamDeltas?: boolean;
          };
          sessionId: string;
          streamDeltas: Array<{
            createdAt: number;
            cursorEnd: number;
            cursorStart: number;
            eventId: string;
            kind: string;
            payloadJson: string;
            streamId: string;
            turnId: string;
            type: "stream_delta";
          }>;
          threadId: string;
        },
        {
          ackedStreams: Array<{ ackCursorEnd: number; streamId: string }>;
          ingestStatus: "ok" | "partial";
        }
      >;
      ingestSafe: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          ensureLastEventCursor?: number;
          lifecycleEvents: Array<{
            createdAt: number;
            eventId: string;
            kind: string;
            payloadJson: string;
            turnId?: string;
            type: "lifecycle_event";
          }>;
          runtime?: {
            exposeRawReasoningDeltas?: boolean;
            finishedStreamDeleteDelayMs?: number;
            maxDeltasPerRequestRead?: number;
            maxDeltasPerStreamRead?: number;
            saveReasoningDeltas?: boolean;
            saveStreamDeltas?: boolean;
          };
          sessionId: string;
          streamDeltas: Array<{
            createdAt: number;
            cursorEnd: number;
            cursorStart: number;
            eventId: string;
            kind: string;
            payloadJson: string;
            streamId: string;
            turnId: string;
            type: "stream_delta";
          }>;
          threadId: string;
        },
        {
          ackedStreams: Array<{ ackCursorEnd: number; streamId: string }>;
          errors: Array<{
            code:
              | "SESSION_NOT_FOUND"
              | "SESSION_THREAD_MISMATCH"
              | "TURN_ID_REQUIRED_FOR_TURN_EVENT"
              | "TURN_ID_MISMATCH"
              | "OUT_OF_ORDER"
              | "REPLAY_GAP"
              | "UNKNOWN";
            message: string;
            recoverable: boolean;
          }>;
          ingestStatus: "ok" | "partial";
          recovery?: {
            action: "session_rebound";
            sessionId: string;
            threadId: string;
          };
          status: "ok" | "partial" | "session_recovered" | "rejected";
        }
      >;
      listCheckpoints: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; threadId: string },
        Array<{ cursor: number; streamId: string }>
      >;
      replay: FunctionReference<
        "query",
        "internal",
        {
          actor: { userId?: string };
          runtime?: {
            exposeRawReasoningDeltas?: boolean;
            finishedStreamDeleteDelayMs?: number;
            maxDeltasPerRequestRead?: number;
            maxDeltasPerStreamRead?: number;
            saveReasoningDeltas?: boolean;
            saveStreamDeltas?: boolean;
          };
          streamCursorsById: Array<{ cursor: number; streamId: string }>;
          threadId: string;
        },
        {
          deltas: Array<{
            cursorEnd: number;
            cursorStart: number;
            kind: string;
            payloadJson: string;
            streamId: string;
          }>;
          nextCheckpoints: Array<{ cursor: number; streamId: string }>;
          snapshots: Array<{
            itemId: string;
            itemType: string;
            payloadJson: string;
            status: string;
          }>;
          streamWindows: Array<{
            serverCursorEnd: number;
            serverCursorStart: number;
            status: "ok" | "rebased" | "stale";
            streamId: string;
          }>;
          streams: Array<{ state: string; streamId: string }>;
        }
      >;
      resumeReplay: FunctionReference<
        "query",
        "internal",
        {
          actor: { userId?: string };
          fromCursor: number;
          runtime?: {
            exposeRawReasoningDeltas?: boolean;
            finishedStreamDeleteDelayMs?: number;
            maxDeltasPerRequestRead?: number;
            maxDeltasPerStreamRead?: number;
            saveReasoningDeltas?: boolean;
            saveStreamDeltas?: boolean;
          };
          threadId: string;
          turnId: string;
        },
        {
          deltas: Array<{
            cursorEnd: number;
            cursorStart: number;
            kind: string;
            payloadJson: string;
          }>;
          nextCursor: number;
          streamWindow: {
            serverCursorEnd: number;
            serverCursorStart: number;
            status: "ok" | "rebased" | "stale";
            streamId: string;
          };
        }
      >;
      upsertCheckpoint: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          cursor: number;
          streamId: string;
          threadId: string;
        },
        { ok: true }
      >;
    };
    threads: {
      cancelScheduledDeletion: FunctionReference<
        "mutation",
        "internal",
        { actor: { userId?: string }; deletionJobId: string },
        { cancelled: boolean; deletionJobId: string }
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          cwd?: string;
          localThreadId?: string;
          model?: string;
          personality?: string;
          threadId: string;
        },
        { threadId: string }
      >;
      deleteCascade: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          batchSize?: number;
          reason?: string;
          threadId: string;
        },
        { deletionJobId: string }
      >;
      forceRunScheduledDeletion: FunctionReference<
        "mutation",
        "internal",
        { actor: { userId?: string }; deletionJobId: string },
        { deletionJobId: string; forced: boolean }
      >;
      getDeletionJobStatus: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; deletionJobId: string },
        null | {
          batchSize?: number;
          cancelledAt?: number;
          completedAt?: number;
          createdAt: number;
          deletedCountsByTable: Array<{ deleted: number; tableName: string }>;
          deletionJobId: string;
          errorCode?: string;
          errorMessage?: string;
          phase?: string;
          reason?: string;
          scheduledFor?: number;
          startedAt?: number;
          status:
            | "scheduled"
            | "queued"
            | "running"
            | "completed"
            | "failed"
            | "cancelled";
          targetKind: "thread" | "turn" | "actor";
          threadId?: string;
          turnId?: string;
          updatedAt: number;
        }
      >;
      getThreadHandleMapping: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; threadId: string },
        null | { threadHandle: string; threadId: string }
      >;
      getState: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; threadId: string },
        {
          activeStreams: Array<{
            startedAt: number;
            state: string;
            streamId: string;
            turnId: string;
          }>;
          allStreams: Array<{
            startedAt: number;
            state: string;
            streamId: string;
            turnId: string;
          }>;
          lifecycleMarkers: Array<{
            createdAt: number;
            kind: string;
            streamId?: string;
            turnId?: string;
          }>;
          pendingApprovals: Array<{
            itemId: string;
            kind: string;
            reason?: string;
            turnId: string;
          }>;
          recentMessages: Array<{
            completedAt?: number;
            createdAt: number;
            messageId: string;
            role: "user" | "assistant" | "system" | "tool";
            status: "streaming" | "completed" | "failed" | "interrupted";
            text: string;
            turnId: string;
            updatedAt: number;
          }>;
          streamStats: Array<{
            deltaCount: number;
            latestCursor: number;
            state: "streaming" | "finished" | "aborted";
            streamId: string;
          }>;
          threadId: string;
          threadStatus: string;
          turns: Array<{
            completedAt?: number;
            startedAt: number;
            status: string;
            turnId: string;
          }>;
        }
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          actor: { userId?: string };
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            status: "active" | "archived" | "failed";
            threadId: string;
            updatedAt: number;
          }>;
        }
      >;
      purgeActorData: FunctionReference<
        "mutation",
        "internal",
        { actor: { userId?: string }; batchSize?: number; reason?: string },
        { deletionJobId: string }
      >;
      resolve: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          cwd?: string;
          threadHandle?: string;
          localThreadId?: string;
          model?: string;
          personality?: string;
        },
        { created: boolean; threadHandle?: string; threadId: string }
      >;
      resolveByThreadHandle: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; threadHandle: string },
        null | { threadHandle: string; threadId: string }
      >;
      resume: FunctionReference<
        "mutation",
        "internal",
        { actor: { userId?: string }; threadId: string },
        { status: "active"; threadId: string }
      >;
      scheduleDeleteCascade: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          batchSize?: number;
          delayMs?: number;
          reason?: string;
          threadId: string;
        },
        { deletionJobId: string; scheduledFor: number }
      >;
      schedulePurgeActorData: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          batchSize?: number;
          delayMs?: number;
          reason?: string;
        },
        { deletionJobId: string; scheduledFor: number }
      >;
    };
    tokenUsage: {
      listByThread: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; threadId: string },
        Array<{
          last: {
            cachedInputTokens: number;
            inputTokens: number;
            outputTokens: number;
            reasoningOutputTokens: number;
            totalTokens: number;
          };
          modelContextWindow?: number;
          total: {
            cachedInputTokens: number;
            inputTokens: number;
            outputTokens: number;
            reasoningOutputTokens: number;
            totalTokens: number;
          };
          turnId: string;
          updatedAt: number;
        }>
      >;
      upsert: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          cachedInputTokens: number;
          inputTokens: number;
          lastCachedInputTokens: number;
          lastInputTokens: number;
          lastOutputTokens: number;
          lastReasoningOutputTokens: number;
          lastTotalTokens: number;
          modelContextWindow?: number;
          outputTokens: number;
          reasoningOutputTokens: number;
          threadId: string;
          totalTokens: number;
          turnId: string;
        },
        null
      >;
    };
    turns: {
      deleteCascade: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          batchSize?: number;
          reason?: string;
          threadId: string;
          turnId: string;
        },
        { deletionJobId: string }
      >;
      interrupt: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          reason?: string;
          threadId: string;
          turnId: string;
        },
        null
      >;
      scheduleDeleteCascade: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          batchSize?: number;
          delayMs?: number;
          reason?: string;
          threadId: string;
          turnId: string;
        },
        { deletionJobId: string; scheduledFor: number }
      >;
      start: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          idempotencyKey: string;
          input: Array<{
            path?: string;
            text?: string;
            type: string;
            url?: string;
          }>;
          options?: {
            approvalPolicy?: string;
            cwd?: string;
            effort?: "low" | "medium" | "high";
            model?: string;
            personality?: string;
            sandboxPolicy?: string;
          };
          threadId: string;
          turnId: string;
        },
        { accepted: boolean; turnId: string }
      >;
    };
  };
};
