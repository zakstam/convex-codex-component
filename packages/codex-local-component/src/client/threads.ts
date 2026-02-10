import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type { CodexMutationRunner, CodexQueryRunner } from "./types.js";

type ThreadsCreateComponent = {
  threads: {
    create: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type ThreadsResolveComponent = {
  threads: {
    resolve: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type ThreadsResumeComponent = {
  threads: {
    resume: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type ThreadsGetStateComponent = {
  threads: {
    getState: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type ThreadsResolveByExternalIdComponent = {
  threads: {
    resolveByExternalId: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type ThreadsGetExternalMappingComponent = {
  threads: {
    getExternalMapping: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

type ThreadsListComponent = {
  threads: {
    list: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
  };
};

export async function createThread<Component extends ThreadsCreateComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["create"]>,
): Promise<FunctionReturnType<Component["threads"]["create"]>> {
  return ctx.runMutation(component.threads.create, args);
}

export async function resolveThread<Component extends ThreadsResolveComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["resolve"]>,
): Promise<FunctionReturnType<Component["threads"]["resolve"]>> {
  return ctx.runMutation(component.threads.resolve, args);
}

export async function resumeThread<Component extends ThreadsResumeComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["resume"]>,
): Promise<FunctionReturnType<Component["threads"]["resume"]>> {
  return ctx.runMutation(component.threads.resume, args);
}

export async function getThreadState<Component extends ThreadsGetStateComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["getState"]>,
): Promise<FunctionReturnType<Component["threads"]["getState"]>> {
  return ctx.runQuery(component.threads.getState, args);
}

export async function resolveThreadByExternalId<Component extends ThreadsResolveByExternalIdComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["resolveByExternalId"]>,
): Promise<FunctionReturnType<Component["threads"]["resolveByExternalId"]>> {
  return ctx.runQuery(component.threads.resolveByExternalId, args);
}

export async function getExternalThreadMapping<Component extends ThreadsGetExternalMappingComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["getExternalMapping"]>,
): Promise<FunctionReturnType<Component["threads"]["getExternalMapping"]>> {
  return ctx.runQuery(component.threads.getExternalMapping, args);
}

export async function listThreads<Component extends ThreadsListComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["list"]>,
): Promise<FunctionReturnType<Component["threads"]["list"]>> {
  return ctx.runQuery(component.threads.list, args);
}
