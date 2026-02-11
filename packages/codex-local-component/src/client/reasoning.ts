import type {
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";
import type { CodexQueryRunner, GenericQueryRef } from "./types.js";

type ReasoningComponent = {
  reasoning: {
    listByThread: GenericQueryRef;
  };
};

export async function listReasoningByThread<Component extends ReasoningComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["reasoning"]["listByThread"]>,
): Promise<FunctionReturnType<Component["reasoning"]["listByThread"]>> {
  return ctx.runQuery(component.reasoning.listByThread, args);
}
