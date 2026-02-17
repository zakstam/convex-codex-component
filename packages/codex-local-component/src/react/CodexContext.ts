"use client";

import { createContext, useContext } from "react";
import type { CodexMessagesQuery } from "./types.js";
import type { CodexThreadActivityThreadState } from "./threadActivity.js";
import type { CodexThreadStateQuery } from "./useCodexThreadState.js";

export type CodexContextValue = {
  actor: Record<string, unknown>;
  listThreadMessages: CodexMessagesQuery<unknown>;
  threadSnapshotSafe: CodexThreadStateQuery<unknown, CodexThreadActivityThreadState>;
  listPendingServerRequests?: unknown;
  defaultInitialNumItems: number;
  defaultStream: boolean;
};

export const CodexContext = createContext<CodexContextValue | null>(null);

export function useCodexContext(): CodexContextValue {
  const ctx = useContext(CodexContext);
  if (!ctx) {
    throw new Error(
      "useCodexContext must be used within a <CodexProvider>. " +
      "Wrap your component tree with <CodexProvider api={api.chat} actor={actor}>."
    );
  }
  return ctx;
}
