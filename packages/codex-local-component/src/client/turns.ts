import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type { CodexMutationRunner } from "./types.js";

type TurnsComponent = {
  turns: {
    start: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
    interrupt: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

export async function startTurn<Component extends TurnsComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["turns"]["start"]>,
): Promise<FunctionReturnType<Component["turns"]["start"]>> {
  return ctx.runMutation(component.turns.start, args);
}

export async function interruptTurn<Component extends TurnsComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["turns"]["interrupt"]>,
): Promise<FunctionReturnType<Component["turns"]["interrupt"]>> {
  return ctx.runMutation(component.turns.interrupt, args);
}
