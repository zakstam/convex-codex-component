import type { HostActorContext } from "@zakstam/codex-runtime-convex/host";
import type { QueryCtx } from "./_generated/server";

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
  return { userId: userId ?? "server" };
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
