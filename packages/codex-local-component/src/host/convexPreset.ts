import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  dataHygiene,
  durableHistoryStats,
  listPendingApprovalsForHooksForActor,
  listPendingServerRequestsForHooksForActor,
  listTokenUsageForHooksForActor,
  listThreadMessagesForHooksForActor,
  listThreadReasoningForHooksForActor,
  listTurnMessagesForHooksForActor,
  persistenceStats,
  threadSnapshot,
  threadSnapshotSafe,
  vHostActorContext,
  vHostDataHygiene,
  vHostDurableHistoryStats,
  vHostPersistenceStats,
  vHostStreamArgs,
  vHostSyncRuntimeOptions,
  type CodexHostComponentsInput,
  type HostActorContext,
  type HostQueryRunner,
} from "./convexSlice.js";
import { classifyThreadReadError, type ThreadReadMissingError } from "../errors.js";
import { buildPresetMutations } from "./convexPresetMutations.js";
import { resolveHostComponentRefs } from "./generatedTypingBoundary.js";
import { HOST_SURFACE_MANIFEST } from "./surfaceManifest.js";

export type CodexHostSliceProfile = "runtimeOwned";
export type CodexHostSliceIngestMode = "streamOnly" | "mixed";

export type CodexHostSliceFeatures = {
  hooks?: boolean;
  approvals?: boolean;
  serverRequests?: boolean;
  reasoning?: boolean;
  hygiene?: boolean;
  tokenUsage?: boolean;
};

export type DefineCodexHostSliceOptions<
  Components extends CodexHostComponentsInput = CodexHostComponentsInput,
> = {
  components: Components;
  serverActor: HostActorContext;
  profile: CodexHostSliceProfile;
  ingestMode: CodexHostSliceIngestMode;
  features?: CodexHostSliceFeatures;
};

function withServerActor<T extends { actor: HostActorContext }>(args: T, serverActor: HostActorContext): T {
  // When the server actor has no userId (runtime-owned profiles), preserve the
  // request actor so data is scoped to the authenticated user rather than the
  // anonymous scope.
  const actor = serverActor.userId ? serverActor : { ...serverActor, ...args.actor };
  return { ...args, actor };
}

function resolveServerActor(
  args: { actor: HostActorContext },
  fallback: HostActorContext,
): HostActorContext {
  return args.actor.userId === undefined ? fallback : args.actor;
}

function withThreadStatusOk<T extends object>(result: T): T & { threadStatus: "ok" } {
  return { ...result, threadStatus: "ok" };
}

function missingThreadPayload(error: unknown): ThreadReadMissingError | null {
  return classifyThreadReadError(error);
}

