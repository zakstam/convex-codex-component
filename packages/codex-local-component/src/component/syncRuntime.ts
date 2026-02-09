export const DELTA_TTL_MS = 1000 * 60 * 60 * 24;
export const LIFECYCLE_EVENT_KINDS = new Set<string>([
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "error",
  "codex/event/turn_aborted",
]);
export const DELTA_EVENT_KINDS = new Set<string>(["item/agentMessage/delta"]);
export const HEARTBEAT_WRITE_MIN_INTERVAL_MS = 10_000;
export const STALE_SWEEP_MIN_INTERVAL_MS = 60_000;
export const CLEANUP_SWEEP_MIN_INTERVAL_MS = 300_000;
export const DEFAULT_MAX_DELTAS_PER_STREAM_READ = 100;
export const DEFAULT_MAX_DELTAS_PER_REQUEST_READ = 1000;
export const DEFAULT_FINISHED_STREAM_DELETE_DELAY_MS = 300_000;
export const DEFAULT_STREAM_DELETE_BATCH_SIZE = 500;

export type RuntimeOptions = {
  saveStreamDeltas: boolean;
  maxDeltasPerStreamRead: number;
  maxDeltasPerRequestRead: number;
  finishedStreamDeleteDelayMs: number;
};

export type SyncRuntimeInput = {
  saveStreamDeltas?: boolean;
  maxDeltasPerStreamRead?: number;
  maxDeltasPerRequestRead?: number;
  finishedStreamDeleteDelayMs?: number;
};

function clampPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

export function resolveRuntimeOptions(
  options: SyncRuntimeInput | null | undefined,
): RuntimeOptions {
  return {
    saveStreamDeltas: options?.saveStreamDeltas ?? false,
    maxDeltasPerStreamRead: clampPositiveInt(
      options?.maxDeltasPerStreamRead,
      DEFAULT_MAX_DELTAS_PER_STREAM_READ,
    ),
    maxDeltasPerRequestRead: clampPositiveInt(
      options?.maxDeltasPerRequestRead,
      DEFAULT_MAX_DELTAS_PER_REQUEST_READ,
    ),
    finishedStreamDeleteDelayMs: Math.max(
      0,
      Math.floor(
        options?.finishedStreamDeleteDelayMs ??
          DEFAULT_FINISHED_STREAM_DELETE_DELAY_MS,
      ),
    ),
  };
}

export function syncError(code: string, message: string): never {
  throw new Error(`[${code}] ${message}`);
}
