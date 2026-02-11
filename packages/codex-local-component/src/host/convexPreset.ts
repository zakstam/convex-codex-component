import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  cancelTurnDispatchForActor,
  claimNextTurnDispatchForActor,
  dataHygiene,
  dispatchObservabilityForActor,
  durableHistoryStats,
  enqueueTurnDispatchForActor,
  ensureSession as ensureSessionHandler,
  ensureThreadByCreate,
  ensureThreadByResolve,
  getTurnDispatchStateForActor,
  ingestBatchMixed,
  ingestBatchStreamOnly,
  ingestEventMixed,
  ingestEventStreamOnly,
  interruptTurnForHooksForActor,
  listPendingApprovalsForHooksForActor,
  listPendingServerRequestsForHooksForActor,
  listThreadMessagesForHooksForActor,
  listThreadReasoningForHooksForActor,
  listTurnMessagesForHooksForActor,
  markTurnDispatchCompletedForActor,
  markTurnDispatchFailedForActor,
  markTurnDispatchStartedForActor,
  persistenceStats,
  resolvePendingServerRequestForHooksForActor,
  respondApprovalForHooksForActor,
  threadSnapshot,
  upsertPendingServerRequestForHooksForActor,
  vHostActorContext,
  vHostClaimedTurnDispatch,
  vHostDataHygiene,
  vHostDispatchObservability,
  vHostDurableHistoryStats,
  vHostEnqueueTurnDispatchResult,
  vHostEnsureSessionResult,
  vHostInboundEvent,
  vHostIngestSafeResult,
  vHostLifecycleInboundEvent,
  vHostPersistenceStats,
  vHostStreamArgs,
  vHostStreamInboundEvent,
  vHostSyncRuntimeOptions,
  vHostTurnDispatchState,
  vHostTurnInput,
  type CodexHostComponentRefs,
  type CodexHostComponentsInput,
  type HostActorContext,
  type HostMutationRunner,
  type HostQueryRunner,
} from "./convexSlice.js";
import { HOST_SURFACE_MANIFEST } from "./surfaceManifest.js";

export type CodexHostSliceProfile = "runtimeOwned" | "dispatchManaged";
export type CodexHostSliceIngestMode = "streamOnly" | "mixed";
export type CodexHostSliceThreadMode = "create" | "resolve";

export type CodexHostSliceFeatures = {
  hooks?: boolean;
  approvals?: boolean;
  serverRequests?: boolean;
  reasoning?: boolean;
  observability?: boolean;
  hygiene?: boolean;
};

type ExtractCodexHostComponentRefs<Components extends CodexHostComponentsInput> =
  Components extends { codexLocal: infer Component }
    ? Component extends CodexHostComponentRefs
      ? Component
      : never
    : Components extends CodexHostComponentRefs
      ? Components
      : never;

export type DefineCodexHostSliceOptions<
  Components extends CodexHostComponentsInput = CodexHostComponentsInput,
> = {
  components: Components;
  serverActor: HostActorContext;
  profile: CodexHostSliceProfile;
  ingestMode: CodexHostSliceIngestMode;
  threadMode: CodexHostSliceThreadMode;
  features?: CodexHostSliceFeatures;
};

function resolveCodexComponent<Components extends CodexHostComponentsInput>(
  components: Components,
): ExtractCodexHostComponentRefs<Components> {
  const codexLocal = (components as { codexLocal?: ExtractCodexHostComponentRefs<Components> }).codexLocal;
  if (codexLocal !== undefined) {
    return codexLocal;
  }
  return components as ExtractCodexHostComponentRefs<Components>;
}

function withServerActor<T extends { actor: HostActorContext }>(args: T, serverActor: HostActorContext): T {
  return {
    ...args,
    actor: serverActor,
  };
}

