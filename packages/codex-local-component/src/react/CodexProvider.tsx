"use client";

import { useMemo, type ReactNode } from "react";
import { CodexContext, type CodexContextValue } from "./CodexContext.js";
import type { CodexMessagesQuery, CodexThreadReadResult } from "./types.js";
import type { CodexThreadActivityThreadState } from "./threadActivity.js";
import type { CodexThreadStateQuery } from "./useCodexThreadState.js";
import type { CodexTokenUsageQuery } from "./useCodexTokenUsage.js";

export type CodexProviderApi<Actor extends Record<string, unknown> = Record<string, unknown>> = {
  listThreadMessages: CodexMessagesQuery<{ actor: Actor }>;
  threadSnapshot: CodexThreadStateQuery<
    { actor: Actor },
    CodexThreadReadResult<CodexThreadActivityThreadState>
  >;
  listPendingServerRequests?: unknown;
  listTokenUsage?: CodexTokenUsageQuery<{ actor: Actor }>;
} & Record<string, unknown>;

export type CodexProviderProps<Actor extends Record<string, unknown> = Record<string, unknown>> = {
  api: CodexProviderApi<Actor>;
  actor?: Actor;
  initialNumItems?: number;
  stream?: boolean;
  children: ReactNode;
};

export function CodexProvider<Actor extends Record<string, unknown> = Record<string, unknown>>({
  api,
  actor,
  initialNumItems = 30,
  stream = true,
  children,
}: CodexProviderProps<Actor>) {
  const value = useMemo<CodexContextValue>(
    () => ({
      actor: actor ?? {},
      listThreadMessages: api.listThreadMessages,
      threadSnapshot: api.threadSnapshot,
      ...(api.listPendingServerRequests !== undefined
        ? { listPendingServerRequests: api.listPendingServerRequests }
        : {}),
      ...(api.listTokenUsage !== undefined
        ? { listTokenUsage: api.listTokenUsage }
        : {}),
      defaultInitialNumItems: initialNumItems,
      defaultStream: stream,
    }),
    [actor, api.listThreadMessages, api.threadSnapshot, api.listPendingServerRequests, api.listTokenUsage, initialNumItems, stream],
  );

  return <CodexContext.Provider value={value}>{children}</CodexContext.Provider>;
}
