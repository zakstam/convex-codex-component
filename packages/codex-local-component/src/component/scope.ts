import type { ActorContext } from "./types.js";

export const ANONYMOUS_USER_SCOPE = "__anonymous__";

export function userScopeFromActor(actor: ActorContext): string {
  const userId = actor.userId?.trim();
  return userId && userId.length > 0 ? userId : ANONYMOUS_USER_SCOPE;
}
