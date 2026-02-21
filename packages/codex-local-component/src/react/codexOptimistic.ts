"use client";

import type { OptimisticLocalStore, OptimisticUpdate } from "convex/browser";
import { useMutation, type ReactMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import type { Value } from "convex/values";
import type { CodexDurableMessageLike } from "../mapping.js";
import type { CodexMessagesQuery } from "./types.js";

export type CodexOptimisticOperation<Mutation extends FunctionReference<"mutation">> = (
  store: OptimisticLocalStore,
  args: FunctionArgs<Mutation>,
) => void;

export function createCodexOptimisticUpdate<Mutation extends FunctionReference<"mutation">>(
  ...ops: Array<CodexOptimisticOperation<Mutation>>
): OptimisticUpdate<FunctionArgs<Mutation>> {
  return (store, args) => {
    for (const op of ops) {
      op(store, args);
    }
  };
}

type CodexArgsResolver<
  Mutation extends FunctionReference<"mutation">,
  Query extends FunctionReference<"query">,
> = FunctionArgs<Query> | ((mutationArgs: FunctionArgs<Mutation>) => FunctionArgs<Query>);

type CodexQueryMatcher<
  Mutation extends FunctionReference<"mutation">,
  Query extends FunctionReference<"query">,
> = (queryArgs: FunctionArgs<Query>, mutationArgs: FunctionArgs<Mutation>) => boolean;

type CodexSetValueResolver<
  Mutation extends FunctionReference<"mutation">,
  Query extends FunctionReference<"query">,
> =
  | FunctionReturnType<Query>
  | undefined
  | ((
      current: FunctionReturnType<Query> | undefined,
      mutationArgs: FunctionArgs<Mutation>,
      queryArgs: FunctionArgs<Query>,
    ) => FunctionReturnType<Query> | undefined);

type CodexPaginatedLike<Item> = {
  page: Item[];
  [key: string]: unknown;
};

type CodexCollectionItem<Query extends FunctionReference<"query">> =
  FunctionReturnType<Query> extends Array<infer Item>
    ? Item
    : FunctionReturnType<Query> extends CodexPaginatedLike<infer Item>
      ? Item
      : never;

type CodexCollectionValue<Query extends FunctionReference<"query">> =
  FunctionReturnType<Query> extends Array<unknown> | CodexPaginatedLike<unknown>
    ? FunctionReturnType<Query>
    : never;

type CodexCollectionUpdaterConfig<
  Mutation extends FunctionReference<"mutation">,
  Query extends FunctionReference<"query">,
> = {
  query: Query;
  args?: CodexArgsResolver<Mutation, Query>;
  match?: CodexQueryMatcher<Mutation, Query>;
};

function resolveQueryArgs<
  Mutation extends FunctionReference<"mutation">,
  Query extends FunctionReference<"query">,
>(resolver: CodexArgsResolver<Mutation, Query>, mutationArgs: FunctionArgs<Mutation>): FunctionArgs<Query> {
  if (typeof resolver === "function") {
    return (resolver as (args: FunctionArgs<Mutation>) => FunctionArgs<Query>)(mutationArgs);
  }
  return resolver;
}

function forEachMatchedQuery<
  Mutation extends FunctionReference<"mutation">,
  Query extends FunctionReference<"query">,
>(
  store: OptimisticLocalStore,
  query: Query,
  mutationArgs: FunctionArgs<Mutation>,
  config: {
    args?: CodexArgsResolver<Mutation, Query>;
    match?: CodexQueryMatcher<Mutation, Query>;
  },
  updater: (queryArgs: FunctionArgs<Query>, current: FunctionReturnType<Query> | undefined) => void,
): void {
  if (config.args !== undefined) {
    const queryArgs = resolveQueryArgs(config.args, mutationArgs);
    updater(queryArgs, store.getQuery(query, queryArgs));
    return;
  }

  const queries = store.getAllQueries(query);
  for (const row of queries) {
    if (config.match && !config.match(row.args, mutationArgs)) {
      continue;
    }
    updater(row.args, row.value);
  }
}

function readCollection<Item>(value: unknown): Item[] | null {
  if (Array.isArray(value)) {
    return value as Item[];
  }
  if (
    value &&
    typeof value === "object" &&
    "page" in value &&
    Array.isArray((value as { page?: unknown }).page)
  ) {
    return (value as { page: Item[] }).page;
  }
  return null;
}

function writeCollection<ValueType, Item>(current: ValueType, page: Item[]): ValueType {
  if (Array.isArray(current)) {
    return page as ValueType;
  }
  if (current && typeof current === "object" && "page" in (current as object)) {
    return {
      ...(current as Record<string, unknown>),
      page,
    } as ValueType;
  }
  return current;
}

const codexOptimisticSet = <
  Mutation extends FunctionReference<"mutation">,
  Query extends FunctionReference<"query">,
>(config: {
  query: Query;
  args?: CodexArgsResolver<Mutation, Query>;
  match?: CodexQueryMatcher<Mutation, Query>;
  value: CodexSetValueResolver<Mutation, Query>;
}): CodexOptimisticOperation<Mutation> => {
  return (store, mutationArgs) => {
    forEachMatchedQuery(store, config.query, mutationArgs, config, (queryArgs, current) => {
      const next =
        typeof config.value === "function"
          ? (
              config.value as (
                current: FunctionReturnType<Query> | undefined,
                mutationArgs: FunctionArgs<Mutation>,
                queryArgs: FunctionArgs<Query>,
              ) => FunctionReturnType<Query> | undefined
            )(current, mutationArgs, queryArgs)
          : config.value;
      store.setQuery(config.query, queryArgs, next);
    });
  };
};

const codexOptimisticInsert = <
  Mutation extends FunctionReference<"mutation">,
  Query extends FunctionReference<"query">,
>(config: CodexCollectionUpdaterConfig<Mutation, Query> & {
  item: (
    mutationArgs: FunctionArgs<Mutation>,
    queryArgs: FunctionArgs<Query>,
    current: CodexCollectionValue<Query>,
  ) => CodexCollectionItem<Query>;
  position?: "start" | "end";
}): CodexOptimisticOperation<Mutation> => {
  return (store, mutationArgs) => {
    const position = config.position ?? "start";
    forEachMatchedQuery(store, config.query, mutationArgs, config, (queryArgs, current) => {
      if (current === undefined) {
        return;
      }
      const page = readCollection<CodexCollectionItem<Query>>(current);
      if (!page) {
        return;
      }
      const item = config.item(mutationArgs, queryArgs, current as CodexCollectionValue<Query>);
      const nextPage = position === "end" ? [...page, item] : [item, ...page];
      store.setQuery(config.query, queryArgs, writeCollection(current, nextPage));
    });
  };
};

const codexOptimisticReplace = <
  Mutation extends FunctionReference<"mutation">,
  Query extends FunctionReference<"query">,
>(config: CodexCollectionUpdaterConfig<Mutation, Query> & {
  when: (
    item: CodexCollectionItem<Query>,
    mutationArgs: FunctionArgs<Mutation>,
    queryArgs: FunctionArgs<Query>,
  ) => boolean;
  replaceWith: (
    item: CodexCollectionItem<Query>,
    mutationArgs: FunctionArgs<Mutation>,
    queryArgs: FunctionArgs<Query>,
  ) => CodexCollectionItem<Query>;
}): CodexOptimisticOperation<Mutation> => {
  return (store, mutationArgs) => {
    forEachMatchedQuery(store, config.query, mutationArgs, config, (queryArgs, current) => {
      if (current === undefined) {
        return;
      }
      const page = readCollection<CodexCollectionItem<Query>>(current);
      if (!page) {
        return;
      }
      let changed = false;
      const nextPage = page.map((item) => {
        if (!config.when(item, mutationArgs, queryArgs)) {
          return item;
        }
        changed = true;
        return config.replaceWith(item, mutationArgs, queryArgs);
      });
      if (!changed) {
        return;
      }
      store.setQuery(config.query, queryArgs, writeCollection(current, nextPage));
    });
  };
};

const codexOptimisticRemove = <
  Mutation extends FunctionReference<"mutation">,
  Query extends FunctionReference<"query">,
>(config: CodexCollectionUpdaterConfig<Mutation, Query> & {
  when: (
    item: CodexCollectionItem<Query>,
    mutationArgs: FunctionArgs<Mutation>,
    queryArgs: FunctionArgs<Query>,
  ) => boolean;
}): CodexOptimisticOperation<Mutation> => {
  return (store, mutationArgs) => {
    forEachMatchedQuery(store, config.query, mutationArgs, config, (queryArgs, current) => {
      if (current === undefined) {
        return;
      }
      const page = readCollection<CodexCollectionItem<Query>>(current);
      if (!page) {
        return;
      }
      const nextPage = page.filter((item) => !config.when(item, mutationArgs, queryArgs));
      if (nextPage.length === page.length) {
        return;
      }
      store.setQuery(config.query, queryArgs, writeCollection(current, nextPage));
    });
  };
};

export const codexOptimisticOps = {
  insert: codexOptimisticInsert,
  replace: codexOptimisticReplace,
  remove: codexOptimisticRemove,
  set: codexOptimisticSet,
  custom: <Mutation extends FunctionReference<"mutation">>(
    operation: CodexOptimisticOperation<Mutation>,
  ): CodexOptimisticOperation<Mutation> => operation,
};

export function useCodexOptimisticMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  optimisticUpdate: OptimisticUpdate<FunctionArgs<Mutation>>,
): ReactMutation<Mutation> {
  return useMutation(mutation).withOptimisticUpdate(optimisticUpdate);
}

