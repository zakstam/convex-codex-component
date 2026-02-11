import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server.js";
import { mutation, query } from "./_generated/server.js";
import { vActorContext, vThreadInputItem } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import { authzError, now, requireThreadForActor, summarizeInput } from "./utils.js";

const DEFAULT_LEASE_MS = 15_000;
const MAX_CLAIM_SCAN = 200;
type DispatchStatus = "queued" | "claimed" | "started" | "completed" | "failed" | "cancelled";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureDispatchToken(args: {
  expectedToken: string | undefined;
  providedToken: string;
  dispatchId: string;
}): void {
  if (!args.expectedToken || args.expectedToken !== args.providedToken) {
    throw new Error(`Dispatch claim token mismatch for dispatchId=${args.dispatchId}`);
  }
}

async function requireDispatchForActor(args: {
  ctx: MutationCtx;
  actor: { userId?: string };
  threadId: string;
  dispatchId: string;
}) {
  const dispatch = await args.ctx.db
    .query("codex_turn_dispatches")
    .withIndex("userScope_threadId_dispatchId", (q) =>
      q
        .eq("userScope", userScopeFromActor(args.actor))
        .eq("threadId", args.threadId)
        .eq("dispatchId", args.dispatchId),
    )
    .first();

  if (!dispatch) {
    throw new Error(`Dispatch not found: ${args.dispatchId}`);
  }
  if (dispatch.userId !== args.actor.userId) {
    authzError(
      "E_AUTH_TURN_FORBIDDEN",
      `User ${args.actor.userId} is not allowed to access dispatch ${args.dispatchId}`,
    );
  }
  return dispatch;
}

export const enqueueTurnDispatch = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    dispatchId: v.optional(v.string()),
    turnId: v.string(),
    idempotencyKey: v.string(),
    input: v.array(vThreadInputItem),
  },
  returns: v.object({
    dispatchId: v.string(),
    turnId: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("started"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    accepted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);

    const existingByIdempotency = await ctx.db
      .query("codex_turn_dispatches")
      .withIndex("userScope_threadId_idempotencyKey", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("threadId", args.threadId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .first();

    if (existingByIdempotency) {
      return {
        dispatchId: String(existingByIdempotency.dispatchId),
        turnId: String(existingByIdempotency.turnId),
        status: existingByIdempotency.status as DispatchStatus,
        accepted: true,
      };
    }

    const ts = now();
    const dispatchId = args.dispatchId ?? randomId();
    await ctx.db.insert("codex_turn_dispatches", {
      userScope: userScopeFromActor(args.actor),
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      threadId: args.threadId,
      dispatchId,
      turnId: args.turnId,
      idempotencyKey: args.idempotencyKey,
      inputText: summarizeInput(args.input),
      status: "queued",
      leaseExpiresAt: 0,
      attemptCount: 0,
      createdAt: ts,
      updatedAt: ts,
    });

    const existingTurn = await ctx.db
      .query("codex_turns")
      .withIndex("userScope_threadId_turnId", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("threadId", args.threadId)
          .eq("turnId", args.turnId),
      )
      .first();

    if (!existingTurn) {
      await ctx.db.insert("codex_turns", {
        userScope: userScopeFromActor(args.actor),
        ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
        threadId: args.threadId,
        turnId: args.turnId,
        status: "queued",
        idempotencyKey: args.idempotencyKey,
        inputSummary: summarizeInput(args.input),
        startedAt: ts,
      });
    }

    return {
      dispatchId,
      turnId: args.turnId,
      status: "queued" as const,
      accepted: true,
    };
  },
});

export const claimNextTurnDispatch = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    claimOwner: v.string(),
    leaseMs: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      dispatchId: v.string(),
      turnId: v.string(),
      idempotencyKey: v.string(),
      inputText: v.string(),
      claimToken: v.string(),
      leaseExpiresAt: v.number(),
      attemptCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);
    const ts = now();
    const leaseMs = Math.max(1_000, Math.floor(args.leaseMs ?? DEFAULT_LEASE_MS));

    const queued = await ctx.db
      .query("codex_turn_dispatches")
      .withIndex("userScope_threadId_status_createdAt", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("threadId", args.threadId)
          .eq("status", "queued"),
      )
      .order("asc")
      .take(MAX_CLAIM_SCAN);

    const expiredClaimed = await ctx.db
      .query("codex_turn_dispatches")
      .withIndex("userScope_threadId_status_leaseExpiresAt", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("threadId", args.threadId)
          .eq("status", "claimed")
          .lte("leaseExpiresAt", ts),
      )
      .order("asc")
      .take(MAX_CLAIM_SCAN);

    const next = [...queued, ...expiredClaimed]
      .filter((row) => row.userId === args.actor.userId)
      .sort((left, right) => Number(left.createdAt) - Number(right.createdAt))[0];

    if (!next) {
      return null;
    }

    const claimToken = randomId();
    const attemptCount = Number(next.attemptCount) + 1;
    const leaseExpiresAt = ts + leaseMs;
    await ctx.db.patch(next._id, {
      status: "claimed",
      claimOwner: args.claimOwner,
      claimToken,
      leaseExpiresAt,
      attemptCount,
      updatedAt: ts,
      failureCode: undefined,
      failureReason: undefined,
    });

    return {
      dispatchId: String(next.dispatchId),
      turnId: String(next.turnId),
      idempotencyKey: String(next.idempotencyKey),
      inputText: String(next.inputText),
      claimToken,
      leaseExpiresAt,
      attemptCount,
    };
  },
});

