"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { useCodexContext } from "./CodexContext.js";
import { useCodexChat, type CodexChatOptions, type CodexChatResult } from "./useCodexChat.js";
import { useCodexThreads, type CodexThreadsControls, type CodexThreadsListQuery } from "./useCodexThreads.js";
import { useCodexThreadState } from "./useCodexThreadState.js";
import { deriveCodexTokenUsage, type CodexTokenUsage } from "./tokenUsage.js";
import { toOptionalRestArgsOrSkip } from "./queryArgs.js";
import type { CodexTokenUsageQuery } from "./useCodexTokenUsage.js";
import type { FunctionArgs } from "convex/server";
import type { CodexMessagesQuery } from "./types.js";
import type { CodexThreadActivityThreadState } from "./threadActivity.js";
import type { CodexThreadStateQuery } from "./useCodexThreadState.js";
import type { CodexDynamicToolsQuery } from "./useCodexDynamicTools.js";

export type UseCodexThreadsConfig<
  Query extends CodexThreadsListQuery<Record<string, unknown>, unknown> = CodexThreadsListQuery<Record<string, unknown>, unknown>,
  CreateResult = unknown,
  ResolveResult = unknown,
  ResumeResult = unknown,
> = {
  list: {
    query: Query;
    args: FunctionArgs<Query> | "skip";
  };
  controls?: CodexThreadsControls<CreateResult, ResolveResult, ResumeResult>;
  initialSelectedThreadId?: string | null;
};

export type UseCodexOptions<
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
> = {
  threadId?: string | null;
  actorReady?: boolean;
  initialNumItems?: number;
  stream?: boolean;
  composer?: CodexChatOptions<
    CodexMessagesQuery<unknown>,
    CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
    CodexDynamicToolsQuery<Record<string, unknown>>,
    ComposerResult, ApprovalResult, InterruptResult, DynamicToolsRespondResult
  >["composer"];
  interrupt?: CodexChatOptions<
    CodexMessagesQuery<unknown>,
    CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
    CodexDynamicToolsQuery<Record<string, unknown>>,
    ComposerResult, ApprovalResult, InterruptResult, DynamicToolsRespondResult
  >["interrupt"];
  approvals?: CodexChatOptions<
    CodexMessagesQuery<unknown>,
    CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
    CodexDynamicToolsQuery<Record<string, unknown>>,
    ComposerResult, ApprovalResult, InterruptResult, DynamicToolsRespondResult
  >["approvals"];
  dynamicTools?: CodexChatOptions<
    CodexMessagesQuery<unknown>,
    CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
    CodexDynamicToolsQuery<Record<string, unknown>>,
    ComposerResult, ApprovalResult, InterruptResult, DynamicToolsRespondResult
  >["dynamicTools"];
  threads?: UseCodexThreadsConfig;
};

export type UseCodexResult<
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
> = CodexChatResult<
  CodexMessagesQuery<unknown>,
  CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
  CodexDynamicToolsQuery<Record<string, unknown>>,
  ComposerResult,
  ApprovalResult,
  InterruptResult,
  DynamicToolsRespondResult
> & {
  tokenUsage: CodexTokenUsage | null;
  threads: ReturnType<typeof useCodexThreads> | null;
  threadState: CodexThreadActivityThreadState | null;
  effectiveThreadId: string | null;
};

