"use client";

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
};

export type CodexThreadActivityDispatchLike = {
  turnId?: string;
  status?: "queued" | "claimed" | "started" | "completed" | "failed" | "cancelled" | string;
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
};

export type CodexThreadActivityThreadState = {
  pendingApprovals?: unknown[] | null;
  recentMessages?: CodexThreadActivityMessageLike[] | null;
  dispatches?: CodexThreadActivityDispatchLike[] | null;
  streamStats?: CodexThreadActivityStreamStatLike[] | null;
  turns?: CodexThreadActivityTurnLike[] | null;
};

type Candidate = {
  timestamp: number;
  activeTurnId?: string;
  activeMessageId?: string;
  phase?: Extract<CodexThreadActivityPhase, "failed" | "interrupted">;
};

const IN_FLIGHT_DISPATCH_STATUSES = new Set(["queued", "claimed", "started"]);
const IN_FLIGHT_TURN_STATUSES = new Set(["queued", "inProgress", "started", "streaming"]);
const FAILED_TURN_STATUSES = new Set(["failed"]);
const INTERRUPTED_TURN_STATUSES = new Set(["interrupted", "cancelled"]);

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
): Candidate | null {
  let latest: Candidate | null = null;
  for (const message of messages) {
    if (message.status !== status) {
      continue;
    }
    const candidate: Candidate = {
      timestamp: candidateTimestamp(message.createdAt),
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
): Candidate | null {
  let latest: Candidate | null = null;
  for (const turn of turns) {
    if (typeof turn.status !== "string" || !predicate(turn.status)) {
      continue;
    }
    const candidate: Candidate = {
      timestamp: candidateTimestamp(turn.startedAt),
      ...(turn.turnId !== undefined ? { activeTurnId: turn.turnId } : {}),
    };
    if (!latest || candidate.timestamp > latest.timestamp) {
      latest = candidate;
    }
  }
  return latest;
}

function activeFromInFlightState(input: {
  messages: CodexThreadActivityMessageLike[];
  dispatches: CodexThreadActivityDispatchLike[];
  turns: CodexThreadActivityTurnLike[];
}): Candidate | null {
  return pickLatest([
    latestMessageByStatus(input.messages, "streaming"),
    latestDispatchByStatus(input.dispatches, (status) => IN_FLIGHT_DISPATCH_STATUSES.has(status)),
    latestTurnByStatus(input.turns, (status) => IN_FLIGHT_TURN_STATUSES.has(status)),
  ]);
}

export function deriveCodexThreadActivity(
  state: CodexThreadActivityThreadState | null | undefined,
): CodexThreadActivity {
  const messages = state?.recentMessages ?? [];
  const dispatches = state?.dispatches ?? [];
  const turns = state?.turns ?? [];
  const pendingApprovals = state?.pendingApprovals ?? [];
  const streamStats = state?.streamStats ?? [];

  if (pendingApprovals.length > 0) {
    const active = activeFromInFlightState({ messages, dispatches, turns });
    return {
      phase: "awaiting_approval",
      ...(active?.activeTurnId !== undefined ? { activeTurnId: active.activeTurnId } : {}),
      ...(active?.activeMessageId !== undefined ? { activeMessageId: active.activeMessageId } : {}),
    };
  }

  const activeStreamingMessage = latestMessageByStatus(messages, "streaming");
  if (activeStreamingMessage) {
    return {
      phase: "streaming",
      ...(activeStreamingMessage.activeTurnId !== undefined
        ? { activeTurnId: activeStreamingMessage.activeTurnId }
        : {}),
      ...(activeStreamingMessage.activeMessageId !== undefined
        ? { activeMessageId: activeStreamingMessage.activeMessageId }
        : {}),
    };
  }

  const hasStreamingStat = streamStats.some((stat) => stat.state === "streaming");
  if (hasStreamingStat) {
    const inFlight = activeFromInFlightState({ messages, dispatches, turns });
    return {
      phase: "streaming",
      ...(inFlight?.activeTurnId !== undefined ? { activeTurnId: inFlight.activeTurnId } : {}),
      ...(inFlight?.activeMessageId !== undefined ? { activeMessageId: inFlight.activeMessageId } : {}),
    };
  }

  const inFlightDispatch = latestDispatchByStatus(dispatches, (status) =>
    IN_FLIGHT_DISPATCH_STATUSES.has(status),
  );
  if (inFlightDispatch) {
    return {
      phase: "streaming",
      ...(inFlightDispatch.activeTurnId !== undefined ? { activeTurnId: inFlightDispatch.activeTurnId } : {}),
    };
  }

  const inFlightTurn = latestTurnByStatus(turns, (status) => IN_FLIGHT_TURN_STATUSES.has(status));
  if (inFlightTurn) {
    return {
      phase: "streaming",
      ...(inFlightTurn.activeTurnId !== undefined ? { activeTurnId: inFlightTurn.activeTurnId } : {}),
    };
  }

  const failed = pickLatest([
    latestMessageByStatus(messages, "failed"),
    latestDispatchByStatus(dispatches, (status) => status === "failed"),
    latestTurnByStatus(turns, (status) => FAILED_TURN_STATUSES.has(status)),
  ]);
  const interrupted = pickLatest([
    latestMessageByStatus(messages, "interrupted"),
    latestTurnByStatus(turns, (status) => INTERRUPTED_TURN_STATUSES.has(status)),
  ]);
  const terminal = pickLatest([
    failed ? { ...failed, phase: "failed" as const } : null,
    interrupted ? { ...interrupted, phase: "interrupted" as const } : null,
  ]);

  if (terminal?.phase) {
    return {
      phase: terminal.phase,
      ...(terminal.activeTurnId !== undefined ? { activeTurnId: terminal.activeTurnId } : {}),
      ...(terminal.activeMessageId !== undefined ? { activeMessageId: terminal.activeMessageId } : {}),
    };
  }

  return { phase: "idle" };
}
