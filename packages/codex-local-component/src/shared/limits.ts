export const IDLE_INGEST_FLUSH_MS = 5_000;

export const THREAD_STATE_QUERY_LIMITS = {
  turns: 50,
  streams: 200,
  stats: 500,
  approvals: 100,
  recentMessages: 20,
  lifecycle: 50,
} as const;

export const DELETION_QUERY_LIMITS = {
  threadStreamScan: 1_000,
  turnStreamScan: 500,
} as const;

