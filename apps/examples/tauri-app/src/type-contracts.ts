import type { FunctionArgs } from "convex/server";
import { api } from "../convex/_generated/api";
import type { ActorContext } from "./lib/tauriBridge";

type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

type ListThreadMessagesArgs = FunctionArgs<typeof api.chat.listThreadMessages>;
type ThreadSnapshotSafeArgs = FunctionArgs<typeof api.chat.threadSnapshotSafe>;
type ListPendingServerRequestsArgs = FunctionArgs<typeof api.chat.listPendingServerRequests>;
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
