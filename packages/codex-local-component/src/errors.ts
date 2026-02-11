export const RECOVERABLE_INGEST_ERROR_CODES = new Set([
  "E_SYNC_SESSION_NOT_FOUND",
  "E_SYNC_SESSION_THREAD_MISMATCH",
  "SESSION_NOT_FOUND",
  "SESSION_THREAD_MISMATCH",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseErrorCode(error: unknown): string | null {
  const match = /^\[([A-Z0-9_]+)\]/.exec(errorMessage(error));
  return match?.[1] ?? null;
}

export function isThreadMissing(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes("Thread not found") ||
    parseErrorCode(error) === "E_SYNC_SESSION_NOT_FOUND"
  );
}

export function isThreadForbidden(error: unknown): boolean {
  return parseErrorCode(error) === "E_AUTH_THREAD_FORBIDDEN";
}

export function isSessionForbidden(error: unknown): boolean {
  return parseErrorCode(error) === "E_AUTH_SESSION_FORBIDDEN";
}

export function isRecoverableIngestError(
  error:
    | unknown
    | { recoverable?: boolean; code?: string | null }
    | { recoverable?: boolean; code?: string | null }[],
): boolean {
  if (Array.isArray(error)) {
    return error.some((entry) => isRecoverableIngestError(entry));
  }
  if (typeof error === "object" && error !== null) {
    const recoverable = Reflect.get(error, "recoverable");
    if (recoverable === true) {
      return true;
    }
    const code = Reflect.get(error, "code");
    if (typeof code === "string") {
      return RECOVERABLE_INGEST_ERROR_CODES.has(code);
    }
  }
  const code = parseErrorCode(error);
  return code !== null && RECOVERABLE_INGEST_ERROR_CODES.has(code);
}
