/**
 * Mutation definitions for the Codex host preset slice.
 * Extracted from convexPreset.ts for file-size compliance.
 */
import { v } from "convex/values";
import {
  ensureSession as ensureSessionHandler,
  ensureThreadByResolve,
  ingestBatchMixed,
  ingestBatchStreamOnly,
  ingestEventMixed,
  ingestEventStreamOnly,
  interruptTurnForHooksForActor,
  resolvePendingServerRequestForHooksForActor,
  respondApprovalForHooksForActor,
  upsertPendingServerRequestForHooksForActor,
  upsertTokenUsageForActor,
  vHostActorContext,
  vHostEnsureSessionResult,
  vHostIngestSafeResult,
  vHostLifecycleInboundEvent,
  vHostStreamInboundEvent,
  vHostSyncRuntimeOptions,
  type CodexHostComponentRefs,
  type HostActorContext,
  type HostMutationRunner,
  type HostQueryRunner,
} from "./convexSlice.js";
import type { CodexHostSliceFeatures, CodexHostSliceIngestMode } from "./convexPreset.js";

type MutationBuilderArgs = {
  component: CodexHostComponentRefs;
  serverActor: HostActorContext;
  ingestMode: CodexHostSliceIngestMode;
  features: Required<CodexHostSliceFeatures>;
};

function withServerActor<T extends { actor: HostActorContext }>(args: T, serverActor: HostActorContext): T {
  return { ...args, actor: serverActor };
}

function resolveServerActor(
  args: { actor: HostActorContext },
  fallback: HostActorContext,
): HostActorContext {
  return args.actor.userId === undefined ? fallback : args.actor;
}

