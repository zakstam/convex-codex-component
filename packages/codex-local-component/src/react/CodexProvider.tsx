"use client";

import { useMemo, type ReactNode } from "react";
import { CodexContext, type CodexContextValue } from "./CodexContext.js";
import type { CodexMessagesQuery } from "./types.js";
import type { CodexThreadActivityThreadState } from "./threadActivity.js";
import type { CodexThreadStateQuery } from "./useCodexThreadState.js";

export type CodexProviderApi<Actor extends Record<string, unknown> = Record<string, unknown>> = {
  listThreadMessages: CodexMessagesQuery<{ actor: Actor }>;
  threadSnapshotSafe: CodexThreadStateQuery<{ actor: Actor }, CodexThreadActivityThreadState>;
  listPendingServerRequests?: unknown;
  listTokenUsage?: unknown;
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
      actor: actor ?? ({} as Record<string, unknown>),
      listThreadMessages: api.listThreadMessages as CodexMessagesQuery<unknown>,
      threadSnapshotSafe: api.threadSnapshotSafe as CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>,
      listPendingServerRequests: api.listPendingServerRequests,
      listTokenUsage: api.listTokenUsage,
      defaultInitialNumItems: initialNumItems,
      defaultStream: stream,
    }),
    [actor, api.listThreadMessages, api.threadSnapshotSafe, api.listPendingServerRequests, api.listTokenUsage, initialNumItems, stream],
  );

  return <CodexContext.Provider value={value}>{children}</CodexContext.Provider>;
}
