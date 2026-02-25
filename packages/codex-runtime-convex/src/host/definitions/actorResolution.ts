import type { HostActorContext } from "../convexSlice.js";

export function resolveHostActor(
  actor: HostActorContext,
  fallback: HostActorContext,
): HostActorContext {
  // Authentication and actor identity are consumer-managed. Host definitions
  // pass through the caller actor when present and only fall back for
  // anonymous calls.
  return actor.userId === undefined && actor.anonymousId === undefined ? fallback : actor;
}

export function withResolvedHostActor<T extends { actor: HostActorContext }>(
  args: T,
  fallback: HostActorContext,
): T {
  return { ...args, actor: resolveHostActor(args.actor, fallback) };
}
