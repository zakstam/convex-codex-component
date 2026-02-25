"use client";

const STREAM_DRAIN_COMPLETE_KIND = "stream/drain_complete";

export const ACTIVITY_STATE_AUTHORITY_VERSION = 1 as const;

export type CodexThreadActivityPhase =
  | "idle"
  | "streaming"
  | "awaiting_approval"
  | "failed"
  | "interrupted";

export type CodexThreadActivity = {
  phase: CodexThreadActivityPhase;
  activeTurnId?: string;
  activeMessageId?: string;
};

export type CodexThreadActivityMessageLike = {
  messageId?: string;
  turnId?: string;
  status?: "streaming" | "completed" | "failed" | "interrupted" | string;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
};

export type CodexThreadActivityDispatchLike = {
  turnId?: string;
  status?: "queued" | "claimed" | "started" | "completed" | "failed" | "interrupted" | string;
  updatedAt?: number;
  createdAt?: number;
};

export type CodexThreadActivityStreamStatLike = {
  state?: "streaming" | "finished" | "aborted" | string;
};

export type CodexThreadActivityTurnLike = {
  turnId?: string;
  status?: string;
  startedAt?: number;
  completedAt?: number;
};

export type CodexThreadActivityActiveStreamLike = {
  streamId?: string;
  turnId?: string;
  state?: string;
  startedAt?: number;
};

export type CodexThreadActivityLifecycleMarkerLike = {
  kind?: string;
  turnId?: string;
  streamId?: string;
  createdAt?: number;
};

export type CodexThreadActivityThreadState = {
  pendingApprovals?: unknown[] | null;
  recentMessages?: CodexThreadActivityMessageLike[] | null;
  dispatches?: CodexThreadActivityDispatchLike[] | null;
  streamStats?: CodexThreadActivityStreamStatLike[] | null;
  activeStreams?: CodexThreadActivityActiveStreamLike[] | null;
  turns?: CodexThreadActivityTurnLike[] | null;
  lifecycleMarkers?: CodexThreadActivityLifecycleMarkerLike[] | null;
};

type Candidate = {
  timestamp: number;
  activeTurnId?: string;
  activeMessageId?: string;
  phase?: Extract<CodexThreadActivityPhase, "failed" | "interrupted">;
};

const IN_FLIGHT_DISPATCH_STATUSES = new Set(["queued", "claimed", "started"]);
const IN_FLIGHT_TURN_STATUSES = new Set(["queued", "inProgress", "started", "streaming"]);
const COMPLETED_TURN_STATUSES = new Set(["completed"]);
const FAILED_TURN_STATUSES = new Set(["failed"]);
const INTERRUPTED_TURN_STATUSES = new Set(["interrupted"]);

function candidateTimestamp(input?: number): number {
  return typeof input === "number" ? input : 0;
}

function pickLatest(candidates: Array<Candidate | null>): Candidate | null {
  let latest: Candidate | null = null;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (!latest || candidate.timestamp > latest.timestamp) {
      latest = candidate;
    }
  }
  return latest;
}

function latestMessageByStatus(
  messages: CodexThreadActivityMessageLike[],
  status: CodexThreadActivityMessageLike["status"],
  resolveTimestamp: (message: CodexThreadActivityMessageLike) => number = (message) =>
    candidateTimestamp(message.createdAt),
): Candidate | null {
  let latest: Candidate | null = null;
  for (const message of messages) {
    if (message.status !== status) {
      continue;
    }
    const candidate: Candidate = {
      timestamp: resolveTimestamp(message),
      ...(message.turnId !== undefined ? { activeTurnId: message.turnId } : {}),
      ...(message.messageId !== undefined ? { activeMessageId: message.messageId } : {}),
    };
    if (!latest || candidate.timestamp > latest.timestamp) {
      latest = candidate;
    }
  }
  return latest;
}

