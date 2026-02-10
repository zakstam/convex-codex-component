import type { FunctionArgs, FunctionReference, FunctionReturnType, PaginationOptions } from "convex/server";
import type { CodexMutationRunner, CodexQueryRunner } from "../client/types.js";

export type HostStreamArgs =
  | { kind: "list"; startOrder?: number }
  | { kind: "deltas"; cursors: Array<{ streamId: string; cursor: number }> };

export type HostSyncRuntimeOptions = {
  saveStreamDeltas?: boolean;
  maxDeltasPerStreamRead?: number;
  maxDeltasPerRequestRead?: number;
  finishedStreamDeleteDelayMs?: number;
};

export type HostMessagesForHooksArgs<Actor> = {
  actor: Actor;
  threadId: string;
  paginationOpts: PaginationOptions;
  streamArgs?: HostStreamArgs;
  runtime?: HostSyncRuntimeOptions;
};

export async function listThreadMessagesForHooks<
  Actor,
  Component extends {
    messages: {
      listByThread: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
    };
    sync: {
      replay: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
    };
  },
>(
  ctx: CodexQueryRunner,
  component: Component,
  args: HostMessagesForHooksArgs<Actor>,
): Promise<
  FunctionReturnType<Component["messages"]["listByThread"]> & {
    streams?:
      | { kind: "list"; streams: Array<{ streamId: string; state: string }> }
      | {
          kind: "deltas";
          streams: Array<{ streamId: string; state: string }>;
          deltas: Array<Record<string, unknown>>;
          streamWindows: Array<{
            streamId: string;
            status: "ok" | "rebased" | "stale";
            serverCursorStart: number;
            serverCursorEnd: number;
          }>;
          nextCheckpoints: Array<{ streamId: string; cursor: number }>;
        };
  }
> {
  const paginated = await ctx.runQuery(component.messages.listByThread, {
    actor: args.actor,
    threadId: args.threadId,
    paginationOpts: args.paginationOpts,
  } as FunctionArgs<Component["messages"]["listByThread"]>);

  const streams = args.streamArgs
    ? await ctx.runQuery(component.sync.replay, {
        actor: args.actor,
        threadId: args.threadId,
        streamCursorsById:
          args.streamArgs.kind === "deltas" ? args.streamArgs.cursors : [],
        ...(args.runtime ? { runtime: args.runtime } : {}),
      } as FunctionArgs<Component["sync"]["replay"]>)
    : undefined;

  if (args.streamArgs?.kind === "deltas") {
    return {
      ...(paginated as object),
      streams: streams
        ? {
            kind: "deltas",
            streams: (streams as { streams: Array<{ streamId: string; state: string }> }).streams,
            deltas: (streams as { deltas: Array<Record<string, unknown>> }).deltas,
            streamWindows: (streams as {
              streamWindows: Array<{
                streamId: string;
                status: "ok" | "rebased" | "stale";
                serverCursorStart: number;
                serverCursorEnd: number;
              }>;
            }).streamWindows,
            nextCheckpoints: (streams as {
              nextCheckpoints: Array<{ streamId: string; cursor: number }>;
            }).nextCheckpoints,
          }
        : undefined,
    } as FunctionReturnType<Component["messages"]["listByThread"]> & {
      streams?:
        | { kind: "list"; streams: Array<{ streamId: string; state: string }> }
        | {
            kind: "deltas";
            streams: Array<{ streamId: string; state: string }>;
            deltas: Array<Record<string, unknown>>;
            streamWindows: Array<{
              streamId: string;
              status: "ok" | "rebased" | "stale";
              serverCursorStart: number;
              serverCursorEnd: number;
            }>;
            nextCheckpoints: Array<{ streamId: string; cursor: number }>;
          };
    };
  }

  return {
    ...(paginated as object),
    streams: streams
      ? {
          kind: "list",
          streams: (streams as { streams: Array<{ streamId: string; state: string }> }).streams,
        }
      : undefined,
  } as FunctionReturnType<Component["messages"]["listByThread"]> & {
    streams?:
      | { kind: "list"; streams: Array<{ streamId: string; state: string }> }
      | {
          kind: "deltas";
          streams: Array<{ streamId: string; state: string }>;
          deltas: Array<Record<string, unknown>>;
          streamWindows: Array<{
            streamId: string;
            status: "ok" | "rebased" | "stale";
            serverCursorStart: number;
            serverCursorEnd: number;
          }>;
          nextCheckpoints: Array<{ streamId: string; cursor: number }>;
        };
  };
}

export type HostInboundStreamDelta = {
  type: "stream_delta";
  eventId: string;
  turnId: string;
  streamId: string;
  kind: string;
  payloadJson: string;
  cursorStart: number;
  cursorEnd: number;
  createdAt: number;
};

export type HostInboundLifecycleEvent = {
  type: "lifecycle_event";
  eventId: string;
  turnId?: string;
  kind: string;
  payloadJson: string;
  createdAt: number;
};

export async function ingestBatchSafe<
  Actor,
  Component extends {
    sync: {
      ingestSafe: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
    };
  },
>(
  ctx: CodexMutationRunner,
  component: Component,
  args: {
    actor: Actor;
    sessionId: string;
    threadId: string;
    deltas: Array<HostInboundStreamDelta | HostInboundLifecycleEvent>;
    runtime?: HostSyncRuntimeOptions;
  },
): Promise<FunctionReturnType<Component["sync"]["ingestSafe"]>> {
  const streamDeltas = args.deltas.filter(
    (delta): delta is HostInboundStreamDelta => delta.type === "stream_delta",
  );
  const lifecycleEvents = args.deltas.filter(
    (delta): delta is HostInboundLifecycleEvent => delta.type === "lifecycle_event",
  );

  return ctx.runMutation(component.sync.ingestSafe, {
    actor: args.actor,
    sessionId: args.sessionId,
    threadId: args.threadId,
    streamDeltas,
    lifecycleEvents,
    ...(args.runtime ? { runtime: args.runtime } : {}),
  } as FunctionArgs<Component["sync"]["ingestSafe"]>);
}
