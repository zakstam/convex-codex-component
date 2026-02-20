import type { HostActorContext } from "./convexSlice.js";

type AuthIdentity = { subject?: unknown } | null;

type AuthIdentityCtx = {
  auth: {
    getUserIdentity: () => Promise<AuthIdentity>;
  };
};

function authError(message: string): never {
  throw new Error(`[E_AUTH_SESSION_FORBIDDEN] authorization failed: ${message}`);
}

export async function resolveActorFromAuth(
  ctx: AuthIdentityCtx,
  requestedActor: HostActorContext = {},
): Promise<HostActorContext> {
  const identity = await ctx.auth.getUserIdentity();
  const subject =
    identity && typeof identity === "object" && typeof identity.subject === "string" && identity.subject.length > 0
      ? identity.subject
      : undefined;

  if (subject === undefined) {
    if (requestedActor.userId !== undefined) {
      authError("requested actor userId requires an authenticated identity");
    }
    return {};
  }

  if (requestedActor.userId !== undefined && requestedActor.userId !== subject) {
    authError(`requested actor userId mismatch for identity subject: ${subject}`);
  }

  return { userId: subject };
}
