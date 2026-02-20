"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { toOptionalRestArgsOrSkip } from "./queryArgs.js";

type CodexTurnMessage = {
  turnId: string;
  status: "streaming" | "completed" | "failed" | "interrupted";
};

type CodexSafeTurnMessages<Message extends CodexTurnMessage> = {
  threadStatus: "ok" | "missing_thread" | "forbidden_thread" | "forbidden_session";
  data: Message[];
  code?: "E_THREAD_NOT_FOUND" | "E_AUTH_THREAD_FORBIDDEN" | "E_AUTH_SESSION_FORBIDDEN";
  message?: string;
};

export type CodexTurnMessagesQuery<Args = Record<string, unknown>, Message extends CodexTurnMessage = CodexTurnMessage> =
  FunctionReference<
    "query",
    "public",
    {
      threadId: string;
      turnId: string;
    } & Args,
    Message[] | CodexSafeTurnMessages<Message>
  >;

export type CodexTurnStateQuery<Args = Record<string, unknown>, Result = unknown> =
  FunctionReference<
    "query",
    "public",
    {
      threadId: string;
    } & Args,
    Result
  >;

export function useCodexTurn<
  MessagesQuery extends CodexTurnMessagesQuery<unknown, CodexTurnMessage>,
  StateQuery extends CodexTurnStateQuery<unknown, unknown>,
>(
  messagesQuery: MessagesQuery,
  args: FunctionArgs<MessagesQuery> | "skip",
  stateQuery: StateQuery,
  stateArgs: FunctionArgs<StateQuery> | "skip",
): {
  messages: FunctionReturnType<MessagesQuery> | undefined;
  status: "streaming" | "completed" | "failed" | "interrupted" | "unknown";
  threadState: FunctionReturnType<StateQuery> | undefined;
} {
  const messagesArgs = toOptionalRestArgsOrSkip<MessagesQuery>(args);
  const stateQueryArgs = toOptionalRestArgsOrSkip<StateQuery>(stateArgs);
  const messages = useQuery(messagesQuery, ...messagesArgs);
  const threadState = useQuery(stateQuery, ...stateQueryArgs);
  const normalizedMessages = useMemo(() => {
    if (!messages) {
      return undefined;
    }
    if (Array.isArray(messages)) {
      return messages;
    }
    return messages.data;
  }, [messages]);

  const status = useMemo(() => {
    if (!normalizedMessages || normalizedMessages.length === 0) {
      return "unknown";
    }
    if (normalizedMessages.some((message) => message.status === "failed")) {
      return "failed";
    }
    if (normalizedMessages.some((message) => message.status === "interrupted")) {
      return "interrupted";
    }
    if (normalizedMessages.some((message) => message.status === "streaming")) {
      return "streaming";
    }
    return "completed";
  }, [normalizedMessages]);

  return {
    messages,
    status,
    threadState,
  };
}
