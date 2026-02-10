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
    sync: {
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
            finishedStreamDeleteDelayMs?: number;
            maxDeltasPerRequestRead?: number;
            maxDeltasPerStreamRead?: number;
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
            finishedStreamDeleteDelayMs?: number;
            maxDeltasPerRequestRead?: number;
            maxDeltasPerStreamRead?: number;
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
            finishedStreamDeleteDelayMs?: number;
            maxDeltasPerRequestRead?: number;
            maxDeltasPerStreamRead?: number;
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
