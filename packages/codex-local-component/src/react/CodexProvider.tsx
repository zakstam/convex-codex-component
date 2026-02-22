"use client";

import { useMemo, type ReactNode } from "react";
import { CodexContext, type CodexContextValue } from "./CodexContext.js";
import type { CodexMessagesQuery, CodexThreadReadResult } from "./types.js";
import type { CodexThreadActivityThreadState } from "./threadActivity.js";
import type { CodexThreadStateQuery } from "./useCodexThreadState.js";
import type { CodexTokenUsageQuery } from "./useCodexTokenUsage.js";
import type { CodexSyncHydrationSource } from "./syncHydration.js";

export type CodexRuntimeOwnedConversationApi<
  Actor extends Record<string, unknown> = Record<string, unknown>,
> = {
  listThreadMessagesByConversation: CodexMessagesQuery<{ actor: Actor }>;
  threadSnapshotByConversation: CodexThreadStateQuery<
    { actor: Actor },
    CodexThreadReadResult<CodexThreadActivityThreadState>
  >;
  listPendingServerRequestsByConversation?: unknown;
  listTokenUsageByConversation?: CodexTokenUsageQuery<{ actor: Actor }>;
} & Record<string, unknown>;

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
  preset: CodexProviderApi<Actor>;
  actor?: Actor;
  syncHydrationSource?: CodexSyncHydrationSource;
  initialNumItems?: number;
  stream?: boolean;
  children: ReactNode;
};

export function createCodexReactPreset<
  Actor extends Record<string, unknown> = Record<string, unknown>,
>(
  api: CodexRuntimeOwnedConversationApi<Actor>,
): CodexProviderApi<Actor> {
  const listThreadMessages = api.listThreadMessagesByConversation;
  const threadSnapshot = api.threadSnapshotByConversation;
  const listPendingServerRequests = api.listPendingServerRequestsByConversation;
  const listTokenUsage = api.listTokenUsageByConversation;

  return {
    listThreadMessages,
    threadSnapshot,
    ...(listPendingServerRequests !== undefined
      ? { listPendingServerRequests }
      : {}),
    ...(listTokenUsage !== undefined
      ? {
          listTokenUsage,
        }
      : {}),
  };
}

export function CodexProvider<Actor extends Record<string, unknown> = Record<string, unknown>>({
  preset,
  actor,
  syncHydrationSource,
  initialNumItems = 30,
  stream = true,
  children,
}: CodexProviderProps<Actor>) {
  const value = useMemo<CodexContextValue>(
    () => ({
      actor: actor ?? {},
      listThreadMessages: preset.listThreadMessages,
      threadSnapshot: preset.threadSnapshot,
      ...(preset.listPendingServerRequests !== undefined
        ? { listPendingServerRequests: preset.listPendingServerRequests }
        : {}),
      ...(preset.listTokenUsage !== undefined
        ? { listTokenUsage: preset.listTokenUsage }
        : {}),
      ...(syncHydrationSource !== undefined
        ? { syncHydrationSource }
        : {}),
      defaultInitialNumItems: initialNumItems,
      defaultStream: stream,
    }),
    [
      actor,
      preset.listThreadMessages,
      preset.threadSnapshot,
      preset.listPendingServerRequests,
      preset.listTokenUsage,
      syncHydrationSource,
      initialNumItems,
      stream,
    ],
  );

  return <CodexContext.Provider value={value}>{children}</CodexContext.Provider>;
}
