"use client";

import type { FunctionArgs, FunctionReference, PaginationOptions, PaginationResult } from "convex/server";
import type {
  CodexDurableMessageLike,
  CodexReasoningSegmentLike,
  CodexStreamDeltaLike,
} from "../mapping.js";

export type CodexStreamArgs =
  | { kind: "list"; startOrder?: number }
  | { kind: "deltas"; cursors: Array<{ streamId: string; cursor: number }> };

export type CodexStreamsResult =
  | { kind: "list"; streams: Array<{ streamId: string; state: string }> }
  | {
      kind: "deltas";
      streams: Array<{ streamId: string; state: string }>;
      deltas: CodexStreamDeltaLike[];
      streamWindows: Array<{
        streamId: string;
        status: "ok" | "rebased" | "stale";
        serverCursorStart: number;
        serverCursorEnd: number;
      }>;
      nextCheckpoints: Array<{ streamId: string; cursor: number }>;
    };

export type CodexMessagesQuery<Args = Record<string, unknown>> = FunctionReference<
  "query",
  "public",
  {
    threadId: string;
    paginationOpts: PaginationOptions;
    streamArgs?: CodexStreamArgs;
  } & Args,
  PaginationResult<CodexDurableMessageLike> & {
    streams?: CodexStreamsResult;
    threadStatus?: "ok" | "missing_thread";
    code?: "E_THREAD_NOT_FOUND";
    message?: string;
  }
>;

export type CodexMessagesQueryArgs<Query extends CodexMessagesQuery<unknown>> =
  Query extends CodexMessagesQuery<unknown>
    ? Omit<FunctionArgs<Query>, "paginationOpts" | "streamArgs">
    : never;

export type CodexReasoningQuery<Args = Record<string, unknown>> = FunctionReference<
  "query",
  "public",
  {
    threadId: string;
    paginationOpts: PaginationOptions;
    includeRaw?: boolean;
  } & Args,
  PaginationResult<CodexReasoningSegmentLike> & {
    streams?: CodexStreamsResult;
    threadStatus?: "ok" | "missing_thread";
    code?: "E_THREAD_NOT_FOUND";
    message?: string;
  }
>;

export type CodexReasoningQueryArgs<Query extends CodexReasoningQuery<unknown>> =
  Query extends CodexReasoningQuery<unknown>
    ? Omit<FunctionArgs<Query>, "paginationOpts" | "streamArgs">
    : never;
