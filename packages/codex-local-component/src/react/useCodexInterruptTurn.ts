"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, OptionalRestArgs, PaginationOptions, PaginationResult } from "convex/server";
import { useCallback } from "react";
import type { CodexDurableMessageLike } from "../mapping.js";
import type { CodexStreamArgs } from "./types.js";

type InterruptMutation = FunctionReference<
  "mutation",
  "public",
  {
    threadId: string;
    turnId: string;
    reason?: string;
  } & Record<string, unknown>,
  null
>;

type MessagesQuery = FunctionReference<
  "query",
  "public",
  {
    threadId: string;
    paginationOpts: PaginationOptions;
    streamArgs?: CodexStreamArgs;
  },
  PaginationResult<CodexDurableMessageLike>
>;

function optimisticInterruptMessages(
  store: OptimisticLocalStore,
  query: MessagesQuery,
  args: { threadId: string; turnId: string; reason?: string },
) {
  for (const existing of store.getAllQueries(query)) {
    if (existing.args.threadId !== args.threadId || existing.args.streamArgs) {
      continue;
    }
    const value = existing.value;
    if (!value) {
      continue;
    }
    const page = value.page.map((message) => {
      if (message.turnId !== args.turnId || message.status !== "streaming") {
        return message;
      }
      return {
        ...message,
        status: "interrupted" as const,
        ...(args.reason ? { error: args.reason } : {}),
        completedAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
    store.setQuery(query, existing.args, { ...value, page });
  }
}

function runMutationWithArgs<Mutation extends FunctionReference<"mutation", "public">>(
  runner: (...args: OptionalRestArgs<Mutation>) => Promise<null>,
  args: FunctionArgs<Mutation>,
): Promise<null> {
  return runner(...([args] as OptionalRestArgs<Mutation>));
}

export function useCodexInterruptTurn<Mutation extends InterruptMutation>(
  mutation: Mutation,
  options?: {
    optimisticMessagesQuery?: MessagesQuery;
  },
): (args: FunctionArgs<Mutation>) => Promise<null> {
  const runInterrupt = useMutation(mutation);

  const interruptWithOptionalOptimistic = useCallback(
    async (args: FunctionArgs<Mutation>) => {
      const optimisticMessagesQuery = options?.optimisticMessagesQuery;
      if (!optimisticMessagesQuery) {
        return runMutationWithArgs(runInterrupt, args);
      }
      const optimisticRunner = runInterrupt.withOptimisticUpdate((store, mutationArgs) => {
        optimisticInterruptMessages(
          store,
          optimisticMessagesQuery,
          mutationArgs,
        );
      });
      return runMutationWithArgs(optimisticRunner, args);
    },
    [options?.optimisticMessagesQuery, runInterrupt],
  );

  return interruptWithOptionalOptimistic;
}
