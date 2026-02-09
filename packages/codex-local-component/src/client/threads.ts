import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type { CodexQueryRunner } from "./types.js";

type ThreadsComponent = {
  threads: {
    getState: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

export async function getThreadState<Component extends ThreadsComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["getState"]>,
): Promise<FunctionReturnType<Component["threads"]["getState"]>> {
  return ctx.runQuery(component.threads.getState, args);
}
