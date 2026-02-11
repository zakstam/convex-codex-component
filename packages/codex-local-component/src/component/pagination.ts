import type { PaginationOptions, PaginationResult } from "convex/server";

export class KeysetCursorDecodeError extends Error {
  readonly cursor: string;

  constructor(cursor: string, cause: string) {
    super(`[E_KEYSET_CURSOR_INVALID] Invalid keyset cursor: ${cause}`);
    this.name = "KeysetCursorDecodeError";
    this.cursor = cursor;
  }
}

function parseJsonCursor<T>(cursor: string | null): T | null {
  if (!cursor) {
    return null;
  }
  try {
    return JSON.parse(cursor) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new KeysetCursorDecodeError(cursor, reason);
  }
}

export function decodeKeysetCursor<T>(cursor: string | null): T | null {
  return parseJsonCursor<T>(cursor);
}

export function encodeKeysetCursor<T>(value: T): string {
  return JSON.stringify(value);
}

export function keysetPageResult<T, Cursor>(
  items: T[],
  paginationOpts: PaginationOptions,
  getCursor: (item: T) => Cursor,
): PaginationResult<T> {
  const page = items.slice(0, paginationOpts.numItems);
  const hasMore = items.length > paginationOpts.numItems;

  const continueCursor =
    page.length > 0
      ? encodeKeysetCursor(getCursor(page[page.length - 1]!))
      : (paginationOpts.cursor ?? "");

  return {
    page,
    isDone: !hasMore,
    continueCursor,
  };
}
