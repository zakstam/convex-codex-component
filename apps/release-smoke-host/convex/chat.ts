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
  type HostActorContext,
} from "@zakstam/codex-local-component/host/convex";

const SERVER_ACTOR: HostActorContext = Object.freeze({
  tenantId: process.env.ACTOR_TENANT_ID ?? "demo-tenant",
  userId: process.env.ACTOR_USER_ID ?? "demo-user",
  deviceId: process.env.ACTOR_DEVICE_ID ?? "release-smoke-server-device",
});

function withServerActor<T extends { actor: HostActorContext }>(args: T): T {
  return { ...args, actor: SERVER_ACTOR };
}

export const ensureThread = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => ensureThreadByCreate(ctx, components.codexLocal, withServerActor(args)),
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
  handler: async (ctx, args) =>
    registerTurnStartHandler(ctx, components.codexLocal, withServerActor(args)),
});

export const ensureSession = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
  },
  returns: vHostEnsureSessionResult,
  handler: async (ctx, args) => ensureSessionHandler(ctx, components.codexLocal, withServerActor(args)),
});

export const ingestEvent = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    event: vHostInboundEvent,
  },
  returns: vHostIngestSafeResult,
  handler: async (ctx, args) =>
    ingestEventStreamOnly(ctx, components.codexLocal, withServerActor(args)),
});

export const ingestBatch = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    deltas: v.array(vHostInboundEvent),
  },
  returns: vHostIngestSafeResult,
  handler: async (ctx, args) =>
    ingestBatchStreamOnly(ctx, components.codexLocal, withServerActor(args)),
});

export const threadSnapshot = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  handler: async (ctx, args) => threadSnapshotHandler(ctx, components.codexLocal, withServerActor(args)),
});

export const persistenceStats = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  returns: vHostPersistenceStats,
  handler: async (ctx, args) =>
    persistenceStatsHandler(ctx, components.codexLocal, withServerActor(args)),
});

export const dataHygiene = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  returns: vHostDataHygiene,
  handler: async (ctx, args) => dataHygieneHandler(ctx, components.codexLocal, withServerActor(args)),
});
