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
import { buildPresetMutations } from "./convexPresetMutations.js";
import { resolveHostComponentRefs } from "./generatedTypingBoundary.js";
import {
  HOST_SURFACE_MANIFEST,
  HOST_MUTATION_INTERNAL_ALIASES,
  HOST_QUERY_INTERNAL_ALIASES,
} from "./surfaceManifest.js";

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

/**
 * Reverse an alias map: { internalKey: publicKey } -> { publicKey: internalKey }.
 */
type InvertAliasMap<M extends Record<string, string>> = {
  [K in keyof M as M[K]]: K;
};

/**
 * Resolve the internal (slice) key for a given public key.
 * If the public key appears as a value in the alias map, the corresponding
 * map key (the internal name) is returned; otherwise the public key itself
 * is used (identity -- no alias needed).
 */
type InternalKeyFor<PublicKey extends string, AliasMap extends Record<string, string>> =
  PublicKey extends AliasMap[keyof AliasMap]
    ? Extract<keyof InvertAliasMap<AliasMap>, PublicKey> extends infer IK extends string
      ? IK
      : PublicKey
    : PublicKey;

/**
 * Pick definitions from a slice output using public names, mapping each
 * public name back to its internal key via the supplied alias map.
 */
type PickAliased<
  SliceDefs,
  PublicKeys extends string,
  AliasMap extends Record<string, string>,
> = {
  [K in PublicKeys]-?: InternalKeyFor<K, AliasMap> extends keyof SliceDefs
    ? SliceDefs[InternalKeyFor<K, AliasMap>]
    : never;
};

type RuntimeOwnedMutationKeys = (typeof HOST_SURFACE_MANIFEST.runtimeOwned.mutations)[number];
type RuntimeOwnedQueryKeys = (typeof HOST_SURFACE_MANIFEST.runtimeOwned.queries)[number];

export type RuntimeOwnedHostDefinitions = {
  profile: "runtimeOwned";
  mutations: PickAliased<
    CodexHostSliceDefinitions["mutations"],
    RuntimeOwnedMutationKeys,
    typeof HOST_MUTATION_INTERNAL_ALIASES
  >;
  queries: PickAliased<
    CodexHostSliceDefinitions["queries"],
    RuntimeOwnedQueryKeys,
    typeof HOST_QUERY_INTERNAL_ALIASES
  >;
};

type HostActorResolver<Ctx = unknown> = (
  ctx: Ctx,
  incomingActor: HostActorContext,
) => Promise<HostActorContext> | HostActorContext;

type RuntimeOwnedDefinitionWithActor<Ctx, Args extends { actor: HostActorContext } = { actor: HostActorContext }> = {
  handler: (ctx: Ctx, args: Args) => unknown;
};

type DefinitionMap = Record<string, unknown>;
type WrappedResult<Wrap> = Wrap extends (...args: never[]) => infer Result ? Result : never;
type WrappedDefinitionMap<Defs extends DefinitionMap, Wrap> = {
  [Key in keyof Defs]: WrappedResult<Wrap>;
};

export type CodexConvexHostActorPolicyShorthand =
  | string
  | { userId: string };

export type CodexConvexHostActorPolicy<MutationCtx = unknown, QueryCtx = unknown> =
  | CodexConvexHostActorPolicyShorthand
  | {
      mode: "serverActor";
      serverActor: HostActorContext;
    }
  | {
      mode: "guarded";
      serverActor: HostActorContext;
      resolveMutationActor: HostActorResolver<MutationCtx>;
      resolveQueryActor: HostActorResolver<QueryCtx>;
    };

type NormalizedActorPolicy<MutationCtx = unknown, QueryCtx = unknown> =
  | {
      mode: "serverActor";
      serverActor: HostActorContext;
    }
  | {
      mode: "guarded";
      serverActor: HostActorContext;
      resolveMutationActor: HostActorResolver<MutationCtx>;
      resolveQueryActor: HostActorResolver<QueryCtx>;
    };

function normalizeActorPolicy<MutationCtx = unknown, QueryCtx = unknown>(
  policy: CodexConvexHostActorPolicy<MutationCtx, QueryCtx> | undefined,
): NormalizedActorPolicy<MutationCtx, QueryCtx> | undefined {
  if (!policy) {
    return undefined;
  }
  if (typeof policy === "string") {
    return { mode: "serverActor", serverActor: { userId: policy } };
  }
  if (typeof policy === "object" && !("mode" in policy)) {
    return { mode: "serverActor", serverActor: { userId: policy.userId } };
  }
  return policy;
}

