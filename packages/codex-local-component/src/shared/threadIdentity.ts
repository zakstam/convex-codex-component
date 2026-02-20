export type ThreadHandle = string;

export type ThreadHandleIdentity = {
  threadHandle: ThreadHandle;
};

export type RuntimeThreadLocator = {
  runtimeThreadId: string;
};

export type ThreadLocator = ThreadHandleIdentity | RuntimeThreadLocator;
