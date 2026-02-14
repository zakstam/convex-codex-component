/**
 * Hook delegation functions for the Codex host slice.
 * Each function wraps a component API call with actor context forwarding.
 * Extracted from convexSlice.ts for file-size compliance.
 */
import type { FunctionReturnType } from "convex/server";
import {
  listThreadMessagesForHooks,
  listThreadReasoningForHooks,
  type HostMessagesForHooksArgs,
  type HostReasoningForHooksArgs,
} from "./convex.js";
import type { HostActorContext, HostQueryRunner, HostMutationRunner } from "./convexSlice.js";

type CodexMessagesComponent = {
  messages: {
    listByThread: import("convex/server").FunctionReference<"query", "public" | "internal">;
    getByTurn: import("convex/server").FunctionReference<"query", "public" | "internal">;
  };
};

type CodexApprovalsComponent = {
  approvals: {
    listPending: import("convex/server").FunctionReference<"query", "public" | "internal">;
    respond: import("convex/server").FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexServerRequestsComponent = {
  serverRequests: {
    listPending: import("convex/server").FunctionReference<"query", "public" | "internal">;
    upsertPending: import("convex/server").FunctionReference<"mutation", "public" | "internal">;
    resolve: import("convex/server").FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexTokenUsageComponent = {
  tokenUsage: {
    upsert: import("convex/server").FunctionReference<"mutation", "public" | "internal">;
    listByThread: import("convex/server").FunctionReference<"query", "public" | "internal">;
  };
};

type CodexTurnsComponent = {
  turns: {
    interrupt: import("convex/server").FunctionReference<"mutation", "public" | "internal">;
  };
};

type CodexSyncComponent = {
  sync: {
    ensureSession: import("convex/server").FunctionReference<"mutation", "public" | "internal">;
    ingestSafe: import("convex/server").FunctionReference<"mutation", "public" | "internal">;
    replay: import("convex/server").FunctionReference<"query", "public" | "internal">;
  };
};

type CodexReasoningComponent = {
  reasoning: {
    listByThread: import("convex/server").FunctionReference<"query", "public" | "internal">;
  };
};

type CodexHooksComponent = CodexMessagesComponent & CodexSyncComponent;

export async function listThreadMessagesForHooksForActor<
  Component extends CodexHooksComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: HostMessagesForHooksArgs<HostActorContext>,
): Promise<
  FunctionReturnType<Component["messages"]["listByThread"]> & {
    streams?:
      | { kind: "list"; streams: Array<{ streamId: string; state: string }> }
      | {
          kind: "deltas";
          streams: Array<{ streamId: string; state: string }>;
          deltas: Array<Record<string, unknown>>;
          streamWindows: Array<{
            streamId: string;
            status: "ok" | "rebased" | "stale";
            serverCursorStart: number;
            serverCursorEnd: number;
          }>;
          nextCheckpoints: Array<{ streamId: string; cursor: number }>;
        };
  }
> {
  return listThreadMessagesForHooks(ctx, component, { ...args, actor: args.actor });
}

export async function listThreadReasoningForHooksForActor<
  Component extends CodexReasoningComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: HostReasoningForHooksArgs<HostActorContext>,
): Promise<FunctionReturnType<Component["reasoning"]["listByThread"]>> {
  return listThreadReasoningForHooks(ctx, component, { ...args, actor: args.actor });
}

export async function listTurnMessagesForHooksForActor<
  Component extends CodexMessagesComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: { actor: HostActorContext; threadId: string; turnId: string },
): Promise<FunctionReturnType<Component["messages"]["getByTurn"]>> {
  return ctx.runQuery(component.messages.getByTurn, { ...args, actor: args.actor });
}

export async function listPendingApprovalsForHooksForActor<
  Component extends CodexApprovalsComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: { actor: HostActorContext; threadId?: string; paginationOpts: { cursor: string | null; numItems: number } },
): Promise<FunctionReturnType<Component["approvals"]["listPending"]>> {
  return ctx.runQuery(component.approvals.listPending, { ...args, actor: args.actor });
}

