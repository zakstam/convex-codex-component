import { v } from "convex/values";
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { vHostActorContext } from "@zakstam/codex-local-component/host/convex";
import {
  readActorBindingForBootstrap,
  requireBoundServerActorForQuery,
} from "./actorLock";

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

    const listed = await ctx.runQuery(components.codexLocal.threads.list, {
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
    const mapping = await ctx.runQuery(components.codexLocal.threads.resolveByConversationId, {
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
    const rows = await ctx.runQuery(components.codexLocal.threads.listRuntimeConversationBindings, {
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
