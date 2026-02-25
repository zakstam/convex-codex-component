import type { QueryCtx } from "../_generated/server.js";
import type { ActorContext } from "../types.js";
import { userScopeFromActor } from "../scope.js";
import { THREAD_STATE_QUERY_LIMITS } from "../../shared/limits.js";

export async function loadThreadSnapshotRows(args: {
  ctx: QueryCtx;
  actor: ActorContext;
  threadId: string;
}) {
  const { ctx, actor, threadId } = args;
  const userScope = userScopeFromActor(actor);

  const [turns, streams, stats, approvals, recentMessages, lifecycle] = await Promise.all([
    ctx.db
      .query("codex_turns")
      .withIndex("userScope_threadId_startedAt")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScope),
          q.eq(q.field("userId"), actor.userId),
          q.eq(q.field("threadId"), threadId),
        ),
      )
      .order("desc")
      .take(THREAD_STATE_QUERY_LIMITS.turns),
    ctx.db
      .query("codex_streams")
      .withIndex("userScope_threadId_state")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScope),
          q.eq(q.field("threadId"), threadId),
        ),
      )
      .take(THREAD_STATE_QUERY_LIMITS.streams),
    ctx.db
      .query("codex_stream_stats")
      .withIndex("userScope_threadId", (q) => q.eq("userScope", userScope).eq("threadId", threadId))
      .take(THREAD_STATE_QUERY_LIMITS.stats),
    ctx.db
      .query("codex_approvals")
      .withIndex("userScope_threadId_status")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScope),
          q.eq(q.field("userId"), actor.userId),
          q.eq(q.field("threadId"), threadId),
          q.eq(q.field("status"), "pending"),
        ),
      )
      .take(THREAD_STATE_QUERY_LIMITS.approvals),
    ctx.db
      .query("codex_messages")
      .withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", userScope).eq("threadId", threadId))
      .order("desc")
      .take(THREAD_STATE_QUERY_LIMITS.recentMessages),
    ctx.db
      .query("codex_lifecycle_events")
      .withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", userScope).eq("threadId", threadId))
      .order("desc")
      .take(THREAD_STATE_QUERY_LIMITS.lifecycle),
  ]);

  return { turns, streams, stats, approvals, recentMessages, lifecycle };
}