export function useCodex<
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
>(options: UseCodexOptions<ComposerResult, ApprovalResult, InterruptResult, DynamicToolsRespondResult>): UseCodexResult<ComposerResult, ApprovalResult, InterruptResult, DynamicToolsRespondResult> {
  const ctx = useCodexContext();

  const actorReady = options.actorReady ?? true;
  const initialNumItems = options.initialNumItems ?? ctx.defaultInitialNumItems;
  const stream = options.stream ?? ctx.defaultStream;

  // ── Threads ──────────────────────────────────────────────────────────
  // Runs BEFORE chat so that the picker's selectedThreadId can drive
  // message loading when the caller omits an explicit threadId.
  const threadsConfig = options.threads;
  const threadsResult = useCodexThreads({
    list: threadsConfig?.list ?? {
      query: ctx.listThreadMessages as unknown as CodexThreadsListQuery,
      args: "skip",
    },
    ...(threadsConfig?.controls ? { controls: threadsConfig.controls } : {}),
    ...(threadsConfig?.initialSelectedThreadId != null
      ? { initialSelectedThreadId: threadsConfig.initialSelectedThreadId }
      : {}),
  });

  // ── Derive effective thread ID ────────────────────────────────────────
  // Priority: explicit threadId wins. When omitted and threads is
  // configured, the picker's selection drives message loading.
  const effectiveThreadId = options.threadId
    ?? (threadsConfig ? threadsResult.selectedThreadId : null)
    ?? null;
  const shouldSkip = !effectiveThreadId || !actorReady;

  // The context stores type-erased query refs (CodexMessagesQuery<unknown>, etc.)
  // so the inferred args types lose the `actor` field. We cast through `never`
  // because the provider guarantees the runtime shapes match.
  const messagesArgs = shouldSkip
    ? ("skip" as const)
    : ({ actor: ctx.actor, threadId: effectiveThreadId } as never);
  const threadStateArgs = shouldSkip
    ? ("skip" as const)
    : ({ actor: ctx.actor, threadId: effectiveThreadId } as never);

  const chat = useCodexChat({
    messages: {
      query: ctx.listThreadMessages,
      args: messagesArgs,
      initialNumItems,
      stream,
    },
    threadState: {
      query: ctx.threadSnapshotSafe,
      args: threadStateArgs,
    },
    ...(options.composer !== undefined ? { composer: options.composer } : {}),
    ...(options.interrupt !== undefined ? { interrupt: options.interrupt } : {}),
    ...(options.approvals !== undefined ? { approvals: options.approvals } : {}),
    ...(options.dynamicTools !== undefined ? { dynamicTools: options.dynamicTools } : {}),
  });

  // ── Raw thread state ─────────────────────────────────────────────────
  // Convex deduplicates identical queries, so this shares the subscription
  // with the internal useCodexConversationController call — zero extra
  // network cost.
  const threadStateRaw = useCodexThreadState(
    ctx.threadSnapshotSafe,
    shouldSkip
      ? "skip"
      : ({ actor: ctx.actor, threadId: effectiveThreadId } as never),
  );

  // ── Token usage ──────────────────────────────────────────────────────
  // Auto-detected from context. When `listTokenUsage` is not provided via
  // the CodexProvider, the query is skipped and tokenUsage is null.
  const tokenUsageQueryRef = ctx.listTokenUsage as CodexTokenUsageQuery<unknown> | undefined;
  const tokenUsageActive = !!tokenUsageQueryRef && !shouldSkip;
  const tokenUsageArgs = tokenUsageActive
    ? ({ actor: ctx.actor, threadId: effectiveThreadId } as never)
    : ("skip" as const);
  // useQuery must always be called (rules of hooks). When token usage is
  // not configured we pass the messages query as a stand-in ref; the "skip"
  // args ensure Convex never executes it.
  const rawTokenTurns = useQuery(
    (tokenUsageQueryRef ?? ctx.listThreadMessages) as CodexTokenUsageQuery<unknown>,
    ...toOptionalRestArgsOrSkip<CodexTokenUsageQuery<unknown>>(tokenUsageArgs),
  );
  const tokenUsage = useMemo(
    () => (tokenUsageQueryRef ? deriveCodexTokenUsage(rawTokenTurns) : null),
    [tokenUsageQueryRef, rawTokenTurns],
  );

  return useMemo(
    () => ({
      ...chat,
      tokenUsage,
      threads: threadsConfig ? threadsResult : null,
      threadState: threadStateRaw ?? null,
      effectiveThreadId,
    }),
    [chat, tokenUsage, threadsConfig, threadsResult, threadStateRaw, effectiveThreadId],
  );
}
