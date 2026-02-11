"use client";

import { useCallback, useMemo, useState } from "react";
import type { FunctionArgs } from "convex/server";
import { useCodexMessages } from "./useCodexMessages.js";
import type { CodexMessagesQuery, CodexMessagesQueryArgs } from "./types.js";
import { useCodexThreadState, type CodexThreadStateQuery } from "./useCodexThreadState.js";
import { deriveCodexThreadActivity, type CodexThreadActivity, type CodexThreadActivityThreadState } from "./threadActivity.js";
import { deriveCodexIngestHealth } from "./ingestHealth.js";
import { deriveCodexBranchActivity, type CodexBranchActivityOptions } from "./branchActivity.js";

export type CodexConversationControllerConfig<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
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
  interrupt?: {
    onInterrupt: (activity: CodexThreadActivity) => Promise<unknown>;
  };
};

export function useCodexConversationController<
  MessagesQuery extends CodexMessagesQuery<unknown>,
  ThreadStateQuery extends CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
>(
  config: CodexConversationControllerConfig<MessagesQuery, ThreadStateQuery>,
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

  const [composerValue, setComposerValue] = useState(config.composer?.initialValue ?? "");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerSending, setComposerSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);

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
      branchActivity,
      composerError,
      composerSending,
      composerValue,
      config.composer,
      config.interrupt,
      ingestHealth,
      interrupt,
      interrupting,
      messages,
      send,
    ],
  );
}
