/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
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
        any,
        Name
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
        null,
        Name
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
        null,
        Name
      >;
      ensureSession: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          lastEventCursor: number;
          sessionId: string;
          threadId: string;
        },
        {
          sessionId: string;
          status: "active" | "created";
          threadId: string;
        },
        Name
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
        any,
        Name
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
        },
        Name
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
          errors: Array<{
            code:
              | "OUT_OF_ORDER"
              | "REPLAY_GAP"
              | "SESSION_DEVICE_MISMATCH"
              | "SESSION_NOT_FOUND"
              | "SESSION_THREAD_MISMATCH"
              | "UNKNOWN";
            message: string;
            recoverable: boolean;
          }>;
          ingestStatus: "ok" | "partial";
          recovery?: { action: "session_rebound"; sessionId: string; threadId: string };
          status: "ok" | "partial" | "rejected" | "session_recovered";
        },
        Name
      >;
      listCheckpoints: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          threadId: string;
        },
        Array<{ cursor: number; streamId: string }>,
        Name
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
        { ok: true },
        Name
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
        any,
        Name
      >;
    };
    messages: {
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
        any,
        Name
      >;
      getByTurn: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          threadId: string;
          turnId: string;
        },
        any,
        Name
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
        any,
        Name
      >;
      getState: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          threadId: string;
        },
        any,
        Name
      >;
      getExternalMapping: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          threadId: string;
        },
        { externalThreadId: string; threadId: string } | null,
        Name
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
        any,
        Name
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
        { created: boolean; externalThreadId?: string; threadId: string },
        Name
      >;
      resolveByExternalId: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          externalThreadId: string;
        },
        { externalThreadId: string; threadId: string } | null,
        Name
      >;
      resume: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          threadId: string;
        },
        any,
        Name
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
        null,
        Name
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
        any,
        Name
      >;
    };
  };
