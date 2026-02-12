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

type ThreadsCreateComponent = {
  threads: {
    create: GenericMutationRef;
  };
};

type ThreadsResolveComponent = {
  threads: {
    resolve: GenericMutationRef;
  };
};

type ThreadsResumeComponent = {
  threads: {
    resume: GenericMutationRef;
  };
};

type ThreadsGetStateComponent = {
  threads: {
    getState: GenericQueryRef;
  };
};

type ThreadsResolveByExternalIdComponent = {
  threads: {
    resolveByExternalId: GenericQueryRef;
  };
};

type ThreadsGetExternalMappingComponent = {
  threads: {
    getExternalMapping: GenericQueryRef;
  };
};

type ThreadsListComponent = {
  threads: {
    list: GenericQueryRef;
  };
};

type ThreadsDeleteCascadeComponent = {
  threads: {
    deleteCascade: GenericMutationRef;
  };
};

type ThreadsScheduleDeleteCascadeComponent = {
  threads: {
    scheduleDeleteCascade: GenericMutationRef;
  };
};

type ThreadsPurgeActorDataComponent = {
  threads: {
    purgeActorData: GenericMutationRef;
  };
};

type ThreadsSchedulePurgeActorDataComponent = {
  threads: {
    schedulePurgeActorData: GenericMutationRef;
  };
};

type ThreadsCancelScheduledDeletionComponent = {
  threads: {
    cancelScheduledDeletion: GenericMutationRef;
  };
};

type ThreadsForceRunScheduledDeletionComponent = {
  threads: {
    forceRunScheduledDeletion: GenericMutationRef;
  };
};

type ThreadsDeletionStatusComponent = {
  threads: {
    getDeletionJobStatus: GenericQueryRef;
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

export async function deleteThreadCascade<Component extends ThreadsDeleteCascadeComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["deleteCascade"]>,
): Promise<FunctionReturnType<Component["threads"]["deleteCascade"]>> {
  return ctx.runMutation(component.threads.deleteCascade, args);
}

export async function scheduleThreadDeleteCascade<Component extends ThreadsScheduleDeleteCascadeComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["scheduleDeleteCascade"]>,
): Promise<FunctionReturnType<Component["threads"]["scheduleDeleteCascade"]>> {
  return ctx.runMutation(component.threads.scheduleDeleteCascade, args);
}

export async function purgeActorCodexData<Component extends ThreadsPurgeActorDataComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["purgeActorData"]>,
): Promise<FunctionReturnType<Component["threads"]["purgeActorData"]>> {
  return ctx.runMutation(component.threads.purgeActorData, args);
}

export async function schedulePurgeActorCodexData<Component extends ThreadsSchedulePurgeActorDataComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["schedulePurgeActorData"]>,
): Promise<FunctionReturnType<Component["threads"]["schedulePurgeActorData"]>> {
  return ctx.runMutation(component.threads.schedulePurgeActorData, args);
}

export async function cancelScheduledDeletion<Component extends ThreadsCancelScheduledDeletionComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["cancelScheduledDeletion"]>,
): Promise<FunctionReturnType<Component["threads"]["cancelScheduledDeletion"]>> {
  return ctx.runMutation(component.threads.cancelScheduledDeletion, args);
}

export async function forceRunScheduledDeletion<Component extends ThreadsForceRunScheduledDeletionComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["forceRunScheduledDeletion"]>,
): Promise<FunctionReturnType<Component["threads"]["forceRunScheduledDeletion"]>> {
  return ctx.runMutation(component.threads.forceRunScheduledDeletion, args);
}

export async function getDeletionJobStatus<Component extends ThreadsDeletionStatusComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["threads"]["getDeletionJobStatus"]>,
): Promise<FunctionReturnType<Component["threads"]["getDeletionJobStatus"]>> {
  return ctx.runQuery(component.threads.getDeletionJobStatus, args);
}
