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

    const rows = await Promise.all(
      page.map(async (thread) => {
        const mapping = await ctx.runQuery(components.codexLocal.threads.getExternalMapping, {
          actor: serverActor,
          threadId: thread.threadId,
        });

        const externalThreadId = mapping?.externalThreadId ?? null;
        const runtimeThreadId = externalThreadId ?? thread.threadId;
        return {
          threadId: thread.threadId,
          status: thread.status,
          updatedAt: thread.updatedAt,
          externalThreadId,
          runtimeThreadId,
          linkState: externalThreadId ? "linked" : "persisted_only",
        };
      }),
    );

    return {
      threads: rows,
      hasMore: !listed.isDone,
      continueCursor: listed.continueCursor,
    };
  },
});
