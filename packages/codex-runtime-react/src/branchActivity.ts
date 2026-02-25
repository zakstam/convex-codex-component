"use client";

import { deriveCodexThreadActivity, type CodexThreadActivity, type CodexThreadActivityThreadState } from "./threadActivity.js";

export type CodexThreadActivityPendingApprovalLike = {
  turnId?: string;
};

export type CodexBranchActivityThreadState = Omit<CodexThreadActivityThreadState, "pendingApprovals"> & {
  pendingApprovals?: unknown[] | null;
};

export type CodexBranchActivityOptions = {
  turnId?: string;
  turnIds?: string[];
  descendantTurnIds?: string[];
  includeDescendants?: boolean;
  fallbackToThread?: boolean;
};

function hasSelection(options?: CodexBranchActivityOptions): boolean {
  return !!(
    options?.turnId ||
    (options?.turnIds && options.turnIds.length > 0) ||
    (options?.descendantTurnIds && options.descendantTurnIds.length > 0)
  );
}

function resolveBranchTurnIds(
  state: CodexBranchActivityThreadState | null | undefined,
  options: CodexBranchActivityOptions,
): Set<string> {
  const selected = new Set<string>();
  for (const turnId of options.turnIds ?? []) {
    if (turnId) {
      selected.add(turnId);
    }
  }
  for (const turnId of options.descendantTurnIds ?? []) {
    if (turnId) {
      selected.add(turnId);
    }
  }
  if (options.turnId) {
    selected.add(options.turnId);
  }

  const includeDescendants = options.includeDescendants ?? true;
  if (!includeDescendants || !options.turnId) {
    return selected;
  }

  const turns = state?.turns ?? [];
  const anchor = turns.find((turn) => turn.turnId === options.turnId);
  if (!anchor || typeof anchor.startedAt !== "number") {
    return selected;
  }

  for (const turn of turns) {
    if (!turn.turnId || typeof turn.startedAt !== "number") {
      continue;
    }
    if (turn.startedAt >= anchor.startedAt) {
      selected.add(turn.turnId);
    }
  }

  return selected;
}

function hasTurnId(approval: unknown): approval is CodexThreadActivityPendingApprovalLike {
  return typeof approval === "object" && approval !== null && "turnId" in approval;
}

export function deriveCodexBranchActivity(
  state: CodexBranchActivityThreadState | null | undefined,
  options?: CodexBranchActivityOptions,
): CodexThreadActivity {
  const nextOptions = options ?? {};
  if (!hasSelection(nextOptions)) {
    return deriveCodexThreadActivity(state);
  }

  const selectedTurnIds = resolveBranchTurnIds(state, nextOptions);
  if (selectedTurnIds.size === 0) {
    return nextOptions.fallbackToThread ? deriveCodexThreadActivity(state) : { phase: "idle" };
  }

  const filteredState: CodexBranchActivityThreadState = {
    pendingApprovals: (state?.pendingApprovals ?? []).filter(
      (approval) =>
        hasTurnId(approval) && typeof approval.turnId === "string" && selectedTurnIds.has(approval.turnId),
    ),
    recentMessages: (state?.recentMessages ?? []).filter(
      (message) => typeof message.turnId === "string" && selectedTurnIds.has(message.turnId),
    ),
    dispatches: (state?.dispatches ?? []).filter(
      (dispatch) => typeof dispatch.turnId === "string" && selectedTurnIds.has(dispatch.turnId),
    ),
    streamStats: state?.streamStats ?? [],
    activeStreams: (state?.activeStreams ?? []).filter(
      (stream) => typeof stream.turnId === "string" && selectedTurnIds.has(stream.turnId),
    ),
    lifecycleMarkers: (state?.lifecycleMarkers ?? []).filter(
      (marker) => typeof marker.turnId === "string" && selectedTurnIds.has(marker.turnId),
    ),
    turns: (state?.turns ?? []).filter(
      (turn) => typeof turn.turnId === "string" && selectedTurnIds.has(turn.turnId),
    ),
  };

  const hasBranchSignals =
    (filteredState.pendingApprovals?.length ?? 0) > 0 ||
    (filteredState.recentMessages?.length ?? 0) > 0 ||
    (filteredState.dispatches?.length ?? 0) > 0 ||
    (filteredState.activeStreams?.length ?? 0) > 0 ||
    (filteredState.lifecycleMarkers?.length ?? 0) > 0 ||
    (filteredState.turns?.length ?? 0) > 0;

  if (!hasBranchSignals && nextOptions.fallbackToThread) {
    return deriveCodexThreadActivity(state);
  }

  return deriveCodexThreadActivity(filteredState);
}
