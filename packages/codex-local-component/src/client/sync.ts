import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type { CodexQueryRunner } from "./types.js";

type SyncComponent = {
  sync: {
    pullState: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
    resumeFromCursor: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

export async function syncStreams<Component extends SyncComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["sync"]["pullState"]>,
): Promise<FunctionReturnType<Component["sync"]["pullState"]>> {
  return ctx.runQuery(component.sync.pullState, args);
}

export async function resumeStream<Component extends SyncComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["sync"]["resumeFromCursor"]>,
): Promise<FunctionReturnType<Component["sync"]["resumeFromCursor"]>> {
  return ctx.runQuery(component.sync.resumeFromCursor, args);
}