type CodexOptimisticMessage = CodexDurableMessageLike & {
  sourceItemType?: string;
  payloadJson?: string;
};

type CodexOptimisticSendMessageArgs = {
  conversationId: string;
  turnId: string;
  text: string;
  messageId?: string;
  includeAssistantPlaceholder?: boolean;
  assistantPlaceholderId?: string;
};

type CodexDeletionStatusLike = {
  deletionJobId: string;
  status: "scheduled" | "queued" | "running" | "completed" | "failed" | "cancelled";
  updatedAt: number;
  targetKind: "thread" | "turn" | "actor";
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  phase?: string;
  [key: string]: Value;
};

type CodexDeletionStatusQuery = FunctionReference<
  "query",
  "public",
  { deletionJobId: string } & Record<string, Value>,
  CodexDeletionStatusLike | null
>;

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function maxOrderInTurn(
  store: OptimisticLocalStore,
  query: CodexMessagesQuery<Record<string, Value>>,
  args: { conversationId: string; turnId: string },
): number {
  const queries = store.getAllQueries(query);
  let maxOrder = -1;
  for (const row of queries) {
    if (row.args?.conversationId !== args.conversationId || row.args?.streamArgs !== undefined) {
      continue;
    }
    for (const message of row.value?.page ?? []) {
      if (message.turnId !== args.turnId) {
        continue;
      }
      maxOrder = Math.max(maxOrder, message.orderInTurn);
    }
  }
  return maxOrder;
}

