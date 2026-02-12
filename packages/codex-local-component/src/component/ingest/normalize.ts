import {
  parseApprovalRequest,
  parseApprovalResolution,
  parseDurableMessageDeltaEvent,
  parseDurableMessageEvent,
  parseReasoningDeltaEvent,
  parseTurnIdForEvent,
  syncError,
  terminalStatusForEvent,
} from "../syncHelpers.js";
import type { InboundEvent, NormalizedInboundEvent } from "./types.js";

function syntheticTurnStatusForEvent(
  kind: string,
  terminalStatus: ReturnType<typeof terminalStatusForEvent>,
): "queued" | "inProgress" | "completed" | "interrupted" | "failed" {
  if (terminalStatus?.status === "completed") {
    return "completed";
  }
  if (terminalStatus?.status === "interrupted") {
    return "interrupted";
  }
  if (terminalStatus?.status === "failed") {
    return "failed";
  }
  if (kind === "turn/started" || kind.startsWith("item/")) {
    return "inProgress";
  }
  return "queued";
}

export function normalizeInboundEvents(args: {
  streamDeltas: InboundEvent[];
}): NormalizedInboundEvent[] {
  const sorted = [...args.streamDeltas].sort((a, b) => a.createdAt - b.createdAt);

  return sorted.map((event) => {
    const payloadTurnId = parseTurnIdForEvent(event.kind, event.payloadJson);
    const requiresCanonicalTurnFromPayload =
      event.type === "stream_delta" &&
      (event.kind === "turn/started" || event.kind === "turn/completed");
    if (requiresCanonicalTurnFromPayload && !payloadTurnId) {
      syncError(
        "E_SYNC_TURN_ID_REQUIRED_FOR_TURN_EVENT",
        `Missing canonical payload turn id for turn lifecycle event kind=${event.kind}`,
      );
    }
    if (event.kind.startsWith("codex/event/") && !payloadTurnId) {
      syncError(
        "E_SYNC_TURN_ID_REQUIRED_FOR_CODEX_EVENT",
        `Missing canonical payload turn id for legacy codex event kind=${event.kind}`,
      );
    }

    if (event.type === "stream_delta") {
      const resolvedTurnId = payloadTurnId ?? event.turnId;
      const terminalTurnStatus = terminalStatusForEvent(event.kind, event.payloadJson);
      return {
        ...event,
        turnId: resolvedTurnId,
        syntheticTurnStatus: syntheticTurnStatusForEvent(event.kind, terminalTurnStatus),
        terminalTurnStatus,
        approvalRequest: parseApprovalRequest(event.kind, event.payloadJson),
        approvalResolution: parseApprovalResolution(event.kind, event.payloadJson),
        durableMessage: parseDurableMessageEvent(event.kind, event.payloadJson),
        durableDelta: parseDurableMessageDeltaEvent(event.kind, event.payloadJson),
        reasoningDelta: parseReasoningDeltaEvent(event.kind, event.payloadJson),
      };
    }

    const resolvedTurnId = payloadTurnId ?? undefined;
    const terminalTurnStatus = resolvedTurnId
      ? terminalStatusForEvent(event.kind, event.payloadJson)
      : null;
    const { turnId: _incomingTurnId, ...lifecycleEventWithoutTurnId } = event;
    return {
      ...lifecycleEventWithoutTurnId,
      ...(resolvedTurnId ? { turnId: resolvedTurnId } : {}),
      syntheticTurnStatus: syntheticTurnStatusForEvent(event.kind, terminalTurnStatus),
      terminalTurnStatus,
      approvalRequest: resolvedTurnId ? parseApprovalRequest(event.kind, event.payloadJson) : null,
      approvalResolution: resolvedTurnId ? parseApprovalResolution(event.kind, event.payloadJson) : null,
      durableMessage: resolvedTurnId ? parseDurableMessageEvent(event.kind, event.payloadJson) : null,
      durableDelta: resolvedTurnId ? parseDurableMessageDeltaEvent(event.kind, event.payloadJson) : null,
      reasoningDelta: resolvedTurnId ? parseReasoningDeltaEvent(event.kind, event.payloadJson) : null,
    };
  });
}
