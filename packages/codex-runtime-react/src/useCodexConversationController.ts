"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import type { CodexUIMessage } from "@zakstam/codex-runtime";
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
import {
  computeCodexConversationSyncProgress,
  type CodexConversationSyncProgress,
  type CodexSyncHydrationSnapshot,
  type CodexSyncHydrationSource,
} from "./syncHydration.js";

export type CodexConversationApprovalDecision = "accepted" | "declined";

export type CodexConversationApprovalItem = {
  conversationId: string;
  turnId: string;
  itemId: string;
  kind: string;
  reason?: string;
  createdAt: number;
};

type CodexConversationMessagesResult = ReturnType<typeof useCodexMessages> & {
  syncProgress: CodexConversationSyncProgress;
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
  syncHydration?: {
    source: CodexSyncHydrationSource;
    conversationId: string | null;
    enabled?: boolean;
  };
};

function syncDebugEnabled(): boolean {
  const debugFlag = Reflect.get(globalThis as Record<string, unknown>, "__CODEX_SYNC_DEBUG__");
  return debugFlag === true;
}

function syncDebugLog(message: string, payload?: Record<string, unknown>): void {
  if (!syncDebugEnabled()) {
    return;
  }
  console.debug("[codex-sync-debug]", { message, ...(payload ?? {}) });
}

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

function scopedMessageIdentity(message: CodexUIMessage): string {
  return `${message.turnId}:${message.messageId}`;
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
    byMessageId.set(scopedMessageIdentity(message), message);
  }
  for (const message of optimisticMessages) {
    const identity = scopedMessageIdentity(message);
    if (!byMessageId.has(identity)) {
      byMessageId.set(identity, message);
    }
  }
  return Array.from(byMessageId.values()).sort(sortCodexMessagesChronologically);
}

function dedupeCodexMessagesByMessageId(messages: CodexUIMessage[]): {
  results: CodexUIMessage[];
  droppedDuplicateCount: number;
} {
  if (messages.length <= 1) {
    return { results: messages, droppedDuplicateCount: 0 };
  }
  const byMessageId = new Map<string, CodexUIMessage>();
  let droppedDuplicateCount = 0;
  for (const message of messages) {
    const identity = scopedMessageIdentity(message);
    const existing = byMessageId.get(identity);
    if (!existing) {
      byMessageId.set(identity, message);
      continue;
    }
    droppedDuplicateCount += 1;
    if (message.updatedAt > existing.updatedAt) {
      byMessageId.set(identity, message);
      continue;
    }
    if (message.updatedAt === existing.updatedAt && message.createdAt > existing.createdAt) {
      byMessageId.set(identity, message);
    }
  }
  return {
    results: Array.from(byMessageId.values()).sort(sortCodexMessagesChronologically),
    droppedDuplicateCount,
  };
}

function findDurableSyncMatch(
  localMessage: CodexUIMessage,
  durableByMessageId: Map<string, CodexUIMessage>,
  usedDurableMessageIds: Set<string>,
): CodexUIMessage | null {
  const identity = scopedMessageIdentity(localMessage);
  const byId = durableByMessageId.get(identity);
  if (byId && !usedDurableMessageIds.has(identity)) {
    return byId;
  }
  return null;
}

