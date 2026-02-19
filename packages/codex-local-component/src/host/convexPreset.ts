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
  type HostMutationRunner,
  type HostQueryRunner,
} from "./convexSlice.js";
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
      returns: vHostPersistenceStats,
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) =>
        persistenceStats(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
    },
    durableHistoryStats: {
      args: { actor: vHostActorContext, threadId: v.string() },
      returns: vHostDurableHistoryStats,
      handler: async (ctx: HostQueryRunner, args: { actor: HostActorContext; threadId: string }) =>
        durableHistoryStats(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
    },
    ...(features.hygiene
      ? {
          dataHygiene: {
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
            ) => listThreadMessagesForHooksForActor(ctx, component, withServerActor(args, resolveServerActor(args, options.serverActor))),
          },
          listTurnMessagesForHooks: {
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
    threadSnapshotSafe: CodexHostSliceDefinitions["queries"]["threadSnapshotSafe"];
    getDeletionStatus: CodexHostSliceDefinitions["queries"]["getDeletionStatus"];
    persistenceStats: CodexHostSliceDefinitions["queries"]["persistenceStats"];
    durableHistoryStats: CodexHostSliceDefinitions["queries"]["durableHistoryStats"];
    dataHygiene: NonNullable<CodexHostSliceDefinitions["queries"]["dataHygiene"]>;
    listThreadMessagesForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listThreadMessagesForHooks"]>;
    listTurnMessagesForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listTurnMessagesForHooks"]>;
    listPendingApprovalsForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listPendingApprovalsForHooks"]>;
    listTokenUsageForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listTokenUsageForHooks"]>;
    listPendingServerRequestsForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listPendingServerRequestsForHooks"]>;
    listThreadReasoningForHooks: NonNullable<CodexHostSliceDefinitions["queries"]["listThreadReasoningForHooks"]>;
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
    threadSnapshotSafe: RuntimeOwnedInternalDefinitions["queries"]["threadSnapshotSafe"];
    getDeletionStatus: RuntimeOwnedInternalDefinitions["queries"]["getDeletionStatus"];
    persistenceStats: RuntimeOwnedInternalDefinitions["queries"]["persistenceStats"];
    durableHistoryStats: RuntimeOwnedInternalDefinitions["queries"]["durableHistoryStats"];
    dataHygiene: RuntimeOwnedInternalDefinitions["queries"]["dataHygiene"];
    listThreadMessages: RuntimeOwnedInternalDefinitions["queries"]["listThreadMessagesForHooks"];
    listTurnMessages: RuntimeOwnedInternalDefinitions["queries"]["listTurnMessagesForHooks"];
    listPendingApprovals: RuntimeOwnedInternalDefinitions["queries"]["listPendingApprovalsForHooks"];
    listTokenUsage: RuntimeOwnedInternalDefinitions["queries"]["listTokenUsageForHooks"];
    listPendingServerRequests: RuntimeOwnedInternalDefinitions["queries"]["listPendingServerRequestsForHooks"];
    listThreadReasoning: RuntimeOwnedInternalDefinitions["queries"]["listThreadReasoningForHooks"];
  };
};

type RuntimeOwnedMutationDefinition =
  RuntimeOwnedHostDefinitions["mutations"][keyof RuntimeOwnedHostDefinitions["mutations"]];
type RuntimeOwnedQueryDefinition =
  RuntimeOwnedHostDefinitions["queries"][keyof RuntimeOwnedHostDefinitions["queries"]];
type MutationDefinitionWrapper = (definition: RuntimeOwnedMutationDefinition) => unknown;
type QueryDefinitionWrapper = (definition: RuntimeOwnedQueryDefinition) => unknown;

type WrapperCanHandleDefinition<Wrap, Definition> =
  Wrap extends { (definition: Definition): unknown } ? true : false;

type WrapperMustHandleDefinitions<Wrap, Definitions> =
  Exclude<
    Definitions extends unknown
      ? WrapperCanHandleDefinition<Wrap, Definitions>
      : never,
    true
  > extends never
    ? Wrap
    : never;

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

type DefinitionMap = Record<string, unknown>;
type WrappedResultForDefinition<Wrap, Definition> =
  Wrap extends (...args: any[]) => any
    ? ReturnType<Wrap & ((definition: Definition) => any)> &
      (Wrap extends (definition: Definition) => infer Result ? Result : unknown)
    : never;
type WrappedDefinitionMap<Defs extends DefinitionMap, Wrap> = {
  [Key in keyof Defs]: WrappedResultForDefinition<Wrap, Defs[Key]>;
};

export type CodexConvexHostActorPolicy = {
  userId: string;
};

type ActorResolver<Context> = (
  ctx: Context,
  actor: HostActorContext,
) => HostActorContext | Promise<HostActorContext>;

export type CodexHostActorResolver = {
  mutation?: ActorResolver<HostMutationRunner & HostQueryRunner>;
  query?: ActorResolver<HostQueryRunner>;
};

type NormalizedActorPolicy = HostActorContext;

function normalizeActorPolicy(
  policy: CodexConvexHostActorPolicy | undefined,
): NormalizedActorPolicy | undefined {
  if (!policy) {
    return undefined;
  }
  if (typeof policy !== "object" || policy === null) {
    throw new Error(
      'createCodexHost requires actorPolicy to be an object: { userId: string }.',
    );
  }
  if (!("userId" in policy)) {
    throw new Error(
      'createCodexHost requires actorPolicy to be an object: { userId: string }.',
    );
  }
  return policy;
}

// ---------------------------------------------------------------------------
// createCodexHost – the new unified entry point
// ---------------------------------------------------------------------------

export type CreateCodexHostOptions<
  Components extends CodexHostComponentsInput = CodexHostComponentsInput,
  MutationWrap = unknown,
  QueryWrap = unknown,
> = {
  components: Components;
  mutation: WrapperMustHandleDefinitions<MutationWrap, RuntimeOwnedMutationDefinition>;
  query: WrapperMustHandleDefinitions<QueryWrap, RuntimeOwnedQueryDefinition>;
  actorPolicy: CodexConvexHostActorPolicy;
  actorResolver?: CodexHostActorResolver;
};

export type CodexHostFacade<
  MutationWrap = unknown,
  QueryWrap = unknown,
> = {
  profile: "runtimeOwned";
  mutations: WrappedDefinitionMap<RuntimeOwnedHostDefinitions["mutations"], MutationWrap>;
  queries: WrappedDefinitionMap<RuntimeOwnedHostDefinitions["queries"], QueryWrap>;
  endpoints: WrappedDefinitionMap<RuntimeOwnedHostDefinitions["mutations"], MutationWrap> &
    WrappedDefinitionMap<RuntimeOwnedHostDefinitions["queries"], QueryWrap>;
};

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
      threadSnapshotSafe: defs.queries.threadSnapshotSafe,
      getDeletionStatus: defs.queries.getDeletionStatus,
      persistenceStats: defs.queries.persistenceStats,
      durableHistoryStats: defs.queries.durableHistoryStats,
      dataHygiene: defs.queries.dataHygiene,
      listThreadMessages: defs.queries.listThreadMessagesForHooks,
      listTurnMessages: defs.queries.listTurnMessagesForHooks,
      listPendingApprovals: defs.queries.listPendingApprovalsForHooks,
      listTokenUsage: defs.queries.listTokenUsageForHooks,
      listPendingServerRequests: defs.queries.listPendingServerRequestsForHooks,
      listThreadReasoning: defs.queries.listThreadReasoningForHooks,
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

function assertValidNormalizedActorPolicy(
  actorPolicy: NormalizedActorPolicy | undefined,
): asserts actorPolicy is NormalizedActorPolicy {
  if (!actorPolicy) {
    throw new Error("createCodexHost requires an explicit actorPolicy.");
  }
  const userId = actorPolicy.userId;
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error(
      "createCodexHost requires actorPolicy.userId to be a non-empty string.",
    );
  }
}

