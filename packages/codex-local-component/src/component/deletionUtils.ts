/**
 * Shared deletion utility functions and constants used by threads.ts,
 * turns.ts, and deletionInternal.ts.
 */

export const DEFAULT_DELETE_GRACE_MS = 10 * 60 * 1000;
export const MIN_DELETE_GRACE_MS = 1_000;
export const MAX_DELETE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function generateUuidV4(): string {
  if (
    "crypto" in globalThis &&
    typeof globalThis.crypto === "object" &&
    globalThis.crypto !== null &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function clampDeleteDelayMs(delayMs: number | undefined): number {
  return Math.max(
    MIN_DELETE_GRACE_MS,
    Math.min(delayMs ?? DEFAULT_DELETE_GRACE_MS, MAX_DELETE_GRACE_MS),
  );
}

export type DeletedCountsByTable = Array<{ tableName: string; deleted: number }>;
export type DeletedCounts = Record<string, number>;

export function parseDeletedCountsToArray(
  deletedCountsJson: string,
): DeletedCountsByTable {
  try {
    const parsed = JSON.parse(deletedCountsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed)
      .filter(([, deleted]) => typeof deleted === "number" && Number.isFinite(deleted))
      .map(([tableName, deleted]) => ({
        tableName,
        deleted: Number(deleted),
      }))
      .sort((left, right) => left.tableName.localeCompare(right.tableName));
  } catch (error) {
    console.warn("[deletionUtils] Failed to parse deletedCountsJson:", error);
    return [];
  }
}

export function parseDeletedCountsToRecord(deletedCountsJson: string): DeletedCounts {
  try {
    const parsed = JSON.parse(deletedCountsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: DeletedCounts = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        result[key] = value;
      }
    }
    return result;
  } catch (error) {
    console.warn("[deletionUtils] Failed to parse deletedCountsJson:", error);
    return {};
  }
}

export function mergeDeletedCounts(current: DeletedCounts, delta: DeletedCounts): DeletedCounts {
  const merged: DeletedCounts = { ...current };
  for (const [tableName, count] of Object.entries(delta)) {
    merged[tableName] = (merged[tableName] ?? 0) + count;
  }
  return merged;
}
