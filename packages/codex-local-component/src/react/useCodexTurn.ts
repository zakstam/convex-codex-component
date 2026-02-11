"use client";

import { useMemo } from "react";
import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
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
  const messagesArgs = (args === "skip" ? ["skip"] : [args]) as unknown as OptionalRestArgsOrSkip<MessagesQuery>;
  const stateQueryArgs = (stateArgs === "skip" ? ["skip"] : [stateArgs]) as unknown as OptionalRestArgsOrSkip<StateQuery>;
  const messages = useQuery(messagesQuery, ...messagesArgs);
  const threadState = useQuery(stateQuery, ...stateQueryArgs);

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
