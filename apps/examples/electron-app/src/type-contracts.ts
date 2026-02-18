import type { FunctionArgs } from "convex/server";
import { api } from "../convex/_generated/api";
import type { ActorContext } from "./lib/electronBridge";

type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

type ListThreadMessagesArgs = FunctionArgs<typeof api.chat.listThreadMessages>;
type ThreadSnapshotSafeArgs = FunctionArgs<typeof api.chat.threadSnapshotSafe>;
type ListPendingServerRequestsArgs = FunctionArgs<typeof api.chat.listPendingServerRequests>;
type ValidateHostWiringArgs = FunctionArgs<typeof api.chat.validateHostWiring>;

type _ListThreadMessagesArgsAreTyped = Assert<
  Extends<
    ListThreadMessagesArgs,
    {
      actor: ActorContext;
      threadId: string;
      paginationOpts: { cursor: string | null; numItems: number };
    }
  >
>;

type _ThreadSnapshotSafeArgsAreTyped = Assert<
  Extends<
    ThreadSnapshotSafeArgs,
    {
      actor: ActorContext;
      threadId: string;
    }
  >
>;

type _ListPendingServerRequestsArgsAreTyped = Assert<
  Extends<
    ListPendingServerRequestsArgs,
    {
      actor: ActorContext;
      threadId?: string;
      limit?: number;
    }
  >
>;

type _ValidateHostWiringArgsAreTyped = Assert<
  Extends<
    ValidateHostWiringArgs,
    {
      actor: ActorContext;
      threadId?: string;
    }
  >
>;

export {};
