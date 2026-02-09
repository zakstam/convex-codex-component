import type { GenericId } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import type { ActorContext } from "./types.js";

type ThreadRecord = {
  _id: GenericId<"codex_threads">;
  tenantId: string;
  userId: string;
  threadId: string;
  status: string;
};

function asThreadRecord(value: unknown): ThreadRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec._id !== "string") {
    return null;
  }
  if (typeof rec.tenantId !== "string") {
    return null;
  }
  if (typeof rec.userId !== "string") {
    return null;
  }
  if (typeof rec.threadId !== "string") {
    return null;
  }
  if (typeof rec.status !== "string") {
    return null;
  }
  return {
    _id: rec._id as GenericId<"codex_threads">,
    tenantId: rec.tenantId,
    userId: rec.userId,
    threadId: rec.threadId,
    status: rec.status,
  };
}

type TurnRecord = {
  _id: GenericId<"codex_turns">;
  tenantId: string;
  userId: string;
  threadId: string;
  turnId: string;
  status: string;
};

function asTurnRecord(value: unknown): TurnRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec._id !== "string") {
    return null;
  }
  if (typeof rec.tenantId !== "string") {
    return null;
  }
  if (typeof rec.userId !== "string") {
    return null;
  }
  if (typeof rec.threadId !== "string") {
    return null;
  }
  if (typeof rec.turnId !== "string") {
    return null;
  }
  if (typeof rec.status !== "string") {
    return null;
  }
  return {
    _id: rec._id as GenericId<"codex_turns">,
    tenantId: rec.tenantId,
    userId: rec.userId,
    threadId: rec.threadId,
    turnId: rec.turnId,
    status: rec.status,
  };
}

export function authzError(code: "E_AUTH_THREAD_FORBIDDEN" | "E_AUTH_TURN_FORBIDDEN" | "E_AUTH_SESSION_FORBIDDEN", message: string): never {
  throw new Error(`[${code}] ${message}`);
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

  const normalized = asThreadRecord(thread);
  if (!normalized) {
    throw new Error(`Thread not found for tenant: ${threadId}`);
  }
  if (normalized.userId !== actor.userId) {
    authzError(
      "E_AUTH_THREAD_FORBIDDEN",
      `User ${actor.userId} is not allowed to access thread ${threadId}`,
    );
  }
  return normalized;
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

  const normalized = asTurnRecord(turn);
  if (!normalized) {
    throw new Error(`Turn not found: ${turnId}`);
  }
  if (normalized.userId !== actor.userId) {
    authzError(
      "E_AUTH_TURN_FORBIDDEN",
      `User ${actor.userId} is not allowed to access turn ${turnId}`,
    );
  }
  return normalized;
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
