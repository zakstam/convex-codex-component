"use client";

import type { CodexUIMessage } from "../shared/types.js";

export type CodexSyncHydrationState =
  | "idle"
  | "syncing"
  | "synced"
  | "partial"
  | "drifted"
  | "cancelled"
  | "failed";

export type CodexSyncJobState =
  | "idle"
  | "syncing"
  | "synced"
  | "failed"
  | "cancelled";

export type CodexSyncHydrationSnapshot = {
  conversationId: string;
  messages: CodexUIMessage[];
  syncState: CodexSyncHydrationState;
  updatedAtMs: number;
  syncJobId?: string;
  syncJobState?: CodexSyncJobState;
  syncJobPolicyVersion?: number;
  lastCursor?: number;
  errorCode?: string;
};

export type CodexConversationSyncProgress = {
  syncedCount: number;
  totalCount: number;
  syncState: CodexSyncHydrationState | null;
  label: string;
};

function isCountedChatMessage(message: CodexUIMessage): boolean {
  if (message.sourceItemType === "reasoning") {
    return false;
  }
  if (message.messageId.startsWith("optimistic:")) {
    return false;
  }
  return true;
}

function scopedMessageIdentity(message: CodexUIMessage): string {
  return `${message.turnId}:${message.messageId}`;
}

function isUnsyncedMessageIdentity(
  unsyncedMessageIds: ReadonlySet<string>,
  message: CodexUIMessage,
): boolean {
  return (
    unsyncedMessageIds.has(scopedMessageIdentity(message)) ||
    unsyncedMessageIds.has(message.messageId)
  );
}

export function computeCodexConversationSyncProgress(args: {
  messages: CodexUIMessage[];
  unsyncedMessageIds: ReadonlySet<string>;
  syncState: CodexSyncHydrationState | null;
}): CodexConversationSyncProgress {
  let totalCount = 0;
  let syncedCount = 0;
  for (const message of args.messages) {
    if (!isCountedChatMessage(message)) {
      continue;
    }
    totalCount += 1;
    if (!isUnsyncedMessageIdentity(args.unsyncedMessageIds, message)) {
      syncedCount += 1;
    }
  }
  return {
    syncedCount,
    totalCount,
    syncState: args.syncState,
    label: `${syncedCount}/${totalCount} synced`,
  };
}

export type CodexSyncHydrationSource = {
  getConversationSnapshot: (
    conversationId: string,
  ) => CodexSyncHydrationSnapshot | null | Promise<CodexSyncHydrationSnapshot | null>;
  subscribe?: (
    listener: (snapshot: CodexSyncHydrationSnapshot) => void,
  ) => void | (() => void) | Promise<void | (() => void)>;
};
