import type { FunctionArgs } from "convex/server";
import { api } from "../convex/_generated/api";
import type { ActorContext } from "./lib/tauriBridge";

type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

type ListThreadMessagesArgs = FunctionArgs<typeof api.chat.listThreadMessagesByConversation>;
type ThreadSnapshotArgs = FunctionArgs<typeof api.chat.threadSnapshotByConversation>;
type ListPendingServerRequestsArgs = FunctionArgs<typeof api.chat.listPendingServerRequestsByConversation>;
type ValidateHostWiringArgs = FunctionArgs<typeof api.chat.validateHostWiring>;
type ScheduleDeleteThreadArgs = FunctionArgs<typeof api.chat.scheduleDeleteThread>;
type ScheduleDeleteTurnArgs = FunctionArgs<typeof api.chat.scheduleDeleteTurn>;
type CancelDeletionArgs = FunctionArgs<typeof api.chat.cancelDeletion>;
type GetDeletionStatusArgs = FunctionArgs<typeof api.chat.getDeletionStatus>;
type ResolveOpenTargetArgs = FunctionArgs<typeof api.chat.resolveOpenTarget>;

type _ListThreadMessagesArgsAreTyped = Assert<
  Extends<
    ListThreadMessagesArgs,
    {
      actor: ActorContext;
      conversationId: string;
      paginationOpts: { cursor: string | null; numItems: number };
    }
  >
>;

type _ThreadSnapshotArgsAreTyped = Assert<
  Extends<
    ThreadSnapshotArgs,
    {
      actor: ActorContext;
      conversationId: string;
    }
  >
>;

type _ListPendingServerRequestsArgsAreTyped = Assert<
  Extends<
    ListPendingServerRequestsArgs,
    {
      actor: ActorContext;
      conversationId: string;
      limit?: number;
    }
  >
>;

type _ValidateHostWiringArgsAreTyped = Assert<
  Extends<
    ValidateHostWiringArgs,
    {
      actor: ActorContext;
      conversationId?: string;
    }
  >
>;

type _ScheduleDeleteThreadArgsAreTyped = Assert<
  Extends<
    ScheduleDeleteThreadArgs,
    {
      actor: ActorContext;
      conversationId: string;
      reason?: string;
      batchSize?: number;
      delayMs?: number;
    }
  >
>;

type _ScheduleDeleteTurnArgsAreTyped = Assert<
  Extends<
    ScheduleDeleteTurnArgs,
    {
      actor: ActorContext;
      conversationId: string;
      turnId: string;
      reason?: string;
      batchSize?: number;
      delayMs?: number;
    }
  >
>;

type _CancelDeletionArgsAreTyped = Assert<
  Extends<
    CancelDeletionArgs,
    {
      actor: ActorContext;
      deletionJobId: string;
    }
  >
>;

type _GetDeletionStatusArgsAreTyped = Assert<
  Extends<
    GetDeletionStatusArgs,
    {
      actor: ActorContext;
      deletionJobId: string;
    }
  >
>;

type _ResolveOpenTargetArgsAreTyped = Assert<
  Extends<
    ResolveOpenTargetArgs,
    {
      actor: ActorContext;
      conversationHandle: string;
    }
  >
>;

export {};
