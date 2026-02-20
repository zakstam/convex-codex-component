"use client";

import { useMemo, type ReactNode } from "react";
import { CodexContext, type CodexContextValue } from "./CodexContext.js";
import type { CodexMessagesQuery, CodexThreadReadResult } from "./types.js";
import type { CodexThreadActivityThreadState } from "./threadActivity.js";
import type { CodexThreadStateQuery } from "./useCodexThreadState.js";
import type { CodexTokenUsageQuery } from "./useCodexTokenUsage.js";

export type CodexRuntimeOwnedThreadHandleApi<
  Actor extends Record<string, unknown> = Record<string, unknown>,
> = {
  listThreadMessagesByThreadHandle: CodexMessagesQuery<{ actor: Actor }>;
  threadSnapshotByThreadHandle: CodexThreadStateQuery<
    { actor: Actor },
    CodexThreadReadResult<CodexThreadActivityThreadState>
  >;
  listPendingServerRequestsByThreadHandle?: unknown;
  listTokenUsageByThreadHandle?: CodexTokenUsageQuery<{ actor: Actor }>;
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
  initialNumItems?: number;
  stream?: boolean;
  children: ReactNode;
};

export function createCodexReactPreset<
  Actor extends Record<string, unknown> = Record<string, unknown>,
>(
  api: CodexRuntimeOwnedThreadHandleApi<Actor>,
): CodexProviderApi<Actor> {
  const listThreadMessages = api.listThreadMessagesByThreadHandle;
  const threadSnapshot = api.threadSnapshotByThreadHandle;
  const listPendingServerRequests = api.listPendingServerRequestsByThreadHandle;
  const listTokenUsage = api.listTokenUsageByThreadHandle;

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
      defaultInitialNumItems: initialNumItems,
      defaultStream: stream,
    }),
    [
      actor,
      preset.listThreadMessages,
      preset.threadSnapshot,
      preset.listPendingServerRequests,
      preset.listTokenUsage,
      initialNumItems,
      stream,
    ],
  );

  return <CodexContext.Provider value={value}>{children}</CodexContext.Provider>;
}
