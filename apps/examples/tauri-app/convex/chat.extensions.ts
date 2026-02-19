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
      threadId: string;
      status: string;
      updatedAt: number;
    }>;

    const rows = page.map((thread) => ({
      threadId: thread.threadId,
      status: thread.status,
      updatedAt: thread.updatedAt,
    }));

    return {
      threads: rows,
      hasMore: !listed.isDone,
      continueCursor: listed.continueCursor,
    };
  },
});

export const resolveThreadHandleForStart = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    const mapping = await ctx.runQuery(components.codexLocal.threads.getExternalMapping, {
      actor: serverActor,
      threadId: args.threadId,
    });
    return {
      threadId: args.threadId,
      threadHandleId: mapping?.externalThreadId ?? args.threadId,
    };
  },
});
