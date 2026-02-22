import type { FunctionArgs } from "convex/server";
import { api } from "../convex/_generated/api.js";

type ActorContext = { userId?: string };
type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type ValidateHostWiringArgs = FunctionArgs<typeof api.chat.validateHostWiring>;
type EnsureConversationBindingArgs = FunctionArgs<typeof api.chat.ensureConversationBinding>;
type EnsureSessionArgs = FunctionArgs<typeof api.chat.ensureSession>;
type IngestBatchArgs = FunctionArgs<typeof api.chat.ingestBatch>;
type PersistenceStatsArgs = FunctionArgs<typeof api.chat.persistenceStats>;
type DurableHistoryStatsArgs = FunctionArgs<typeof api.chat.durableHistoryStats>;
type ThreadSnapshotArgs = FunctionArgs<typeof api.chat.threadSnapshotByConversation>;

type _ValidateHostWiringArgsAreTyped = Assert<
  Equal<
    ValidateHostWiringArgs,
    {
      actor: ActorContext;
      conversationId?: string;
    }
  >
>;

type _EnsureConversationBindingArgsAreTyped = Assert<
  Equal<
    EnsureConversationBindingArgs,
    {
      actor: ActorContext;
      conversationId: string;
      model?: string;
      cwd?: string;
    }
  >
>;

type _EnsureSessionArgsAreTyped = Assert<
  Equal<
    EnsureSessionArgs,
    {
      actor: ActorContext;
      sessionId: string;
      threadId: string;
      lastEventCursor: number;
    }
  >
>;

type _IngestBatchArgsAreTyped = Assert<
  Equal<
    IngestBatchArgs,
    {
      actor: ActorContext;
      sessionId: string;
      threadId: string;
      deltas: Array<
        | {
            type: "stream_delta";
            eventId: string;
            turnId: string;
            streamId: string;
            kind: string;
            payloadJson: string;
            cursorStart: number;
            cursorEnd: number;
            createdAt: number;
          }
        | {
            type: "lifecycle_event";
            eventId: string;
            turnId?: string;
            kind: string;
            payloadJson: string;
            createdAt: number;
          }
      >;
      runtime?: {
        saveStreamDeltas?: boolean;
        saveReasoningDeltas?: boolean;
        exposeRawReasoningDeltas?: boolean;
        maxDeltasPerStreamRead?: number;
        maxDeltasPerRequestRead?: number;
        finishedStreamDeleteDelayMs?: number;
      };
    }
  >
>;

type _PersistenceStatsArgsAreTyped = Assert<
  Equal<
    PersistenceStatsArgs,
    {
      actor: ActorContext;
      conversationId: string;
    }
  >
>;

type _DurableHistoryStatsArgsAreTyped = Assert<
  Equal<
    DurableHistoryStatsArgs,
    {
      actor: ActorContext;
      conversationId: string;
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

export {};
