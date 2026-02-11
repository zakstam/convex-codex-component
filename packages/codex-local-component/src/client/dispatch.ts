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

type DispatchComponent = {
  dispatch: {
    enqueueTurnDispatch: GenericMutationRef;
    claimNextTurnDispatch: GenericMutationRef;
    markTurnStarted: GenericMutationRef;
    markTurnCompleted: GenericMutationRef;
    markTurnFailed: GenericMutationRef;
    cancelTurnDispatch: GenericMutationRef;
    getTurnDispatchState: GenericQueryRef;
  };
};

export async function enqueueTurnDispatch<Component extends DispatchComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["dispatch"]["enqueueTurnDispatch"]>,
): Promise<FunctionReturnType<Component["dispatch"]["enqueueTurnDispatch"]>> {
  return ctx.runMutation(component.dispatch.enqueueTurnDispatch, args);
}

export async function claimNextTurnDispatch<Component extends DispatchComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["dispatch"]["claimNextTurnDispatch"]>,
): Promise<FunctionReturnType<Component["dispatch"]["claimNextTurnDispatch"]>> {
  return ctx.runMutation(component.dispatch.claimNextTurnDispatch, args);
}

export async function markTurnStarted<Component extends DispatchComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["dispatch"]["markTurnStarted"]>,
): Promise<FunctionReturnType<Component["dispatch"]["markTurnStarted"]>> {
  return ctx.runMutation(component.dispatch.markTurnStarted, args);
}

export async function markTurnCompleted<Component extends DispatchComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["dispatch"]["markTurnCompleted"]>,
): Promise<FunctionReturnType<Component["dispatch"]["markTurnCompleted"]>> {
  return ctx.runMutation(component.dispatch.markTurnCompleted, args);
}

export async function markTurnFailed<Component extends DispatchComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["dispatch"]["markTurnFailed"]>,
): Promise<FunctionReturnType<Component["dispatch"]["markTurnFailed"]>> {
  return ctx.runMutation(component.dispatch.markTurnFailed, args);
}

export async function cancelTurnDispatch<Component extends DispatchComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["dispatch"]["cancelTurnDispatch"]>,
): Promise<FunctionReturnType<Component["dispatch"]["cancelTurnDispatch"]>> {
  return ctx.runMutation(component.dispatch.cancelTurnDispatch, args);
}

export async function getTurnDispatchState<Component extends DispatchComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["dispatch"]["getTurnDispatchState"]>,
): Promise<FunctionReturnType<Component["dispatch"]["getTurnDispatchState"]>> {
  return ctx.runQuery(component.dispatch.getTurnDispatchState, args);
}
