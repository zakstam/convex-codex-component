import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type { CodexQueryRunner } from "./types.js";

type SyncComponent = {
  sync: {
    replay: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
    resumeReplay: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

export async function replayStreams<Component extends SyncComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["sync"]["replay"]>,
): Promise<FunctionReturnType<Component["sync"]["replay"]>> {
  return ctx.runQuery(component.sync.replay, args);
}

export async function resumeStreamReplay<Component extends SyncComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["sync"]["resumeReplay"]>,
): Promise<FunctionReturnType<Component["sync"]["resumeReplay"]>> {
  return ctx.runQuery(component.sync.resumeReplay, args);
}
