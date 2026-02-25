import type { FunctionArgs } from "convex/server";
import { api } from "../convex/_generated/api";
import type { ActorContext } from "./lib/tauriBridge";

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type ListThreadMessagesArgs = FunctionArgs<typeof api.chat.listThreadMessagesByConversation>;
type ThreadSnapshotArgs = FunctionArgs<typeof api.chat.threadSnapshotByConversation>;
type ListPendingServerRequestsArgs = FunctionArgs<typeof api.chat.listPendingServerRequestsByConversation>;
type ValidateHostWiringArgs = FunctionArgs<typeof api.chat.validateHostWiring>;
type ValidatePickerHostWiringArgs = FunctionArgs<typeof api.chat.validatePickerHostWiring>;
type ScheduleDeleteThreadArgs = FunctionArgs<typeof api.chat.scheduleDeleteThread>;
type ScheduleDeleteTurnArgs = FunctionArgs<typeof api.chat.scheduleDeleteTurn>;
type CancelDeletionArgs = FunctionArgs<typeof api.chat.cancelDeletion>;
type GetDeletionStatusArgs = FunctionArgs<typeof api.chat.getDeletionStatus>;
type ResolveOpenTargetArgs = FunctionArgs<typeof api.chat.resolveOpenTarget>;

type _ListThreadMessagesArgsAreTyped = Assert<
  Equal<
    Pick<ListThreadMessagesArgs, "actor" | "conversationId">,
    {
      actor: ActorContext;
      conversationId: string;
    }
  >
>;

type _ListThreadMessagesPaginationArgsAreTyped = Assert<
  Equal<
    Pick<ListThreadMessagesArgs["paginationOpts"], "cursor" | "numItems">,
    {
      cursor: string | null;
      numItems: number;
    }
  >
>;

type _ThreadSnapshotArgsAreTyped = Assert<
  Equal<
    ThreadSnapshotArgs,
    {
      actor: ActorContext;
      conversationId: string;
    }
  >
>;

type _ListPendingServerRequestsArgsAreTyped = Assert<
  Equal<
    ListPendingServerRequestsArgs,
    {
      actor: ActorContext;
      conversationId: string;
      limit?: number;
    }
  >
>;

type _ValidateHostWiringArgsAreTyped = Assert<
  Equal<
    ValidateHostWiringArgs,
    {
      actor: ActorContext;
      conversationId?: string;
    }
  >
>;

type _ValidatePickerHostWiringArgsAreTyped = Assert<
  Equal<
    ValidatePickerHostWiringArgs,
    {
      actor: ActorContext;
    }
  >
>;

type _ScheduleDeleteThreadArgsAreTyped = Assert<
  Equal<
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
  Equal<
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
  Equal<
    CancelDeletionArgs,
    {
      actor: ActorContext;
      deletionJobId: string;
    }
  >
>;

type _GetDeletionStatusArgsAreTyped = Assert<
  Equal<
    GetDeletionStatusArgs,
    {
      actor: ActorContext;
      deletionJobId: string;
    }
  >
>;

type _ResolveOpenTargetArgsAreTyped = Assert<
  Equal<
    ResolveOpenTargetArgs,
    {
      actor: ActorContext;
      conversationHandle: string;
    }
  >
>;

export {};
