"use client";

import { useCodexContext } from "./CodexContext.js";
import { useCodexChat, type CodexChatOptions, type CodexChatResult } from "./useCodexChat.js";
import type { CodexMessagesQuery } from "./types.js";
import type { CodexThreadActivityThreadState } from "./threadActivity.js";
import type { CodexThreadStateQuery } from "./useCodexThreadState.js";
import type { CodexDynamicToolsQuery } from "./useCodexDynamicTools.js";

export type UseCodexOptions<
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
> = {
  threadId: string | null | undefined;
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
};

export function useCodex<
  ComposerResult = unknown,
  ApprovalResult = unknown,
  InterruptResult = unknown,
  DynamicToolsRespondResult = unknown,
>(options: UseCodexOptions<ComposerResult, ApprovalResult, InterruptResult, DynamicToolsRespondResult>) {
  const ctx = useCodexContext();

  const threadId = options.threadId;
  const actorReady = options.actorReady ?? true;
  const initialNumItems = options.initialNumItems ?? ctx.defaultInitialNumItems;
  const stream = options.stream ?? ctx.defaultStream;

  const shouldSkip = !threadId || !actorReady;

  // The context stores type-erased query refs (CodexMessagesQuery<unknown>, etc.)
  // so the inferred args types lose the `actor` field. We cast through `never`
  // because the provider guarantees the runtime shapes match.
  const messagesArgs = shouldSkip
    ? ("skip" as const)
    : ({ actor: ctx.actor, threadId } as never);
  const threadStateArgs = shouldSkip
    ? ("skip" as const)
    : ({ actor: ctx.actor, threadId } as never);

  return useCodexChat({
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
}
