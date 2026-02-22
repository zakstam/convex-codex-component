import type { Doc } from "./_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import type { ActorContext } from "./types.js";
import { userScopeFromActor } from "./scope.js";

type ThreadRecord = Doc<"codex_threads">;
type TurnRecord = Doc<"codex_turns">;
type StreamRecord = Doc<"codex_streams">;

export function authzError(code: "E_AUTH_THREAD_FORBIDDEN" | "E_AUTH_TURN_FORBIDDEN" | "E_AUTH_SESSION_FORBIDDEN", message: string): never {
  throw new Error(`[${code}] authorization failed: ${message}`);
}

export async function requireThreadForActor(
  ctx: QueryCtx | MutationCtx,
  actor: ActorContext,
  threadId: string,
): Promise<ThreadRecord> {
  const userScope = userScopeFromActor(actor);
  const thread = await ctx.db
    .query("codex_threads")
    .withIndex("userScope_threadId", (q) =>
      q.eq("userScope", userScope).eq("threadId", threadId),
    )
    .first();

  if (!thread) {
    throw new Error(`[E_THREAD_NOT_FOUND] Thread not found: ${threadId}`);
  }
  return thread;
}

export async function requireThreadRefForActor(
  ctx: QueryCtx | MutationCtx,
  actor: ActorContext,
  threadId: string,
): Promise<{ thread: ThreadRecord; threadRef: ThreadRecord["_id"] }> {
  const thread = await requireThreadForActor(ctx, actor, threadId);
  return { thread, threadRef: thread._id };
}

export async function requireTurnForActor(
  ctx: QueryCtx | MutationCtx,
  actor: ActorContext,
  threadId: string,
  turnId: string,
): Promise<TurnRecord> {
  const userScope = userScopeFromActor(actor);
  const turn = await ctx.db
    .query("codex_turns")
    .withIndex("userScope_threadId_turnId", (q) =>
      q.eq("userScope", userScope).eq("threadId", threadId).eq("turnId", turnId),
    )
    .first();

  if (!turn) {
    throw new Error(`[E_TURN_NOT_FOUND] Turn not found: ${turnId}`);
  }
  return turn;
}

export async function requireTurnRefForActor(
  ctx: QueryCtx | MutationCtx,
  actor: ActorContext,
  threadId: string,
  turnId: string,
): Promise<{ turn: TurnRecord; turnRef: TurnRecord["_id"] }> {
  const turn = await requireTurnForActor(ctx, actor, threadId, turnId);
  return { turn, turnRef: turn._id };
}

export async function requireStreamForActor(
  ctx: QueryCtx | MutationCtx,
  actor: ActorContext,
  streamId: string,
): Promise<StreamRecord> {
  const userScope = userScopeFromActor(actor);
  const stream = await ctx.db
    .query("codex_streams")
    .withIndex("userScope_streamId", (q) =>
      q.eq("userScope", userScope).eq("streamId", streamId),
    )
    .first();

  if (!stream) {
    throw new Error(`[E_STREAM_NOT_FOUND] Stream not found: ${streamId}`);
  }
  return stream;
}

export function now(): number {
  return Date.now();
}

export function summarizeInput(input: Array<{ type: string; text?: string }>): string {
  const textParts = input
    .filter(
      (item): item is { type: "text"; text: string } =>
        item.type === "text" && typeof item.text === "string",
    )
    .map((item) => item.text);
  return textParts.join("\n").slice(0, 500);
}
