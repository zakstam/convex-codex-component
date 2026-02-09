"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

type CodexTurnMessage = {
  turnId: string;
  status: "streaming" | "completed" | "failed" | "interrupted";
};

export type CodexTurnMessagesQuery<Args = Record<string, unknown>, Message extends CodexTurnMessage = CodexTurnMessage> =
  FunctionReference<
    "query",
    "public",
    {
      threadId: string;
      turnId: string;
    } & Args,
    Message[]
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
  MessagesQuery extends CodexTurnMessagesQuery<any, any>,
  StateQuery extends CodexTurnStateQuery<any, any>,
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
  const messages = useQuery(messagesQuery, args);
  const threadState = useQuery(
    stateQuery,
    stateArgs,
  ) as FunctionReturnType<StateQuery> | undefined;

  const status = useMemo(() => {
    if (!messages || messages.length === 0) {
      return "unknown";
    }
    if (messages.some((message) => message.status === "failed")) {
      return "failed";
    }
    if (messages.some((message) => message.status === "interrupted")) {
      return "interrupted";
    }
    if (messages.some((message) => message.status === "streaming")) {
      return "streaming";
    }
    return "completed";
  }, [messages]);

  return {
    messages,
    status,
    threadState,
  };
}