export async function respondApprovalForHooksForActor<
  Component extends CodexApprovalsComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: { actor: HostActorContext; threadId: string; turnId: string; itemId: string; decision: "accepted" | "declined" },
): Promise<FunctionReturnType<Component["approvals"]["respond"]>> {
  return ctx.runMutation(component.approvals.respond, { ...args, actor: args.actor });
}

export async function listPendingServerRequestsForHooksForActor<
  Component extends CodexServerRequestsComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: { actor: HostActorContext; threadId?: string; limit?: number },
): Promise<FunctionReturnType<Component["serverRequests"]["listPending"]>> {
  return ctx.runQuery(component.serverRequests.listPending, { ...args, actor: args.actor });
}

export async function upsertPendingServerRequestForHooksForActor<
  Component extends CodexServerRequestsComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: {
    actor: HostActorContext;
    requestId: string | number;
    threadId: string;
    turnId: string;
    itemId: string;
    method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/tool/requestUserInput" | "item/tool/call";
    payloadJson: string;
    reason?: string;
    questionsJson?: string;
    requestedAt: number;
  },
): Promise<FunctionReturnType<Component["serverRequests"]["upsertPending"]>> {
  return ctx.runMutation(component.serverRequests.upsertPending, { ...args, actor: args.actor });
}

export async function resolvePendingServerRequestForHooksForActor<
  Component extends CodexServerRequestsComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: {
    actor: HostActorContext;
    threadId: string;
    requestId: string | number;
    status: "answered" | "expired";
    resolvedAt: number;
    responseJson?: string;
  },
): Promise<FunctionReturnType<Component["serverRequests"]["resolve"]>> {
  return ctx.runMutation(component.serverRequests.resolve, { ...args, actor: args.actor });
}

export async function upsertTokenUsageForActor<
  Component extends CodexTokenUsageComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: {
    actor: HostActorContext;
    threadId: string;
    turnId: string;
    totalTokens: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    lastTotalTokens: number;
    lastInputTokens: number;
    lastCachedInputTokens: number;
    lastOutputTokens: number;
    lastReasoningOutputTokens: number;
    modelContextWindow?: number;
  },
): Promise<FunctionReturnType<Component["tokenUsage"]["upsert"]>> {
  return ctx.runMutation(component.tokenUsage.upsert, {
    actor: args.actor,
    threadId: args.threadId,
    turnId: args.turnId,
    totalTokens: args.totalTokens,
    inputTokens: args.inputTokens,
    cachedInputTokens: args.cachedInputTokens,
    outputTokens: args.outputTokens,
    reasoningOutputTokens: args.reasoningOutputTokens,
    lastTotalTokens: args.lastTotalTokens,
    lastInputTokens: args.lastInputTokens,
    lastCachedInputTokens: args.lastCachedInputTokens,
    lastOutputTokens: args.lastOutputTokens,
    lastReasoningOutputTokens: args.lastReasoningOutputTokens,
    ...(args.modelContextWindow !== undefined ? { modelContextWindow: args.modelContextWindow } : {}),
  });
}

export async function listTokenUsageForHooksForActor<
  Component extends CodexTokenUsageComponent,
>(
  ctx: HostQueryRunner,
  component: Component,
  args: { actor: HostActorContext; threadId: string },
): Promise<FunctionReturnType<Component["tokenUsage"]["listByThread"]>> {
  return ctx.runQuery(component.tokenUsage.listByThread, { actor: args.actor, threadId: args.threadId });
}

export async function interruptTurnForHooksForActor<
  Component extends CodexTurnsComponent,
>(
  ctx: HostMutationRunner,
  component: Component,
  args: { actor: HostActorContext; threadId: string; turnId: string; reason?: string },
): Promise<FunctionReturnType<Component["turns"]["interrupt"]>> {
  return ctx.runMutation(component.turns.interrupt, { ...args, actor: args.actor });
}
