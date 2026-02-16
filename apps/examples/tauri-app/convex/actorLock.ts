import type { HostActorContext } from "@zakstam/codex-local-component/host/convex";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const SERVER_ACTOR: HostActorContext = {
  ...(process.env.ACTOR_USER_ID ? { userId: process.env.ACTOR_USER_ID } : {}),
};

const ACTOR_LOCK_TABLE = "tauri_actor_lock";
const ACTOR_LOCK_ENABLED = process.env.TAURI_ACTOR_LOCK?.trim() === "1";

function requireIncomingUserId(actor: HostActorContext): string {
  const incomingUserId = actor.userId?.trim();
  if (!incomingUserId) {
    throw new Error("actor.userId is required for tauri host API calls.");
  }
  return incomingUserId;
}

function validatePinnedUserId(incomingUserId: string): string | null {
  const pinnedUserId = process.env.ACTOR_USER_ID?.trim() ?? null;
  if (pinnedUserId && pinnedUserId !== incomingUserId) {
    throw new Error(
      `actor.userId mismatch. This host is pinned to userId=${pinnedUserId}.`,
    );
  }
  return pinnedUserId;
}

function validateBoundUserId(
  incomingUserId: string,
  boundUserId: string | null,
): void {
  if (boundUserId && boundUserId !== incomingUserId) {
    throw new Error(
      `actor.userId mismatch. This host is bound to userId=${boundUserId}.`,
    );
  }
}

function toServerActor(userId: string | null | undefined): HostActorContext {
  return userId ? { userId } : {};
}

export async function requireBoundServerActorForMutation(
  ctx: MutationCtx,
  actor: HostActorContext,
): Promise<HostActorContext> {
  const incomingUserId = requireIncomingUserId(actor);
  const pinnedUserId = validatePinnedUserId(incomingUserId);
  if (!ACTOR_LOCK_ENABLED) {
    return toServerActor(pinnedUserId ?? incomingUserId);
  }

  const lock = await ctx.db.query(ACTOR_LOCK_TABLE).first();
  const boundUserId = lock?.userId?.trim() ?? null;

  validateBoundUserId(incomingUserId, boundUserId);
  if (!boundUserId) {
    const resolvedUserId = pinnedUserId ?? incomingUserId;
    await ctx.db.insert(ACTOR_LOCK_TABLE, {
      userId: resolvedUserId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return toServerActor(resolvedUserId);
  }

  return toServerActor(boundUserId);
}

export async function requireBoundServerActorForQuery(
  ctx: QueryCtx,
  actor: HostActorContext,
): Promise<HostActorContext> {
  const incomingUserId = requireIncomingUserId(actor);
  const pinnedUserId = validatePinnedUserId(incomingUserId);
  if (!ACTOR_LOCK_ENABLED) {
    return toServerActor(pinnedUserId ?? incomingUserId);
  }
  const lock = await ctx.db.query(ACTOR_LOCK_TABLE).first();
  const boundUserId = lock?.userId?.trim() ?? pinnedUserId;

  validateBoundUserId(incomingUserId, boundUserId ?? null);
  return toServerActor(boundUserId ?? incomingUserId);
}

export async function readActorBindingForBootstrap(
  ctx: QueryCtx,
): Promise<{
  lockEnabled: boolean;
  boundUserId: string | null;
  pinnedUserId: string | null;
}> {
  const pinnedUserId = process.env.ACTOR_USER_ID?.trim() ?? null;
  if (!ACTOR_LOCK_ENABLED) {
    return {
      lockEnabled: false,
      boundUserId: null,
      pinnedUserId,
    };
  }
  const lock = await ctx.db.query(ACTOR_LOCK_TABLE).first();
  return {
    lockEnabled: true,
    boundUserId: lock?.userId?.trim() ?? null,
    pinnedUserId,
  };
}
