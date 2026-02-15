import type { GenericId } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import type {
  ApprovalRequest,
  ApprovalResolution,
  DurableMessageDeltaFromEvent,
  DurableMessageFromEvent,
  ReasoningDeltaFromEvent,
  TerminalTurnStatus,
} from "../syncHelpers.js";
import type { RuntimeOptions, SyncRuntimeInput } from "../syncRuntime.js";

export type ActorContext = {
  userId?: string;
};

export type StreamInboundEvent = {
  type: "stream_delta";
  eventId: string;
  turnId: string;
  streamId: string;
  kind: string;
  payloadJson: string;
  cursorStart: number;
  cursorEnd: number;
  createdAt: number;
};

export type LifecycleInboundEvent = {
  type: "lifecycle_event";
  eventId: string;
  turnId?: string;
  kind: string;
  payloadJson: string;
  createdAt: number;
};

export type InboundEvent = StreamInboundEvent | LifecycleInboundEvent;

export type PushEventsArgs = {
  actor: ActorContext;
  sessionId: string;
  threadId: string;
  streamDeltas: StreamInboundEvent[];
  lifecycleEvents: LifecycleInboundEvent[];
  runtime?: SyncRuntimeInput;
};

export type HeartbeatArgs = {
  actor: ActorContext;
  sessionId: string;
  threadId: string;
  lastEventCursor: number;
};

export type EnsureSessionArgs = HeartbeatArgs;

export type EnsureSessionResult = {
  sessionId: string;
  threadId: string;
  status: "created" | "active";
};

export type IngestSafeErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_THREAD_MISMATCH"
  | "TURN_ID_REQUIRED_FOR_TURN_EVENT"
  | "TURN_ID_REQUIRED_FOR_CODEX_EVENT"
  | "OUT_OF_ORDER"
  | "REPLAY_GAP"
  | "UNKNOWN";

export type IngestSafeArgs = PushEventsArgs & {
  ensureLastEventCursor?: number;
};

export type IngestSafeResult = {
  status: "ok" | "partial" | "session_recovered" | "rejected";
  ingestStatus: "ok" | "partial";
  ackedStreams: Array<{ streamId: string; ackCursorEnd: number }>;
  recovery?: {
    action: "session_rebound";
    sessionId: string;
    threadId: string;
  };
  errors: Array<{
    code: IngestSafeErrorCode;
    message: string;
    recoverable: boolean;
  }>;
};

export type CachedMessage = {
  _id: GenericId<"codex_messages">;
  status: "streaming" | "completed" | "failed" | "interrupted";
  text: string;
};

export type CachedApproval = {
  _id: GenericId<"codex_approvals">;
  status: "pending" | "accepted" | "declined";
};

export type CachedStream = {
  _id: GenericId<"codex_streams">;
  turnId: string;
  turnRef: GenericId<"codex_turns">;
  state: { kind: "streaming" | "finished" | "aborted" };
};

export type IngestSession = Doc<"codex_sessions">;

export type IngestStreamStatsState = {
  persistedStatsByStreamId: Map<
    string,
    { threadId: string; turnId: string; latestCursor: number; deltaCount: number }
  >;
  expectedCursorByStreamId: Map<string, number>;
  streamCheckpointCursorByStreamId: Map<string, number>;
};

export type IngestCollectedState = {
  inBatchEventIds: Set<string>;
  knownTurnIds: Set<string>;
  startedTurns: Set<string>;
  terminalTurns: Map<string, TerminalTurnStatus>;
  pendingApprovals: Map<string, ApprovalRequest>;
  resolvedApprovals: Map<string, ApprovalResolution>;
};

export type NormalizedInboundEvent = InboundEvent & {
  syntheticTurnStatus: "queued" | "inProgress" | "completed" | "interrupted" | "failed";
  terminalTurnStatus: TerminalTurnStatus | null;
  approvalRequest: ApprovalRequest | null;
  approvalResolution: ApprovalResolution | null;
  durableMessage: DurableMessageFromEvent | null;
  durableDelta: DurableMessageDeltaFromEvent | null;
  reasoningDelta: ReasoningDeltaFromEvent | null;
};

export type IngestSharedContext = {
  ctx: MutationCtx;
  args: PushEventsArgs;
  thread: Doc<"codex_threads">;
};

export type IngestRuntimeContext = IngestSharedContext & {
  runtime: RuntimeOptions;
};

export type IngestProgressState = {
  lastPersistedCursor: number;
  persistedAnyEvent: boolean;
  ingestStatus: "ok" | "partial";
};

export type TurnIngestContext = IngestSharedContext & {
  collected: IngestCollectedState;
};

export type MessageIngestContext = IngestRuntimeContext;

export type ApprovalIngestContext = IngestSharedContext & {
  collected: IngestCollectedState;
};

export type StreamIngestContext = IngestRuntimeContext & {
  collected: IngestCollectedState;
  streamState: IngestStreamStatsState;
  progress: IngestProgressState;
};

export type CheckpointIngestContext = IngestSharedContext & {
  streamState: IngestStreamStatsState;
};

export type SessionIngestContext = Pick<IngestSharedContext, "ctx" | "args"> & {
  session: IngestSession;
  progress: IngestProgressState;
};