function applyActorGuards<
  MutationCtx = unknown,
  QueryCtx = unknown,
>(
  defs: RuntimeOwnedHostDefinitions,
  guards: {
    resolveMutationActor: HostActorResolver<MutationCtx>;
    resolveQueryActor: HostActorResolver<QueryCtx>;
  },
): RuntimeOwnedHostDefinitions {
  const guardedMutations = Object.fromEntries(
    Object.entries(defs.mutations).map(([name, definition]) => {
      const typedDefinition = definition as RuntimeOwnedDefinitionWithActor<unknown>;
      return [
        name,
        {
          ...typedDefinition,
          handler: async (ctx: MutationCtx, args: { actor: HostActorContext }) => {
            const actor = await guards.resolveMutationActor(ctx, args.actor);
            return typedDefinition.handler(ctx, { ...args, actor });
          },
        },
      ];
    }),
  ) as unknown as RuntimeOwnedHostDefinitions["mutations"];

  const guardedQueries = Object.fromEntries(
    Object.entries(defs.queries).map(([name, definition]) => {
      const typedDefinition = definition as RuntimeOwnedDefinitionWithActor<unknown>;
      return [
        name,
        {
          ...typedDefinition,
          handler: async (ctx: QueryCtx, args: { actor: HostActorContext }) => {
            const actor = await guards.resolveQueryActor(ctx, args.actor);
            return typedDefinition.handler(ctx, { ...args, actor });
          },
        },
      ];
    }),
  ) as unknown as RuntimeOwnedHostDefinitions["queries"];

  return {
    ...defs,
    mutations: guardedMutations,
    queries: guardedQueries,
  };
}

// ---------------------------------------------------------------------------
// createCodexHost – the new unified entry point
// ---------------------------------------------------------------------------

export type CreateCodexHostOptions<
  Components extends CodexHostComponentsInput = CodexHostComponentsInput,
  MutationCtx = unknown,
  QueryCtx = unknown,
> = {
  components: Components;
  mutation: (definition: never) => unknown;
  query: (definition: never) => unknown;
  actorPolicy: CodexConvexHostActorPolicy<MutationCtx, QueryCtx>;
};

export type CodexHostFacade<MutationWrap = unknown, QueryWrap = unknown> = {
  profile: "runtimeOwned";
  mutations: WrappedDefinitionMap<RuntimeOwnedHostDefinitions["mutations"], MutationWrap>;
  queries: WrappedDefinitionMap<RuntimeOwnedHostDefinitions["queries"], QueryWrap>;
  endpoints: WrappedDefinitionMap<RuntimeOwnedHostDefinitions["mutations"], MutationWrap> &
    WrappedDefinitionMap<RuntimeOwnedHostDefinitions["queries"], QueryWrap>;
  defs: RuntimeOwnedHostDefinitions;
};

/**
 * Rename internal-named definition keys to their clean public aliases.
 * Keys that have no alias are passed through unchanged.
 */
function aliasDefinitionKeys<T extends Record<string, unknown>>(
  defs: T,
  aliases: Record<string, string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(defs).map(([key, value]) => [aliases[key] ?? key, value]),
  );
}

function assertValidNormalizedActorPolicy<MutationCtx = unknown, QueryCtx = unknown>(
  actorPolicy: NormalizedActorPolicy<MutationCtx, QueryCtx> | undefined,
): asserts actorPolicy is NormalizedActorPolicy<MutationCtx, QueryCtx> {
  if (!actorPolicy) {
    throw new Error("createCodexHost requires an explicit actorPolicy.");
  }
  const userId = actorPolicy.serverActor.userId;
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error(
      "createCodexHost requires actorPolicy.serverActor.userId to be a non-empty string.",
    );
  }
}

export function createCodexHost<
  Components extends CodexHostComponentsInput,
  MutationCtx = unknown,
  QueryCtx = unknown,