function latestDispatchByStatus(
  dispatches: CodexThreadActivityDispatchLike[],
  predicate: (status: string) => boolean,
): Candidate | null {
  let latest: Candidate | null = null;
  for (const dispatch of dispatches) {
    if (typeof dispatch.status !== "string" || !predicate(dispatch.status)) {
      continue;
    }
    const candidate: Candidate = {
      timestamp: candidateTimestamp(dispatch.updatedAt ?? dispatch.createdAt),
      ...(dispatch.turnId !== undefined ? { activeTurnId: dispatch.turnId } : {}),
    };
    if (!latest || candidate.timestamp > latest.timestamp) {
      latest = candidate;
    }
  }
  return latest;
}

function latestTurnByStatus(
  turns: CodexThreadActivityTurnLike[],
  predicate: (status: string) => boolean,
  resolveTimestamp: (turn: CodexThreadActivityTurnLike) => number = (turn) =>
    candidateTimestamp(turn.startedAt),
): Candidate | null {
  let latest: Candidate | null = null;
  for (const turn of turns) {
    if (typeof turn.status !== "string" || !predicate(turn.status)) {
      continue;
    }
    const candidate: Candidate = {
      timestamp: resolveTimestamp(turn),
      ...(turn.turnId !== undefined ? { activeTurnId: turn.turnId } : {}),
    };
    if (!latest || candidate.timestamp > latest.timestamp) {
      latest = candidate;
    }
  }
  return latest;
}

function latestActiveStream(
  activeStreams: CodexThreadActivityActiveStreamLike[],
): Candidate | null {
  let latest: Candidate | null = null;
  for (const activeStream of activeStreams) {
    const candidate: Candidate = {
      timestamp: candidateTimestamp(activeStream.startedAt),
      ...(activeStream.turnId !== undefined ? { activeTurnId: activeStream.turnId } : {}),
    };
    if (!latest || candidate.timestamp > latest.timestamp) {
      latest = candidate;
    }
  }
  return latest;
}

function latestLifecycleMarker(
  markers: CodexThreadActivityLifecycleMarkerLike[],
  kind: string,
): Candidate | null {
  let latest: Candidate | null = null;
  for (const marker of markers) {
    if (marker.kind !== kind) {
      continue;
    }
    const candidate: Candidate = {
      timestamp: candidateTimestamp(marker.createdAt),
      ...(marker.turnId !== undefined ? { activeTurnId: marker.turnId } : {}),
    };
    if (!latest || candidate.timestamp > latest.timestamp) {
      latest = candidate;
    }
  }
  return latest;
}

function latestInFlightFromDispatchOrTurn(input: {
  dispatches: CodexThreadActivityDispatchLike[];
  turns: CodexThreadActivityTurnLike[];
}): Candidate | null {
  return pickLatest([
    latestDispatchByStatus(input.dispatches, (status) => IN_FLIGHT_DISPATCH_STATUSES.has(status)),
    latestTurnByStatus(input.turns, (status) => IN_FLIGHT_TURN_STATUSES.has(status)),
  ]);
}

