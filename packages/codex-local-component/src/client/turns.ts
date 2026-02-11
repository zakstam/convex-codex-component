import type {
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";
import type { CodexMutationRunner, GenericMutationRef } from "./types.js";

type TurnsStartComponent = {
  turns: {
    start: GenericMutationRef;
  };
};

type TurnsInterruptComponent = {
  turns: {
    interrupt: GenericMutationRef;
  };
};

export async function startTurn<Component extends TurnsStartComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["turns"]["start"]>,
): Promise<FunctionReturnType<Component["turns"]["start"]>> {
  return ctx.runMutation(component.turns.start, args);
}

export async function interruptTurn<Component extends TurnsInterruptComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["turns"]["interrupt"]>,
): Promise<FunctionReturnType<Component["turns"]["interrupt"]>> {
  return ctx.runMutation(component.turns.interrupt, args);
}
