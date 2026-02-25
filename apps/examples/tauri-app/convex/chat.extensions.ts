import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { vHostActorContext } from "@zakstam/codex-runtime-convex/host";
import {
  readActorBindingForBootstrap,
  requireBoundServerActorForQuery,
} from "./actorLock";

type PickerThreadsComponentRefs = {
  threads: {
    list?: FunctionReference<"query", "public" | "internal", Record<string, unknown>>;
    resolveByConversationId?: FunctionReference<"query", "public" | "internal", Record<string, unknown>>;
    listRuntimeConversationBindings?: FunctionReference<"query", "public" | "internal", Record<string, unknown>>;
  };
};

const codexLocal = components.codexLocal as unknown as PickerThreadsComponentRefs;

function missingPickerWiringError(path: string): Error {
  return new Error(
    `Missing components.codexLocal.${path}. Run \`pnpm --filter codex-runtime-tauri-example run dev:convex:once\` and restart Tauri.`,
  );
}

function requirePickerThreadsList():
  FunctionReference<"query", "public" | "internal", Record<string, unknown>> {
  if (!codexLocal.threads.list) {
    throw missingPickerWiringError("threads.list");
  }
  return codexLocal.threads.list;
}

function requireResolveByConversationId():
  FunctionReference<"query", "public" | "internal", Record<string, unknown>> {
  if (!codexLocal.threads.resolveByConversationId) {
    throw missingPickerWiringError("threads.resolveByConversationId");
  }
  return codexLocal.threads.resolveByConversationId;
}

function requireListRuntimeConversationBindings():
  FunctionReference<"query", "public" | "internal", Record<string, unknown>> {
  if (!codexLocal.threads.listRuntimeConversationBindings) {
    throw missingPickerWiringError("threads.listRuntimeConversationBindings");
  }
  return codexLocal.threads.listRuntimeConversationBindings;
}

export const getActorBindingForBootstrap = query({
  args: {},
  handler: async (ctx) => await readActorBindingForBootstrap(ctx),
});

export const listThreadsForPicker = query({
  args: {
    actor: vHostActorContext,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    const listThreadsRef = requirePickerThreadsList();

    const listed = await ctx.runQuery(listThreadsRef, {
      actor: serverActor,
      paginationOpts: {
        numItems: Math.max(1, Math.floor(args.limit ?? 25)),
        cursor: null,
      },
    });

    const page = listed.page as Array<{
      conversationId: string;
      status: string;
      updatedAt: number;
      preview: string;
    }>;

    const rows = page.map((thread) => ({
      conversationId: thread.conversationId,
      status: thread.status,
      updatedAt: thread.updatedAt,
      preview: thread.preview,
    }));

    return {
      threads: rows,
      hasMore: !listed.isDone,
      continueCursor: listed.continueCursor,
    };
  },
});

export const resolveOpenTarget = query({
  args: {
    actor: vHostActorContext,
    conversationHandle: v.string(),
  },
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    const resolveByConversationIdRef = requireResolveByConversationId();
    const mapping = await ctx.runQuery(resolveByConversationIdRef, {
      actor: serverActor,
      conversationId: args.conversationHandle,
    });
    if (!mapping) {
      return {
        mode: "unbound" as const,
        conversationHandle: args.conversationHandle,
        runtimeThreadHandle: args.conversationHandle,
      };
    }
    return {
      mode: "bound" as const,
      conversationHandle: args.conversationHandle,
      runtimeThreadHandle: mapping.conversationId,
    };
  },
});

export const listRuntimeConversationBindingsForPicker = query({
  args: {
    actor: vHostActorContext,
    runtimeConversationIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    const listRuntimeConversationBindingsRef = requireListRuntimeConversationBindings();
    const rows = await ctx.runQuery(listRuntimeConversationBindingsRef, {
      actor: serverActor,
      runtimeConversationIds: args.runtimeConversationIds,
    });
    return rows as Array<{
      runtimeConversationId: string;
      threadId: string;
      conversationId: string;
    }>;
  },
});

export const validatePickerHostWiring = query({
  args: {
    actor: vHostActorContext,
  },
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    const listThreadsRef = requirePickerThreadsList();
    requireResolveByConversationId();
    requireListRuntimeConversationBindings();
    await ctx.runQuery(listThreadsRef, {
      actor: serverActor,
      paginationOpts: {
        numItems: 1,
        cursor: null,
      },
    });
    return { ok: true } as const;
  },
});