export function deriveCodexActivityByAuthorityRules(
  state: CodexThreadActivityThreadState | null | undefined,
): CodexThreadActivity {
  const messages = state?.recentMessages ?? [];
  const dispatches = state?.dispatches ?? [];
  const turns = state?.turns ?? [];
  const pendingApprovals = state?.pendingApprovals ?? [];
  const streamStats = state?.streamStats ?? [];
  const activeStreams = state?.activeStreams ?? [];
  const lifecycleMarkers = state?.lifecycleMarkers ?? [];

  const streamingMessage = latestMessageByStatus(messages, "streaming");
  const activeStream = latestActiveStream(activeStreams);
  const inFlightDispatchOrTurn = latestInFlightFromDispatchOrTurn({ dispatches, turns });
  const streamDrainCompleted = latestLifecycleMarker(lifecycleMarkers, STREAM_DRAIN_COMPLETE_KIND);

  const terminalMessageTimestamp = (message: CodexThreadActivityMessageLike): number =>
    candidateTimestamp(message.completedAt ?? message.updatedAt ?? message.createdAt);
  const terminalTurnTimestamp = (turn: CodexThreadActivityTurnLike): number =>
    candidateTimestamp(turn.completedAt ?? turn.startedAt);

  const failed = pickLatest([
    latestMessageByStatus(messages, "failed", terminalMessageTimestamp),
    latestDispatchByStatus(dispatches, (status) => status === "failed"),
    latestTurnByStatus(turns, (status) => FAILED_TURN_STATUSES.has(status), terminalTurnTimestamp),
  ]);
  const interrupted = pickLatest([
    latestMessageByStatus(messages, "interrupted", terminalMessageTimestamp),
    latestTurnByStatus(turns, (status) => INTERRUPTED_TURN_STATUSES.has(status), terminalTurnTimestamp),
  ]);
  const terminalPhase = pickLatest([
    failed ? { ...failed, phase: "failed" as const } : null,
    interrupted ? { ...interrupted, phase: "interrupted" as const } : null,
  ]);

  const latestTerminalBoundary = pickLatest([
    latestMessageByStatus(messages, "completed", terminalMessageTimestamp),
    latestTurnByStatus(turns, (status) => COMPLETED_TURN_STATUSES.has(status), terminalTurnTimestamp),
    failed,
    interrupted,
    latestDispatchByStatus(dispatches, (status) => status === "failed" || status === "interrupted"),
    latestTurnByStatus(
      turns,
      (status) => FAILED_TURN_STATUSES.has(status) || INTERRUPTED_TURN_STATUSES.has(status),
      terminalTurnTimestamp,
    ),
    streamDrainCompleted,
  ]);
  const latestTerminalBoundaryTs = latestTerminalBoundary?.timestamp ?? 0;

  if (pendingApprovals.length > 0) {
    const active = pickLatest([streamingMessage, activeStream, inFlightDispatchOrTurn]);
    return {
      phase: "awaiting_approval",
      ...(active?.activeTurnId !== undefined ? { activeTurnId: active.activeTurnId } : {}),
      ...(active?.activeMessageId !== undefined ? { activeMessageId: active.activeMessageId } : {}),
    };
  }

  if (streamingMessage && streamingMessage.timestamp > latestTerminalBoundaryTs) {
    return {
      phase: "streaming",
      ...(streamingMessage.activeTurnId !== undefined ? { activeTurnId: streamingMessage.activeTurnId } : {}),
      ...(streamingMessage.activeMessageId !== undefined
        ? { activeMessageId: streamingMessage.activeMessageId }
        : {}),
    };
  }

  const hasActiveStreams = activeStreams.length > 0;
  const hasStreamingStat = streamStats.some((stat) => stat.state === "streaming");
  const canStreamFromStats = hasActiveStreams && hasStreamingStat;
  const activeStreamTimestamp = activeStream?.timestamp ?? 0;
  if ((hasActiveStreams || canStreamFromStats) && activeStreamTimestamp > (streamDrainCompleted?.timestamp ?? -1)) {
    return {
      phase: "streaming",
      ...(activeStream?.activeTurnId !== undefined ? { activeTurnId: activeStream.activeTurnId } : {}),
    };
  }

  if (inFlightDispatchOrTurn && inFlightDispatchOrTurn.timestamp > latestTerminalBoundaryTs) {
    return {
      phase: "streaming",
      ...(inFlightDispatchOrTurn.activeTurnId !== undefined
        ? { activeTurnId: inFlightDispatchOrTurn.activeTurnId }
        : {}),
    };
  }

  if (terminalPhase?.phase) {
    return {
      phase: terminalPhase.phase,
      ...(terminalPhase.activeTurnId !== undefined ? { activeTurnId: terminalPhase.activeTurnId } : {}),
      ...(terminalPhase.activeMessageId !== undefined ? { activeMessageId: terminalPhase.activeMessageId } : {}),
    };
  }

  return { phase: "idle" };
}