export const markTurnStarted = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    dispatchId: v.string(),
    claimToken: v.string(),
    runtimeThreadId: v.optional(v.string()),
    runtimeTurnId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);
    const ts = now();
    const dispatch = await requireDispatchForActor({
      ctx,
      actor: args.actor,
      threadId: args.threadId,
      dispatchId: args.dispatchId,
    });

    if (dispatch.status === "completed" || dispatch.status === "failed" || dispatch.status === "cancelled") {
      return null;
    }
    if (dispatch.status !== "claimed" && dispatch.status !== "started") {
      throw new Error(`Dispatch ${args.dispatchId} is not claimable for started transition`);
    }

    ensureDispatchToken({
      expectedToken: dispatch.claimToken,
      providedToken: args.claimToken,
      dispatchId: args.dispatchId,
    });

    await ctx.db.patch(dispatch._id, {
      status: "started",
      runtimeThreadId: args.runtimeThreadId ?? dispatch.runtimeThreadId,
      runtimeTurnId: args.runtimeTurnId ?? dispatch.runtimeTurnId ?? dispatch.turnId,
      startedAt: dispatch.startedAt ?? ts,
      updatedAt: ts,
      leaseExpiresAt: ts + DEFAULT_LEASE_MS,
    });

    const turn = await ctx.db
      .query("codex_turns")
      .withIndex("userScope_threadId_turnId", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("threadId", args.threadId)
          .eq("turnId", String(dispatch.turnId)),
      )
      .first();
    if (turn && turn.status === "queued") {
      await ctx.db.patch(turn._id, { status: "inProgress" });
    }

    return null;
  },
});

export const markTurnCompleted = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    dispatchId: v.string(),
    claimToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);
    const ts = now();
    const dispatch = await requireDispatchForActor({
      ctx,
      actor: args.actor,
      threadId: args.threadId,
      dispatchId: args.dispatchId,
    });

    if (dispatch.status === "completed") {
      return null;
    }
    if (dispatch.status === "failed" || dispatch.status === "cancelled") {
      throw new Error(`Dispatch ${args.dispatchId} already terminal with status=${dispatch.status}`);
    }
    ensureDispatchToken({
      expectedToken: dispatch.claimToken,
      providedToken: args.claimToken,
      dispatchId: args.dispatchId,
    });

    await ctx.db.patch(dispatch._id, {
      status: "completed",
      completedAt: ts,
      updatedAt: ts,
      leaseExpiresAt: 0,
    });

    return null;
  },
});

export const markTurnFailed = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    dispatchId: v.string(),
    claimToken: v.string(),
    code: v.optional(v.string()),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);
    const ts = now();
    const dispatch = await requireDispatchForActor({
      ctx,
      actor: args.actor,
      threadId: args.threadId,
      dispatchId: args.dispatchId,
    });

    if (dispatch.status === "failed") {
      return null;
    }
    if (dispatch.status === "completed" || dispatch.status === "cancelled") {
      throw new Error(`Dispatch ${args.dispatchId} already terminal with status=${dispatch.status}`);
    }
    ensureDispatchToken({
      expectedToken: dispatch.claimToken,
      providedToken: args.claimToken,
      dispatchId: args.dispatchId,
    });

    await ctx.db.patch(dispatch._id, {
      status: "failed",
      completedAt: ts,
      updatedAt: ts,
      leaseExpiresAt: 0,
      failureCode: args.code,
      failureReason: args.reason,
    });

    return null;
  },
});

export const cancelTurnDispatch = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    dispatchId: v.string(),
    claimToken: v.optional(v.string()),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);
    const ts = now();
    const dispatch = await requireDispatchForActor({
      ctx,
      actor: args.actor,
      threadId: args.threadId,
      dispatchId: args.dispatchId,
    });

    if (dispatch.status === "cancelled") {
      return null;
    }
    if (dispatch.status === "completed" || dispatch.status === "failed") {
      throw new Error(`Dispatch ${args.dispatchId} already terminal with status=${dispatch.status}`);
    }

    if (dispatch.status === "claimed" || dispatch.status === "started") {
      if (!args.claimToken) {
        throw new Error(`claimToken is required to cancel claimed/started dispatch ${args.dispatchId}`);
      }
      ensureDispatchToken({
        expectedToken: dispatch.claimToken,
        providedToken: args.claimToken,
        dispatchId: args.dispatchId,
      });
    }

    await ctx.db.patch(dispatch._id, {
      status: "cancelled",
      cancelledAt: ts,
      completedAt: ts,
      updatedAt: ts,
      leaseExpiresAt: 0,
      failureReason: args.reason,
    });

    return null;
  },
});

