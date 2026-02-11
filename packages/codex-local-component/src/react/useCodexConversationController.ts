"use client";

import { useCallback, useMemo, useState } from "react";
import type { FunctionArgs } from "convex/server";
import { useCodexMessages } from "./useCodexMessages.js";
import type { CodexMessagesQuery, CodexMessagesQueryArgs } from "./types.js";
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
  threadId: string;
  turnId: string;
  itemId: string;
  kind: string;
  reason?: string;
  createdAt: number;
};

export type CodexConversationControllerConfig<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>>,
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
    onSend: (text: string) => Promise<unknown>;
  };
  approvals?: {
    onResolve: (approval: CodexConversationApprovalItem, decision: CodexConversationApprovalDecision) => Promise<unknown>;
  };
  dynamicTools?: {
    query: DynamicToolsQuery;
    args: FunctionArgs<DynamicToolsQuery> | "skip";
    respond?: CodexDynamicToolsRespond;
    handlers?: Record<string, CodexDynamicToolHandler>;
    autoHandle?: boolean;
    enabled?: boolean;
  };
  interrupt?: {
    onInterrupt: (activity: CodexThreadActivity) => Promise<unknown>;
  };
};

function isApprovalLike(value: unknown): value is CodexConversationApprovalItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.threadId === "string" &&
    typeof record.turnId === "string" &&
    typeof record.itemId === "string" &&
    typeof record.kind === "string" &&
    typeof record.createdAt === "number"
  );
}

export function useCodexConversationController<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
  DynamicToolsQuery extends CodexDynamicToolsQuery<Record<string, unknown>> = CodexDynamicToolsQuery<Record<string, unknown>>,
>(
  config: CodexConversationControllerConfig<MessagesQuery, ThreadStateQuery, DynamicToolsQuery>,
) {
  const messages = useCodexMessages(config.messages.query, config.messages.args, {
    initialNumItems: config.messages.initialNumItems,
    ...(config.messages.stream !== undefined ? { stream: config.messages.stream } : {}),
  });
  const threadState = useCodexThreadState(config.threadState.query, config.threadState.args);
  const activity = useMemo(() => deriveCodexThreadActivity(threadState), [threadState]);
  const ingestHealth = useMemo(() => deriveCodexIngestHealth(threadState), [threadState]);
  const branchActivity = useMemo(
    () => deriveCodexBranchActivity(threadState, config.threadState.branchOptions),
    [config.threadState.branchOptions, threadState],
  );
  const dynamicTools = useCodexDynamicTools(
    config.dynamicTools?.query ??
      (config.threadState.query as unknown as DynamicToolsQuery),
    config.dynamicTools?.args ?? "skip",
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
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvingItemId, setApprovingItemId] = useState<string | null>(null);
  const [interrupting, setInterrupting] = useState(false);

  const pendingApprovals = useMemo(() => {
    const raw = threadState?.pendingApprovals ?? [];
    return raw.filter(isApprovalLike);
  }, [threadState]);

  const send = useCallback(
    async (overrideText?: string) => {
      if (!config.composer) {
        return;
      }
      const text = (overrideText ?? composerValue).trim();
      if (!text) {
        return;
      }
      setComposerSending(true);
      setComposerError(null);
      try {
        await config.composer.onSend(text);
        setComposerValue("");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setComposerError(message);
        throw error;
      } finally {
        setComposerSending(false);
      }
    },
    [composerValue, config.composer],
  );

  const resolveApproval = useCallback(
    async (
      approval: CodexConversationApprovalItem,
      decision: CodexConversationApprovalDecision,
    ) => {
      if (!config.approvals) {
        return;
      }
      setApprovingItemId(approval.itemId);
      setApprovalError(null);
      try {
        await config.approvals.onResolve(approval, decision);
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
      return;
    }
    setInterrupting(true);
    try {
      await config.interrupt.onInterrupt(activity);
    } finally {
      setInterrupting(false);
    }
  }, [activity, config.interrupt]);

  return useMemo(
    () => ({
      messages,
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
      messages,
      pendingApprovals,
      resolveApproval,
      send,
    ],
  );
}
