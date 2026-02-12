import { v } from "convex/values";
import type { ToolRequestUserInputQuestion } from "../protocol/schemas/v2/ToolRequestUserInputQuestion.js";
import { mutation, query } from "./_generated/server.js";
import { vActorContext } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import {
  authzError,
  now,
  requireThreadForActor,
  requireThreadRefForActor,
  requireTurnRefForActor,
} from "./utils.js";

const vManagedServerRequestMethod = v.union(
  v.literal("item/commandExecution/requestApproval"),
  v.literal("item/fileChange/requestApproval"),
  v.literal("item/tool/requestUserInput"),
  v.literal("item/tool/call"),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isToolRequestUserInputQuestion(value: unknown): value is ToolRequestUserInputQuestion {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.header === "string" &&
    typeof value.question === "string" &&
    typeof value.isOther === "boolean" &&
    typeof value.isSecret === "boolean" &&
    (value.options === null || Array.isArray(value.options))
  );
}

function toRequestStorageId(requestId: string | number): {
  requestIdType: "string" | "number";
  requestIdText: string;
} {
  if (typeof requestId === "number") {
    return {
      requestIdType: "number",
      requestIdText: String(requestId),
    };
  }
  return {
    requestIdType: "string",
    requestIdText: requestId,
  };
}

function fromRequestStorageId(args: {
  requestIdType: "string" | "number";
  requestIdText: string;
}): string | number {
  if (args.requestIdType === "number") {
    const parsed = Number(args.requestIdText);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return args.requestIdText;
}

function parseQuestionsJson(questionsJson: string | undefined): ToolRequestUserInputQuestion[] | undefined {
  if (!questionsJson) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(questionsJson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[E_SERVER_REQUEST_QUESTIONS_JSON_INVALID] Failed to parse questions JSON: ${reason}`);
  }
  if (Array.isArray(parsed) && parsed.every(isToolRequestUserInputQuestion)) {
    return parsed;
  }
  throw new Error("[E_SERVER_REQUEST_QUESTIONS_JSON_INVALID] questionsJson is not a valid ToolRequestUserInputQuestion[]");
}

export const upsertPending = mutation({
  args: {
    actor: vActorContext,
    requestId: v.union(v.string(), v.number()),
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    method: vManagedServerRequestMethod,
    payloadJson: v.string(),
    reason: v.optional(v.string()),
    questionsJson: v.optional(v.string()),
    requestedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { threadRef } = await requireThreadRefForActor(ctx, args.actor, args.threadId);
    const { turnRef } = await requireTurnRefForActor(ctx, args.actor, args.threadId, args.turnId);

    const requestId = toRequestStorageId(args.requestId);

    const existing = await ctx.db
      .query("codex_server_requests")
      .withIndex("userScope_threadId_requestIdType_requestIdText")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("requestIdType"), requestId.requestIdType),
          q.eq(q.field("requestIdText"), requestId.requestIdText),
        ),
      )
      .first();

    if (existing) {
      if (existing.userId !== args.actor.userId) {
        authzError(
          "E_AUTH_TURN_FORBIDDEN",
          `User ${args.actor.userId} cannot update server request ${requestId.requestIdText}`,
        );
      }
      await ctx.db.patch(existing._id, {
        threadRef,
        turnId: args.turnId,
        turnRef,
        itemId: args.itemId,
        method: args.method,
        payloadJson: args.payloadJson,
        status: "pending",
        ...(args.reason ? { reason: args.reason } : {}),
        ...(args.questionsJson ? { questionsJson: args.questionsJson } : {}),
        updatedAt: now(),
        resolvedAt: undefined,
        responseJson: undefined,
      });
      return null;
    }

    await ctx.db.insert("codex_server_requests", {
      userScope: userScopeFromActor(args.actor),
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      threadId: args.threadId,
      threadRef,
      turnId: args.turnId,
      turnRef,
      itemId: args.itemId,
      method: args.method,
      requestIdType: requestId.requestIdType,
      requestIdText: requestId.requestIdText,
      payloadJson: args.payloadJson,
      status: "pending",
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.questionsJson ? { questionsJson: args.questionsJson } : {}),
      createdAt: args.requestedAt,
      updatedAt: args.requestedAt,
    });

    return null;
  },
});

export const resolve = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    requestId: v.union(v.string(), v.number()),
    status: v.union(v.literal("answered"), v.literal("expired")),
    resolvedAt: v.number(),
    responseJson: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);
    const requestId = toRequestStorageId(args.requestId);

    const existing = await ctx.db
      .query("codex_server_requests")
      .withIndex("userScope_threadId_requestIdType_requestIdText")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("requestIdType"), requestId.requestIdType),
          q.eq(q.field("requestIdText"), requestId.requestIdText),
        ),
      )
      .first();

    if (!existing) {
      throw new Error(`Server request not found: ${requestId.requestIdText}`);
    }
    if (existing.userId !== args.actor.userId) {
      authzError(
        "E_AUTH_TURN_FORBIDDEN",
        `User ${args.actor.userId} cannot resolve server request ${requestId.requestIdText}`,
      );
    }

    await ctx.db.patch(existing._id, {
      status: args.status,
      updatedAt: args.resolvedAt,
      resolvedAt: args.resolvedAt,
      ...(args.responseJson ? { responseJson: args.responseJson } : {}),
    });

    return null;
  },
});

export const listPending = query({
  args: {
    actor: vActorContext,
    threadId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(200, args.limit ?? 100));

    if (args.threadId) {
      await requireThreadForActor(ctx, args.actor, args.threadId);
    }

    const rows = args.threadId
      ? await ctx.db
          .query("codex_server_requests")
          .withIndex("userScope_userId_threadId_status_updatedAt", (q) =>
            q
              .eq("userScope", userScopeFromActor(args.actor))
              .eq("userId", args.actor.userId)
              .eq("threadId", args.threadId!)
              .eq("status", "pending"),
          )
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("codex_server_requests")
          .withIndex("userScope_userId_status_updatedAt", (q) =>
            q
              .eq("userScope", userScopeFromActor(args.actor))
              .eq("userId", args.actor.userId)
              .eq("status", "pending"),
          )
          .order("desc")
          .take(limit);

    return rows.map((row) => ({
      requestId: fromRequestStorageId({
        requestIdType: row.requestIdType,
        requestIdText: row.requestIdText,
      }),
      method: row.method,
      threadId: row.threadId,
      turnId: row.turnId,
      itemId: row.itemId,
      payloadJson: row.payloadJson,
      status: row.status,
      ...(row.reason ? { reason: row.reason } : {}),
      ...(row.questionsJson
        ? {
            questions: parseQuestionsJson(row.questionsJson),
          }
        : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.resolvedAt ? { resolvedAt: row.resolvedAt } : {}),
      ...(row.responseJson ? { responseJson: row.responseJson } : {}),
    }));
  },
});
