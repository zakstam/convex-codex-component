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

type PickRequiredKeys<T, Keys extends keyof T> = {
  [K in Keys]-?: T[K];
};

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

export type RuntimeOwnedHostDefinitions = {
  profile: "runtimeOwned";
  mutations: PickRequiredKeys<CodexHostSliceDefinitions["mutations"], RuntimeOwnedMutationKeys>;
  queries: PickRequiredKeys<CodexHostSliceDefinitions["queries"], RuntimeOwnedQueryKeys>;
};

export type DefineRuntimeOwnedHostSliceOptions<
  Components extends CodexHostComponentsInput = CodexHostComponentsInput,
> = Pick<DefineCodexHostSliceOptions<Components>, "components" | "serverActor">;

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

export type CodexConvexHostActorPolicy<MutationCtx = unknown, QueryCtx = unknown> =
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

export type CreateCodexConvexHostOptions<
  Components extends CodexHostComponentsInput = CodexHostComponentsInput,
  MutationCtx = unknown,
  QueryCtx = unknown,
> = {
  components: Components;
  actorPolicy: CodexConvexHostActorPolicy<MutationCtx, QueryCtx>;
};

export type CodexConvexHostFacade<MutationCtx = unknown, QueryCtx = unknown> = {
  profile: "runtimeOwned";
  defs: RuntimeOwnedHostDefinitions;
  register: <MutationWrap, QueryWrap>(wrap: { mutation: MutationWrap; query: QueryWrap }) => {
    mutations: WrappedDefinitionMap<RuntimeOwnedHostDefinitions["mutations"], MutationWrap>;
    queries: WrappedDefinitionMap<RuntimeOwnedHostDefinitions["queries"], QueryWrap>;
  };
  actorPolicy: CodexConvexHostActorPolicy<MutationCtx, QueryCtx>;
};

export function defineRuntimeOwnedHostSlice<Components extends CodexHostComponentsInput>(
  options: DefineRuntimeOwnedHostSliceOptions<Components>,
): RuntimeOwnedHostDefinitions {
  const defs = defineCodexHostSlice({
    ...options,
    profile: "runtimeOwned",
    ingestMode: "streamOnly",
    features: {
      hooks: true,
      approvals: true,
      serverRequests: false,
      reasoning: false,
      hygiene: true,
      tokenUsage: true,
    },
  });

  return {
    profile: "runtimeOwned",
    mutations: pickRequiredKeys(defs.mutations, HOST_SURFACE_MANIFEST.runtimeOwned.mutations),
    queries: pickRequiredKeys(defs.queries, HOST_SURFACE_MANIFEST.runtimeOwned.queries),
  };
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

export function createCodexConvexHost<
  Components extends CodexHostComponentsInput,
  MutationCtx = unknown,
  QueryCtx = unknown,
>(
  options: CreateCodexConvexHostOptions<Components, MutationCtx, QueryCtx>,
): CodexConvexHostFacade<MutationCtx, QueryCtx> {
  const runtimeDefs = defineRuntimeOwnedHostSlice<Components>({
    components: options.components,
    serverActor: options.actorPolicy.serverActor,
  });
  const defs = options.actorPolicy.mode === "guarded"
    ? applyActorGuards<MutationCtx, QueryCtx>(runtimeDefs, {
        resolveMutationActor: options.actorPolicy.resolveMutationActor,
        resolveQueryActor: options.actorPolicy.resolveQueryActor,
      })
    : runtimeDefs;

  return {
    profile: "runtimeOwned",
    defs,
    register: ({ mutation, query }) => {
      const mutationWrapper = mutation as (
        definition: RuntimeOwnedHostDefinitions["mutations"][keyof RuntimeOwnedHostDefinitions["mutations"]],
      ) => WrappedResult<typeof mutation>;
      const queryWrapper = query as (
        definition: RuntimeOwnedHostDefinitions["queries"][keyof RuntimeOwnedHostDefinitions["queries"]],
      ) => WrappedResult<typeof query>;

      const mutations = Object.fromEntries(
        Object.entries(defs.mutations).map(([name, definition]) => [
          name,
          mutationWrapper(definition as RuntimeOwnedHostDefinitions["mutations"][keyof RuntimeOwnedHostDefinitions["mutations"]]),
        ]),
      ) as WrappedDefinitionMap<RuntimeOwnedHostDefinitions["mutations"], typeof mutation>;

      const queries = Object.fromEntries(
        Object.entries(defs.queries).map(([name, definition]) => [
          name,
          queryWrapper(definition as RuntimeOwnedHostDefinitions["queries"][keyof RuntimeOwnedHostDefinitions["queries"]]),
        ]),
      ) as WrappedDefinitionMap<RuntimeOwnedHostDefinitions["queries"], typeof query>;

      return { mutations, queries };
    },
    actorPolicy: options.actorPolicy,
  };
}