export const codexOptimisticPresets = {
  messages: {
    send: <Query extends CodexMessagesQuery<Record<string, Value>>>(query: Query) =>
      createCodexOptimisticUpdate<FunctionReference<"mutation", "public", CodexOptimisticSendMessageArgs>>(
        codexOptimisticOps.custom((store, args) => {
          const now = Date.now();
          const nextOrder = maxOrderInTurn(store, query, {
            conversationId: args.conversationId,
            turnId: args.turnId,
          });
          const userOrder = nextOrder + 1;
          const userMessageId = args.messageId ?? randomId();

          codexOptimisticOps.insert({
            query,
            match: (queryArgs, mutationArgs) =>
              queryArgs.conversationId === mutationArgs.conversationId && queryArgs.streamArgs === undefined,
            item: () => {
              const payload = {
                type: "userMessage",
                id: userMessageId,
                content: [{ type: "text", text: args.text }],
              };
              return {
                messageId: userMessageId,
                turnId: args.turnId,
                role: "user",
                status: "completed",
                text: args.text,
                sourceItemType: "userMessage",
                orderInTurn: userOrder,
                payloadJson: JSON.stringify(payload),
                createdAt: now,
                updatedAt: now,
                completedAt: now,
              } as CodexCollectionItem<Query>;
            },
          })(store, args);

          if (!args.includeAssistantPlaceholder) {
            return;
          }

          const assistantOrder = userOrder + 1;
          const assistantMessageId = args.assistantPlaceholderId ?? randomId();
          codexOptimisticOps.insert({
            query,
            match: (queryArgs, mutationArgs) =>
              queryArgs.conversationId === mutationArgs.conversationId && queryArgs.streamArgs === undefined,
            item: () => {
              const payload = {
                type: "agentMessage",
                id: assistantMessageId,
                text: "",
              };
              return {
                messageId: assistantMessageId,
                turnId: args.turnId,
                role: "assistant",
                status: "streaming",
                text: "",
                sourceItemType: "agentMessage",
                orderInTurn: assistantOrder,
                payloadJson: JSON.stringify(payload),
                createdAt: now,
                updatedAt: now,
              } as CodexCollectionItem<Query>;
            },
          })(store, args);
        }),
      ),
  },
  deletionStatus: {
    cancel: <Query extends CodexDeletionStatusQuery>(query: Query) =>
      createCodexOptimisticUpdate<FunctionReference<"mutation", "public", FunctionArgs<Query>>>(
        codexOptimisticOps.set({
          query,
          args: (mutationArgs) => mutationArgs as FunctionArgs<Query>,
          value: (current) => {
            if (!current) {
              return current;
            }
            const now = Date.now();
            return {
              ...current,
              status: "cancelled",
              phase: "cancelled",
              cancelledAt: now,
              updatedAt: now,
            };
          },
        }),
      ),
    forceRun: <Query extends CodexDeletionStatusQuery>(query: Query) =>
      createCodexOptimisticUpdate<FunctionReference<"mutation", "public", FunctionArgs<Query>>>(
        codexOptimisticOps.set({
          query,
          args: (mutationArgs) => mutationArgs as FunctionArgs<Query>,
          value: (current) => {
            if (!current) {
              return current;
            }
            const now = Date.now();
            return {
              ...current,
              status: "running",
              phase: "running",
              startedAt: current.startedAt ?? now,
              updatedAt: now,
            };
          },
        }),
      ),
  },
};