export const getTurnDispatchState = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    dispatchId: v.optional(v.string()),
    turnId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      dispatchId: v.string(),
      turnId: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("claimed"),
        v.literal("started"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      idempotencyKey: v.string(),
      inputText: v.string(),
      claimToken: v.optional(v.string()),
      claimOwner: v.optional(v.string()),
      leaseExpiresAt: v.number(),
      attemptCount: v.number(),
      runtimeThreadId: v.optional(v.string()),
      runtimeTurnId: v.optional(v.string()),
      failureCode: v.optional(v.string()),
      failureReason: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      cancelledAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);

    if (typeof args.dispatchId === "string") {
      const dispatchId = args.dispatchId;
      const byDispatchId = await ctx.db
        .query("codex_turn_dispatches")
        .withIndex("userScope_threadId_dispatchId", (q) =>
          q
            .eq("userScope", userScopeFromActor(args.actor))
            .eq("threadId", args.threadId)
            .eq("dispatchId", dispatchId),
        )
        .first();

      if (!byDispatchId || byDispatchId.userId !== args.actor.userId) {
        return null;
      }
      return {
        dispatchId: String(byDispatchId.dispatchId),
        turnId: String(byDispatchId.turnId),
        status: byDispatchId.status,
        idempotencyKey: String(byDispatchId.idempotencyKey),
        inputText: String(byDispatchId.inputText),
        ...(byDispatchId.claimToken !== undefined ? { claimToken: byDispatchId.claimToken } : {}),
        leaseExpiresAt: Number(byDispatchId.leaseExpiresAt),
        attemptCount: Number(byDispatchId.attemptCount),
        createdAt: Number(byDispatchId.createdAt),
        updatedAt: Number(byDispatchId.updatedAt),
        ...(byDispatchId.claimOwner !== undefined ? { claimOwner: byDispatchId.claimOwner } : {}),
        ...(byDispatchId.runtimeThreadId !== undefined ? { runtimeThreadId: byDispatchId.runtimeThreadId } : {}),
        ...(byDispatchId.runtimeTurnId !== undefined ? { runtimeTurnId: byDispatchId.runtimeTurnId } : {}),
        ...(byDispatchId.failureCode !== undefined ? { failureCode: byDispatchId.failureCode } : {}),
        ...(byDispatchId.failureReason !== undefined ? { failureReason: byDispatchId.failureReason } : {}),
        ...(byDispatchId.startedAt !== undefined ? { startedAt: byDispatchId.startedAt } : {}),
        ...(byDispatchId.completedAt !== undefined ? { completedAt: byDispatchId.completedAt } : {}),
        ...(byDispatchId.cancelledAt !== undefined ? { cancelledAt: byDispatchId.cancelledAt } : {}),
      };
    }

    if (!args.turnId) {
      throw new Error("getTurnDispatchState requires dispatchId or turnId");
    }

    const rows = await ctx.db
      .query("codex_turn_dispatches")
      .withIndex("userScope_threadId_turnId", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("threadId", args.threadId)
          .eq("turnId", args.turnId!),
      )
      .collect();

    const row = rows
      .filter((item) => item.userId === args.actor.userId)
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt))[0];
    if (!row) {
      return null;
    }

    return {
      dispatchId: String(row.dispatchId),
      turnId: String(row.turnId),
      status: row.status,
      idempotencyKey: String(row.idempotencyKey),
      inputText: String(row.inputText),
      ...(row.claimToken !== undefined ? { claimToken: row.claimToken } : {}),
      leaseExpiresAt: Number(row.leaseExpiresAt),
      attemptCount: Number(row.attemptCount),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      ...(row.claimOwner !== undefined ? { claimOwner: row.claimOwner } : {}),
      ...(row.runtimeThreadId !== undefined ? { runtimeThreadId: row.runtimeThreadId } : {}),
      ...(row.runtimeTurnId !== undefined ? { runtimeTurnId: row.runtimeTurnId } : {}),
      ...(row.failureCode !== undefined ? { failureCode: row.failureCode } : {}),
      ...(row.failureReason !== undefined ? { failureReason: row.failureReason } : {}),
      ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
      ...(row.completedAt !== undefined ? { completedAt: row.completedAt } : {}),
      ...(row.cancelledAt !== undefined ? { cancelledAt: row.cancelledAt } : {}),
    };
  },
});