>(
  options: CreateCodexHostOptions<Components, MutationCtx, QueryCtx>,
): CodexHostFacade<typeof options.mutation, typeof options.query> {
  const actorPolicy = normalizeActorPolicy(options.actorPolicy);
  assertValidNormalizedActorPolicy(actorPolicy);

  // 1. Build raw internal-named slice definitions
  const rawSlice = defineCodexHostSlice<Components>({
    components: options.components,
    serverActor: actorPolicy.serverActor,
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

  // Pick only the manifest-required keys from the raw slice (using internal names).
  // We need to collect them before aliasing because the slice uses internal names.
  const internalMutationKeys = HOST_SURFACE_MANIFEST.runtimeOwned.mutations.map(
    (publicKey) => {
      // Find the internal key that maps to this public key, or use the public key itself
      const internalKey =
        Object.entries(HOST_MUTATION_INTERNAL_ALIASES).find(
          ([, pub]) => pub === publicKey,
        )?.[0] ?? publicKey;
      return internalKey;
    },
  );
  const internalQueryKeys = HOST_SURFACE_MANIFEST.runtimeOwned.queries.map(
    (publicKey) => {
      const internalKey =
        Object.entries(HOST_QUERY_INTERNAL_ALIASES).find(
          ([, pub]) => pub === publicKey,
        )?.[0] ?? publicKey;
      return internalKey;
    },
  );

  const pickedMutations = pickRequiredKeysFromRecord(rawSlice.mutations, internalMutationKeys);
  const pickedQueries = pickRequiredKeysFromRecord(rawSlice.queries, internalQueryKeys);

  const internalDefs: RuntimeOwnedHostDefinitions = {
    profile: "runtimeOwned",
    mutations: pickedMutations as RuntimeOwnedHostDefinitions["mutations"],
    queries: pickedQueries as RuntimeOwnedHostDefinitions["queries"],
  };

  // 2. Optionally apply actor guards (still internal-named)
  const guardedDefs =
    actorPolicy.mode === "guarded"
      ? applyActorGuards<MutationCtx, QueryCtx>(internalDefs, {
          resolveMutationActor: actorPolicy.resolveMutationActor,
          resolveQueryActor: actorPolicy.resolveQueryActor,
        })
      : internalDefs;

  // 3. Alias internal names to clean public names
  const publicMutationDefs = aliasDefinitionKeys(
    guardedDefs.mutations,
    HOST_MUTATION_INTERNAL_ALIASES,
  );
  const publicQueryDefs = aliasDefinitionKeys(
    guardedDefs.queries,
    HOST_QUERY_INTERNAL_ALIASES,
  );

  // 4. Wrap each definition with the supplied mutation/query constructors
  const mutationWrapper = options.mutation as (definition: unknown) => unknown;
  const queryWrapper = options.query as (definition: unknown) => unknown;

  const wrappedMutations = Object.fromEntries(
    Object.entries(publicMutationDefs).map(([name, definition]) => [
      name,
      mutationWrapper(definition),
    ]),
  ) as WrappedDefinitionMap<RuntimeOwnedHostDefinitions["mutations"], typeof options.mutation>;

  const wrappedQueries = Object.fromEntries(
    Object.entries(publicQueryDefs).map(([name, definition]) => [
      name,
      queryWrapper(definition),
    ]),
  ) as WrappedDefinitionMap<RuntimeOwnedHostDefinitions["queries"], typeof options.query>;

  // Build the public-named defs for the escape hatch (unwrapped but aliased)
  const publicDefs: RuntimeOwnedHostDefinitions = {
    profile: "runtimeOwned",
    mutations: publicMutationDefs as RuntimeOwnedHostDefinitions["mutations"],
    queries: publicQueryDefs as RuntimeOwnedHostDefinitions["queries"],
  };

  const endpoints = { ...wrappedMutations, ...wrappedQueries } as
    WrappedDefinitionMap<RuntimeOwnedHostDefinitions["mutations"], typeof options.mutation> &
    WrappedDefinitionMap<RuntimeOwnedHostDefinitions["queries"], typeof options.query>;

  return {
    profile: "runtimeOwned",
    mutations: wrappedMutations,
    queries: wrappedQueries,
    endpoints,
    defs: publicDefs,
  };
}

/**
 * Pick required keys from a record, throwing on missing keys.
 */
function pickRequiredKeysFromRecord<T extends Record<string, unknown>>(
  source: T,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.map((key) => {
      const value = source[key];
      if (value === undefined || value === null) {
        throw new Error(`Missing required host surface key: ${String(key)}`);
      }
      return [key, value];
    }),
  );
}
