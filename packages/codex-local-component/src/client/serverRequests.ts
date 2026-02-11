import type {
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";
import type {
  CodexMutationRunner,
  CodexQueryRunner,
  GenericMutationRef,
  GenericQueryRef,
} from "./types.js";

type ServerRequestsComponent = {
  serverRequests: {
    upsertPending: GenericMutationRef;
    resolve: GenericMutationRef;
    listPending: GenericQueryRef;
  };
};

export async function upsertPendingServerRequest<Component extends ServerRequestsComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["serverRequests"]["upsertPending"]>,
): Promise<FunctionReturnType<Component["serverRequests"]["upsertPending"]>> {
  return ctx.runMutation(component.serverRequests.upsertPending, args);
}

export async function resolvePendingServerRequest<Component extends ServerRequestsComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["serverRequests"]["resolve"]>,
): Promise<FunctionReturnType<Component["serverRequests"]["resolve"]>> {
  return ctx.runMutation(component.serverRequests.resolve, args);
}

export async function listPendingServerRequests<Component extends ServerRequestsComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["serverRequests"]["listPending"]>,
): Promise<FunctionReturnType<Component["serverRequests"]["listPending"]>> {
  return ctx.runQuery(component.serverRequests.listPending, args);
}
