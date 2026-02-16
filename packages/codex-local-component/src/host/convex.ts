import type { FunctionReference, FunctionReturnType, PaginationOptions } from "convex/server";
import type { CodexMutationRunner, CodexQueryRunner } from "../shared/types.js";
import { normalizeInboundDeltas } from "./normalizeInboundDeltas.js";

type HostStreamListItem = { streamId: string; state: string };
type HostStreamWindow = {
  streamId: string;
  status: "ok" | "rebased" | "stale";
  serverCursorStart: number;
  serverCursorEnd: number;
};
export type HostReplayResult = {
  streams: HostStreamListItem[];
  deltas: Array<Record<string, unknown>>;
  streamWindows: HostStreamWindow[];
  nextCheckpoints: Array<{ streamId: string; cursor: number }>;
};
type HostHookStreams =
  | { kind: "list"; streams: HostStreamListItem[] }
  | {
      kind: "deltas";
      streams: HostStreamListItem[];
      deltas: Array<Record<string, unknown>>;
      streamWindows: HostStreamWindow[];
      nextCheckpoints: Array<{ streamId: string; cursor: number }>;
    };

export type HostStreamArgs =
  | { kind: "list"; startOrder?: number }
  | { kind: "deltas"; cursors: Array<{ streamId: string; cursor: number }> };

export type HostSyncRuntimeOptions = {
  saveStreamDeltas?: boolean;
  saveReasoningDeltas?: boolean;
  exposeRawReasoningDeltas?: boolean;
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

export type HostReasoningForHooksArgs<Actor> = {
  actor: Actor;
  threadId: string;
  paginationOpts: PaginationOptions;
  includeRaw?: boolean;
};

export async function listThreadMessagesForHooks<
  Actor,
  MessagesResult extends object,
  Component extends {
    messages: {
      listByThread: FunctionReference<"query", "public" | "internal", Record<string, unknown>, MessagesResult>;
    };
    sync: {
      replay: FunctionReference<"query", "public" | "internal", Record<string, unknown>, HostReplayResult>;
    };
  },
>(
  ctx: CodexQueryRunner,
  component: Component,
  args: HostMessagesForHooksArgs<Actor>,
): Promise<
  MessagesResult & {
    streams?: HostHookStreams;
  }
> {
  const paginated = await ctx.runQuery(component.messages.listByThread, {
    actor: args.actor,
    threadId: args.threadId,
    paginationOpts: args.paginationOpts,
  });

  const streams = args.streamArgs
    ? await ctx.runQuery(component.sync.replay, {
        actor: args.actor,
        threadId: args.threadId,
        streamCursorsById:
          args.streamArgs.kind === "deltas" ? args.streamArgs.cursors : [],
        ...(args.runtime ? { runtime: args.runtime } : {}),
      })
    : undefined;

  if (args.streamArgs?.kind === "deltas") {
    const streamPayload: HostHookStreams | undefined = streams
      ? {
          kind: "deltas",
          streams: streams.streams,
          deltas: streams.deltas,
          streamWindows: streams.streamWindows,
          nextCheckpoints: streams.nextCheckpoints,
        }
      : undefined;
    return {
      ...paginated,
      ...(streamPayload ? { streams: streamPayload } : {}),
    };
  }

  const streamPayload: HostHookStreams | undefined = streams
    ? {
        kind: "list",
        streams: streams.streams,
      }
    : undefined;
  return {
    ...paginated,
    ...(streamPayload ? { streams: streamPayload } : {}),
  };
}

export async function listThreadReasoningForHooks<
  Actor,
  Component extends {
    reasoning: {
      listByThread: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
    };
  },
>(
  ctx: CodexQueryRunner,
  component: Component,
  args: HostReasoningForHooksArgs<Actor>,
): Promise<FunctionReturnType<Component["reasoning"]["listByThread"]>> {
  return ctx.runQuery(component.reasoning.listByThread, {
    actor: args.actor,
    threadId: args.threadId,
    paginationOpts: args.paginationOpts,
    ...(typeof args.includeRaw === "boolean" ? { includeRaw: args.includeRaw } : {}),
  });
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
  const normalized = normalizeInboundDeltas(args.deltas);
  const streamDeltas = normalized.filter(
    (delta): delta is HostInboundStreamDelta => delta.type === "stream_delta",
  );
  const lifecycleEvents = normalized.filter(
    (delta): delta is HostInboundLifecycleEvent => delta.type === "lifecycle_event",
  );

  return ctx.runMutation(component.sync.ingestSafe, {
    actor: args.actor,
    sessionId: args.sessionId,
    threadId: args.threadId,
    streamDeltas,
    lifecycleEvents,
    ...(args.runtime ? { runtime: args.runtime } : {}),
  });
}