export function defineCodexHostSlice<Components extends CodexHostComponentsInput>(
  options: DefineCodexHostSliceOptions<Components>,
) {
  const features: Required<CodexHostSliceFeatures> = {
    hooks: options.features?.hooks ?? true,
    approvals: options.features?.approvals ?? true,
    serverRequests: options.features?.serverRequests ?? true,
    reasoning: options.features?.reasoning ?? true,
    observability: options.features?.observability ?? true,
    hygiene: options.features?.hygiene ?? true,
  };

  const component = resolveCodexComponent(options.components);

  const validateHostWiring = {
    args: {
      actor: vHostActorContext,
      threadId: v.optional(v.string()),
    },
    handler: async (
      ctx: HostQueryRunner,
      args: { actor: HostActorContext; threadId?: string },
    ) => {
      const checkThreadId = args.threadId ?? "__codex_host_wiring_preflight__";
      const checkTurnId = "__codex_host_wiring_preflight_turn__";
      const checks: Array<{ name: string; ok: boolean; error?: string }> = [];
      const isExpectedPreflightError = (message: string) =>
        message.includes("Thread not found") ||
        message.includes("Turn not found");

      const runCheck = async (name: string, fn: () => Promise<unknown>) => {
        try {
          await fn();
          checks.push({ name, ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isExpectedPreflightError(message)) {
            checks.push({ name, ok: true });
            return;
          }
          checks.push({
            name,
            ok: false,
            error: message,
          });
        }
      };

      await runCheck("threads.getState", () =>
        ctx.runQuery(component.threads.getState, {
          actor: options.serverActor,
          threadId: checkThreadId,
        }),
      );
      await runCheck("messages.listByThread", () =>
        ctx.runQuery(component.messages.listByThread, {
          actor: options.serverActor,
          threadId: checkThreadId,
          paginationOpts: {
            cursor: null,
            numItems: 1,
          },
        }),
      );
      await runCheck("messages.getByTurn", () =>
        ctx.runQuery(component.messages.getByTurn, {
          actor: options.serverActor,
          threadId: checkThreadId,
          turnId: checkTurnId,
        }),
      );
      await runCheck("dispatch.getTurnDispatchState", () =>
        ctx.runQuery(component.dispatch.getTurnDispatchState, {
          actor: options.serverActor,
          threadId: checkThreadId,
        }),
      );

      if (features.approvals) {
        await runCheck("approvals.listPending", () =>
          ctx.runQuery(component.approvals.listPending, {
            actor: options.serverActor,
            paginationOpts: {
              cursor: null,
              numItems: 1,
            },
          }),
        );
      }

      if (features.reasoning) {
        await runCheck("reasoning.listByThread", () =>
          ctx.runQuery(component.reasoning.listByThread, {
            actor: options.serverActor,
            threadId: checkThreadId,
            paginationOpts: {
              cursor: null,
              numItems: 1,
            },
            includeRaw: false,
          }),
        );
      }

      if (features.serverRequests) {
        await runCheck("serverRequests.listPending", () =>
          ctx.runQuery(component.serverRequests.listPending, {
            actor: options.serverActor,
            limit: 1,
          }),
        );
      }

      return {
        ok: checks.every((check) => check.ok),
        checks,
      };
    },
  };

  const ensureThread = {
    args: {
      actor: vHostActorContext,
      threadId: v.optional(v.string()),
      externalThreadId: v.optional(v.string()),
      model: v.optional(v.string()),
      cwd: v.optional(v.string()),
    },
    handler: async (ctx: HostMutationRunner & HostQueryRunner, args: {
      actor: HostActorContext;
      threadId?: string;
      externalThreadId?: string;
      model?: string;
      cwd?: string;
    }) => {
      if (options.threadMode === "resolve") {
        return ensureThreadByResolve(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        );
      }
      if (!args.threadId) {
        throw new Error("ensureThread requires threadId when threadMode=create");
      }
      return ensureThreadByCreate(
        ctx,
        component,
        withServerActor(
          { ...args, threadId: args.threadId },
          options.serverActor,
        ),
      );
    },
  };

  const ingestEvent = {
    args: {
      actor: vHostActorContext,
      sessionId: v.string(),
      threadId: v.string(),
      event: v.union(vHostInboundEvent, vHostStreamInboundEvent, vHostLifecycleInboundEvent),
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
      if (options.ingestMode === "mixed") {
        const event = "type" in args.event
          ? args.event
          : { ...args.event, type: "stream_delta" as const };
        return ingestEventMixed(
          ctx,
          component,
          withServerActor({ ...args, event }, options.serverActor),
        );
      }

      if ("type" in args.event && args.event.type === "lifecycle_event") {
        throw new Error("ingestEvent(streamOnly) does not accept lifecycle events");
      }
      const event = "type" in args.event
        ? {
            eventId: args.event.eventId,
            turnId: args.event.turnId,
            streamId: args.event.streamId,
            kind: args.event.kind,
            payloadJson: args.event.payloadJson,
            cursorStart: args.event.cursorStart,
            cursorEnd: args.event.cursorEnd,
            createdAt: args.event.createdAt,
          }
        : args.event;
      return ingestEventStreamOnly(
        ctx,
        component,
        withServerActor({ ...args, event }, options.serverActor),
      );
    },
  };

  const ingestBatch = {
    args: {
      actor: vHostActorContext,
      sessionId: v.string(),
      threadId: v.string(),
      deltas: v.array(v.union(vHostInboundEvent, vHostStreamInboundEvent, vHostLifecycleInboundEvent)),
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
      if (options.ingestMode === "mixed") {
        const deltas = args.deltas.map((delta) =>
          "type" in delta ? delta : { ...delta, type: "stream_delta" as const },
        );
        return ingestBatchMixed(
          ctx,
          component,
          withServerActor({ ...args, deltas }, options.serverActor),
        );
      }

      const hasLifecycle = args.deltas.some((delta) => "type" in delta && delta.type === "lifecycle_event");
      if (hasLifecycle) {
        throw new Error("ingestBatch(streamOnly) does not accept lifecycle events");
      }
      const streamDeltas = args.deltas
        .filter(
          (
            delta,
          ): delta is
            | {
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
                type: "stream_delta";
                eventId: string;
                turnId: string;
                streamId: string;
                kind: string;
                payloadJson: string;
                cursorStart: number;
                cursorEnd: number;
                createdAt: number;
              } => !("type" in delta) || delta.type === "stream_delta",
        )
        .map((delta) =>
          "type" in delta
            ? {
                eventId: delta.eventId,
                turnId: delta.turnId,
                streamId: delta.streamId,
                kind: delta.kind,
                payloadJson: delta.payloadJson,
                cursorStart: delta.cursorStart,
                cursorEnd: delta.cursorEnd,
                createdAt: delta.createdAt,
              }
            : delta,
        );
      return ingestBatchStreamOnly(
        ctx,
        component,
        withServerActor({ ...args, deltas: streamDeltas }, options.serverActor),
      );
    },
  };

  const mutations = {
    ensureThread,
    enqueueTurnDispatch: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
        dispatchId: v.optional(v.string()),
        turnId: v.string(),
        idempotencyKey: v.string(),
        input: vHostTurnInput,
      },
      returns: vHostEnqueueTurnDispatchResult,
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          dispatchId?: string;
          turnId: string;
          idempotencyKey: string;
          input: Array<{
            type: string;
            text?: string;
            url?: string;
            path?: string;
          }>;
        },
      ) =>
        enqueueTurnDispatchForActor(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
    },
    claimNextTurnDispatch: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
        claimOwner: v.string(),
        leaseMs: v.optional(v.number()),
      },
      returns: vHostClaimedTurnDispatch,
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          claimOwner: string;
          leaseMs?: number;
        },
      ) =>
        claimNextTurnDispatchForActor(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
    },
    markTurnDispatchStarted: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
        dispatchId: v.string(),
        claimToken: v.string(),
        runtimeThreadId: v.optional(v.string()),
        runtimeTurnId: v.optional(v.string()),
      },
      returns: v.null(),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          dispatchId: string;
          claimToken: string;
          runtimeThreadId?: string;
          runtimeTurnId?: string;
        },
      ) =>
        markTurnDispatchStartedForActor(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
    },
    markTurnDispatchCompleted: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
        dispatchId: v.string(),
        claimToken: v.string(),
      },
      returns: v.null(),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          dispatchId: string;
          claimToken: string;
        },
      ) =>
        markTurnDispatchCompletedForActor(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
    },
    markTurnDispatchFailed: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
        dispatchId: v.string(),
        claimToken: v.string(),
        code: v.optional(v.string()),
        reason: v.string(),
      },
      returns: v.null(),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          dispatchId: string;
          claimToken: string;
          code?: string;
          reason: string;
        },
      ) =>
        markTurnDispatchFailedForActor(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
    },
    cancelTurnDispatch: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
        dispatchId: v.string(),
        claimToken: v.optional(v.string()),
        reason: v.string(),
      },
      returns: v.null(),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          dispatchId: string;
          claimToken?: string;
          reason: string;
        },
      ) =>
        cancelTurnDispatchForActor(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
    },
    ensureSession: {
      args: {
        actor: vHostActorContext,
        sessionId: v.string(),
        threadId: v.string(),
      },
      returns: vHostEnsureSessionResult,
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          sessionId: string;
          threadId: string;
        },
      ) =>
        ensureSessionHandler(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
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
              args: {
                actor: HostActorContext;
                threadId: string;
                turnId: string;
                itemId: string;
                decision: "accepted" | "declined";
              },
            ) =>
              respondApprovalForHooksForActor(
                ctx,
                component,
                withServerActor(args, options.serverActor),
              ),
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
                method:
                  | "item/commandExecution/requestApproval"
                  | "item/fileChange/requestApproval"
                  | "item/tool/requestUserInput"
                  | "item/tool/call";
                payloadJson: string;
                reason?: string;
                questionsJson?: string;
                requestedAt: number;
              },
            ) =>
              upsertPendingServerRequestForHooksForActor(
                ctx,
                component,
                withServerActor(args, options.serverActor),
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
                withServerActor(args, options.serverActor),
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
              args: {
                actor: HostActorContext;
                threadId: string;
                turnId: string;
                reason?: string;
              },
            ) =>
              interruptTurnForHooksForActor(
                ctx,
                component,
                withServerActor(args, options.serverActor),
              ),
          },
        }
      : {}),
  };

  const queries = {
    validateHostWiring,
    getTurnDispatchState: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
        dispatchId: v.optional(v.string()),
        turnId: v.optional(v.string()),
      },
      returns: vHostTurnDispatchState,
      handler: async (
        ctx: HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          dispatchId?: string;
          turnId?: string;
        },
      ) =>
        getTurnDispatchStateForActor(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
    },
    threadSnapshot: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
      },
      handler: async (
        ctx: HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
        },
      ) =>
        threadSnapshot(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
    },
    persistenceStats: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
      },
      returns: vHostPersistenceStats,
      handler: async (
        ctx: HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
        },
      ) =>
        persistenceStats(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
    },
    durableHistoryStats: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
      },
      returns: vHostDurableHistoryStats,
      handler: async (
        ctx: HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
        },
      ) =>
        durableHistoryStats(
          ctx,
          component,
          withServerActor(args, options.serverActor),
        ),
    },
    ...(features.observability
      ? {
          getDispatchObservability: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
              dispatchId: v.optional(v.string()),
              turnId: v.optional(v.string()),
            },
            returns: vHostDispatchObservability,
            handler: async (
              ctx: HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId: string;
                dispatchId?: string;
                turnId?: string;
              },
            ) =>
              dispatchObservabilityForActor(
                ctx,
                component,
                withServerActor(args, options.serverActor),
              ),
          },
        }
      : {}),
    ...(features.hygiene
      ? {
          dataHygiene: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
            },
            returns: vHostDataHygiene,
            handler: async (
              ctx: HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId: string;
              },
            ) =>
              dataHygiene(
                ctx,
                component,
                withServerActor(args, options.serverActor),
              ),
          },
        }
      : {}),
    ...(features.hooks
      ? {
          listThreadMessagesForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
              paginationOpts: paginationOptsValidator,
              streamArgs: vHostStreamArgs,
              runtime: v.optional(vHostSyncRuntimeOptions),
            },
            handler: async (
              ctx: HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId: string;
                paginationOpts: { cursor: string | null; numItems: number };
                streamArgs?:
                  | {
                      kind: "list";
                      startOrder?: number;
                    }
                  | {
                      kind: "deltas";
                      cursors: Array<{ streamId: string; cursor: number }>;
                    };
                runtime?: {
                  saveStreamDeltas?: boolean;
                  saveReasoningDeltas?: boolean;
                  exposeRawReasoningDeltas?: boolean;
                  maxDeltasPerStreamRead?: number;
                  maxDeltasPerRequestRead?: number;
                  finishedStreamDeleteDelayMs?: number;
                };
              },
            ) =>
              listThreadMessagesForHooksForActor(
                ctx,
                component,
                withServerActor(args, options.serverActor),
              ),
          },
          listTurnMessagesForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
              turnId: v.string(),
            },
            handler: async (
              ctx: HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId: string;
                turnId: string;
              },
            ) =>
              listTurnMessagesForHooksForActor(
                ctx,
                component,
                withServerActor(args, options.serverActor),
              ),
          },
        }
      : {}),
    ...(features.reasoning
      ? {
          listThreadReasoningForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
              paginationOpts: paginationOptsValidator,
              includeRaw: v.optional(v.boolean()),
            },
            handler: async (
              ctx: HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId: string;
                paginationOpts: { cursor: string | null; numItems: number };
                includeRaw?: boolean;
              },
            ) =>
              listThreadReasoningForHooksForActor(
                ctx,
                component,
                withServerActor(args, options.serverActor),
              ),
          },
        }
      : {}),
    ...(features.approvals
      ? {
          listPendingApprovalsForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.optional(v.string()),
              paginationOpts: paginationOptsValidator,
            },
            handler: async (
              ctx: HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId?: string;
                paginationOpts: { cursor: string | null; numItems: number };
              },
            ) =>
              listPendingApprovalsForHooksForActor(
                ctx,
                component,
                withServerActor(args, options.serverActor),
              ),
          },
        }
      : {}),
    ...(features.serverRequests
      ? {
          listPendingServerRequestsForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.optional(v.string()),
              limit: v.optional(v.number()),
            },
            handler: async (
              ctx: HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId?: string;
                limit?: number;
              },
            ) =>
              listPendingServerRequestsForHooksForActor(
                ctx,
                component,
                withServerActor(args, options.serverActor),
              ),
          },
        }
      : {}),
  };

  return {
    profile: options.profile,
    mutations,
    queries,
  };
}

