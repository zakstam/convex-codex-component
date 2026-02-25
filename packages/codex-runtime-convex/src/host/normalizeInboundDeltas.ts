type NormalizableDelta = {
  type?: unknown;
  eventId?: unknown;
  turnId?: unknown;
  streamId?: unknown;
  kind?: unknown;
  payloadJson?: unknown;
  cursorStart?: unknown;
  cursorEnd?: unknown;
  createdAt?: unknown;
};

export type NormalizedInboundStreamDelta = {
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

export type NormalizedInboundLifecycleEvent = {
  type: "lifecycle_event";
  eventId: string;
  turnId?: string;
  kind: string;
  payloadJson: string;
  createdAt: number;
};

export type NormalizedInboundDelta =
  | NormalizedInboundStreamDelta
  | NormalizedInboundLifecycleEvent;

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function normalizeInboundDeltas(
  deltas: ReadonlyArray<NormalizableDelta>,
): NormalizedInboundDelta[] {
  return deltas.map((delta, index) => {
    if (delta.type === "stream_delta") {
      const eventId = asString(delta.eventId);
      const turnId = asString(delta.turnId);
      const streamId = asString(delta.streamId);
      const kind = asString(delta.kind);
      const payloadJson = asString(delta.payloadJson);
      if (
        !eventId ||
        !turnId ||
        !streamId ||
        !kind ||
        payloadJson === null ||
        !isNumber(delta.cursorStart) ||
        !isNumber(delta.cursorEnd) ||
        !isNumber(delta.createdAt)
      ) {
        throw new Error(`normalizeInboundDeltas: invalid stream_delta at index ${String(index)}`);
      }
      return {
        type: "stream_delta",
        eventId,
        turnId,
        streamId,
        kind,
        payloadJson,
        cursorStart: delta.cursorStart,
        cursorEnd: delta.cursorEnd,
        createdAt: delta.createdAt,
      };
    }

    if (delta.type === "lifecycle_event") {
      const eventId = asString(delta.eventId);
      const kind = asString(delta.kind);
      const payloadJson = asString(delta.payloadJson);
      const turnId = asString(delta.turnId);
      if (
        !eventId ||
        !kind ||
        payloadJson === null ||
        !isNumber(delta.createdAt)
      ) {
        throw new Error(`normalizeInboundDeltas: invalid lifecycle_event at index ${String(index)}`);
      }
      return {
        type: "lifecycle_event",
        eventId,
        ...(turnId !== null ? { turnId } : {}),
        kind,
        payloadJson,
        createdAt: delta.createdAt,
      };
    }

    throw new Error(`normalizeInboundDeltas: unknown event type at index ${String(index)}`);
  });
}
