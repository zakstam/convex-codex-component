import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  dataHygiene,
  durableHistoryStats,
  getConversationSyncJobForActor,
  listConversationSyncJobsForActor,
  listPendingApprovalsForHooksForActor,
  listPendingServerRequestsForHooksForActor,
  listTokenUsageForHooksForActor,
  listThreadMessagesForHooksForActor,
  resolveThreadByConversationIdForActor,
  listThreadReasoningForHooksForActor,
  listTurnMessagesForHooksForActor,
  persistenceStats,
  threadSnapshot,
  vHostActorContext,
  vHostStreamArgs,
  vHostSyncRuntimeOptions,
  type CodexHostComponentsInput,
  type HostActorContext,
  type HostQueryRunner,
} from "../convexSlice.js";
import { classifyThreadReadError, type ThreadReadSafeError } from "@zakstam/codex-runtime";
import { resolveHostActor, withResolvedHostActor } from "./actorResolution.js";
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
  Components extends CodexHostComponentsInput<object> = CodexHostComponentsInput<object>,
> = {
  components: Components;
  serverActor: HostActorContext;
  profile: CodexHostSliceProfile;
  ingestMode: CodexHostSliceIngestMode;
  features?: CodexHostSliceFeatures;
};

function withThreadStatusOk<T extends object>(result: T): T & { threadStatus: "ok" } {
  return { ...result, threadStatus: "ok" };
}

function missingThreadPayload(error: unknown): ThreadReadSafeError | null {
  return classifyThreadReadError(error);
}

function missingThreadPayloadFromConversationId(conversationId: string): ThreadReadSafeError {
  return {
    threadStatus: "missing_thread",
    code: "E_THREAD_NOT_FOUND",
    message: `[E_THREAD_NOT_FOUND] Thread not found: ${conversationId}`,
  };
}

