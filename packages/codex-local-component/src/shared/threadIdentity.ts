export type ThreadHandle = string;

export type ThreadHandleIdentity = {
  threadHandle: ThreadHandle;
};

export type RuntimeConversationLocator = {
  runtimeConversationId: string;
};

export type ThreadLocator = ThreadHandleIdentity | RuntimeConversationLocator;