export function defineCodexHostSlice<Components extends CodexHostComponentsInput>(
  options: DefineCodexHostSliceOptions<Components>,
) {
  const features: Required<CodexHostSliceFeatures> = {
    hooks: options.features?.hooks ?? true,
    approvals: options.features?.approvals ?? true,
    serverRequests: options.features?.serverRequests ?? true,
    reasoning: options.features?.reasoning ?? true,
    hygiene: options.features?.hygiene ?? true,
    tokenUsage: options.features?.tokenUsage ?? true,
  };

  const component = resolveHostComponentRefs(options.components);

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

      const runCheck = async (name: string, fn: () => Promise<void>) => {
        try {
          await fn();
          checks.push({ name, ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isExpectedPreflightError(message)) {
            checks.push({ name, ok: true });
            return;
          }
          checks.push({ name, ok: false, error: message });
        }
      };

      await runCheck("threads.getState", () =>
        ctx.runQuery(component.threads.getState, {
          actor: resolveServerActor(args, options.serverActor),
          threadId: checkThreadId,
        }),
      );
      await runCheck("messages.listByThread", () =>
        ctx.runQuery(component.messages.listByThread, {
          actor: resolveServerActor(args, options.serverActor),
          threadId: checkThreadId,
          paginationOpts: { cursor: null, numItems: 1 },
        }),
      );
      await runCheck("messages.getByTurn", () =>
        ctx.runQuery(component.messages.getByTurn, {
          actor: resolveServerActor(args, options.serverActor),
          threadId: checkThreadId,
          turnId: checkTurnId,
        }),
      );
      if (features.approvals) {
        await runCheck("approvals.listPending", () =>
          ctx.runQuery(component.approvals.listPending, {
            actor: resolveServerActor(args, options.serverActor),
            paginationOpts: { cursor: null, numItems: 1 },
          }),
        );
      }
      if (features.reasoning) {
        await runCheck("reasoning.listByThread", () =>
          ctx.runQuery(component.reasoning.listByThread, {
            actor: resolveServerActor(args, options.serverActor),
            threadId: checkThreadId,
            paginationOpts: { cursor: null, numItems: 1 },
            includeRaw: false,
          }),
        );
      }
      if (features.serverRequests) {
        await runCheck("serverRequests.listPending", () =>
          ctx.runQuery(component.serverRequests.listPending, {
            actor: resolveServerActor(args, options.serverActor),
            limit: 1,
          }),
        );
      }

      return { ok: checks.every((check) => check.ok), checks };
    },
  };

  const mutations = buildPresetMutations({
    component,
    serverActor: options.serverActor,
    ingestMode: options.ingestMode,
    features,
  });

  const queries = {
    validateHostWiring,
    threadSnapshot: {
      args: { actor: vHostActorContext, threadId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) => {
        try {
          const snapshot = await threadSnapshot(
            ctx,
            component,
            withServerActor(args, resolveServerActor(args, options.serverActor)),
          );
          return {
            threadStatus: "ok" as const,
            data: snapshot,
          };
        } catch (error) {
          const missing = missingThreadPayload(error);
          if (missing) {
            return missing;
          }
          throw error;
        }
      },
    },
    threadSnapshotStrict: {
      args: { actor: vHostActorContext, threadId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) =>
        threadSnapshot(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
    },
    threadSnapshotSafe: {
      args: { actor: vHostActorContext, threadId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) =>
        threadSnapshotSafe(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
    },
    getDeletionStatus: {
      args: { actor: vHostActorContext, deletionJobId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; deletionJobId: string }) =>
        ctx.runQuery(
          component.threads.getDeletionJobStatus,
          withServerActor(args, resolveServerActor(args, options.serverActor)),
        ),
    },
    persistenceStats: {
      args: { actor: vHostActorContext, threadId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) => {
        try {
          return withThreadStatusOk(
            await persistenceStats(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
          );
        } catch (error) {
          const missing = missingThreadPayload(error);
          if (missing) {
            return {
              ...missing,
              streamCount: 0,
              deltaCount: 0,
              latestCursorByStream: [],
            };
          }
          throw error;
        }
      },
    },
    persistenceStatsStrict: {
      args: { actor: vHostActorContext, threadId: v.string() },
      returns: vHostPersistenceStats,
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) =>
        persistenceStats(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
    },
    durableHistoryStats: {
      args: { actor: vHostActorContext, threadId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) => {
        try {
          return withThreadStatusOk(
            await durableHistoryStats(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
          );
        } catch (error) {
          const missing = missingThreadPayload(error);
          if (missing) {
            return {
              ...missing,
              messageCountInPage: 0,
              latest: [],
            };
          }
          throw error;
        }
      },
    },
    durableHistoryStatsStrict: {
      args: { actor: vHostActorContext, threadId: v.string() },
      returns: vHostDurableHistoryStats,
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) =>
        durableHistoryStats(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
    },
    ...(features.hygiene
      ? {
          dataHygiene: {
            args: { actor: vHostActorContext, threadId: v.string() },
            handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) => {
              try {
                return withThreadStatusOk(
                  await dataHygiene(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
                );
              } catch (error) {
                const missing = missingThreadPayload(error);
                if (missing) {
                  return {
                    ...missing,
                    scannedStreamStats: 0,
                    streamStatOrphans: 0,
                    orphanStreamIds: [],
                  };
                }
                throw error;
              }
            },
          },
          dataHygieneStrict: {
            args: { actor: vHostActorContext, threadId: v.string() },
            returns: vHostDataHygiene,
            handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) =>
              dataHygiene(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
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
                streamArgs?: { kind: "list"; startOrder?: number } | { kind: "deltas"; cursors: Array<{ streamId: string; cursor: number }> };
                runtime?: { saveStreamDeltas?: boolean; saveReasoningDeltas?: boolean; exposeRawReasoningDeltas?: boolean; maxDeltasPerStreamRead?: number; maxDeltasPerRequestRead?: number; finishedStreamDeleteDelayMs?: number };
              },
            ) => {
              try {
                return withThreadStatusOk(
                  await listThreadMessagesForHooksForActor(
                    ctx,
                    component,
                    withServerActor(args, resolveServerActor(args, options.serverActor)),
                  ),
                );
              } catch (error) {
                const missing = missingThreadPayload(error);
                if (missing) {
                  const streams =
                    args.streamArgs?.kind === "deltas"
                      ? {
                          kind: "deltas" as const,
                          streams: [],
                          deltas: [],
                          streamWindows: [],
                          nextCheckpoints: [],
                        }
                      : args.streamArgs?.kind === "list"
                        ? {
                            kind: "list" as const,
                            streams: [],
                          }
                        : undefined;
                  return {
                    ...missing,
                    page: [],
                    isDone: true,
                    continueCursor: args.paginationOpts.cursor ?? "",
                    ...(streams ? { streams } : {}),
                  };
                }
                throw error;
              }
            },
          },
          listThreadMessagesForHooksStrict: {
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
                streamArgs?: { kind: "list"; startOrder?: number } | { kind: "deltas"; cursors: Array<{ streamId: string; cursor: number }> };
                runtime?: { saveStreamDeltas?: boolean; saveReasoningDeltas?: boolean; exposeRawReasoningDeltas?: boolean; maxDeltasPerStreamRead?: number; maxDeltasPerRequestRead?: number; finishedStreamDeleteDelayMs?: number };
              },
            ) => listThreadMessagesForHooksForActor(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
          },
          listTurnMessagesForHooks: {
            args: { actor: vHostActorContext, threadId: v.string(), turnId: v.string() },
            handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string; turnId: string }) => {
              try {
                return {
                  threadStatus: "ok" as const,
                  data: await listTurnMessagesForHooksForActor(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
                };
              } catch (error) {
                const missing = missingThreadPayload(error);
                if (missing) {
                  return {
                    ...missing,
                    data: [],
                  };
                }
                throw error;
              }
            },
          },
          listTurnMessagesForHooksStrict: {
            args: { actor: vHostActorContext, threadId: v.string(), turnId: v.string() },
            handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string; turnId: string }) =>
              listTurnMessagesForHooksForActor(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
          },
        }
      : {}),
    ...(features.reasoning
      ? {
          listThreadReasoningForHooks: {
            args: { actor: vHostActorContext, threadId: v.string(), paginationOpts: paginationOptsValidator, includeRaw: v.optional(v.boolean()) },
            handler: async (
              ctx: HostQueryRunner,
              args: { actor: HostActorContext; threadId: string; paginationOpts: { cursor: string | null; numItems: number }; includeRaw?: boolean },
            ) => {
              try {
                return withThreadStatusOk(
                  await listThreadReasoningForHooksForActor(
                    ctx,
                    component,
                    withServerActor(args, resolveServerActor(args, options.serverActor)),
                  ),
                );
              } catch (error) {
                const missing = missingThreadPayload(error);
                if (missing) {
                  return {
                    ...missing,
                    page: [],
                    isDone: true,
                    continueCursor: args.paginationOpts.cursor ?? "",
                  };
                }
                throw error;
              }
            },
          },
          listThreadReasoningForHooksStrict: {
            args: { actor: vHostActorContext, threadId: v.string(), paginationOpts: paginationOptsValidator, includeRaw: v.optional(v.boolean()) },
            handler: async (
              ctx: HostQueryRunner,
              args: { actor: HostActorContext; threadId: string; paginationOpts: { cursor: string | null; numItems: number }; includeRaw?: boolean },
            ) => listThreadReasoningForHooksForActor(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
          },
        }
      : {}),
    ...(features.approvals
      ? {
          listPendingApprovalsForHooks: {
            args: { actor: vHostActorContext, threadId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
            handler: async (
              ctx: HostQueryRunner,
              args: { actor: HostActorContext; threadId?: string; paginationOpts: { cursor: string | null; numItems: number } },
            ) => listPendingApprovalsForHooksForActor(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
          },
        }
      : {}),
    ...(features.serverRequests
      ? {
          listPendingServerRequestsForHooks: {
            args: { actor: vHostActorContext, threadId: v.optional(v.string()), limit: v.optional(v.number()) },
            handler: async (
              ctx: HostQueryRunner,
              args: { actor: HostActorContext; threadId?: string; limit?: number },
            ) => listPendingServerRequestsForHooksForActor(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
          },
        }
      : {}),
    ...(features.tokenUsage
      ? {
          listTokenUsageForHooks: {
            args: { actor: vHostActorContext, threadId: v.string() },
            handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) =>
              listTokenUsageForHooksForActor(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
          },
        }
      : {}),
  };

  return { profile: options.profile, mutations, queries };
}

type CodexHostSliceDefinitions = ReturnType<typeof defineCodexHostSlice>;

type RuntimeOwnedMutationKeys = (typeof HOST_SURFACE_MANIFEST.runtimeOwned.mutations)[number];
type RuntimeOwnedQueryKeys = (typeof HOST_SURFACE_MANIFEST.runtimeOwned.queries)[number];

type RuntimeOwnedInternalDefinitions = {
  profile: "runtimeOwned";
  mutations: {
    ensureThread: CodexHostSliceDefinitions["mutations"]["ensureThread"];
    ensureSession: CodexHostSliceDefinitions["mutations"]["ensureSession"];
    ingestEvent: CodexHostSliceDefinitions["mutations"]["ingestEvent"];
    ingestBatch: CodexHostSliceDefinitions["mutations"]["ingestBatch"];
    deleteThread: CodexHostSliceDefinitions["mutations"]["deleteThread"];
    scheduleDeleteThread: CodexHostSliceDefinitions["mutations"]["scheduleDeleteThread"];
    deleteTurn: CodexHostSliceDefinitions["mutations"]["deleteTurn"];
    scheduleDeleteTurn: CodexHostSliceDefinitions["mutations"]["scheduleDeleteTurn"];
    purgeActorData: CodexHostSliceDefinitions["mutations"]["purgeActorData"];
    schedulePurgeActorData: CodexHostSliceDefinitions["mutations"]["schedulePurgeActorData"];
    cancelDeletion: CodexHostSliceDefinitions["mutations"]["cancelDeletion"];
    forceRunDeletion: CodexHostSliceDefinitions["mutations"]["forceRunDeletion"];
    respondApprovalForHooks: NonNullable<CodexHostSliceDefinitions["mutations"]["respondApprovalForHooks"]>;
    upsertTokenUsageForHooks: NonNullable<CodexHostSliceDefinitions["mutations"]["upsertTokenUsageForHooks"]>;
    interruptTurnForHooks: NonNullable<CodexHostSliceDefinitions["mutations"]["interruptTurnForHooks"]>;
    upsertPendingServerRequestForHooks: NonNullable<CodexHostSliceDefinitions["mutations"]["upsertPendingServerRequestForHooks"]>;
    resolvePendingServerRequestForHooks: NonNullable<CodexHostSliceDefinitions["mutations"]["resolvePendingServerRequestForHooks"]>;
    acceptTurnSendForHooks: CodexHostSliceDefinitions["mutations"]["acceptTurnSendForHooks"];
    failAcceptedTurnSendForHooks: CodexHostSliceDefinitions["mutations"]["failAcceptedTurnSendForHooks"];
  };
  queries: {
    validateHostWiring: CodexHostSliceDefinitions["queries"]["validateHostWiring"];
    threadSnapshot: CodexHostSliceDefinitions["queries"]["threadSnapshot"];
    threadSnapshotStrict: CodexHostSliceDefinitions["queries"]["threadSnapshotStrict"];
    threadSnapshotSafe: CodexHostSliceDefinitions["queries"]["threadSnapshotSafe"];
    getDeletionStatus: CodexHostSliceDefinitions["queries"]["getDeletionStatus"];
    persistenceStats: CodexHostSliceDefinitions["queries"]["persistenceStats"];
    persistenceStatsStrict: CodexHostSliceDefinitions["queries"]["persistenceStatsStrict"];
    durableHistoryStats: CodexHostSliceDefinitions["queries"]["durableHistoryStats"];
    durableHistoryStatsStrict: CodexHostSliceDefinitions["queries"]["durableHistoryStatsStrict"];
    dataHygiene: NonNullable<CodexHostSliceDefinitions["queries"]["dataHygiene"]>;
    dataHygieneStrict: NonNullable<CodexHostSliceDefinitions["queries"]["dataHygieneStrict"]>;
    listThreadMessagesForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listThreadMessagesForHooks"]>;
    listThreadMessagesForHooksStrict: NonNullable<CodexHostSliceDefinitions["queries"]["listThreadMessagesForHooksStrict"]>;
    listTurnMessagesForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listTurnMessagesForHooks"]>;
    listTurnMessagesForHooksStrict: NonNullable<CodexHostSliceDefinitions["queries"]["listTurnMessagesForHooksStrict"]>;
    listPendingApprovalsForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listPendingApprovalsForHooks"]>;
    listTokenUsageForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listTokenUsageForHooks"]>;
    listPendingServerRequestsForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listPendingServerRequestsForHooks"]>;
    listThreadReasoningForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listThreadReasoningForHooks"]>;
    listThreadReasoningForHooksStrict: NonNullable<CodexHostSliceDefinitions["queries"]["listThreadReasoningForHooksStrict"]>;
  };
};

export type RuntimeOwnedHostDefinitions = {
  profile: "runtimeOwned";
  mutations: {
    ensureThread: RuntimeOwnedInternalDefinitions["mutations"]["ensureThread"];
    ensureSession: RuntimeOwnedInternalDefinitions["mutations"]["ensureSession"];
    ingestEvent: RuntimeOwnedInternalDefinitions["mutations"]["ingestEvent"];
    ingestBatch: RuntimeOwnedInternalDefinitions["mutations"]["ingestBatch"];
    deleteThread: RuntimeOwnedInternalDefinitions["mutations"]["deleteThread"];
    scheduleDeleteThread: RuntimeOwnedInternalDefinitions["mutations"]["scheduleDeleteThread"];
    deleteTurn: RuntimeOwnedInternalDefinitions["mutations"]["deleteTurn"];
    scheduleDeleteTurn: RuntimeOwnedInternalDefinitions["mutations"]["scheduleDeleteTurn"];
    purgeActorData: RuntimeOwnedInternalDefinitions["mutations"]["purgeActorData"];
    schedulePurgeActorData: RuntimeOwnedInternalDefinitions["mutations"]["schedulePurgeActorData"];
    cancelDeletion: RuntimeOwnedInternalDefinitions["mutations"]["cancelDeletion"];
    forceRunDeletion: RuntimeOwnedInternalDefinitions["mutations"]["forceRunDeletion"];
    respondApproval: RuntimeOwnedInternalDefinitions["mutations"]["respondApprovalForHooks"];
    upsertTokenUsage: RuntimeOwnedInternalDefinitions["mutations"]["upsertTokenUsageForHooks"];
    interruptTurn: RuntimeOwnedInternalDefinitions["mutations"]["interruptTurnForHooks"];
    upsertPendingServerRequest: RuntimeOwnedInternalDefinitions["mutations"]["upsertPendingServerRequestForHooks"];
    resolvePendingServerRequest: RuntimeOwnedInternalDefinitions["mutations"]["resolvePendingServerRequestForHooks"];
    acceptTurnSend: RuntimeOwnedInternalDefinitions["mutations"]["acceptTurnSendForHooks"];
    failAcceptedTurnSend: RuntimeOwnedInternalDefinitions["mutations"]["failAcceptedTurnSendForHooks"];
  };
  queries: {
    validateHostWiring: RuntimeOwnedInternalDefinitions["queries"]["validateHostWiring"];
    threadSnapshot: RuntimeOwnedInternalDefinitions["queries"]["threadSnapshot"];
    threadSnapshotStrict: RuntimeOwnedInternalDefinitions["queries"]["threadSnapshotStrict"];
    threadSnapshotSafe: RuntimeOwnedInternalDefinitions["queries"]["threadSnapshotSafe"];
    getDeletionStatus: RuntimeOwnedInternalDefinitions["queries"]["getDeletionStatus"];
    persistenceStats: RuntimeOwnedInternalDefinitions["queries"]["persistenceStats"];
    persistenceStatsStrict: RuntimeOwnedInternalDefinitions["queries"]["persistenceStatsStrict"];
    durableHistoryStats: RuntimeOwnedInternalDefinitions["queries"]["durableHistoryStats"];
    durableHistoryStatsStrict: RuntimeOwnedInternalDefinitions["queries"]["durableHistoryStatsStrict"];
    dataHygiene: RuntimeOwnedInternalDefinitions["queries"]["dataHygiene"];
    dataHygieneStrict: RuntimeOwnedInternalDefinitions["queries"]["dataHygieneStrict"];
    listThreadMessages: RuntimeOwnedInternalDefinitions["queries"]["listThreadMessagesForHooks"];
    listThreadMessagesStrict: RuntimeOwnedInternalDefinitions["queries"]["listThreadMessagesForHooksStrict"];
    listTurnMessages: RuntimeOwnedInternalDefinitions["queries"]["listTurnMessagesForHooks"];
    listTurnMessagesStrict: RuntimeOwnedInternalDefinitions["queries"]["listTurnMessagesForHooksStrict"];
    listPendingApprovals: RuntimeOwnedInternalDefinitions["queries"]["listPendingApprovalsForHooks"];
    listTokenUsage: RuntimeOwnedInternalDefinitions["queries"]["listTokenUsageForHooks"];
    listPendingServerRequests: RuntimeOwnedInternalDefinitions["queries"]["listPendingServerRequestsForHooks"];
    listThreadReasoning: RuntimeOwnedInternalDefinitions["queries"]["listThreadReasoningForHooks"];
    listThreadReasoningStrict: RuntimeOwnedInternalDefinitions["queries"]["listThreadReasoningForHooksStrict"];
  };
};

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

type _RuntimeOwnedMutationKeysMatchManifest = Assert<
  IsEqual<keyof RuntimeOwnedHostDefinitions["mutations"], RuntimeOwnedMutationKeys>
>;
type _RuntimeOwnedQueryKeysMatchManifest = Assert<
  IsEqual<keyof RuntimeOwnedHostDefinitions["queries"], RuntimeOwnedQueryKeys>
>;

export type DefineCodexHostDefinitionsOptions<
  Components extends CodexHostComponentsInput = CodexHostComponentsInput,
> = {
  components: Components;
};

export type CodexHostDefinitions = RuntimeOwnedHostDefinitions;

function toPublicRuntimeOwnedDefinitions(
  defs: RuntimeOwnedInternalDefinitions,
): RuntimeOwnedHostDefinitions {
  return {
    profile: defs.profile,
    mutations: {
      ensureThread: defs.mutations.ensureThread,
      ensureSession: defs.mutations.ensureSession,
      ingestEvent: defs.mutations.ingestEvent,
      ingestBatch: defs.mutations.ingestBatch,
      deleteThread: defs.mutations.deleteThread,
      scheduleDeleteThread: defs.mutations.scheduleDeleteThread,
      deleteTurn: defs.mutations.deleteTurn,
      scheduleDeleteTurn: defs.mutations.scheduleDeleteTurn,
      purgeActorData: defs.mutations.purgeActorData,
      schedulePurgeActorData: defs.mutations.schedulePurgeActorData,
      cancelDeletion: defs.mutations.cancelDeletion,
      forceRunDeletion: defs.mutations.forceRunDeletion,
      respondApproval: defs.mutations.respondApprovalForHooks,
      upsertTokenUsage: defs.mutations.upsertTokenUsageForHooks,
      interruptTurn: defs.mutations.interruptTurnForHooks,
      upsertPendingServerRequest: defs.mutations.upsertPendingServerRequestForHooks,
      resolvePendingServerRequest: defs.mutations.resolvePendingServerRequestForHooks,
      acceptTurnSend: defs.mutations.acceptTurnSendForHooks,
      failAcceptedTurnSend: defs.mutations.failAcceptedTurnSendForHooks,
    },
    queries: {
      validateHostWiring: defs.queries.validateHostWiring,
      threadSnapshot: defs.queries.threadSnapshot,
      threadSnapshotStrict: defs.queries.threadSnapshotStrict,
      threadSnapshotSafe: defs.queries.threadSnapshotSafe,
      getDeletionStatus: defs.queries.getDeletionStatus,
      persistenceStats: defs.queries.persistenceStats,
      persistenceStatsStrict: defs.queries.persistenceStatsStrict,
      durableHistoryStats: defs.queries.durableHistoryStats,
      durableHistoryStatsStrict: defs.queries.durableHistoryStatsStrict,
      dataHygiene: defs.queries.dataHygiene,
      dataHygieneStrict: defs.queries.dataHygieneStrict,
      listThreadMessages: defs.queries.listThreadMessagesForHooks,
      listThreadMessagesStrict: defs.queries.listThreadMessagesForHooksStrict,
      listTurnMessages: defs.queries.listTurnMessagesForHooks,
      listTurnMessagesStrict: defs.queries.listTurnMessagesForHooksStrict,
      listPendingApprovals: defs.queries.listPendingApprovalsForHooks,
      listTokenUsage: defs.queries.listTokenUsageForHooks,
      listPendingServerRequests: defs.queries.listPendingServerRequestsForHooks,
      listThreadReasoning: defs.queries.listThreadReasoningForHooks,
      listThreadReasoningStrict: defs.queries.listThreadReasoningForHooksStrict,
    },
  };
}

function requireHostDefinition<Definition>(
  definition: Definition | undefined,
  key: string,
): Definition {
  if (definition === undefined) {
    throw new Error(`Missing required host definition: ${key}`);
  }
  return definition;
}

function toRuntimeOwnedInternalDefinitions(
  rawSlice: CodexHostSliceDefinitions,
): RuntimeOwnedInternalDefinitions {
  return {
    profile: "runtimeOwned",
    mutations: {
      ensureThread: rawSlice.mutations.ensureThread,
      ensureSession: rawSlice.mutations.ensureSession,
      ingestEvent: rawSlice.mutations.ingestEvent,
      ingestBatch: rawSlice.mutations.ingestBatch,
      deleteThread: rawSlice.mutations.deleteThread,
      scheduleDeleteThread: rawSlice.mutations.scheduleDeleteThread,
      deleteTurn: rawSlice.mutations.deleteTurn,
      scheduleDeleteTurn: rawSlice.mutations.scheduleDeleteTurn,
      purgeActorData: rawSlice.mutations.purgeActorData,
      schedulePurgeActorData: rawSlice.mutations.schedulePurgeActorData,
      cancelDeletion: rawSlice.mutations.cancelDeletion,
      forceRunDeletion: rawSlice.mutations.forceRunDeletion,
      respondApprovalForHooks: requireHostDefinition(rawSlice.mutations.respondApprovalForHooks, "respondApprovalForHooks"),
      upsertTokenUsageForHooks: requireHostDefinition(rawSlice.mutations.upsertTokenUsageForHooks, "upsertTokenUsageForHooks"),
      interruptTurnForHooks: requireHostDefinition(rawSlice.mutations.interruptTurnForHooks, "interruptTurnForHooks"),
      upsertPendingServerRequestForHooks: requireHostDefinition(rawSlice.mutations.upsertPendingServerRequestForHooks, "upsertPendingServerRequestForHooks"),
      resolvePendingServerRequestForHooks: requireHostDefinition(rawSlice.mutations.resolvePendingServerRequestForHooks, "resolvePendingServerRequestForHooks"),
      acceptTurnSendForHooks: rawSlice.mutations.acceptTurnSendForHooks,
      failAcceptedTurnSendForHooks: rawSlice.mutations.failAcceptedTurnSendForHooks,
    },
    queries: {
      validateHostWiring: rawSlice.queries.validateHostWiring,
      threadSnapshot: rawSlice.queries.threadSnapshot,
      threadSnapshotStrict: rawSlice.queries.threadSnapshotStrict,
      threadSnapshotSafe: rawSlice.queries.threadSnapshotSafe,
      getDeletionStatus: rawSlice.queries.getDeletionStatus,
      persistenceStats: rawSlice.queries.persistenceStats,
      persistenceStatsStrict: rawSlice.queries.persistenceStatsStrict,
      durableHistoryStats: rawSlice.queries.durableHistoryStats,
      durableHistoryStatsStrict: rawSlice.queries.durableHistoryStatsStrict,
      dataHygiene: requireHostDefinition(rawSlice.queries.dataHygiene, "dataHygiene"),
      dataHygieneStrict: requireHostDefinition(rawSlice.queries.dataHygieneStrict, "dataHygieneStrict"),
      listThreadMessagesForHooks: requireHostDefinition(rawSlice.queries.listThreadMessagesForHooks, "listThreadMessagesForHooks"),
      listThreadMessagesForHooksStrict: requireHostDefinition(rawSlice.queries.listThreadMessagesForHooksStrict, "listThreadMessagesForHooksStrict"),
      listTurnMessagesForHooks: requireHostDefinition(rawSlice.queries.listTurnMessagesForHooks, "listTurnMessagesForHooks"),
      listTurnMessagesForHooksStrict: requireHostDefinition(rawSlice.queries.listTurnMessagesForHooksStrict, "listTurnMessagesForHooksStrict"),
      listPendingApprovalsForHooks: requireHostDefinition(rawSlice.queries.listPendingApprovalsForHooks, "listPendingApprovalsForHooks"),
      listTokenUsageForHooks: requireHostDefinition(rawSlice.queries.listTokenUsageForHooks, "listTokenUsageForHooks"),
      listPendingServerRequestsForHooks: requireHostDefinition(rawSlice.queries.listPendingServerRequestsForHooks, "listPendingServerRequestsForHooks"),
      listThreadReasoningForHooks: requireHostDefinition(rawSlice.queries.listThreadReasoningForHooks, "listThreadReasoningForHooks"),
      listThreadReasoningForHooksStrict: requireHostDefinition(rawSlice.queries.listThreadReasoningForHooksStrict, "listThreadReasoningForHooksStrict"),
    },
  };
}

const RUNTIME_OWNED_DEFAULT_FEATURES: Required<CodexHostSliceFeatures> = {
  hooks: true,
  approvals: true,
  serverRequests: true,
  reasoning: true,
  hygiene: true,
  tokenUsage: true,
};

export function defineCodexHostDefinitions<
  Components extends CodexHostComponentsInput,
>(
  options: DefineCodexHostDefinitionsOptions<Components>,
): CodexHostDefinitions {
  const rawSlice = defineCodexHostSlice<Components>({
    components: options.components,
    serverActor: {},
    profile: "runtimeOwned",
    ingestMode: "streamOnly",
    features: RUNTIME_OWNED_DEFAULT_FEATURES,
  });
  return toPublicRuntimeOwnedDefinitions(
    toRuntimeOwnedInternalDefinitions(rawSlice),
  );
}
