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
        any,
        Name
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
        null,
        Name
      >;
    };
    dispatch: {
      cancelTurnDispatch: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          claimToken?: string;
          dispatchId: string;
          reason: string;
          threadId: string;
        },
        null,
        Name
      >;
      claimNextTurnDispatch: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
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
        },
        Name
      >;
      enqueueTurnDispatch: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
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
        },
        Name
      >;
      getTurnDispatchState: FunctionReference<
        "query",
        "internal",
        {
          actor: { userId?: string };
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
        },
        Name
      >;
      markTurnCompleted: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          claimToken: string;
          dispatchId: string;
          threadId: string;
        },
        null,
        Name
      >;
      markTurnFailed: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          claimToken: string;
          code?: string;
          dispatchId: string;
          reason: string;
          threadId: string;
        },
        null,
        Name
      >;
      markTurnStarted: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
          claimToken: string;
          dispatchId: string;
          runtimeThreadId?: string;
          runtimeTurnId?: string;
          threadId: string;
        },
        null,
        Name
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
        }>,
        Name
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
        any,
        Name
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
        any,
        Name
      >;
    };
    serverRequests: {
      listPending: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; limit?: number; threadId?: string },
        any,
        Name
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
        null,
        Name
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
        null,
        Name
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
        { sessionId: string; status: "created" | "active"; threadId: string },
        Name
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
        null,
        Name
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
        },
        Name
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
        },
        Name
      >;
      listCheckpoints: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; threadId: string },
        any,
        Name
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
        any,
        Name
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
        any,
        Name
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
        { ok: true },
        Name
      >;
    };
    threads: {
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
        any,
        Name
      >;
      getExternalMapping: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; threadId: string },
        null | { externalThreadId: string; threadId: string },
        Name
      >;
      getState: FunctionReference<
        "query",
        "internal",
        { actor: { userId?: string }; threadId: string },
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
        },
        Name
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
        any,
        Name
      >;
      resolve: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
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
        { actor: { userId?: string }; externalThreadId: string },
        null | { externalThreadId: string; threadId: string },
        Name
      >;
      resume: FunctionReference<
        "mutation",
        "internal",
        { actor: { userId?: string }; threadId: string },
        any,
        Name
      >;
    };
    turns: {
      interrupt: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { userId?: string };
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
        any,
        Name
      >;
    };
  };
