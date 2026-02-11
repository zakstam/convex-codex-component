"use client";

import { useCodexMessages } from "../react/useCodexMessages.js";
import { useCodexBranchActivity } from "../react/useCodexBranchActivity.js";
import { useCodexConversationController } from "../react/useCodexConversationController.js";
import { useCodexIngestHealth } from "../react/useCodexIngestHealth.js";
import { useCodexThreadActivity } from "../react/useCodexThreadActivity.js";
import type { CodexDynamicToolHandler, CodexDynamicToolsQuery, CodexDynamicToolsRespond } from "../react/useCodexDynamicTools.js";
import type { CodexMessagesQuery, CodexMessagesQueryArgs } from "../react/types.js";
import type { CodexThreadActivityQuery } from "../react/useCodexThreadActivity.js";
import type { CodexThreadActivity, CodexThreadActivityThreadState } from "../react/threadActivity.js";
import type { CodexBranchActivityOptions } from "../react/branchActivity.js";
import type { CodexConversationApprovalDecision, CodexConversationApprovalItem } from "../react/useCodexConversationController.js";

export type CodexThreadScopeArgs<Actor extends Record<string, unknown>> = {
  actor: Actor;
  threadId: string;
};

export type CodexThreadTurnScopeArgs<Actor extends Record<string, unknown>> = CodexThreadScopeArgs<Actor> & {
  turnId: string;
};

export type CodexReactHostHooks<Actor extends Record<string, unknown>> = {
  listThreadMessagesForHooks: CodexMessagesQuery<{ actor: Actor }>;
  threadSnapshotSafe: CodexThreadActivityQuery<{ actor: Actor }, CodexThreadActivityThreadState>;
  listPendingServerRequestsForHooks?: CodexDynamicToolsQuery<{ actor: Actor; threadId: string; limit?: number }>;
};

export type CodexReactConversationControllerOptions = {
  initialNumItems: number;
  stream?: boolean;
  branchOptions?: CodexBranchActivityOptions;
  composer?: {
    initialValue?: string;
    onSend: (text: string) => Promise<unknown>;
  };
  approvals?: {
    onResolve: (approval: CodexConversationApprovalItem, decision: CodexConversationApprovalDecision) => Promise<unknown>;
  };
  dynamicTools?: {
    respond?: CodexDynamicToolsRespond;
    handlers?: Record<string, CodexDynamicToolHandler>;
    autoHandle?: boolean;
    enabled?: boolean;
    limit?: number;
  };
  interrupt?: {
    onInterrupt: (activity: CodexThreadActivity) => Promise<unknown>;
  };
};

export function codexThreadScopeArgs<Actor extends Record<string, unknown>>(
  actor: Actor,
  threadId: string | null | undefined,
): CodexThreadScopeArgs<Actor> | "skip" {
  if (!threadId) {
    return "skip";
  }
  return { actor, threadId };
}

export function codexThreadTurnScopeArgs<Actor extends Record<string, unknown>>(
  actor: Actor,
  threadId: string | null | undefined,
  turnId: string | null | undefined,
): CodexThreadTurnScopeArgs<Actor> | "skip" {
  if (!threadId || !turnId) {
    return "skip";
  }
  return { actor, threadId, turnId };
}

export function createCodexReactConvexAdapter<
  Actor extends Record<string, unknown>,
>(config: { actor: Actor; hooks: CodexReactHostHooks<Actor> }) {
  return {
    threadArgs: (threadId: string | null | undefined) => codexThreadScopeArgs(config.actor, threadId),
    threadTurnArgs: (threadId: string | null | undefined, turnId: string | null | undefined) =>
      codexThreadTurnScopeArgs(config.actor, threadId, turnId),
    useThreadMessages: (
      threadId: string | null | undefined,
      options: { initialNumItems: number; stream?: boolean },
    ) => {
      const args: CodexMessagesQueryArgs<CodexReactHostHooks<Actor>["listThreadMessagesForHooks"]> | "skip" =
        codexThreadScopeArgs(config.actor, threadId);
      return useCodexMessages(
        config.hooks.listThreadMessagesForHooks,
        args,
        options,
      );
    },
    useThreadActivity: (threadId: string | null | undefined) =>
      useCodexThreadActivity(
        config.hooks.threadSnapshotSafe,
        codexThreadScopeArgs(config.actor, threadId),
      ),
    useBranchActivity: (
      threadId: string | null | undefined,
      options?: CodexBranchActivityOptions,
    ) =>
      useCodexBranchActivity(
        config.hooks.threadSnapshotSafe,
        codexThreadScopeArgs(config.actor, threadId),
        options,
      ),
    useIngestHealth: (threadId: string | null | undefined) =>
      useCodexIngestHealth(
        config.hooks.threadSnapshotSafe,
        codexThreadScopeArgs(config.actor, threadId),
      ),
    useConversationController: (
      threadId: string | null | undefined,
      options: CodexReactConversationControllerOptions,
    ) =>
      useCodexConversationController({
        messages: {
          query: config.hooks.listThreadMessagesForHooks,
          args: codexThreadScopeArgs(config.actor, threadId),
          initialNumItems: options.initialNumItems,
          ...(options.stream !== undefined ? { stream: options.stream } : {}),
        },
        threadState: {
          query: config.hooks.threadSnapshotSafe,
          args: codexThreadScopeArgs(config.actor, threadId),
          ...(options.branchOptions !== undefined ? { branchOptions: options.branchOptions } : {}),
        },
        ...(options.approvals !== undefined ? { approvals: options.approvals } : {}),
        ...(options.dynamicTools !== undefined && config.hooks.listPendingServerRequestsForHooks !== undefined
          ? {
              dynamicTools: {
                query: config.hooks.listPendingServerRequestsForHooks,
                args: threadId
                  ? { actor: config.actor, threadId, ...(options.dynamicTools.limit !== undefined ? { limit: options.dynamicTools.limit } : {}) }
                  : "skip",
                ...(options.dynamicTools.respond !== undefined ? { respond: options.dynamicTools.respond } : {}),
                ...(options.dynamicTools.handlers !== undefined ? { handlers: options.dynamicTools.handlers } : {}),
                ...(options.dynamicTools.autoHandle !== undefined ? { autoHandle: options.dynamicTools.autoHandle } : {}),
                ...(options.dynamicTools.enabled !== undefined ? { enabled: options.dynamicTools.enabled } : {}),
              },
            }
          : {}),
        ...(options.composer !== undefined ? { composer: options.composer } : {}),
        ...(options.interrupt !== undefined ? { interrupt: options.interrupt } : {}),
      }),
  };
}
