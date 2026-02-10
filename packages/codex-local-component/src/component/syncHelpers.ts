import {
  approvalRequestForPayload,
  approvalResolutionForPayload,
  durableMessageDeltaForPayload,
  durableMessageForPayload,
  itemSnapshotForPayload,
  terminalStatusForPayload,
  type CanonicalApprovalRequest,
  type CanonicalApprovalResolution,
  type CanonicalDurableMessage,
  type CanonicalDurableMessageDelta,
  type CanonicalItemSnapshot,
  type CanonicalTerminalStatus,
} from "../protocol/events.js";

const TERMINAL_STATUS_PRIORITY = {
  completed: 1,
  interrupted: 2,
  failed: 3,
} as const;

export type TerminalTurnStatus = CanonicalTerminalStatus;
export type ApprovalRequest = CanonicalApprovalRequest;
export type ApprovalResolution = CanonicalApprovalResolution;
export type ItemSnapshot = CanonicalItemSnapshot;
export type DurableMessageFromEvent = CanonicalDurableMessage;
export type DurableMessageDeltaFromEvent = CanonicalDurableMessageDelta;
export type DurableMessageRole = CanonicalDurableMessage["role"];
export type DurableMessageStatus = CanonicalDurableMessage["status"];

export function terminalStatusForEvent(kind: string, payloadJson: string): TerminalTurnStatus | null {
  return terminalStatusForPayload(kind, payloadJson);
}

export function pickHigherPriorityTerminalStatus(
  current: TerminalTurnStatus | undefined,
  next: TerminalTurnStatus,
): TerminalTurnStatus {
  if (!current) {
    return next;
  }
  if (TERMINAL_STATUS_PRIORITY[next.status] > TERMINAL_STATUS_PRIORITY[current.status]) {
    return next;
  }
  return current;
}

export function parseApprovalRequest(kind: string, payloadJson: string): ApprovalRequest | null {
  return approvalRequestForPayload(kind, payloadJson);
}

export function parseApprovalResolution(kind: string, payloadJson: string): ApprovalResolution | null {
  return approvalResolutionForPayload(kind, payloadJson);
}

export function parseItemSnapshot(
  kind: string,
  payloadJson: string,
  cursorEnd: number,
): ItemSnapshot | null {
  return itemSnapshotForPayload(kind, payloadJson, cursorEnd);
}

export function parseDurableMessageEvent(kind: string, payloadJson: string): DurableMessageFromEvent | null {
  return durableMessageForPayload(kind, payloadJson);
}

export function parseDurableMessageDeltaEvent(
  kind: string,
  payloadJson: string,
): DurableMessageDeltaFromEvent | null {
  return durableMessageDeltaForPayload(kind, payloadJson);
}

export function assertContinuousStreamDeltas(
  _streamId: string,
  requestedCursor: number,
  deltas: Array<{ cursorStart: number; cursorEnd: number }>,
): { ok: true } | { ok: false; expected: number; actual: number } {
  let expected = requestedCursor;
  for (const delta of deltas) {
    if (delta.cursorStart !== expected) {
      return { ok: false, expected, actual: delta.cursorStart };
    }
    expected = delta.cursorEnd;
  }
  return { ok: true };
}