type CodexHostSliceDefinitions = ReturnType<typeof defineCodexHostSlice>;

type PickRequiredKeys<T, Keys extends keyof T> = {
  [K in Keys]-?: T[K];
};

type DispatchManagedMutationKeys = (typeof HOST_SURFACE_MANIFEST.dispatchManaged.mutations)[number];
type DispatchManagedQueryKeys = (typeof HOST_SURFACE_MANIFEST.dispatchManaged.queries)[number];
type RuntimeOwnedMutationKeys = (typeof HOST_SURFACE_MANIFEST.runtimeOwned.mutations)[number];
type RuntimeOwnedQueryKeys = (typeof HOST_SURFACE_MANIFEST.runtimeOwned.queries)[number];

function pickRequiredKeys<T extends Record<string, unknown>, Keys extends readonly (keyof T)[]>(
  source: T,
  keys: Keys,
): { [K in Keys[number]]-?: NonNullable<T[K]> } {
  return Object.fromEntries(
    keys.map((key) => {
      const value = source[key];
      if (value === undefined || value === null) {
        throw new Error(`Missing required host surface key: ${String(key)}`);
      }
      return [key, value];
    }),
  ) as { [K in Keys[number]]-?: NonNullable<T[K]> };
}

export type DispatchManagedHostDefinitions = {
  profile: "dispatchManaged";
  mutations: PickRequiredKeys<CodexHostSliceDefinitions["mutations"], DispatchManagedMutationKeys>;
  queries: PickRequiredKeys<CodexHostSliceDefinitions["queries"], DispatchManagedQueryKeys>;
};

