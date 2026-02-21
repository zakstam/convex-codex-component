"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { useCodexContext } from "./CodexContext.js";
import { useCodexChat, type CodexChatOptions, type CodexChatResult } from "./useCodexChat.js";
import { useCodexThreads, type CodexThreadsControls, type CodexThreadsListQuery } from "./useCodexThreads.js";
import { useCodexThreadState } from "./useCodexThreadState.js";
import { deriveCodexTokenUsage, type CodexTokenUsage } from "./tokenUsage.js";
import { toOptionalRestArgsOrSkip } from "./queryArgs.js";
import type { CodexTurnTokenUsage } from "./tokenUsage.js";
import type { FunctionArgs, FunctionReference } from "convex/server";
import type { CodexMessagesQuery, CodexThreadReadResult } from "./types.js";
import type { CodexThreadActivityThreadState } from "./threadActivity.js";
import type { CodexThreadStateQuery } from "./useCodexThreadState.js";
import type { CodexDynamicToolsQuery } from "./useCodexDynamicTools.js";
import type { ThreadReadSafeError } from "../errors.js";

type SafeThreadSnapshotResult = CodexThreadReadResult<CodexThreadActivityThreadState> | null | undefined;

function isThreadReadSafeError(value: unknown): value is ThreadReadSafeError {
  return (
    typeof value === "object" &&
    value !== null &&
    (Reflect.get(value, "threadStatus") === "missing_thread" ||
      Reflect.get(value, "threadStatus") === "forbidden_thread" ||
      Reflect.get(value, "threadStatus") === "forbidden_session")
  );
}

function isOkThreadSnapshot(
  value: unknown,
): value is { threadStatus: "ok"; data: CodexThreadActivityThreadState } {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "threadStatus") === "ok" &&
    typeof Reflect.get(value, "data") === "object" &&
    Reflect.get(value, "data") !== null
  );
}

function unwrapThreadSnapshot(
  snapshot: SafeThreadSnapshotResult,
): CodexThreadActivityThreadState | null | undefined {
  if (!snapshot) {
    return snapshot;
  }
  if (isThreadReadSafeError(snapshot)) {
    return null;
  }
  if (isOkThreadSnapshot(snapshot)) {
    return snapshot.data;
  }
  return null;
}

function isCodexTurnTokenUsageArray(value: unknown): value is CodexTurnTokenUsage[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const turnId = Reflect.get(entry, "turnId");
    const updatedAt = Reflect.get(entry, "updatedAt");
    const total = Reflect.get(entry, "total");
    const last = Reflect.get(entry, "last");
    return (
      typeof turnId === "string" &&
      typeof updatedAt === "number" &&
      typeof total === "object" &&
      total !== null &&
      typeof last === "object" &&
      last !== null
    );
  });
}

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
  initialSelectedConversationId?: string | null;
};

