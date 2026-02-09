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
      pullState: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          streamCursorsById: Array<{ cursor: number; streamId: string }>;
          threadId: string;
        },
        any,
        Name
      >;
      pushEvents: FunctionReference<
        "mutation",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          deltas: Array<{
            createdAt: number;
            cursorEnd: number;
            cursorStart: number;
            eventId: string;
            kind: string;
            payloadJson: string;
            streamId: string;
            turnId: string;
          }>;
          sessionId: string;
          threadId: string;
        },
        { ackCursor: number },
        Name
      >;
      resumeFromCursor: FunctionReference<
        "query",
        "internal",
        {
          actor: { deviceId: string; tenantId: string; userId: string };
          fromCursor: number;
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
