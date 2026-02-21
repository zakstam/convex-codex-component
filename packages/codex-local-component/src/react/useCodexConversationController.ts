"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import type { CodexUIMessage } from "../shared/types.js";
import { useCodexMessages } from "./useCodexMessages.js";
import type { CodexMessagesQuery, CodexMessagesQueryArgs, CodexThreadReadResult } from "./types.js";
import { useCodexThreadState, type CodexThreadStateQuery } from "./useCodexThreadState.js";
import { deriveCodexThreadActivity, type CodexThreadActivity, type CodexThreadActivityThreadState } from "./threadActivity.js";
import { deriveCodexIngestHealth } from "./ingestHealth.js";
import { deriveCodexBranchActivity, type CodexBranchActivityOptions } from "./branchActivity.js";
import {
  useCodexDynamicTools,
  type CodexDynamicToolHandler,
  type CodexDynamicToolsQuery,
  type CodexDynamicToolsRespond,
} from "./useCodexDynamicTools.js";

export type CodexConversationApprovalDecision = "accepted" | "declined";

export type CodexConversationApprovalItem = {
  conversationId: string;
  turnId: string;
  itemId: string;
  kind: string;
  reason?: string;
  createdAt: number;
};

type CodexConversationComposerOptimisticConfig = {
  enabled?: boolean;
  includeAssistantPlaceholder?: boolean;
};

type CodexOptimisticComposerGroup = {
  user: CodexUIMessage;
  assistantPlaceholder?: CodexUIMessage;
  durableUserTextBaselineCount: number;
};

export type CodexConversationControllerConfig<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends
    CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>>,
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
> = {
  messages: {
    query: MessagesQuery;
    args: CodexMessagesQueryArgs<MessagesQuery> | "skip";
    initialNumItems: number;
    stream?: boolean;
  };
  threadState: {
    query: ThreadStateQuery;
    args: FunctionArgs<ThreadStateQuery> | "skip";
    branchOptions?: CodexBranchActivityOptions;
  };
  composer?: {
    initialValue?: string;
    onSend: (text: string) => Promise<ComposerResult>;
    optimistic?: CodexConversationComposerOptimisticConfig;
  };
  approvals?: {
    onResolve: (approval: CodexConversationApprovalItem, decision: CodexConversationApprovalDecision) => Promise<ApprovalResult>;
  };
  dynamicTools?: {
    query: DynamicToolsQuery;
    args: FunctionArgs<DynamicToolsQuery> | "skip";
    respond?: CodexDynamicToolsRespond<DynamicToolsRespondResult>;
    handlers?: Record<string, CodexDynamicToolHandler>;
    autoHandle?: boolean;
    enabled?: boolean;
  };
  interrupt?: {
    onInterrupt: (activity: CodexThreadActivity) => Promise<InterruptResult>;
  };
};

function isApprovalLike(value: unknown): value is CodexConversationApprovalItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const conversationId = Reflect.get(value, "conversationId");
  const turnId = Reflect.get(value, "turnId");
  const itemId = Reflect.get(value, "itemId");
  const kind = Reflect.get(value, "kind");
  const createdAt = Reflect.get(value, "createdAt");
  return (
    typeof conversationId === "string" &&
    typeof turnId === "string" &&
    typeof itemId === "string" &&
    typeof kind === "string" &&
    typeof createdAt === "number"
  );
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function flattenCodexOptimisticGroups(
  pendingBySendId: Record<string, CodexOptimisticComposerGroup>,
): CodexUIMessage[] {
  const merged: CodexUIMessage[] = [];
  for (const group of Object.values(pendingBySendId)) {
    merged.push(group.user);
    if (group.assistantPlaceholder) {
      merged.push(group.assistantPlaceholder);
    }
  }
  return merged;
}

function countDurableUserMessagesWithText(
  durableMessages: CodexUIMessage[],
  text: string,
): number {
  let count = 0;
  for (const message of durableMessages) {
    if (message.role !== "user") {
      continue;
    }
    if (message.messageId.startsWith("optimistic:")) {
      continue;
    }
    if (message.text === text) {
      count += 1;
    }
  }
  return count;
}

function sortCodexMessagesChronologically(left: CodexUIMessage, right: CodexUIMessage): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  if (left.turnId !== right.turnId) {
    return left.turnId < right.turnId ? -1 : 1;
  }
  if (left.orderInTurn !== right.orderInTurn) {
    return left.orderInTurn - right.orderInTurn;
  }
  if (left.messageId === right.messageId) {
    return 0;
  }
  return left.messageId < right.messageId ? -1 : 1;
}

