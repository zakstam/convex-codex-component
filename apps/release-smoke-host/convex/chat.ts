import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  dataHygiene as dataHygieneHandler,
  ensureSession as ensureSessionHandler,
  ensureThreadByCreate,
  ingestBatchStreamOnly,
  ingestEventStreamOnly,
  persistenceStats as persistenceStatsHandler,
  registerTurnStart as registerTurnStartHandler,
  threadSnapshot as threadSnapshotHandler,
  vHostActorContext,
  vHostDataHygiene,
  vHostEnsureSessionResult,
  vHostInboundEvent,
  vHostIngestSafeResult,
  vHostPersistenceStats,
} from "@zakstam/codex-local-component/host/convex";

export const ensureThread = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => ensureThreadByCreate(ctx, components.codexLocal, args),
});

export const registerTurnStart = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    turnId: v.string(),
    inputText: v.string(),
    idempotencyKey: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => registerTurnStartHandler(ctx, components.codexLocal, args),
});

export const ensureSession = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
  },
  returns: vHostEnsureSessionResult,
  handler: async (ctx, args) => ensureSessionHandler(ctx, components.codexLocal, args),
});

export const ingestEvent = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    event: vHostInboundEvent,
  },
  returns: vHostIngestSafeResult,
  handler: async (ctx, args) => ingestEventStreamOnly(ctx, components.codexLocal, args),
});

export const ingestBatch = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    deltas: v.array(vHostInboundEvent),
  },
  returns: vHostIngestSafeResult,
  handler: async (ctx, args) => ingestBatchStreamOnly(ctx, components.codexLocal, args),
});

export const threadSnapshot = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  handler: async (ctx, args) => threadSnapshotHandler(ctx, components.codexLocal, args),
});

export const persistenceStats = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  returns: vHostPersistenceStats,
  handler: async (ctx, args) => persistenceStatsHandler(ctx, components.codexLocal, args),
});

export const dataHygiene = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  returns: vHostDataHygiene,
  handler: async (ctx, args) => dataHygieneHandler(ctx, components.codexLocal, args),
});