function assertMutationWrapper(
  wrapper: unknown,
): asserts wrapper is MutationDefinitionWrapper {
  if (typeof wrapper !== "function") {
    throw new Error("createCodexHost requires mutation to be a function.");
  }
}

function assertQueryWrapper(
  wrapper: unknown,
): asserts wrapper is QueryDefinitionWrapper {
  if (typeof wrapper !== "function") {
    throw new Error("createCodexHost requires query to be a function.");
  }
}

export function createCodexHost<
  Components extends CodexHostComponentsInput,
  MutationWrap = unknown,
  QueryWrap = unknown,
>(
  options: CreateCodexHostOptions<Components, MutationWrap, QueryWrap>,
): CodexHostFacade<MutationWrap, QueryWrap> {
  const actorPolicy = normalizeActorPolicy(options.actorPolicy);
  assertValidNormalizedActorPolicy(actorPolicy);
  const mutationWrap = options.mutation;
  const queryWrap = options.query;
  assertMutationWrapper(mutationWrap);
  assertQueryWrapper(queryWrap);

  // 1. Build raw internal-named slice definitions
  const rawSlice = defineCodexHostSlice<Components>({
    components: options.components,
    serverActor: actorPolicy,
    profile: "runtimeOwned",
    ingestMode: "streamOnly",
    features: {
      hooks: true,
      approvals: true,
      serverRequests: true,
      reasoning: true,
      hygiene: true,
      tokenUsage: true,
    },
  });

  const internalDefs: RuntimeOwnedInternalDefinitions = {
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
      threadSnapshotSafe: rawSlice.queries.threadSnapshotSafe,
      getDeletionStatus: rawSlice.queries.getDeletionStatus,
      persistenceStats: rawSlice.queries.persistenceStats,
      durableHistoryStats: rawSlice.queries.durableHistoryStats,
      dataHygiene: requireHostDefinition(rawSlice.queries.dataHygiene, "dataHygiene"),
      listThreadMessagesForHooks: requireHostDefinition(rawSlice.queries.listThreadMessagesForHooks, "listThreadMessagesForHooks"),
      listTurnMessagesForHooks: requireHostDefinition(rawSlice.queries.listTurnMessagesForHooks, "listTurnMessagesForHooks"),
      listPendingApprovalsForHooks: requireHostDefinition(rawSlice.queries.listPendingApprovalsForHooks, "listPendingApprovalsForHooks"),
      listTokenUsageForHooks: requireHostDefinition(rawSlice.queries.listTokenUsageForHooks, "listTokenUsageForHooks"),
      listPendingServerRequestsForHooks: requireHostDefinition(rawSlice.queries.listPendingServerRequestsForHooks, "listPendingServerRequestsForHooks"),
      listThreadReasoningForHooks: requireHostDefinition(rawSlice.queries.listThreadReasoningForHooks, "listThreadReasoningForHooks"),
    },
  };

  // 2. Convert internal names to clean public names
  const publicDefs = toPublicRuntimeOwnedDefinitions(internalDefs);
  const mutationActorResolver = options.actorResolver?.mutation;
  const queryActorResolver = options.actorResolver?.query;
  const resolvedDefs: RuntimeOwnedHostDefinitions = {
    profile: publicDefs.profile,
    mutations: {
      ensureThread: mutationActorResolver === undefined
        ? publicDefs.mutations.ensureThread
        : {
            ...publicDefs.mutations.ensureThread,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.ensureThread.handler(ctx, { ...args, actor });
            },
          },
      ensureSession: mutationActorResolver === undefined
        ? publicDefs.mutations.ensureSession
        : {
            ...publicDefs.mutations.ensureSession,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.ensureSession.handler(ctx, { ...args, actor });
            },
          },
      ingestEvent: mutationActorResolver === undefined
        ? publicDefs.mutations.ingestEvent
        : {
            ...publicDefs.mutations.ingestEvent,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.ingestEvent.handler(ctx, { ...args, actor });
            },
          },
      ingestBatch: mutationActorResolver === undefined
        ? publicDefs.mutations.ingestBatch
        : {
            ...publicDefs.mutations.ingestBatch,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.ingestBatch.handler(ctx, { ...args, actor });
            },
          },
      deleteThread: mutationActorResolver === undefined
        ? publicDefs.mutations.deleteThread
        : {
            ...publicDefs.mutations.deleteThread,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.deleteThread.handler(ctx, { ...args, actor });
            },
          },
      scheduleDeleteThread: mutationActorResolver === undefined
        ? publicDefs.mutations.scheduleDeleteThread
        : {
            ...publicDefs.mutations.scheduleDeleteThread,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.scheduleDeleteThread.handler(ctx, { ...args, actor });
            },
          },
      deleteTurn: mutationActorResolver === undefined
        ? publicDefs.mutations.deleteTurn
        : {
            ...publicDefs.mutations.deleteTurn,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.deleteTurn.handler(ctx, { ...args, actor });
            },
          },
      scheduleDeleteTurn: mutationActorResolver === undefined
        ? publicDefs.mutations.scheduleDeleteTurn
        : {
            ...publicDefs.mutations.scheduleDeleteTurn,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.scheduleDeleteTurn.handler(ctx, { ...args, actor });
            },
          },
      purgeActorData: mutationActorResolver === undefined
        ? publicDefs.mutations.purgeActorData
        : {
            ...publicDefs.mutations.purgeActorData,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.purgeActorData.handler(ctx, { ...args, actor });
            },
          },
      schedulePurgeActorData: mutationActorResolver === undefined
        ? publicDefs.mutations.schedulePurgeActorData
        : {
            ...publicDefs.mutations.schedulePurgeActorData,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.schedulePurgeActorData.handler(ctx, { ...args, actor });
            },
          },
      cancelDeletion: mutationActorResolver === undefined
        ? publicDefs.mutations.cancelDeletion
        : {
            ...publicDefs.mutations.cancelDeletion,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.cancelDeletion.handler(ctx, { ...args, actor });
            },
          },
      forceRunDeletion: mutationActorResolver === undefined
        ? publicDefs.mutations.forceRunDeletion
        : {
            ...publicDefs.mutations.forceRunDeletion,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.forceRunDeletion.handler(ctx, { ...args, actor });
            },
          },
      respondApproval: mutationActorResolver === undefined
        ? publicDefs.mutations.respondApproval
        : {
            ...publicDefs.mutations.respondApproval,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.respondApproval.handler(ctx, { ...args, actor });
            },
          },
      upsertTokenUsage: mutationActorResolver === undefined
        ? publicDefs.mutations.upsertTokenUsage
        : {
            ...publicDefs.mutations.upsertTokenUsage,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.upsertTokenUsage.handler(ctx, { ...args, actor });
            },
          },
      interruptTurn: mutationActorResolver === undefined
        ? publicDefs.mutations.interruptTurn
        : {
            ...publicDefs.mutations.interruptTurn,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.interruptTurn.handler(ctx, { ...args, actor });
            },
          },
      upsertPendingServerRequest: mutationActorResolver === undefined
        ? publicDefs.mutations.upsertPendingServerRequest
        : {
            ...publicDefs.mutations.upsertPendingServerRequest,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.upsertPendingServerRequest.handler(ctx, { ...args, actor });
            },
          },
      resolvePendingServerRequest: mutationActorResolver === undefined
        ? publicDefs.mutations.resolvePendingServerRequest
        : {
            ...publicDefs.mutations.resolvePendingServerRequest,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.resolvePendingServerRequest.handler(ctx, { ...args, actor });
            },
          },
      acceptTurnSend: mutationActorResolver === undefined
        ? publicDefs.mutations.acceptTurnSend
        : {
            ...publicDefs.mutations.acceptTurnSend,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.acceptTurnSend.handler(ctx, { ...args, actor });
            },
          },
      failAcceptedTurnSend: mutationActorResolver === undefined
        ? publicDefs.mutations.failAcceptedTurnSend
        : {
            ...publicDefs.mutations.failAcceptedTurnSend,
            handler: async (ctx, args) => {
              const actor = await mutationActorResolver(ctx, args.actor);
              return publicDefs.mutations.failAcceptedTurnSend.handler(ctx, { ...args, actor });
            },
          },
    },
    queries: {
      validateHostWiring: queryActorResolver === undefined
        ? publicDefs.queries.validateHostWiring
        : {
            ...publicDefs.queries.validateHostWiring,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.validateHostWiring.handler(ctx, { ...args, actor });
            },
          },
      threadSnapshot: queryActorResolver === undefined
        ? publicDefs.queries.threadSnapshot
        : {
            ...publicDefs.queries.threadSnapshot,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.threadSnapshot.handler(ctx, { ...args, actor });
            },
          },
      threadSnapshotSafe: queryActorResolver === undefined
        ? publicDefs.queries.threadSnapshotSafe
        : {
            ...publicDefs.queries.threadSnapshotSafe,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.threadSnapshotSafe.handler(ctx, { ...args, actor });
            },
          },
      getDeletionStatus: queryActorResolver === undefined
        ? publicDefs.queries.getDeletionStatus
        : {
            ...publicDefs.queries.getDeletionStatus,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.getDeletionStatus.handler(ctx, { ...args, actor });
            },
          },
      persistenceStats: queryActorResolver === undefined
        ? publicDefs.queries.persistenceStats
        : {
            ...publicDefs.queries.persistenceStats,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.persistenceStats.handler(ctx, { ...args, actor });
            },
          },
      durableHistoryStats: queryActorResolver === undefined
        ? publicDefs.queries.durableHistoryStats
        : {
            ...publicDefs.queries.durableHistoryStats,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.durableHistoryStats.handler(ctx, { ...args, actor });
            },
          },
      dataHygiene: queryActorResolver === undefined
        ? publicDefs.queries.dataHygiene
        : {
            ...publicDefs.queries.dataHygiene,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.dataHygiene.handler(ctx, { ...args, actor });
            },
          },
      listThreadMessages: queryActorResolver === undefined
        ? publicDefs.queries.listThreadMessages
        : {
            ...publicDefs.queries.listThreadMessages,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.listThreadMessages.handler(ctx, { ...args, actor });
            },
          },
      listTurnMessages: queryActorResolver === undefined
        ? publicDefs.queries.listTurnMessages
        : {
            ...publicDefs.queries.listTurnMessages,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.listTurnMessages.handler(ctx, { ...args, actor });
            },
          },
      listPendingApprovals: queryActorResolver === undefined
        ? publicDefs.queries.listPendingApprovals
        : {
            ...publicDefs.queries.listPendingApprovals,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.listPendingApprovals.handler(ctx, { ...args, actor });
            },
          },
      listTokenUsage: queryActorResolver === undefined
        ? publicDefs.queries.listTokenUsage
        : {
            ...publicDefs.queries.listTokenUsage,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.listTokenUsage.handler(ctx, { ...args, actor });
            },
          },
      listPendingServerRequests: queryActorResolver === undefined
        ? publicDefs.queries.listPendingServerRequests
        : {
            ...publicDefs.queries.listPendingServerRequests,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.listPendingServerRequests.handler(ctx, { ...args, actor });
            },
          },
      listThreadReasoning: queryActorResolver === undefined
        ? publicDefs.queries.listThreadReasoning
        : {
            ...publicDefs.queries.listThreadReasoning,
            handler: async (ctx, args) => {
              const actor = await queryActorResolver(ctx, args.actor);
              return publicDefs.queries.listThreadReasoning.handler(ctx, { ...args, actor });
            },
          },
    },
  };

  // 3. Wrap each definition with the supplied mutation/query constructors
  const wrappedMutations = {
    ensureThread: mutationWrap(resolvedDefs.mutations.ensureThread),
    ensureSession: mutationWrap(resolvedDefs.mutations.ensureSession),
    ingestEvent: mutationWrap(resolvedDefs.mutations.ingestEvent),
    ingestBatch: mutationWrap(resolvedDefs.mutations.ingestBatch),
    deleteThread: mutationWrap(resolvedDefs.mutations.deleteThread),
    scheduleDeleteThread: mutationWrap(resolvedDefs.mutations.scheduleDeleteThread),
    deleteTurn: mutationWrap(resolvedDefs.mutations.deleteTurn),
    scheduleDeleteTurn: mutationWrap(resolvedDefs.mutations.scheduleDeleteTurn),
    purgeActorData: mutationWrap(resolvedDefs.mutations.purgeActorData),
    schedulePurgeActorData: mutationWrap(resolvedDefs.mutations.schedulePurgeActorData),
    cancelDeletion: mutationWrap(resolvedDefs.mutations.cancelDeletion),
    forceRunDeletion: mutationWrap(resolvedDefs.mutations.forceRunDeletion),
    respondApproval: mutationWrap(resolvedDefs.mutations.respondApproval),
    upsertTokenUsage: mutationWrap(resolvedDefs.mutations.upsertTokenUsage),
    interruptTurn: mutationWrap(resolvedDefs.mutations.interruptTurn),
    upsertPendingServerRequest: mutationWrap(
      resolvedDefs.mutations.upsertPendingServerRequest,
    ),
    resolvePendingServerRequest: mutationWrap(
      resolvedDefs.mutations.resolvePendingServerRequest,
    ),
    acceptTurnSend: mutationWrap(resolvedDefs.mutations.acceptTurnSend),
    failAcceptedTurnSend: mutationWrap(
      resolvedDefs.mutations.failAcceptedTurnSend,
    ),
  } as WrappedDefinitionMap<RuntimeOwnedHostDefinitions["mutations"], MutationWrap>;

  const wrappedQueries = {
    validateHostWiring: queryWrap(resolvedDefs.queries.validateHostWiring),
    threadSnapshot: queryWrap(resolvedDefs.queries.threadSnapshot),
    threadSnapshotSafe: queryWrap(resolvedDefs.queries.threadSnapshotSafe),
    getDeletionStatus: queryWrap(resolvedDefs.queries.getDeletionStatus),
    persistenceStats: queryWrap(resolvedDefs.queries.persistenceStats),
    durableHistoryStats: queryWrap(resolvedDefs.queries.durableHistoryStats),
    dataHygiene: queryWrap(resolvedDefs.queries.dataHygiene),
    listThreadMessages: queryWrap(resolvedDefs.queries.listThreadMessages),
    listTurnMessages: queryWrap(resolvedDefs.queries.listTurnMessages),
    listPendingApprovals: queryWrap(resolvedDefs.queries.listPendingApprovals),
    listTokenUsage: queryWrap(resolvedDefs.queries.listTokenUsage),
    listPendingServerRequests: queryWrap(resolvedDefs.queries.listPendingServerRequests),
    listThreadReasoning: queryWrap(resolvedDefs.queries.listThreadReasoning),
  } as WrappedDefinitionMap<RuntimeOwnedHostDefinitions["queries"], QueryWrap>;

  const endpoints = { ...wrappedMutations, ...wrappedQueries } as
    WrappedDefinitionMap<RuntimeOwnedHostDefinitions["mutations"], MutationWrap> &
    WrappedDefinitionMap<RuntimeOwnedHostDefinitions["queries"], QueryWrap>;

  return {
    profile: "runtimeOwned",
    mutations: wrappedMutations,
    queries: wrappedQueries,
    endpoints,
  };
}
