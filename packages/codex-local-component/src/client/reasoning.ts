import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type { CodexQueryRunner } from "./types.js";

type ReasoningComponent = {
  reasoning: {
    listByThread: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

export async function listReasoningByThread<Component extends ReasoningComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["reasoning"]["listByThread"]>,
): Promise<FunctionReturnType<Component["reasoning"]["listByThread"]>> {
  return ctx.runQuery(component.reasoning.listByThread, args);
}