export type RuntimeOwnedHostDefinitions = {
  profile: "runtimeOwned";
  mutations: PickRequiredKeys<CodexHostSliceDefinitions["mutations"], RuntimeOwnedMutationKeys>;
  queries: PickRequiredKeys<CodexHostSliceDefinitions["queries"], RuntimeOwnedQueryKeys>;
};

export type DefineDispatchManagedHostSliceOptions<
  Components extends CodexHostComponentsInput = CodexHostComponentsInput,
> = Pick<DefineCodexHostSliceOptions<Components>, "components" | "serverActor">;

export type DefineRuntimeOwnedHostSliceOptions<
  Components extends CodexHostComponentsInput = CodexHostComponentsInput,
> = Pick<DefineCodexHostSliceOptions<Components>, "components" | "serverActor">;

export function defineDispatchManagedHostSlice<Components extends CodexHostComponentsInput>(
  options: DefineDispatchManagedHostSliceOptions<Components>,
): DispatchManagedHostDefinitions {
  const defs = defineCodexHostSlice({
    ...options,
    profile: "dispatchManaged",
    ingestMode: "mixed",
    threadMode: "resolve",
    features: {
      hooks: true,
      approvals: true,
      serverRequests: true,
      reasoning: true,
      observability: true,
      hygiene: false,
    },
  });

  return {
    profile: "dispatchManaged",
    mutations: pickRequiredKeys(defs.mutations, HOST_SURFACE_MANIFEST.dispatchManaged.mutations),
    queries: pickRequiredKeys(defs.queries, HOST_SURFACE_MANIFEST.dispatchManaged.queries),
  };
}

export function defineRuntimeOwnedHostSlice<Components extends CodexHostComponentsInput>(
  options: DefineRuntimeOwnedHostSliceOptions<Components>,
): RuntimeOwnedHostDefinitions {
  const defs = defineCodexHostSlice({
    ...options,
    profile: "runtimeOwned",
    ingestMode: "streamOnly",
    threadMode: "create",
    features: {
      hooks: true,
      approvals: true,
      serverRequests: false,
      reasoning: false,
      observability: true,
      hygiene: true,
    },
  });

  return {
    profile: "runtimeOwned",
    mutations: pickRequiredKeys(defs.mutations, HOST_SURFACE_MANIFEST.runtimeOwned.mutations),
    queries: pickRequiredKeys(defs.queries, HOST_SURFACE_MANIFEST.runtimeOwned.queries),
  };
}
