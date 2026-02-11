"use client";

import { usePaginatedQuery, useMutation, type PaginatedQueryArgs, type UsePaginatedQueryResult } from "convex/react";
import type { FunctionArgs, FunctionReference, OptionalRestArgs, PaginationOptions, PaginationResult } from "convex/server";
import { useCallback } from "react";

export type CodexApprovalItem = {
  threadId: string;
  turnId: string;
  itemId: string;
  kind: string;
  reason?: string;
  createdAt: number;
};

export type CodexApprovalsQuery<Args = Record<string, unknown>> = FunctionReference<
  "query",
  "public",
  {
    paginationOpts: PaginationOptions;
    threadId?: string;
  } & Args,
  PaginationResult<CodexApprovalItem>
>;

export type CodexApprovalsQueryArgs<Query extends CodexApprovalsQuery<unknown>> =
  Query extends CodexApprovalsQuery<unknown>
    ? Omit<FunctionArgs<Query>, "paginationOpts">
    : never;

export type CodexApprovalRespondMutation<Args = Record<string, unknown>> = FunctionReference<
  "mutation",
  "public",
  {
    threadId: string;
    turnId: string;
    itemId: string;
    decision: "accepted" | "declined";
  } & Args,
  null
>;

export type CodexApprovalRespondArgs<
  Mutation extends CodexApprovalRespondMutation<unknown>,
> = Mutation extends CodexApprovalRespondMutation<unknown>
  ? Omit<FunctionArgs<Mutation>, "decision">
  : never;

function runMutationWithArgs<Mutation extends FunctionReference<"mutation", "public">>(
  runner: (...args: OptionalRestArgs<Mutation>) => Promise<null>,
  args: FunctionArgs<Mutation>,
): Promise<null> {
  return runner(...([args] as OptionalRestArgs<Mutation>));
}

export function useCodexApprovals<
  Query extends CodexApprovalsQuery<unknown>,
  Mutation extends CodexApprovalRespondMutation<unknown>,
>(
  query: Query,
  args: CodexApprovalsQueryArgs<Query> | "skip",
  respondMutation: Mutation,
  options: { initialNumItems: number },
): UsePaginatedQueryResult<CodexApprovalItem> & {
  accept: (args: CodexApprovalRespondArgs<Mutation>) => Promise<null>;
  decline: (args: CodexApprovalRespondArgs<Mutation>) => Promise<null>;
} {
  const paginated = usePaginatedQuery(query, args as PaginatedQueryArgs<Query> | "skip", {
    initialNumItems: options.initialNumItems,
  });
  const respond = useMutation(respondMutation);

  const accept = useCallback(
    async (nextArgs: CodexApprovalRespondArgs<Mutation>) => {
      const payload: FunctionArgs<Mutation> = { ...nextArgs, decision: "accepted" };
      return runMutationWithArgs(respond, payload);
    },
    [respond],
  );

  const decline = useCallback(
    async (nextArgs: CodexApprovalRespondArgs<Mutation>) => {
      const payload: FunctionArgs<Mutation> = { ...nextArgs, decision: "declined" };
      return runMutationWithArgs(respond, payload);
    },
    [respond],
  );

  return {
    ...paginated,
    accept,
    decline,
  };
}
