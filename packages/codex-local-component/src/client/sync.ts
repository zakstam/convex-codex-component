import type {
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";
import type { CodexQueryRunner, GenericQueryRef } from "./types.js";

type SyncComponent = {
  sync: {
    replay: GenericQueryRef;
    resumeReplay: GenericQueryRef;
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
