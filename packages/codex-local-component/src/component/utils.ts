import type { Doc } from "./_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import type { ActorContext } from "./types.js";

type ThreadRecord = Doc<"codex_threads">;
type TurnRecord = Doc<"codex_turns">;

export function authzError(code: "E_AUTH_THREAD_FORBIDDEN" | "E_AUTH_TURN_FORBIDDEN" | "E_AUTH_SESSION_FORBIDDEN", message: string): never {
  void message;
  throw new Error(`[${code}] authorization failed`);
}

export async function requireThreadForActor(
  ctx: QueryCtx | MutationCtx,
  actor: ActorContext,
  threadId: string,
): Promise<ThreadRecord> {
  const thread = await ctx.db
    .query("codex_threads")
    .withIndex("tenantId_threadId")
    .filter((q) =>
      q.and(
        q.eq(q.field("tenantId"), actor.tenantId),
        q.eq(q.field("threadId"), threadId),
      ),
    )
    .first();

  if (!thread) {
    throw new Error(`Thread not found for tenant: ${threadId}`);
  }
  if (thread.userId !== actor.userId) {
    authzError("E_AUTH_THREAD_FORBIDDEN", "thread access denied");
  }
  return thread;
}

export async function requireTurnForActor(
  ctx: QueryCtx | MutationCtx,
  actor: ActorContext,
  threadId: string,
  turnId: string,
): Promise<TurnRecord> {
  const turn = await ctx.db
    .query("codex_turns")
    .withIndex("tenantId_threadId_turnId")
    .filter((q) =>
      q.and(
        q.eq(q.field("tenantId"), actor.tenantId),
        q.eq(q.field("threadId"), threadId),
        q.eq(q.field("turnId"), turnId),
      ),
    )
    .first();

  if (!turn) {
    throw new Error(`Turn not found: ${turnId}`);
  }
  if (turn.userId !== actor.userId) {
    authzError("E_AUTH_TURN_FORBIDDEN", "turn access denied");
  }
  return turn;
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
