"use client";

import type { FunctionArgs, FunctionReference, PaginationOptions, PaginationResult } from "convex/server";
import type { CodexDurableMessageLike, CodexStreamDeltaLike } from "../mapping.js";

export type CodexStreamArgs =
  | { kind: "list"; startOrder?: number }
  | { kind: "deltas"; cursors: Array<{ streamId: string; cursor: number }> };

export type CodexStreamsResult =
  | { kind: "list"; streams: Array<{ streamId: string; state: string }> }
  | { kind: "deltas"; deltas: CodexStreamDeltaLike[] };

export type CodexMessagesQuery<Args = Record<string, unknown>> = FunctionReference<
  "query",
  "public",
  {
    threadId: string;
    paginationOpts: PaginationOptions;
    streamArgs?: CodexStreamArgs;
  } & Args,
  PaginationResult<CodexDurableMessageLike> & { streams?: CodexStreamsResult }
>;

export type CodexMessagesQueryArgs<Query extends CodexMessagesQuery<unknown>> =
  Query extends CodexMessagesQuery<unknown>
    ? Omit<FunctionArgs<Query>, "paginationOpts" | "streamArgs">
    : never;