export type UseCodexOptions<
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
> = {
  conversationId?: string | null;
  actorReady?: boolean;
  initialNumItems?: number;
  stream?: boolean;
  composer?: CodexChatOptions<
    CodexMessagesQuery<unknown>,
    CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
    CodexDynamicToolsQuery<Record<string, unknown>>,
    ComposerResult, ApprovalResult, InterruptResult, DynamicToolsRespondResult
  >["composer"];
  interrupt?: CodexChatOptions<
    CodexMessagesQuery<unknown>,
    CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
    CodexDynamicToolsQuery<Record<string, unknown>>,
    ComposerResult, ApprovalResult, InterruptResult, DynamicToolsRespondResult
  >["interrupt"];
  approvals?: CodexChatOptions<
    CodexMessagesQuery<unknown>,
    CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
    CodexDynamicToolsQuery<Record<string, unknown>>,
    ComposerResult, ApprovalResult, InterruptResult, DynamicToolsRespondResult
  >["approvals"];
  dynamicTools?: CodexChatOptions<
    CodexMessagesQuery<unknown>,
    CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
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
  CodexThreadStateQuery<unknown, CodexThreadReadResult<CodexThreadActivityThreadState>>,
  CodexDynamicToolsQuery<Record<string, unknown>>,
  ComposerResult,
  ApprovalResult,
  InterruptResult,
  DynamicToolsRespondResult
> & {
  tokenUsage: CodexTokenUsage | null;
  threads: ReturnType<typeof useCodexThreads> | null;
  threadState: CodexThreadActivityThreadState | null;
  effectiveConversationId: string | null;
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
  // Runs BEFORE chat so that the picker's selectedConversationId can drive
  // message loading when the caller omits an explicit conversationId.
  const threadsConfig = options.threads;
  const threadsResult = useCodexThreads({
    list: threadsConfig?.list ?? {
      query: ctx.listThreadMessages,
      args: "skip",
    },
    ...(threadsConfig?.controls ? { controls: threadsConfig.controls } : {}),
    ...(threadsConfig?.initialSelectedConversationId != null
      ? { initialSelectedConversationId: threadsConfig.initialSelectedConversationId }
      : {}),
  });

  // ── Derive effective conversation id ───────────────────────────────────
  // Priority: explicit conversationId wins. When omitted and threads is
  // configured, the picker's selection drives message loading.
  const effectiveConversationId = options.conversationId
    ?? (threadsConfig ? threadsResult.selectedConversationId : null)
    ?? null;
  const shouldSkip = !effectiveConversationId || !actorReady;

  // The context stores type-erased query refs (CodexMessagesQuery<unknown>, etc.)
  // so the inferred args types lose the `actor` field. We cast through `never`
  // because the provider guarantees the runtime shapes match.
  const messagesArgs = shouldSkip
    ? ("skip" as const)
    : { actor: ctx.actor, conversationId: effectiveConversationId };
  const threadStateArgs = shouldSkip
    ? ("skip" as const)
    : { actor: ctx.actor, conversationId: effectiveConversationId };

  const chat = useCodexChat({
    messages: {
      query: ctx.listThreadMessages,
      args: messagesArgs,
      initialNumItems,
      stream,
    },
    threadState: {
      query: ctx.threadSnapshot,
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
    ctx.threadSnapshot,
    shouldSkip
      ? "skip"
      : { actor: ctx.actor, conversationId: effectiveConversationId },
  );
  const threadState = useMemo(
    () => unwrapThreadSnapshot(threadStateRaw),
    [threadStateRaw],
  );

  // ── Token usage ──────────────────────────────────────────────────────
  // Auto-detected from context. When `listTokenUsage` is not provided via
  // the CodexProvider, the query is skipped and tokenUsage is null.
  const tokenUsageQueryRef = ctx.listTokenUsage;
  const tokenUsageActive = !!tokenUsageQueryRef && !shouldSkip;
  const tokenUsageArgs: Record<string, unknown> | "skip" = tokenUsageActive
    ? { actor: ctx.actor, conversationId: effectiveConversationId }
    : ("skip" as const);
  const tokenUsageQuery: FunctionReference<
    "query",
    "public",
    Record<string, unknown>,
    unknown
  > = tokenUsageQueryRef ?? ctx.listThreadMessages;
  // useQuery must always be called (rules of hooks). When token usage is
  // not configured we pass the messages query as a stand-in ref; the "skip"
  // args ensure Convex never executes it.
  const rawTokenTurns = useQuery(
    tokenUsageQuery,
    ...toOptionalRestArgsOrSkip(tokenUsageArgs),
  );
  const tokenTurns = isCodexTurnTokenUsageArray(rawTokenTurns)
    ? rawTokenTurns
    : undefined;
  const tokenUsage = useMemo(
    () => (tokenUsageQueryRef ? deriveCodexTokenUsage(tokenTurns) : null),
    [tokenUsageQueryRef, tokenTurns],
  );

  return useMemo(
    () => ({
      ...chat,
      tokenUsage,
      threads: threadsConfig ? threadsResult : null,
      threadState: threadState ?? null,
      effectiveConversationId,
    }),
    [chat, tokenUsage, threadsConfig, threadsResult, threadState, effectiveConversationId],
  );
}
