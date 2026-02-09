import { v } from "convex/values";

export const vActorContext = v.object({
  tenantId: v.string(),
  userId: v.string(),
  deviceId: v.string(),
});

export const vThreadInputItem = v.object({
  type: v.string(),
  text: v.optional(v.string()),
  url: v.optional(v.string()),
  path: v.optional(v.string()),
});

export const vTurnOptions = v.object({
  model: v.optional(v.string()),
  effort: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  cwd: v.optional(v.string()),
  personality: v.optional(v.string()),
  approvalPolicy: v.optional(v.string()),
  sandboxPolicy: v.optional(v.string()),
});

export const vSyncRuntimeOptions = v.object({
  saveStreamDeltas: v.optional(v.boolean()),
  maxDeltasPerStreamRead: v.optional(v.number()),
  maxDeltasPerRequestRead: v.optional(v.number()),
  finishedStreamDeleteDelayMs: v.optional(v.number()),
});

export type ActorContext = {
  tenantId: string;
  userId: string;
  deviceId: string;
};
