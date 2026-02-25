type UnknownRecord = { [key: string]: unknown };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function readOptionalStringField(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type CanonicalSnapshotItemId = {
  messageId: string;
  generated: boolean;
};

/**
 * Canonicalize message identity across:
 * - thread/read snapshots
 * - local import deltas
 * - hydration/UI projection
 *
 * The upstream runtime may omit `item.id` for historical messages.
 * We generate a stable ID using `(turnId, itemIndex)` in the returned snapshot order.
 */
export function canonicalizeSnapshotItemId(args: {
  turnId: string;
  item: unknown;
  itemIndex: number;
}): CanonicalSnapshotItemId {
  const item = isRecord(args.item) ? args.item : null;
  if (item) {
    const directId = readOptionalStringField(item, "id");
    if (directId) {
      return { messageId: directId, generated: false };
    }
    const messageId = readOptionalStringField(item, "messageId") ?? readOptionalStringField(item, "message_id");
    if (messageId) {
      return { messageId, generated: false };
    }
  }
  return {
    messageId: `generated:${args.turnId}:${Math.max(0, Math.floor(args.itemIndex))}`,
    generated: true,
  };
}