function mergeCodexMessagesWithOptimisticComposer(
  durableMessages: CodexUIMessage[],
  optimisticMessages: CodexUIMessage[],
): CodexUIMessage[] {
  if (optimisticMessages.length === 0) {
    return durableMessages;
  }
  const byMessageId = new Map<string, CodexUIMessage>();
  for (const message of durableMessages) {
    byMessageId.set(message.messageId, message);
  }
  for (const message of optimisticMessages) {
    if (!byMessageId.has(message.messageId)) {
      byMessageId.set(message.messageId, message);
    }
  }
  return Array.from(byMessageId.values()).sort(sortCodexMessagesChronologically);
}

function nextCodexOrderInTurn(
  turnId: string,
  durableMessages: CodexUIMessage[],
  optimisticMessages: CodexUIMessage[],
): number {
  let maxOrderInTurn = -1;
  for (const message of durableMessages) {
    if (message.turnId === turnId) {
      maxOrderInTurn = Math.max(maxOrderInTurn, message.orderInTurn);
    }
  }
  for (const message of optimisticMessages) {
    if (message.turnId === turnId) {
      maxOrderInTurn = Math.max(maxOrderInTurn, message.orderInTurn);
    }
  }
  return maxOrderInTurn + 1;
}

export function useCodexConversationController<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>> = CodexDynamicToolsQuery<Record<string, unknown>>,
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
>(
  config: CodexConversationControllerConfig<
    MessagesQuery,
    ThreadStateQuery,
    DynamicToolsQuery,
    ComposerResult,
    ApprovalResult,
    InterruptResult,
    DynamicToolsRespondResult
  >,
) {
  const messages = useCodexMessages(config.messages.query, config.messages.args, {
    initialNumItems: config.messages.initialNumItems,
    ...(config.messages.stream !== undefined ? { stream: config.messages.stream } : {}),
  });
  const threadState = useCodexThreadState(config.threadState.query, config.threadState.args);
  const threadStateData = useMemo<CodexThreadActivityThreadState | null>(() => {
    if (!threadState || threadState.threadStatus !== "ok") {
      return null;
    }
    return threadState.data;
  }, [threadState]);
  const activity = useMemo(() => deriveCodexThreadActivity(threadStateData), [threadStateData]);
  const ingestHealth = useMemo(() => deriveCodexIngestHealth(threadStateData), [threadStateData]);
  const branchActivity = useMemo(
    () => deriveCodexBranchActivity(threadStateData, config.threadState.branchOptions),
    [config.threadState.branchOptions, threadStateData],
  );
  const dynamicToolsQuery: FunctionReference<"query", "public", Record<string, unknown>, unknown> =
    config.dynamicTools?.query ?? config.threadState.query;
  const dynamicToolsArgs = config.dynamicTools?.args ?? "skip";
  const dynamicTools = useCodexDynamicTools(
    dynamicToolsQuery,
    dynamicToolsArgs,
    {
      ...(config.dynamicTools?.respond !== undefined ? { respond: config.dynamicTools.respond } : {}),
      ...(config.dynamicTools?.handlers !== undefined ? { handlers: config.dynamicTools.handlers } : {}),
      ...(config.dynamicTools?.autoHandle !== undefined ? { autoHandle: config.dynamicTools.autoHandle } : {}),
      ...(config.dynamicTools?.enabled !== undefined ? { enabled: config.dynamicTools.enabled } : {}),
    },
  );

  const [composerValue, setComposerValue] = useState(config.composer?.initialValue ?? "");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerSending, setComposerSending] = useState(false);
  const [pendingOptimisticComposerBySendId, setPendingOptimisticComposerBySendId] = useState<
    Record<string, CodexOptimisticComposerGroup>
  >({});
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvingItemId, setApprovingItemId] = useState<string | null>(null);
  const [interrupting, setInterrupting] = useState(false);

  const pendingApprovals = useMemo(() => {
    const raw = threadStateData?.pendingApprovals ?? [];
    return raw.filter(isApprovalLike);
  }, [threadStateData]);

  const optimisticComposerMessages = useMemo(
    () => flattenCodexOptimisticGroups(pendingOptimisticComposerBySendId),
    [pendingOptimisticComposerBySendId],
  );

  useEffect(() => {
    if (Object.keys(pendingOptimisticComposerBySendId).length === 0) {
      return;
    }
    setPendingOptimisticComposerBySendId((current) => {
      let changed = false;
      const next: Record<string, CodexOptimisticComposerGroup> = {};
      for (const [sendId, group] of Object.entries(current)) {
        const durableCount = countDurableUserMessagesWithText(messages.results, group.user.text);
        if (durableCount > group.durableUserTextBaselineCount) {
          changed = true;
          continue;
        }
        next[sendId] = group;
      }
      return changed ? next : current;
    });
  }, [messages.results, pendingOptimisticComposerBySendId]);

  const mergedMessages = useMemo(() => {
    if (optimisticComposerMessages.length === 0) {
      return messages;
    }
    return {
      ...messages,
      results: mergeCodexMessagesWithOptimisticComposer(messages.results, optimisticComposerMessages),
    };
  }, [messages, optimisticComposerMessages]);

  const send = useCallback(
    async (overrideText?: string) => {
      if (!config.composer) {
        return undefined;
      }
      const text = (overrideText ?? composerValue).trim();
      if (!text) {
        return undefined;
      }
      const optimisticEnabled = config.composer.optimistic?.enabled ?? false;
      const includeAssistantPlaceholder =
        config.composer.optimistic?.includeAssistantPlaceholder ?? true;
      const sendId = randomId();
      if (optimisticEnabled) {
        setPendingOptimisticComposerBySendId((current) => {
          const existingOptimistic = flattenCodexOptimisticGroups(current);
          const nextTurnId = `optimistic:${sendId}`;
          const userOrder = nextCodexOrderInTurn(nextTurnId, messages.results, existingOptimistic);
          const now = Date.now();
          const userMessageId = `optimistic:user:${sendId}`;
          const userMessage: CodexUIMessage = {
            messageId: userMessageId,
            turnId: nextTurnId,
            role: "user",
            status: "completed",
            sourceItemType: "userMessage",
            text,
            orderInTurn: userOrder,
            createdAt: now,
            updatedAt: now,
            completedAt: now,
          };
          const optimisticGroup: CodexOptimisticComposerGroup = {
            user: userMessage,
            durableUserTextBaselineCount: countDurableUserMessagesWithText(messages.results, text),
            ...(includeAssistantPlaceholder
              ? {
                  assistantPlaceholder: {
                    messageId: `optimistic:assistant:${sendId}`,
                    turnId: nextTurnId,
                    role: "assistant",
                    status: "streaming",
                    sourceItemType: "agentMessage",
                    text: "",
                    orderInTurn: userOrder + 1,
                    createdAt: now,
                    updatedAt: now,
                  },
                }
              : {}),
          };
          return {
            ...current,
            [sendId]: optimisticGroup,
          };
        });
      }
      setComposerSending(true);
      setComposerError(null);
      try {
        const result = await config.composer.onSend(text);
        setComposerValue("");
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setComposerError(message);
        setPendingOptimisticComposerBySendId((current) => {
          if (!Object.hasOwn(current, sendId)) {
            return current;
          }
          const next = { ...current };
          delete next[sendId];
          return next;
        });
        throw error;
      } finally {
        setComposerSending(false);
      }
    },
    [composerValue, config.composer, messages.results],
  );

  const resolveApproval = useCallback(
    async (
      approval: CodexConversationApprovalItem,
      decision: CodexConversationApprovalDecision,
    ) => {
      if (!config.approvals) {
        return undefined;
      }
      setApprovingItemId(approval.itemId);
      setApprovalError(null);
      try {
        return await config.approvals.onResolve(approval, decision);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setApprovalError(message);
        throw error;
      } finally {
        setApprovingItemId((current) => (current === approval.itemId ? null : current));
      }
    },
    [config.approvals],
  );

  const interrupt = useCallback(async () => {
    if (!config.interrupt) {
      return undefined;
    }
    setInterrupting(true);
    try {
      return await config.interrupt.onInterrupt(activity);
    } finally {
      setInterrupting(false);
    }
  }, [activity, config.interrupt]);

  return useMemo(
    () => ({
      messages: mergedMessages,
      activity,
      ingestHealth,
      branchActivity,
      approvals: {
        pending: pendingApprovals,
        pendingCount: pendingApprovals.length,
        approvingItemId,
        error: approvalError,
        canResolve: !!config.approvals,
        resolve: resolveApproval,
        accept: async (approval: CodexConversationApprovalItem) => resolveApproval(approval, "accepted"),
        decline: async (approval: CodexConversationApprovalItem) => resolveApproval(approval, "declined"),
      },
      dynamicTools,
      composer: {
        value: composerValue,
        setValue: setComposerValue,
        error: composerError,
        isSending: composerSending,
        canSend: !!config.composer && !composerSending && composerValue.trim().length > 0,
        send,
      },
      interrupt,
      canInterrupt:
        !!config.interrupt &&
        !interrupting &&
        activity.phase === "streaming" &&
        typeof activity.activeTurnId === "string" &&
        activity.activeTurnId.length > 0,
      isInterrupting: interrupting,
    }),
    [
      activity,
      approvalError,
      approvingItemId,
      branchActivity,
      composerError,
      composerSending,
      composerValue,
      config.approvals,
      config.composer,
      config.dynamicTools,
      config.interrupt,
      dynamicTools,
      ingestHealth,
      interrupt,
      interrupting,
      mergedMessages,
      pendingApprovals,
      pendingOptimisticComposerBySendId,
      resolveApproval,
      send,
    ],
  );
}