export function buildPresetMutations(opts: MutationBuilderArgs) {
  const { component, serverActor, ingestMode, features } = opts;

  const ensureThread = {
    args: {
      actor: vHostActorContext,
      threadId: v.optional(v.string()),
      externalThreadId: v.optional(v.string()),
      model: v.optional(v.string()),
      cwd: v.optional(v.string()),
    },
    returns: v.object({
      threadId: v.string(),
      externalThreadId: v.optional(v.string()),
      created: v.optional(v.boolean()),
    }),
    handler: async (ctx: HostMutationRunner & HostQueryRunner, args: {
      actor: HostActorContext;
      threadId?: string;
      externalThreadId?: string;
      model?: string;
      cwd?: string;
    }) => {
      if (!args.threadId && !args.externalThreadId) {
        throw new Error("ensureThread requires threadId or externalThreadId.");
      }
      return ensureThreadByResolve(ctx, component, withServerActor(args, resolveServerActor(args, serverActor)));
    },
  };

  const ingestEvent = {
    args: {
      actor: vHostActorContext,
      sessionId: v.string(),
      threadId: v.string(),
      event: v.union(vHostStreamInboundEvent, vHostLifecycleInboundEvent),
    },
    returns: vHostIngestSafeResult,
    handler: async (
      ctx: HostMutationRunner & HostQueryRunner,
      args: {
        actor: HostActorContext;
        sessionId: string;
        threadId: string;
        event:
          | {
              type: "stream_delta";
              eventId: string;
              turnId: string;
              streamId: string;
              kind: string;
              payloadJson: string;
              cursorStart: number;
              cursorEnd: number;
              createdAt: number;
            }
          | {
              type: "lifecycle_event";
              eventId: string;
              turnId?: string;
              kind: string;
              payloadJson: string;
              createdAt: number;
            };
      },
    ) => {
      if (ingestMode === "mixed") {
        return ingestEventMixed(ctx, component, withServerActor(args, resolveServerActor(args, serverActor)));
      }
      if (args.event.type === "lifecycle_event") {
        throw new Error("ingestEvent(streamOnly) does not accept lifecycle events");
      }
      return ingestEventStreamOnly(
        ctx,
        component,
        withServerActor({ ...args, event: args.event }, resolveServerActor(args, serverActor)),
      );
    },
  };

  const ingestBatch = {
    args: {
      actor: vHostActorContext,
      sessionId: v.string(),
      threadId: v.string(),
      deltas: v.array(v.union(vHostStreamInboundEvent, vHostLifecycleInboundEvent)),
      runtime: v.optional(vHostSyncRuntimeOptions),
    },
    returns: vHostIngestSafeResult,
    handler: async (
      ctx: HostMutationRunner & HostQueryRunner,
      args: {
        actor: HostActorContext;
        sessionId: string;
        threadId: string;
        deltas: Array<
          | {
              type: "stream_delta";
              eventId: string;
              turnId: string;
              streamId: string;
              kind: string;
              payloadJson: string;
              cursorStart: number;
              cursorEnd: number;
              createdAt: number;
            }
          | {
              type: "lifecycle_event";
              eventId: string;
              turnId?: string;
              kind: string;
              payloadJson: string;
              createdAt: number;
            }
        >;
        runtime?: {
          saveStreamDeltas?: boolean;
          saveReasoningDeltas?: boolean;
          exposeRawReasoningDeltas?: boolean;
          maxDeltasPerStreamRead?: number;
          maxDeltasPerRequestRead?: number;
          finishedStreamDeleteDelayMs?: number;
        };
      },
    ) => {
      if (ingestMode === "mixed") {
        return ingestBatchMixed(ctx, component, withServerActor(args, resolveServerActor(args, serverActor)));
      }
      const hasLifecycle = args.deltas.some((delta) => delta.type === "lifecycle_event");
      if (hasLifecycle) {
        throw new Error("ingestBatch(streamOnly) does not accept lifecycle events");
      }
      const streamDeltas = args.deltas
        .filter((delta): delta is Extract<(typeof args.deltas)[number], { type: "stream_delta" }> =>
          delta.type === "stream_delta")
        .map((delta) => ({
          eventId: delta.eventId,
          turnId: delta.turnId,
          streamId: delta.streamId,
          kind: delta.kind,
          payloadJson: delta.payloadJson,
          cursorStart: delta.cursorStart,
          cursorEnd: delta.cursorEnd,
          createdAt: delta.createdAt,
        }));
      return ingestBatchStreamOnly(
        ctx,
        component,
        withServerActor({ ...args, deltas: streamDeltas }, resolveServerActor(args, serverActor)),
      );
    },
  };

  return {
    ensureThread,
    ensureSession: {
      args: {
        actor: vHostActorContext,
        sessionId: v.string(),
        threadId: v.string(),
        lastEventCursor: v.number(),
      },
      returns: vHostEnsureSessionResult,
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; sessionId: string; threadId: string; lastEventCursor: number },
      ) => ensureSessionHandler(ctx, component, withServerActor(args, resolveServerActor(args, serverActor))),
    },
    ingestEvent,
    ingestBatch,
    ...(features.approvals
      ? {
          respondApprovalForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
              turnId: v.string(),
              itemId: v.string(),
              decision: v.union(v.literal("accepted"), v.literal("declined")),
            },
            returns: v.null(),
            handler: async (
              ctx: HostMutationRunner & HostQueryRunner,
              args: { actor: HostActorContext; threadId: string; turnId: string; itemId: string; decision: "accepted" | "declined" },
            ) =>
              respondApprovalForHooksForActor(ctx, component, withServerActor(args, resolveServerActor(args, serverActor))),
          },
        }
      : {}),
    ...(features.serverRequests
      ? {
          upsertPendingServerRequestForHooks: {
            args: {
              actor: vHostActorContext,
              requestId: v.union(v.string(), v.number()),
              threadId: v.string(),
              turnId: v.string(),
              itemId: v.string(),
              method: v.union(
                v.literal("item/commandExecution/requestApproval"),
                v.literal("item/fileChange/requestApproval"),
                v.literal("item/tool/requestUserInput"),
                v.literal("item/tool/call"),
              ),
              payloadJson: v.string(),
              reason: v.optional(v.string()),
              questionsJson: v.optional(v.string()),
              requestedAt: v.number(),
            },
            returns: v.null(),
            handler: async (
              ctx: HostMutationRunner & HostQueryRunner,
              args: {
                actor: HostActorContext;
                requestId: string | number;
                threadId: string;
                turnId: string;
                itemId: string;
                method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/tool/requestUserInput" | "item/tool/call";
                payloadJson: string;
                reason?: string;
                questionsJson?: string;
                requestedAt: number;
              },
            ) =>
              upsertPendingServerRequestForHooksForActor(
                ctx,
                component,
                withServerActor(args, resolveServerActor(args, serverActor)),
              ),
          },
          resolvePendingServerRequestForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
              requestId: v.union(v.string(), v.number()),
              status: v.union(v.literal("answered"), v.literal("expired")),
              resolvedAt: v.number(),
              responseJson: v.optional(v.string()),
            },
            returns: v.null(),
            handler: async (
              ctx: HostMutationRunner & HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId: string;
                requestId: string | number;
                status: "answered" | "expired";
                resolvedAt: number;
                responseJson?: string;
              },
            ) =>
              resolvePendingServerRequestForHooksForActor(
                ctx,
                component,
                withServerActor(args, resolveServerActor(args, serverActor)),
              ),
          },
        }
      : {}),
    ...(features.hooks
      ? {
          interruptTurnForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
              turnId: v.string(),
              reason: v.optional(v.string()),
            },
            returns: v.null(),
            handler: async (
              ctx: HostMutationRunner & HostQueryRunner,
              args: { actor: HostActorContext; threadId: string; turnId: string; reason?: string },
            ) =>
              interruptTurnForHooksForActor(
                ctx,
                component,
                withServerActor(args, resolveServerActor(args, serverActor)),
              ),
          },
        }
      : {}),
    ...(features.tokenUsage
      ? {
          upsertTokenUsageForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
              turnId: v.string(),
              totalTokens: v.number(),
              inputTokens: v.number(),
              cachedInputTokens: v.number(),
              outputTokens: v.number(),
              reasoningOutputTokens: v.number(),
              lastTotalTokens: v.number(),
              lastInputTokens: v.number(),
              lastCachedInputTokens: v.number(),
              lastOutputTokens: v.number(),
              lastReasoningOutputTokens: v.number(),
              modelContextWindow: v.optional(v.number()),
            },
            returns: v.null(),
            handler: async (
              ctx: HostMutationRunner & HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId: string;
                turnId: string;
                totalTokens: number;
                inputTokens: number;
                cachedInputTokens: number;
                outputTokens: number;
                reasoningOutputTokens: number;
                lastTotalTokens: number;
                lastInputTokens: number;
                lastCachedInputTokens: number;
                lastOutputTokens: number;
                lastReasoningOutputTokens: number;
                modelContextWindow?: number;
              },
            ) =>
              upsertTokenUsageForActor(
                ctx,
                component,
                withServerActor(args, resolveServerActor(args, serverActor)),
              ),
          },
        }
      : {}),
    acceptTurnSendForHooks: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
        turnId: v.string(),
        idempotencyKey: v.string(),
        inputText: v.string(),
        dispatchId: v.optional(v.string()),
      },
      returns: v.object({
        dispatchId: v.string(),
        turnId: v.string(),
        accepted: v.literal(true),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          turnId: string;
          idempotencyKey: string;
          inputText: string;
          dispatchId?: string;
        },
      ) => {
        const resolvedActor = resolveServerActor(args, serverActor);
        await ctx.runMutation(component.turns.start, {
          actor: resolvedActor,
          threadId: args.threadId,
          turnId: args.turnId,
          idempotencyKey: args.idempotencyKey,
          input: [{ type: "text", text: args.inputText }],
        });
        return {
          dispatchId: args.dispatchId ?? args.turnId,
          turnId: args.turnId,
          accepted: true as const,
        };
      },
    },
    failAcceptedTurnSendForHooks: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
        turnId: v.string(),
        dispatchId: v.optional(v.string()),
        code: v.optional(v.string()),
        reason: v.string(),
      },
      returns: v.null(),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          turnId: string;
          dispatchId?: string;
          code?: string;
          reason: string;
        },
      ) => {
        const resolvedActor = resolveServerActor(args, serverActor);
        await ctx.runMutation(component.turns.interrupt, {
          actor: resolvedActor,
          threadId: args.threadId,
          turnId: args.turnId,
          reason: args.code ? `[${args.code}] ${args.reason}` : args.reason,
        });
        return null;
      },
    },
  };
}
