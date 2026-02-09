"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { insertAtTop } from "convex/react";
import type { FunctionReference, PaginationOptions, PaginationResult } from "convex/server";
import type { CodexDurableMessageLike } from "../mapping.js";
import type { CodexStreamArgs } from "./types.js";

type CodexOptimisticMessage = CodexDurableMessageLike & {
  sourceItemType: string;
  payloadJson: string;
};

type CodexMessagesQueryRef = FunctionReference<
  "query",
  "public",
  {
    threadId: string;
    paginationOpts: PaginationOptions;
    streamArgs?: CodexStreamArgs;
  },
  PaginationResult<CodexOptimisticMessage>
>;

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export function optimisticallySendCodexMessage(query: CodexMessagesQueryRef) {
  return (
    store: OptimisticLocalStore,
    args: {
      threadId: string;
      turnId: string;
      text: string;
      messageId?: string;
      includeAssistantPlaceholder?: boolean;
      assistantPlaceholderId?: string;
    },
  ) => {
    const queries = store.getAllQueries(query);
    let maxOrderInTurn = -1;
    for (const q of queries) {
      if (q.args?.threadId !== args.threadId || q.args?.streamArgs) {
        continue;
      }
      for (const message of q.value?.page ?? []) {
        if (message.turnId !== args.turnId) {
          continue;
        }
        maxOrderInTurn = Math.max(maxOrderInTurn, message.orderInTurn);
      }
    }

    const now = Date.now();
    const userOrder = maxOrderInTurn + 1;
    const userMessageId = args.messageId ?? randomId();
    insertAtTop({
      paginatedQuery: query,
      argsToMatch: { threadId: args.threadId },
      item: {
        messageId: userMessageId,
        turnId: args.turnId,
        role: "user",
        status: "completed",
        text: args.text,
        sourceItemType: "userMessage",
        orderInTurn: userOrder,
        payloadJson: JSON.stringify({
          type: "userMessage",
          id: userMessageId,
          content: [{ type: "text", text: args.text }],
        }),
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      },
      localQueryStore: store,
    });

    if (!args.includeAssistantPlaceholder) {
      return;
    }

    const assistantMessageId = args.assistantPlaceholderId ?? randomId();
    const assistantOrder = userOrder + 1;
    insertAtTop({
      paginatedQuery: query,
      argsToMatch: { threadId: args.threadId },
      item: {
        messageId: assistantMessageId,
        turnId: args.turnId,
        role: "assistant",
        status: "streaming",
        text: "",
        sourceItemType: "agentMessage",
        orderInTurn: assistantOrder,
        payloadJson: JSON.stringify({
          type: "agentMessage",
          id: assistantMessageId,
          text: "",
        }),
        createdAt: now,
        updatedAt: now,
      },
      localQueryStore: store,
    });
  };
}