export function defineCodexHostSlice<Components extends CodexHostComponentsInput<object>>(
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
      conversationId: v.optional(v.string()),
    },
    handler: async (
      ctx: HostQueryRunner,
      args: { actor: HostActorContext; conversationId?: string },
    ) => {
      const checkThreadId = args.conversationId ?? "__codex_host_wiring_preflight__";
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
          actor: resolveHostActor(args.actor, options.serverActor),
          threadId: checkThreadId,
        }),
      );
      await runCheck("messages.listByThread", () =>
        ctx.runQuery(component.messages.listByThread, {
          actor: resolveHostActor(args.actor, options.serverActor),
          threadId: checkThreadId,
          paginationOpts: { cursor: null, numItems: 1 },
        }),
      );
      await runCheck("messages.getByTurn", () =>
        ctx.runQuery(component.messages.getByTurn, {
          actor: resolveHostActor(args.actor, options.serverActor),
          threadId: checkThreadId,
          turnId: checkTurnId,
        }),
      );
      if (features.approvals) {
        await runCheck("approvals.listPending", () =>
          ctx.runQuery(component.approvals.listPending, {
            actor: resolveHostActor(args.actor, options.serverActor),
            paginationOpts: { cursor: null, numItems: 1 },
          }),
        );
      }
      if (features.reasoning) {
        await runCheck("reasoning.listByThread", () =>
          ctx.runQuery(component.reasoning.listByThread, {
            actor: resolveHostActor(args.actor, options.serverActor),
            threadId: checkThreadId,
            paginationOpts: { cursor: null, numItems: 1 },
            includeRaw: false,
          }),
        );
      }
      if (features.serverRequests) {
        await runCheck("serverRequests.listPending", () =>
          ctx.runQuery(component.serverRequests.listPending, {
            actor: resolveHostActor(args.actor, options.serverActor),
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

  const resolveThreadIdByConversationId = async (
    ctx: HostQueryRunner,
    args: { actor: HostActorContext; conversationId: string },
  ) => {
    const mapping = await resolveThreadByConversationIdForActor(
      ctx,
      component,
      withResolvedHostActor(args, options.serverActor),
    );
    if (mapping === null) {
      return null;
    }
    return mapping.threadId;
  };

  const queries = {
    validateHostWiring,
    getConversationSyncJob: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        jobId: v.optional(v.string()),
      },
      handler: async (
        ctx: HostQueryRunner,
        args: { actor: HostActorContext; conversationId: string; jobId?: string },
      ) =>
        getConversationSyncJobForActor(
          ctx,
          component,
          withResolvedHostActor(args, options.serverActor),
        ),
    },
    listConversationSyncJobs: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        limit: v.optional(v.number()),
      },
      handler: async (
        ctx: HostQueryRunner,
        args: { actor: HostActorContext; conversationId: string; limit?: number },
      ) =>
        listConversationSyncJobsForActor(
          ctx,
          component,
          withResolvedHostActor(args, options.serverActor),
        ),
    },
    threadSnapshot: {
      args: { actor: vHostActorContext, conversationId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; conversationId: string }) => {
        try {
          const threadId = await resolveThreadIdByConversationId(ctx, args);
          if (threadId === null) {
            return missingThreadPayloadFromConversationId(args.conversationId);
          }
          const snapshot = await threadSnapshot(
            ctx,
            component,
            withResolvedHostActor({ actor: args.actor, threadId }, options.serverActor),
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
    threadSnapshotByConversation: {
      args: { actor: vHostActorContext, conversationId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; conversationId: string }) => {
        const threadId = await resolveThreadIdByConversationId(ctx, args);
        if (threadId === null) {
          return missingThreadPayloadFromConversationId(args.conversationId);
        }
        try {
          const snapshot = await threadSnapshot(
            ctx,
            component,
            withResolvedHostActor({ actor: args.actor, threadId }, options.serverActor),
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
    getDeletionStatus: {
      args: { actor: vHostActorContext, deletionJobId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; deletionJobId: string }) =>
        ctx.runQuery(
          component.threads.getDeletionJobStatus,
          withResolvedHostActor(args, options.serverActor),
        ),
    },
    listThreadsForConversation: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        includeArchived: v.optional(v.boolean()),
      },
      handler: async (
        ctx: HostQueryRunner,
        args: { actor: HostActorContext; conversationId: string; includeArchived?: boolean },
      ) => {
        const listByConversation = component.threads.listByConversation;
        if (!listByConversation) {
          throw new Error("Host component is missing threads.listByConversation.");
        }
        return ctx.runQuery(
          listByConversation,
          withResolvedHostActor(
            {
              actor: args.actor,
              conversationId: args.conversationId,
              ...(args.includeArchived !== undefined ? { includeArchived: args.includeArchived } : {}),
            },
            options.serverActor,
          ),
        );
      },
    },
    persistenceStats: {
      args: { actor: vHostActorContext, conversationId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; conversationId: string }) => {
        const threadId = await resolveThreadIdByConversationId(ctx, args);
        if (threadId === null) {
          return {
            ...missingThreadPayloadFromConversationId(args.conversationId),
            streamCount: 0,
            deltaCount: 0,
            latestCursorByStream: [],
          };
        }
        try {
          return withThreadStatusOk(
            await persistenceStats(
              ctx,
              component,
              withResolvedHostActor({ actor: args.actor, threadId }, options.serverActor),
            ),
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
    durableHistoryStats: {
      args: { actor: vHostActorContext, conversationId: v.string() },
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; conversationId: string }) => {
        const threadId = await resolveThreadIdByConversationId(ctx, args);
        if (threadId === null) {
          return {
            ...missingThreadPayloadFromConversationId(args.conversationId),
            messageCountInPage: 0,
            latest: [],
          };
        }
        try {
          return withThreadStatusOk(
            await durableHistoryStats(
              ctx,
              component,
              withResolvedHostActor({ actor: args.actor, threadId }, options.serverActor),
            ),
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
    ...(features.hygiene
      ? {
          dataHygiene: {
            args: { actor: vHostActorContext, conversationId: v.string() },
            handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; conversationId: string }) => {
              const threadId = await resolveThreadIdByConversationId(ctx, args);
              if (threadId === null) {
                return {
                  ...missingThreadPayloadFromConversationId(args.conversationId),
                  scannedStreamStats: 0,
                  streamStatOrphans: 0,
                  orphanStreamIds: [],
                };
              }
              try {
                return withThreadStatusOk(
                  await dataHygiene(
                    ctx,
                    component,
                    withResolvedHostActor({ actor: args.actor, threadId }, options.serverActor),
                  ),
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
        }
      : {}),
    ...(features.hooks
      ? {
          listThreadMessagesForHooks: {
            args: {
              actor: vHostActorContext,
              conversationId: v.string(),
              paginationOpts: paginationOptsValidator,
              streamArgs: vHostStreamArgs,
              runtime: v.optional(vHostSyncRuntimeOptions),
            },
            handler: async (
              ctx: HostQueryRunner,
              args: {
                actor: HostActorContext;
                conversationId: string;
                paginationOpts: { cursor: string | null; numItems: number };
                streamArgs?: { kind: "list"; startOrder?: number } | { kind: "deltas"; cursors: Array<{ streamId: string; cursor: number }> };
                runtime?: { saveStreamDeltas?: boolean; saveReasoningDeltas?: boolean; exposeRawReasoningDeltas?: boolean; maxDeltasPerStreamRead?: number; maxDeltasPerRequestRead?: number; finishedStreamDeleteDelayMs?: number };
              },
            ) => {
              const threadId = await resolveThreadIdByConversationId(ctx, args);
              if (threadId === null) {
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
                  ...missingThreadPayloadFromConversationId(args.conversationId),
                  page: [],
                  isDone: true,
                  continueCursor: args.paginationOpts.cursor === null ? "" : args.paginationOpts.cursor,
                  ...(streams ? { streams } : {}),
                };
              }
              try {
                return withThreadStatusOk(
                  await listThreadMessagesForHooksForActor(
                    ctx,
                    component,
                    withResolvedHostActor(
                      {
                        actor: args.actor,
                        threadId,
                        paginationOpts: args.paginationOpts,
                        ...(args.streamArgs === undefined ? {} : { streamArgs: args.streamArgs }),
                        ...(args.runtime === undefined ? {} : { runtime: args.runtime }),
                      },
                      options.serverActor,
                    ),
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
          listThreadMessagesByConversation: {
            args: {
              actor: vHostActorContext,
              conversationId: v.string(),
              paginationOpts: paginationOptsValidator,
              streamArgs: vHostStreamArgs,
              runtime: v.optional(vHostSyncRuntimeOptions),
            },
            handler: async (
              ctx: HostQueryRunner,
              args: {
                actor: HostActorContext;
                conversationId: string;
                paginationOpts: { cursor: string | null; numItems: number };
                streamArgs?: { kind: "list"; startOrder?: number } | { kind: "deltas"; cursors: Array<{ streamId: string; cursor: number }> };
                runtime?: { saveStreamDeltas?: boolean; saveReasoningDeltas?: boolean; exposeRawReasoningDeltas?: boolean; maxDeltasPerStreamRead?: number; maxDeltasPerRequestRead?: number; finishedStreamDeleteDelayMs?: number };
              },
            ) => {
                const threadId = await resolveThreadIdByConversationId(ctx, args);
              if (threadId === null) {
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
                  ...missingThreadPayloadFromConversationId(args.conversationId),
                  page: [],
                  isDone: true,
                  continueCursor: args.paginationOpts.cursor === null ? "" : args.paginationOpts.cursor,
                  ...(streams ? { streams } : {}),
                };
              }
              try {
                return withThreadStatusOk(
                  await listThreadMessagesForHooksForActor(
                    ctx,
                    component,
                    withResolvedHostActor(
                      {
                        actor: args.actor,
                        threadId,
                        paginationOpts: args.paginationOpts,
                        ...(args.streamArgs === undefined ? {} : { streamArgs: args.streamArgs }),
                        ...(args.runtime === undefined ? {} : { runtime: args.runtime }),
                      },
                      options.serverActor,
                    ),
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
                    continueCursor:
                      args.paginationOpts.cursor === null ? "" : args.paginationOpts.cursor,
                    ...(streams ? { streams } : {}),
                  };
                }
                throw error;
              }
            },
          },
          listTurnMessagesForHooks: {
            args: { actor: vHostActorContext, conversationId: v.string(), turnId: v.string() },
            handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; conversationId: string; turnId: string }) => {
              const threadId = await resolveThreadIdByConversationId(ctx, args);
              if (threadId === null) {
                return {
                  ...missingThreadPayloadFromConversationId(args.conversationId),
                  data: [],
                };
              }
              try {
                return {
                  threadStatus: "ok" as const,
                  data: await listTurnMessagesForHooksForActor(
                    ctx,
                    component,
                    withResolvedHostActor({ actor: args.actor, threadId, turnId: args.turnId }, options.serverActor),
                  ),
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
          listTurnMessagesByConversation: {
            args: { actor: vHostActorContext, conversationId: v.string(), turnId: v.string() },
            handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; conversationId: string; turnId: string }) => {
              const threadId = await resolveThreadIdByConversationId(ctx, args);
              if (threadId === null) {
                return {
                  ...missingThreadPayloadFromConversationId(args.conversationId),
                  data: [],
                };
              }
              try {
                return {
                  threadStatus: "ok" as const,
                  data: await listTurnMessagesForHooksForActor(
                    ctx,
                    component,
                    withResolvedHostActor(
                      {
                        actor: args.actor,
                        threadId,
                        turnId: args.turnId,
                      },
                      options.serverActor,
                    ),
                  ),
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
        }
      : {}),
    ...(features.reasoning
      ? {
          listThreadReasoningForHooks: {
            args: { actor: vHostActorContext, conversationId: v.string(), paginationOpts: paginationOptsValidator, includeRaw: v.optional(v.boolean()) },
            handler: async (
              ctx: HostQueryRunner,
              args: { actor: HostActorContext; conversationId: string; paginationOpts: { cursor: string | null; numItems: number }; includeRaw?: boolean },
            ) => {
              const threadId = await resolveThreadIdByConversationId(ctx, args);
              if (threadId === null) {
                return {
                  ...missingThreadPayloadFromConversationId(args.conversationId),
                  page: [],
                  isDone: true,
                  continueCursor: args.paginationOpts.cursor === null ? "" : args.paginationOpts.cursor,
                };
              }
              try {
                return withThreadStatusOk(
                  await listThreadReasoningForHooksForActor(
                    ctx,
                    component,
                    withResolvedHostActor(
                      { actor: args.actor, threadId, paginationOpts: args.paginationOpts, ...(args.includeRaw === undefined ? {} : { includeRaw: args.includeRaw }) },
                      options.serverActor,
                    ),
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
        }
      : {}),
    ...(features.approvals
      ? {
          listPendingApprovalsForHooks: {
            args: { actor: vHostActorContext, threadId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
            handler: async (
              ctx: HostQueryRunner,
              args: { actor: HostActorContext; threadId?: string; paginationOpts: { cursor: string | null; numItems: number } },
            ) => listPendingApprovalsForHooksForActor(ctx, component, withResolvedHostActor(args, options.serverActor)),
          },
        }
      : {}),
    ...(features.serverRequests
      ? {
          listPendingServerRequestsForHooks: {
            args: { actor: vHostActorContext, conversationId: v.optional(v.string()), limit: v.optional(v.number()) },
            handler: async (
              ctx: HostQueryRunner,
              args: { actor: HostActorContext; conversationId?: string; limit?: number },
            ) => {
              try {
                const threadId = args.conversationId
                  ? await resolveThreadIdByConversationId(ctx, { actor: args.actor, conversationId: args.conversationId })
                  : null;
                if (args.conversationId && threadId === null) {
                  return [];
                }
                return await listPendingServerRequestsForHooksForActor(
                  ctx,
                  component,
                  withResolvedHostActor(
                    {
                      actor: args.actor,
                      ...(threadId ? { threadId } : {}),
                      ...(args.limit === undefined ? {} : { limit: args.limit }),
                    },
                    options.serverActor,
                  ),
                );
              } catch (error) {
                if (missingThreadPayload(error)) {
                  return [];
                }
                throw error;
              }
            }
          },
          listPendingServerRequestsByConversation: {
            args: { actor: vHostActorContext, conversationId: v.string(), limit: v.optional(v.number()) },
            handler: async (
              ctx: HostQueryRunner,
              args: { actor: HostActorContext; conversationId: string; limit?: number },
            ) => {
              const threadId = await resolveThreadIdByConversationId(ctx, args);
              if (threadId === null) {
                return [];
              }
              try {
                return await listPendingServerRequestsForHooksForActor(
                  ctx,
                  component,
                  withResolvedHostActor(
                    {
                      actor: args.actor,
                      threadId,
                      ...(args.limit === undefined ? {} : { limit: args.limit }),
                    },
                    options.serverActor,
                  ),
                );
              } catch (error) {
                if (missingThreadPayload(error)) {
                  return [];
                }
                throw error;
              }
            },
          },
        }
      : {}),
    ...(features.tokenUsage
      ? {
          listTokenUsageForHooks: {
            args: { actor: vHostActorContext, conversationId: v.string() },
            handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; conversationId: string }) => {
              const threadId = await resolveThreadIdByConversationId(ctx, args);
              if (!threadId) {
                return [];
              }
              return listTokenUsageForHooksForActor(
                ctx,
                component,
                withResolvedHostActor({ actor: args.actor, threadId }, options.serverActor),
              );
            },
          },
          listTokenUsageByConversation: {
            args: { actor: vHostActorContext, conversationId: v.string() },
            handler: async (
              ctx: HostQueryRunner,
              args: { actor: HostActorContext; conversationId: string },
            ) => {
              const threadId = await resolveThreadIdByConversationId(ctx, args);
              if (!threadId) {
                return [];
              }
              try {
                return await listTokenUsageForHooksForActor(
                  ctx,
                  component,
                  withResolvedHostActor(
                    { actor: args.actor, threadId },
                    options.serverActor,
                  ),
                );
              } catch (error) {
                const classified = classifyThreadReadError(error);
                if (classified?.threadStatus === "missing_thread") {
                  return [];
                }
                throw error;
              }
            },
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
    syncOpenConversationBinding: CodexHostSliceDefinitions["mutations"]["syncOpenConversationBinding"];
    markConversationSyncProgress: CodexHostSliceDefinitions["mutations"]["markConversationSyncProgress"];
    forceRebindConversationSync: CodexHostSliceDefinitions["mutations"]["forceRebindConversationSync"];
    startConversationSyncSource: CodexHostSliceDefinitions["mutations"]["startConversationSyncSource"];
    appendConversationSyncSourceChunk: CodexHostSliceDefinitions["mutations"]["appendConversationSyncSourceChunk"];
    sealConversationSyncSource: CodexHostSliceDefinitions["mutations"]["sealConversationSyncSource"];
    cancelConversationSyncJob: CodexHostSliceDefinitions["mutations"]["cancelConversationSyncJob"];
    ensureConversationBinding: CodexHostSliceDefinitions["mutations"]["ensureConversationBinding"];
    archiveConversation: CodexHostSliceDefinitions["mutations"]["archiveConversation"];
    unarchiveConversation: CodexHostSliceDefinitions["mutations"]["unarchiveConversation"];
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
    getConversationSyncJob: CodexHostSliceDefinitions["queries"]["getConversationSyncJob"];
    listConversationSyncJobs: CodexHostSliceDefinitions["queries"]["listConversationSyncJobs"];
    threadSnapshot: CodexHostSliceDefinitions["queries"]["threadSnapshot"];
    threadSnapshotByConversation: CodexHostSliceDefinitions["queries"]["threadSnapshotByConversation"];
    listThreadsForConversation: CodexHostSliceDefinitions["queries"]["listThreadsForConversation"];
    getDeletionStatus: CodexHostSliceDefinitions["queries"]["getDeletionStatus"];
    persistenceStats: CodexHostSliceDefinitions["queries"]["persistenceStats"];
    durableHistoryStats: CodexHostSliceDefinitions["queries"]["durableHistoryStats"];
    dataHygiene: NonNullable<CodexHostSliceDefinitions["queries"]["dataHygiene"]>;
    listThreadMessagesForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listThreadMessagesForHooks"]>;
    listTurnMessagesForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listTurnMessagesForHooks"]>;
    listThreadMessagesByConversation: NonNullable<CodexHostSliceDefinitions["queries"]["listThreadMessagesByConversation"]>;
    listTurnMessagesByConversation: NonNullable<CodexHostSliceDefinitions["queries"]["listTurnMessagesByConversation"]>;
    listPendingApprovalsForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listPendingApprovalsForHooks"]>;
    listPendingServerRequestsByConversation: NonNullable<CodexHostSliceDefinitions["queries"]["listPendingServerRequestsByConversation"]>;
    listTokenUsageForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listTokenUsageForHooks"]>;
    listTokenUsageByConversation: NonNullable<CodexHostSliceDefinitions["queries"]["listTokenUsageByConversation"]>;
    listPendingServerRequestsForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listPendingServerRequestsForHooks"]>;
    listThreadReasoningForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listThreadReasoningForHooks"]>;
  };
};

export type RuntimeOwnedHostDefinitions = {
  profile: "runtimeOwned";
  mutations: {
    syncOpenConversationBinding: RuntimeOwnedInternalDefinitions["mutations"]["syncOpenConversationBinding"];
    markConversationSyncProgress: RuntimeOwnedInternalDefinitions["mutations"]["markConversationSyncProgress"];
    forceRebindConversationSync: RuntimeOwnedInternalDefinitions["mutations"]["forceRebindConversationSync"];
    startConversationSyncSource: RuntimeOwnedInternalDefinitions["mutations"]["startConversationSyncSource"];
    appendConversationSyncSourceChunk: RuntimeOwnedInternalDefinitions["mutations"]["appendConversationSyncSourceChunk"];
    sealConversationSyncSource: RuntimeOwnedInternalDefinitions["mutations"]["sealConversationSyncSource"];
    cancelConversationSyncJob: RuntimeOwnedInternalDefinitions["mutations"]["cancelConversationSyncJob"];
    ensureConversationBinding: RuntimeOwnedInternalDefinitions["mutations"]["ensureConversationBinding"];
    archiveConversation: RuntimeOwnedInternalDefinitions["mutations"]["archiveConversation"];
    unarchiveConversation: RuntimeOwnedInternalDefinitions["mutations"]["unarchiveConversation"];
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
    getConversationSyncJob: RuntimeOwnedInternalDefinitions["queries"]["getConversationSyncJob"];
    listConversationSyncJobs: RuntimeOwnedInternalDefinitions["queries"]["listConversationSyncJobs"];
    threadSnapshotByConversation: RuntimeOwnedInternalDefinitions["queries"]["threadSnapshotByConversation"];
    listThreadsForConversation: RuntimeOwnedInternalDefinitions["queries"]["listThreadsForConversation"];
    getDeletionStatus: RuntimeOwnedInternalDefinitions["queries"]["getDeletionStatus"];
    persistenceStats: RuntimeOwnedInternalDefinitions["queries"]["persistenceStats"];
    durableHistoryStats: RuntimeOwnedInternalDefinitions["queries"]["durableHistoryStats"];
    dataHygiene: RuntimeOwnedInternalDefinitions["queries"]["dataHygiene"];
    listThreadMessagesByConversation: RuntimeOwnedInternalDefinitions["queries"]["listThreadMessagesByConversation"];
    listTurnMessagesByConversation: RuntimeOwnedInternalDefinitions["queries"]["listTurnMessagesByConversation"];
    listPendingServerRequestsByConversation: RuntimeOwnedInternalDefinitions["queries"]["listPendingServerRequestsByConversation"];
    listPendingApprovals: RuntimeOwnedInternalDefinitions["queries"]["listPendingApprovalsForHooks"];
    listTokenUsageByConversation: RuntimeOwnedInternalDefinitions["queries"]["listTokenUsageByConversation"];
    listThreadReasoningByConversation: RuntimeOwnedInternalDefinitions["queries"]["listThreadReasoningForHooks"];
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
  Components extends CodexHostComponentsInput<object> = CodexHostComponentsInput<object>,
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
      syncOpenConversationBinding: defs.mutations.syncOpenConversationBinding,
      markConversationSyncProgress: defs.mutations.markConversationSyncProgress,
      forceRebindConversationSync: defs.mutations.forceRebindConversationSync,
      startConversationSyncSource: defs.mutations.startConversationSyncSource,
      appendConversationSyncSourceChunk: defs.mutations.appendConversationSyncSourceChunk,
      sealConversationSyncSource: defs.mutations.sealConversationSyncSource,
      cancelConversationSyncJob: defs.mutations.cancelConversationSyncJob,
      ensureConversationBinding: defs.mutations.ensureConversationBinding,
      archiveConversation: defs.mutations.archiveConversation,
      unarchiveConversation: defs.mutations.unarchiveConversation,
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
      getConversationSyncJob: defs.queries.getConversationSyncJob,
      listConversationSyncJobs: defs.queries.listConversationSyncJobs,
      threadSnapshotByConversation: defs.queries.threadSnapshotByConversation,
      listThreadsForConversation: defs.queries.listThreadsForConversation,
      getDeletionStatus: defs.queries.getDeletionStatus,
      persistenceStats: defs.queries.persistenceStats,
      durableHistoryStats: defs.queries.durableHistoryStats,
      dataHygiene: defs.queries.dataHygiene,
      listThreadMessagesByConversation: defs.queries.listThreadMessagesByConversation,
      listTurnMessagesByConversation: defs.queries.listTurnMessagesByConversation,
      listPendingServerRequestsByConversation: defs.queries.listPendingServerRequestsByConversation,
      listPendingApprovals: defs.queries.listPendingApprovalsForHooks,
      listTokenUsageByConversation: defs.queries.listTokenUsageByConversation,
      listThreadReasoningByConversation: defs.queries.listThreadReasoningForHooks,
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
      syncOpenConversationBinding: rawSlice.mutations.syncOpenConversationBinding,
      markConversationSyncProgress: rawSlice.mutations.markConversationSyncProgress,
      forceRebindConversationSync: rawSlice.mutations.forceRebindConversationSync,
      startConversationSyncSource: rawSlice.mutations.startConversationSyncSource,
      appendConversationSyncSourceChunk: rawSlice.mutations.appendConversationSyncSourceChunk,
      sealConversationSyncSource: rawSlice.mutations.sealConversationSyncSource,
      cancelConversationSyncJob: rawSlice.mutations.cancelConversationSyncJob,
      ensureConversationBinding: rawSlice.mutations.ensureConversationBinding,
      archiveConversation: rawSlice.mutations.archiveConversation,
      unarchiveConversation: rawSlice.mutations.unarchiveConversation,
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
      getConversationSyncJob: requireHostDefinition(rawSlice.queries.getConversationSyncJob, "getConversationSyncJob"),
      listConversationSyncJobs: requireHostDefinition(rawSlice.queries.listConversationSyncJobs, "listConversationSyncJobs"),
      threadSnapshot: rawSlice.queries.threadSnapshot,
      threadSnapshotByConversation: requireHostDefinition(rawSlice.queries.threadSnapshotByConversation, "threadSnapshotByConversation"),
      listThreadsForConversation: requireHostDefinition(rawSlice.queries.listThreadsForConversation, "listThreadsForConversation"),
      getDeletionStatus: rawSlice.queries.getDeletionStatus,
      persistenceStats: rawSlice.queries.persistenceStats,
      durableHistoryStats: rawSlice.queries.durableHistoryStats,
      dataHygiene: requireHostDefinition(rawSlice.queries.dataHygiene, "dataHygiene"),
      listThreadMessagesForHooks: requireHostDefinition(rawSlice.queries.listThreadMessagesForHooks, "listThreadMessagesForHooks"),
      listTurnMessagesForHooks: requireHostDefinition(rawSlice.queries.listTurnMessagesForHooks, "listTurnMessagesForHooks"),
      listThreadMessagesByConversation: requireHostDefinition(rawSlice.queries.listThreadMessagesByConversation, "listThreadMessagesByConversation"),
      listTurnMessagesByConversation: requireHostDefinition(rawSlice.queries.listTurnMessagesByConversation, "listTurnMessagesByConversation"),
      listPendingApprovalsForHooks: requireHostDefinition(rawSlice.queries.listPendingApprovalsForHooks, "listPendingApprovalsForHooks"),
      listTokenUsageForHooks: requireHostDefinition(rawSlice.queries.listTokenUsageForHooks, "listTokenUsageForHooks"),
      listTokenUsageByConversation: requireHostDefinition(rawSlice.queries.listTokenUsageByConversation, "listTokenUsageByConversation"),
      listPendingServerRequestsByConversation: requireHostDefinition(rawSlice.queries.listPendingServerRequestsByConversation, "listPendingServerRequestsByConversation"),
      listPendingServerRequestsForHooks: requireHostDefinition(rawSlice.queries.listPendingServerRequestsForHooks, "listPendingServerRequestsForHooks"),
      listThreadReasoningForHooks: requireHostDefinition(rawSlice.queries.listThreadReasoningForHooks, "listThreadReasoningForHooks"),
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
  Components extends CodexHostComponentsInput<object>,
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
