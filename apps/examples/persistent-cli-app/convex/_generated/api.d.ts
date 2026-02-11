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
          actor: { deviceId: string; tenantId: string; userId: string };
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
        any
      >;
      respond: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          decision: "accepted" | "declined";
          itemId: string;
          threadId: string;
          turnId: string;
        },
        null
      >;
    };
    dispatch: {
      cancelTurnDispatch: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          claimToken?: string;
          dispatchId: string;
          reason: string;
          threadId: string;
        },
        null
      >;
      claimNextTurnDispatch: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          claimOwner: string;
          leaseMs?: number;
          threadId: string;
        },
        null | {
          attemptCount: number;
          claimToken: string;
          dispatchId: string;
          idempotencyKey: string;
          inputText: string;
          leaseExpiresAt: number;
          turnId: string;
        }
      >;
      enqueueTurnDispatch: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          dispatchId?: string;
          idempotencyKey: string;
          input: Array<{
            path?: string;
            text?: string;
            type: string;
            url?: string;
          }>;
          threadId: string;
          turnId: string;
        },
        {
          accepted: boolean;
          dispatchId: string;
          status:
            | "queued"
            | "claimed"
            | "started"
            | "completed"
            | "failed"
            | "cancelled";
          turnId: string;
        }
      >;
      getTurnDispatchState: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          dispatchId?: string;
          threadId: string;
          turnId?: string;
        },
        null | {
          attemptCount: number;
          cancelledAt?: number;
          claimOwner?: string;
          claimToken?: string;
          completedAt?: number;
          createdAt: number;
          dispatchId: string;
          failureCode?: string;
          failureReason?: string;
          idempotencyKey: string;
          inputText: string;
          leaseExpiresAt: number;
          runtimeThreadId?: string;
          runtimeTurnId?: string;
          startedAt?: number;
          status:
            | "queued"
            | "claimed"
            | "started"
            | "completed"
            | "failed"
            | "cancelled";
          turnId: string;
          updatedAt: number;
        }
      >;
      markTurnCompleted: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          claimToken: string;
          dispatchId: string;
          threadId: string;
        },
        null
      >;
      markTurnFailed: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          claimToken: string;
          code?: string;
          dispatchId: string;
          reason: string;
          threadId: string;
        },
        null
      >;
      markTurnStarted: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          claimToken: string;
          dispatchId: string;
          runtimeThreadId?: string;
          runtimeTurnId?: string;
          threadId: string;
        },
        null
      >;
    };
    messages: {
      getByTurn: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          threadId: string;
          turnId: string;
        },
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
          actor: { deviceId: string; tenantId: string; userId: string };
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
        any
      >;
    };
    reasoning: {
      listByThread: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
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
        any
      >;
    };
    serverRequests: {
      listPending: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          limit?: number;
          threadId?: string;
        },
        any
      >;
      resolve: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
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
          actor: { deviceId: string; tenantId: string; userId: string };
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
          actor: { deviceId: string; tenantId: string; userId: string };
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
          actor: { deviceId: string; tenantId: string; userId: string };
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
          actor: { deviceId: string; tenantId: string; userId: string };
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
          actor: { deviceId: string; tenantId: string; userId: string };
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
              | "SESSION_DEVICE_MISMATCH"
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
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          threadId: string;
        },
        any
      >;
      replay: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
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
        any
      >;
      resumeReplay: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
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
        any
      >;
      upsertCheckpoint: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          cursor: number;
          streamId: string;
          threadId: string;
        },
        { ok: true }
      >;
    };
    threads: {
      create: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          cwd?: string;
          localThreadId?: string;
          model?: string;
          personality?: string;
          threadId: string;
        },
        any
      >;
      getExternalMapping: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          threadId: string;
        },
        null | { externalThreadId: string; threadId: string }
      >;
      getState: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          threadId: string;
        },
        {
          activeStreams: Array<{ state: string; streamId: string }>;
          allStreams: Array<{ state: string; streamId: string }>;
          dispatches: Array<{
            attemptCount: number;
            claimOwner?: string;
            createdAt: number;
            dispatchId: string;
            failureCode?: string;
            failureReason?: string;
            leaseExpiresAt: number;
            status:
              | "queued"
              | "claimed"
              | "started"
              | "completed"
              | "failed"
              | "cancelled";
            turnId: string;
            updatedAt: number;
          }>;
          pendingApprovals: Array<{
            itemId: string;
            kind: string;
            reason?: string;
          }>;
          recentMessages: Array<{
            createdAt: number;
            messageId: string;
            role: "user" | "assistant" | "system" | "tool";
            status: "streaming" | "completed" | "failed" | "interrupted";
            text: string;
            turnId: string;
          }>;
          streamStats: Array<{
            deltaCount: number;
            latestCursor: number;
            state: "streaming" | "finished" | "aborted";
            streamId: string;
          }>;
          threadId: string;
          threadStatus: string;
          turns: Array<{ startedAt: number; status: string; turnId: string }>;
        }
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any
      >;
      resolve: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          cwd?: string;
          externalThreadId?: string;
          localThreadId?: string;
          model?: string;
          personality?: string;
        },
        { created: boolean; externalThreadId?: string; threadId: string }
      >;
      resolveByExternalId: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          externalThreadId: string;
        },
        null | { externalThreadId: string; threadId: string }
      >;
      resume: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          threadId: string;
        },
        any
      >;
    };
    turns: {
      interrupt: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          reason?: string;
          threadId: string;
          turnId: string;
        },
        null
      >;
      start: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
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
        any
      >;
    };
  };
};
