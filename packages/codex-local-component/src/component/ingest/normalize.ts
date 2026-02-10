import {
  parseApprovalRequest,
  parseApprovalResolution,
  parseDurableMessageDeltaEvent,
  parseDurableMessageEvent,
  parseReasoningDeltaEvent,
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
    const terminalTurnStatus = event.turnId
      ? terminalStatusForEvent(event.kind, event.payloadJson)
      : null;

    return {
      ...event,
      syntheticTurnStatus: syntheticTurnStatusForEvent(event.kind, terminalTurnStatus),
      terminalTurnStatus,
      approvalRequest: event.turnId ? parseApprovalRequest(event.kind, event.payloadJson) : null,
      approvalResolution: event.turnId ? parseApprovalResolution(event.kind, event.payloadJson) : null,
      durableMessage: event.turnId ? parseDurableMessageEvent(event.kind, event.payloadJson) : null,
      durableDelta: event.turnId ? parseDurableMessageDeltaEvent(event.kind, event.payloadJson) : null,
      reasoningDelta: event.turnId ? parseReasoningDeltaEvent(event.kind, event.payloadJson) : null,
    };
  });
}