function mergeCodexSyncHydrationMessages(
  durableMessages: CodexUIMessage[],
  snapshot: CodexSyncHydrationSnapshot | null,
): {
  results: CodexUIMessage[];
  unsyncedMessageIds: ReadonlySet<string>;
  syncHydrationState: CodexSyncHydrationSnapshot["syncState"] | null;
} {
  if (!snapshot || snapshot.messages.length === 0) {
    if (snapshot) {
      syncDebugLog("merge_skip_no_snapshot_messages", {
        conversationId: snapshot.conversationId,
        syncState: snapshot.syncState,
        syncJobId: snapshot.syncJobId ?? null,
      });
    }
    return {
      results: durableMessages,
      unsyncedMessageIds: new Set<string>(),
      syncHydrationState: snapshot?.syncState ?? null,
    };
  }

  const merged = [...durableMessages];
  const durableByMessageId = new Map<string, CodexUIMessage>(
    durableMessages.map((message) => [scopedMessageIdentity(message), message]),
  );
  const usedDurableMessageIds = new Set<string>();
  const unsyncedMessageIds = new Set<string>();
  let unmatchedByMessageIdCount = 0;

  for (const localMessage of [...snapshot.messages].sort(sortCodexMessagesChronologically)) {
    const durableMatch = findDurableSyncMatch(
      localMessage,
      durableByMessageId,
      usedDurableMessageIds,
    );
    if (durableMatch) {
      usedDurableMessageIds.add(scopedMessageIdentity(durableMatch));
      continue;
    }
    unmatchedByMessageIdCount += 1;
    const localIdentity = scopedMessageIdentity(localMessage);
    if (!durableByMessageId.has(localIdentity)) {
      merged.push(localMessage);
    }
    unsyncedMessageIds.add(localIdentity);
  }

  syncDebugLog("merge_snapshot_with_durable", {
    conversationId: snapshot.conversationId,
    syncState: snapshot.syncState,
    syncJobId: snapshot.syncJobId ?? null,
    syncJobState: snapshot.syncJobState ?? null,
    snapshotMessageCount: snapshot.messages.length,
    durableMessageCount: durableMessages.length,
    unsyncedOverlayCount: unsyncedMessageIds.size,
    unmatchedByMessageIdCount,
    mergedMessageCount: merged.length,
    lastCursor: snapshot.lastCursor ?? null,
    errorCode: snapshot.errorCode ?? null,
  });

  return {
    results: merged.sort(sortCodexMessagesChronologically),
    unsyncedMessageIds,
    syncHydrationState: snapshot.syncState,
  };
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
  const [syncHydrationSnapshot, setSyncHydrationSnapshot] = useState<CodexSyncHydrationSnapshot | null>(null);

  const pendingApprovals = useMemo(() => {
    const raw = threadStateData?.pendingApprovals ?? [];
    return raw.filter(isApprovalLike);
  }, [threadStateData]);

  const optimisticComposerMessages = useMemo(
    () => flattenCodexOptimisticGroups(pendingOptimisticComposerBySendId),
    [pendingOptimisticComposerBySendId],
  );

  useEffect(() => {
    const source = config.syncHydration?.source;
    const enabled = config.syncHydration?.enabled ?? true;
    const conversationId = config.syncHydration?.conversationId;
    if (!source || !enabled || !conversationId) {
      setSyncHydrationSnapshot(null);
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const applySnapshot = (snapshot: CodexSyncHydrationSnapshot | null): void => {
      if (cancelled) {
        return;
      }
      if (!snapshot || snapshot.conversationId !== conversationId) {
        return;
      }
      setSyncHydrationSnapshot(snapshot);
    };

    const start = async () => {
      try {
        const initial = await source.getConversationSnapshot(conversationId);
        applySnapshot(initial);
        if (!source.subscribe) {
          return;
        }
        const maybeUnsubscribe = await source.subscribe((next) => {
          if (next.conversationId !== conversationId) {
            return;
          }
          applySnapshot(next);
        });
        if (typeof maybeUnsubscribe === "function") {
          if (cancelled) {
            maybeUnsubscribe();
            return;
          }
          unsubscribe = maybeUnsubscribe;
        }
      } catch (error) {
        if (!cancelled) {
          setSyncHydrationSnapshot(null);
          const message = error instanceof Error ? error.message : String(error);
          setComposerError((current) => current ?? `Sync hydration unavailable: ${message}`);
        }
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [config.syncHydration?.conversationId, config.syncHydration?.enabled, config.syncHydration?.source]);

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

  const mergedMessages = useMemo<CodexConversationMessagesResult>(() => {
    const syncMerged = mergeCodexSyncHydrationMessages(messages.results, syncHydrationSnapshot);
    const merged = optimisticComposerMessages.length === 0
      ? syncMerged.results
      : mergeCodexMessagesWithOptimisticComposer(syncMerged.results, optimisticComposerMessages);
    const deduped = dedupeCodexMessagesByMessageId(merged);
    if (deduped.droppedDuplicateCount > 0) {
      syncDebugLog("dedupe_message_id_collisions", {
        droppedDuplicateCount: deduped.droppedDuplicateCount,
        mergedCount: merged.length,
        dedupedCount: deduped.results.length,
        syncJobId: syncHydrationSnapshot?.syncJobId ?? null,
      });
    }
    const results = deduped.results;
    const syncProgress = computeCodexConversationSyncProgress({
      messages: results,
      unsyncedMessageIds: syncMerged.unsyncedMessageIds,
      syncState: syncMerged.syncHydrationState,
    });
    return {
      ...messages,
      results,
      syncProgress,
    };
  }, [messages, optimisticComposerMessages, syncHydrationSnapshot]);

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
