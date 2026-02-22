/**
 * Internal helper functions for thread mutations/queries.
 * Extracted from threads.ts for file-size compliance per ADR-20260214.
 *
 * These are NOT Convex exports — they are shared by the mutations/queries
 * in threads.ts and are not part of the component API surface.
 */
import type { Id } from "./_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import { userScopeFromActor } from "./scope.js";
import { authzError, now } from "./utils.js";

export async function touchThread(
  ctx: MutationCtx,
  args: {
    actor: { userId?: string; anonymousId?: string };
    threadId: string;
    model?: string;
    cwd?: string;
    personality?: string;
    localThreadId?: string;
  },
): Promise<{ threadId: string; created: boolean; threadRef: Id<"codex_threads"> }> {
  const existing = await ctx.db
    .query("codex_threads")
    .withIndex("userScope_threadId")
    .filter((q) =>
      q.and(
        q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
        q.eq(q.field("threadId"), args.threadId),
      ),
    )
    .first();

  const ts = now();
  if (existing) {
    if (existing.userId !== args.actor.userId) {
      authzError(
        "E_AUTH_THREAD_FORBIDDEN",
        `User ${args.actor.userId} is not allowed to access thread ${args.threadId}`,
      );
    }
    await ctx.db.patch(existing._id, {
      updatedAt: ts,
      model: args.model ?? existing.model,
      cwd: args.cwd ?? existing.cwd,
      personality: args.personality ?? existing.personality,
      localThreadId: args.localThreadId ?? existing.localThreadId,
    });
    return { threadId: String(existing.threadId), created: false, threadRef: existing._id };
  }

  const threadRef = await ctx.db.insert("codex_threads", {
    userScope: userScopeFromActor(args.actor),
    ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
    threadId: args.threadId,
    status: "active",
    ...(args.localThreadId ? { localThreadId: args.localThreadId } : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(args.personality ? { personality: args.personality } : {}),
    createdAt: ts,
    updatedAt: ts,
  });

  return { threadId: args.threadId, created: true, threadRef };
}

export async function getDeletionJobForActor(args: {
  ctx: MutationCtx | QueryCtx;
  actor: { userId?: string; anonymousId?: string };
  deletionJobId: string;
}) {
  const job = await args.ctx.db
    .query("codex_deletion_jobs")
    .withIndex("userScope_deletionJobId", (q) =>
      q.eq("userScope", userScopeFromActor(args.actor)).eq("deletionJobId", args.deletionJobId),
    )
    .first();
  if (!job) {
    return null;
  }
  if (job.userId !== args.actor.userId) {
    return null;
  }
  return job;
}
