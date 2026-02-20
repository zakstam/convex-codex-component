import type { FunctionArgs } from "convex/server";
import { api } from "../convex/_generated/api";
import type { ActorContext } from "./lib/tauriBridge";

type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

type ListThreadMessagesArgs = FunctionArgs<typeof api.chat.listThreadMessagesByThreadHandle>;
type ThreadSnapshotArgs = FunctionArgs<typeof api.chat.threadSnapshotByThreadHandle>;
type ListPendingServerRequestsArgs = FunctionArgs<typeof api.chat.listPendingServerRequestsByThreadHandle>;
type ValidateHostWiringArgs = FunctionArgs<typeof api.chat.validateHostWiring>;
type ScheduleDeleteThreadArgs = FunctionArgs<typeof api.chat.scheduleDeleteThread>;
type ScheduleDeleteTurnArgs = FunctionArgs<typeof api.chat.scheduleDeleteTurn>;
type CancelDeletionArgs = FunctionArgs<typeof api.chat.cancelDeletion>;
type GetDeletionStatusArgs = FunctionArgs<typeof api.chat.getDeletionStatus>;

type _ListThreadMessagesArgsAreTyped = Assert<
  Extends<
    ListThreadMessagesArgs,
    {
      actor: ActorContext;
      threadHandle: string;
      paginationOpts: { cursor: string | null; numItems: number };
    }
  >
>;

type _ThreadSnapshotArgsAreTyped = Assert<
  Extends<
    ThreadSnapshotArgs,
    {
      actor: ActorContext;
      threadHandle: string;
    }
  >
>;

type _ListPendingServerRequestsArgsAreTyped = Assert<
  Extends<
    ListPendingServerRequestsArgs,
    {
      actor: ActorContext;
      threadHandle: string;
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

type _ScheduleDeleteThreadArgsAreTyped = Assert<
  Extends<
    ScheduleDeleteThreadArgs,
    {
      actor: ActorContext;
      threadId: string;
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
      threadId: string;
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

export {};
