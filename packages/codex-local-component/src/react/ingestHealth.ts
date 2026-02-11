"use client";

export type CodexIngestHealthStatus = "unknown" | "missing_thread" | "healthy" | "degraded";

export type CodexIngestHealthIssue =
  | "aborted_streams"
  | "orphan_streaming_state"
  | "dispatch_without_stream"
  | "streams_without_messages"
  | "pending_approvals";

export type CodexIngestHealth = {
  status: CodexIngestHealthStatus;
  issues: CodexIngestHealthIssue[];
  streamCount: number;
  activeStreamCount: number;
  finishedStreamCount: number;
  abortedStreamCount: number;
  latestStreamCursor: number;
  recentMessageCount: number;
  pendingApprovalCount: number;
  inFlightDispatchCount: number;
  lastMessageAt?: number;
  lastTurnStartedAt?: number;
};

export type CodexIngestHealthThreadState = {
  streamStats?: Array<{
    state?: "streaming" | "finished" | "aborted" | string;
    latestCursor?: number;
  }> | null;
  recentMessages?: Array<{
    status?: "streaming" | "completed" | "failed" | "interrupted" | string;
    createdAt?: number;
  }> | null;
  pendingApprovals?: unknown[] | null;
  dispatches?: Array<{
    status?: "queued" | "claimed" | "started" | "completed" | "failed" | "cancelled" | string;
  }> | null;
  turns?: Array<{
    startedAt?: number;
  }> | null;
};

const DEGRADING_ISSUES = new Set<CodexIngestHealthIssue>([
  "aborted_streams",
  "orphan_streaming_state",
  "dispatch_without_stream",
  "streams_without_messages",
]);

const IN_FLIGHT_DISPATCH_STATUSES = new Set(["queued", "claimed", "started"]);

function latestNumber(values: Array<number | undefined>): number | undefined {
  let latest: number | undefined;
  for (const value of values) {
    if (typeof value !== "number") {
      continue;
    }
    if (latest === undefined || value > latest) {
      latest = value;
    }
  }
  return latest;
}

export function deriveCodexIngestHealth(
  state: CodexIngestHealthThreadState | null | undefined,
): CodexIngestHealth {
  if (state === undefined) {
    return {
      status: "unknown",
      issues: [],
      streamCount: 0,
      activeStreamCount: 0,
      finishedStreamCount: 0,
      abortedStreamCount: 0,
      latestStreamCursor: 0,
      recentMessageCount: 0,
      pendingApprovalCount: 0,
      inFlightDispatchCount: 0,
    };
  }
  if (state === null) {
    return {
      status: "missing_thread",
      issues: [],
      streamCount: 0,
      activeStreamCount: 0,
      finishedStreamCount: 0,
      abortedStreamCount: 0,
      latestStreamCursor: 0,
      recentMessageCount: 0,
      pendingApprovalCount: 0,
      inFlightDispatchCount: 0,
    };
  }

  const streamStats = state.streamStats ?? [];
  const messages = state.recentMessages ?? [];
  const pendingApprovals = state.pendingApprovals ?? [];
  const dispatches = state.dispatches ?? [];
  const turns = state.turns ?? [];

  const activeStreamCount = streamStats.filter((stream) => stream.state === "streaming").length;
  const finishedStreamCount = streamStats.filter((stream) => stream.state === "finished").length;
  const abortedStreamCount = streamStats.filter((stream) => stream.state === "aborted").length;
  const latestStreamCursor = streamStats.reduce((latest, stream) => {
    const cursor = typeof stream.latestCursor === "number" ? stream.latestCursor : 0;
    return Math.max(latest, cursor);
  }, 0);

  const hasStreamingMessage = messages.some((message) => message.status === "streaming");
  const inFlightDispatchCount = dispatches.filter(
    (dispatch) => typeof dispatch.status === "string" && IN_FLIGHT_DISPATCH_STATUSES.has(dispatch.status),
  ).length;

  const issues: CodexIngestHealthIssue[] = [];
  if (abortedStreamCount > 0) {
    issues.push("aborted_streams");
  }
  if (activeStreamCount > 0 && !hasStreamingMessage && inFlightDispatchCount === 0) {
    issues.push("orphan_streaming_state");
  }
  if (inFlightDispatchCount > 0 && activeStreamCount === 0 && !hasStreamingMessage) {
    issues.push("dispatch_without_stream");
  }
  if (streamStats.length > 0 && messages.length === 0) {
    issues.push("streams_without_messages");
  }
  if (pendingApprovals.length > 0) {
    issues.push("pending_approvals");
  }

  const status: CodexIngestHealthStatus = issues.some((issue) => DEGRADING_ISSUES.has(issue))
    ? "degraded"
    : "healthy";

  return {
    status,
    issues,
    streamCount: streamStats.length,
    activeStreamCount,
    finishedStreamCount,
    abortedStreamCount,
    latestStreamCursor,
    recentMessageCount: messages.length,
    pendingApprovalCount: pendingApprovals.length,
    inFlightDispatchCount,
    ...(latestNumber(messages.map((message) => message.createdAt)) !== undefined
      ? { lastMessageAt: latestNumber(messages.map((message) => message.createdAt))! }
      : {}),
    ...(latestNumber(turns.map((turn) => turn.startedAt)) !== undefined
      ? { lastTurnStartedAt: latestNumber(turns.map((turn) => turn.startedAt))! }
      : {}),
  };
}
