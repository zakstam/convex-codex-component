import type { ActorContext } from "./types.js";

export const ANONYMOUS_USER_SCOPE = "__anonymous__";

export function userScopeFromActor(actor: ActorContext): string {
  const userId = actor.userId?.trim();
  if (userId && userId.length > 0) {
    return userId;
  }
  const anonymousId = actor.anonymousId?.trim();
  if (anonymousId && anonymousId.length > 0) {
    return `anon:${anonymousId}`;
  }
  return ANONYMOUS_USER_SCOPE;
}
