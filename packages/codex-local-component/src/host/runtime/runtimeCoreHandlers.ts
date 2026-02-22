/**
 * Bridge event handlers, ingest pipeline, and server-request retry logic.
 * Extracted from runtimeCore.ts for file-size compliance.
 * All functions receive the core context object to access shared state.
 */
import {
  buildTurnInterruptRequest,
  isUuidLikeThreadId,
} from "../../app-server/client.js";
import type { CodexResponse, NormalizedEvent, ServerInboundMessage, RpcId } from "../../protocol/generated.js";
import { normalizeInboundDeltas } from "../normalizeInboundDeltas.js";
import { isTurnNotFound } from "../../errors.js";
import {
  asObject,
  isChatgptAuthTokensRefreshRequest,
  isResponse,
  isTurnScopedEvent,
  MAX_BATCH_SIZE,
  parseManagedServerRequestFromEvent,
  parseTurnCompletedStatus,
  PENDING_SERVER_REQUEST_MAX_RETRIES,
  PENDING_SERVER_REQUEST_RETRY_DELAY_MS,
  PENDING_SERVER_REQUEST_RETRY_TTL_MS,
  rewritePayloadTurnId,
  shouldDropRejectedIngestBatch,
  toRequestKey,
} from "./runtimeHelpers.js";
import { IDLE_INGEST_FLUSH_MS } from "../../shared/limits.js";
import type {
  ActorContext,
  ClientMessage,
  HostRuntimeErrorCode,
  HostRuntimePersistence,
  HostRuntimeHandlers,
  IngestDelta,
  PendingAuthTokensRefreshRequest,
  PendingServerRequest,
  PendingServerRequestRetryEntry,
} from "./runtimeTypes.js";

// ── Context type: the subset of RuntimeCore state needed by handlers ─

export type HandlerCtx = {
  // State reads
  readonly actor: ActorContext | null;
  readonly sessionId: string | null;
  readonly threadId: string | null;
  runtimeConversationId: string | null;
  readonly turnId: string | null;
  runtimeTurnId: string | null;
  turnInFlight: boolean;
  turnSettled: boolean;
  interruptRequested: boolean;
  readonly activeDispatch: { dispatchId: string; claimToken: string; turnId: string; text: string } | null;
  setActiveDispatch: (v: null) => void;
  setTurnId: (v: string | null) => void;

  // Ingest queue
  ingestQueue: IngestDelta[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  setFlushTimer: (v: ReturnType<typeof setTimeout> | null) => void;
  flushTail: Promise<void>;
  setFlushTail: (v: Promise<void>) => void;
  readonly ingestFlushMs: number;
  enqueuedEventCount: number;
  skippedEventCount: number;
  incrementEnqueuedKind: (kind: string) => void;
  incrementSkippedKind: (kind: string) => void;

  // Server request retry
  pendingServerRequestRetries: Map<string, PendingServerRequestRetryEntry>;
  pendingServerRequestRetryTimer: ReturnType<typeof setTimeout> | null;
  setPendingServerRequestRetryTimer: (v: ReturnType<typeof setTimeout> | null) => void;

  // Dispatch maps
  dispatchByTurnId: Map<string, { dispatchId: string; claimToken: string; persistedTurnId: string }>;
  pendingRequests: Map<number, { method: string; dispatchId?: string; claimToken?: string; turnId?: string; resolve?: (message: CodexResponse) => void; reject?: (error: Error) => void }>;

  // Delegates
  persistence: HostRuntimePersistence;
  handlers: HostRuntimeHandlers | undefined;
  emitState: (error?: { code: HostRuntimeErrorCode; message: string } | null) => void;
  runtimeError: (code: HostRuntimeErrorCode, message: string) => Error;
  requestIdFn: () => number;
  sendMessage: (message: ClientMessage, trackedMethod?: string) => void;
  clearFlushTimer: () => void;
  ensureThreadBinding: (preferred?: string) => Promise<void>;
  processDispatchQueue: () => Promise<void>;
  failAcceptedTurnSend: (args: {
    actor: ActorContext;
    threadId: string;
    dispatchId: string;
    turnId: string;
    code?: string;
    reason: string;
  }) => Promise<void>;
  registerPendingServerRequest: (request: PendingServerRequest) => Promise<void>;
  resolvePendingServerRequest: (a: { requestId: RpcId; status: "answered" | "expired"; responseJson?: string }) => Promise<void>;
  expireTurnServerRequests: (turn: { threadId: string; turnId?: string | null }) => Promise<void>;
  setRuntimeThreadFromResponse: (message: CodexResponse, method: string) => void;
  registerPendingAuthTokensRefreshRequest: (r: PendingAuthTokensRefreshRequest) => void;
  resolvePersistedTurnId: (rtid?: string) => string | null;
};

// ── Server request retry ────────────────────────────────────────────

export function clearPendingServerRequestRetryTimer(ctx: HandlerCtx): void {
  if (ctx.pendingServerRequestRetryTimer) { clearTimeout(ctx.pendingServerRequestRetryTimer); ctx.setPendingServerRequestRetryTimer(null); }
}

function schedulePendingServerRequestRetry(ctx: HandlerCtx): void {
  if (ctx.pendingServerRequestRetries.size === 0 || ctx.pendingServerRequestRetryTimer) return;
  ctx.setPendingServerRequestRetryTimer(setTimeout(() => {
    ctx.setPendingServerRequestRetryTimer(null);
    void flushPendingServerRequestRetries(ctx);
  }, PENDING_SERVER_REQUEST_RETRY_DELAY_MS));
}

export function enqueuePendingServerRequestRetry(ctx: HandlerCtx, request: PendingServerRequest, error: unknown): void {
  const key = toRequestKey(request.requestId);
  const existing = ctx.pendingServerRequestRetries.get(key);
  const reason = error instanceof Error ? error.message : String(error);
  ctx.pendingServerRequestRetries.set(key, existing
    ? { request, attempts: existing.attempts + 1, firstQueuedAt: existing.firstQueuedAt, lastError: reason }
    : { request, attempts: 1, firstQueuedAt: Date.now(), lastError: reason });
  schedulePendingServerRequestRetry(ctx);
}

export async function flushPendingServerRequestRetries(ctx: HandlerCtx): Promise<void> {
  if (!ctx.actor || ctx.pendingServerRequestRetries.size === 0) return;
  const now = Date.now();
  for (const [key, entry] of ctx.pendingServerRequestRetries.entries()) {
    if (entry.attempts >= PENDING_SERVER_REQUEST_MAX_RETRIES || now - entry.firstQueuedAt >= PENDING_SERVER_REQUEST_RETRY_TTL_MS) {
      ctx.pendingServerRequestRetries.delete(key);
      ctx.handlers?.onProtocolError?.({ message: `Dropped pending server request after retry budget exhausted: requestId=${String(entry.request.requestId)} turnId=${entry.request.turnId} reason=${entry.lastError}`, line: entry.request.payloadJson });
      continue;
    }
    try {
      await ctx.persistence.upsertPendingServerRequest({ actor: ctx.actor, request: entry.request });
      ctx.pendingServerRequestRetries.delete(key);
    } catch (error) {
      if (isTurnNotFound(error)) {
        ctx.pendingServerRequestRetries.set(key, { ...entry, attempts: entry.attempts + 1, lastError: error instanceof Error ? error.message : String(error) });
        continue;
      }
      ctx.pendingServerRequestRetries.delete(key);
      ctx.handlers?.onProtocolError?.({ message: `Failed to persist pending server request: ${error instanceof Error ? error.message : String(error)}`, line: entry.request.payloadJson });
    }
  }
  if (ctx.pendingServerRequestRetries.size > 0) schedulePendingServerRequestRetry(ctx);
}

// ── Ingest ──────────────────────────────────────────────────────────

export async function flushQueue(ctx: HandlerCtx): Promise<void> {
  if (!ctx.actor || !ctx.sessionId || !ctx.threadId) return;
  const aa = ctx.actor, as_ = ctx.sessionId, at = ctx.threadId;
  const next = ctx.flushTail.then(async () => {
    ctx.clearFlushTimer();
    while (ctx.ingestQueue.length > 0) {
      const batch = ctx.ingestQueue.splice(0, MAX_BATCH_SIZE);
      const norm = normalizeInboundDeltas(batch).map((d, i) => ({ ...d, threadId: batch[i]?.threadId ?? at }));
      const result = await ctx.persistence.ingestSafe({ actor: aa, sessionId: as_, threadId: at, deltas: norm });
      if (result.status === "rejected") { if (shouldDropRejectedIngestBatch(result.errors)) continue; throw new Error(`ingestSafe rejected: ${result.errors.map((e) => e.code).join(",")}`); }
    }
    await flushPendingServerRequestRetries(ctx);
  });
  ctx.setFlushTail(next.catch((error) => { const reason = error instanceof Error ? error.message : String(error); const coded = ctx.runtimeError("E_RUNTIME_INGEST_FLUSH_FAILED", `Failed to flush ingest queue: ${reason}`); ctx.handlers?.onProtocolError?.({ message: coded.message, line: "[runtime:flushQueue]" }); }));
  await next;
}

function transitionTurnStarted(ctx: HandlerCtx, persistedTurnId: string, runtimeTurnId: string): void {
  ctx.setTurnId(persistedTurnId);
  ctx.runtimeTurnId = runtimeTurnId;
  ctx.turnInFlight = true;
  ctx.turnSettled = false;
}

function transitionTurnSettled(ctx: HandlerCtx, turnId: string | null, runtimeTurnId: string | null): void {
  ctx.turnInFlight = false;
  ctx.turnSettled = true;
  ctx.setTurnId(turnId);
  ctx.runtimeTurnId = runtimeTurnId;
}

function toIngestDelta(ctx: HandlerCtx, event: NormalizedEvent, ptid: string): IngestDelta | null {
  const resolved = ctx.resolvePersistedTurnId(event.turnId);
  if (!resolved || !isTurnScopedEvent(event.kind)) return null;
  const rp = rewritePayloadTurnId({ kind: event.kind, payloadJson: event.payloadJson, persistedTurnId: resolved, ...(event.turnId ? { runtimeTurnId: event.turnId } : {}) });
  const rsid = event.streamId && event.turnId && event.turnId !== resolved ? event.streamId.replace(`:${event.turnId}:`, `:${resolved}:`) : event.streamId;
  if (!rsid) throw new Error(`Protocol event missing streamId for turn-scoped kind: ${event.kind}`);
  return { type: "stream_delta", eventId: event.eventId, kind: event.kind, payloadJson: rp, cursorStart: event.cursorStart, cursorEnd: event.cursorEnd, createdAt: event.createdAt, threadId: ptid, turnId: resolved, streamId: rsid };
}

function readAssistantDeltaPayload(payloadJson: string): { delta: string; parsed: Record<string, unknown> } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(payloadJson); } catch (_error) { return null; }
  if (typeof parsed !== "object" || parsed === null || !("method" in parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.method !== "item/agentMessage/delta") return null;
  const params = asObject(obj.params);
  if (!params || typeof params.delta !== "string") return null;
  return { delta: params.delta, parsed: obj };
}

function mergeAssistantDeltaPair(first: IngestDelta, second: IngestDelta): IngestDelta | null {
  if (
    first.type !== "stream_delta" || second.type !== "stream_delta" ||
    first.kind !== "item/agentMessage/delta" || second.kind !== "item/agentMessage/delta" ||
    first.threadId !== second.threadId || first.turnId !== second.turnId ||
    first.streamId !== second.streamId || first.cursorEnd !== second.cursorStart
  ) return null;
  const fp = readAssistantDeltaPayload(first.payloadJson);
  const sp = readAssistantDeltaPayload(second.payloadJson);
  if (!fp || !sp) return null;
  const merged = { ...fp.parsed, params: { ...(asObject(fp.parsed.params) ?? {}), delta: `${fp.delta}${sp.delta}` } };
  return { ...first, eventId: second.eventId, payloadJson: JSON.stringify(merged), cursorEnd: second.cursorEnd, createdAt: second.createdAt };
}

async function enqueueIngestDelta(ctx: HandlerCtx, delta: IngestDelta, forceFlush: boolean): Promise<void> {
  const tail = ctx.ingestQueue[ctx.ingestQueue.length - 1];
  if (tail) {
    const merged = mergeAssistantDeltaPair(tail, delta);
    if (merged) {
      ctx.ingestQueue[ctx.ingestQueue.length - 1] = merged;
    } else {
      ctx.ingestQueue.push(delta);
    }
  } else {
    ctx.ingestQueue.push(delta);
  }
  if (forceFlush || ctx.ingestQueue.length >= MAX_BATCH_SIZE) { await flushQueue(ctx); return; }
  if (!ctx.flushTimer) {
    ctx.setFlushTimer(setTimeout(() => { ctx.setFlushTimer(null); void flushQueue(ctx).catch((error) => { const reason = error instanceof Error ? error.message : String(error); const coded = ctx.runtimeError("E_RUNTIME_INGEST_FLUSH_FAILED", `Deferred ingest flush failed: ${reason}`); ctx.handlers?.onProtocolError?.({ message: coded.message, line: "[runtime:flushTimer]" }); }); }, ctx.turnInFlight ? ctx.ingestFlushMs : IDLE_INGEST_FLUSH_MS));
  }
}

// ── Bridge event handler ────────────────────────────────────────────

export async function handleBridgeEvent(ctx: HandlerCtx, event: NormalizedEvent): Promise<void> {
  if (!ctx.actor || !ctx.sessionId) return;
  if (!ctx.runtimeConversationId || (!isUuidLikeThreadId(ctx.runtimeConversationId) && isUuidLikeThreadId(event.threadId))) ctx.runtimeConversationId = event.threadId;
  await ctx.ensureThreadBinding(event.threadId);

  if (event.kind === "turn/started" && event.turnId) {
    const ptid = ctx.resolvePersistedTurnId(event.turnId) ?? event.turnId;
    transitionTurnStarted(ctx, ptid, event.turnId);
    if (ctx.activeDispatch && ctx.actor && ctx.threadId) {
      ctx.dispatchByTurnId.set(event.turnId, { dispatchId: ctx.activeDispatch.dispatchId, claimToken: ctx.activeDispatch.claimToken, persistedTurnId: ctx.activeDispatch.turnId });
      await ctx.persistence.markTurnDispatchStarted({ actor: ctx.actor, threadId: ctx.threadId, dispatchId: ctx.activeDispatch.dispatchId, claimToken: ctx.activeDispatch.claimToken, ...(ctx.runtimeConversationId ? { runtimeConversationId: ctx.runtimeConversationId } : {}), runtimeTurnId: event.turnId });
      ctx.setActiveDispatch(null);
    }
    ctx.emitState();
    if (ctx.interruptRequested) { if (!ctx.runtimeConversationId) return; ctx.sendMessage(buildTurnInterruptRequest(ctx.requestIdFn(), { threadId: ctx.runtimeConversationId, turnId: event.turnId }), "turn/interrupt"); ctx.interruptRequested = false; }
  }

  if (event.kind === "turn/completed") {
    const terminal = parseTurnCompletedStatus(event.payloadJson);
    if (ctx.actor && ctx.threadId && event.turnId) {
      const d = ctx.dispatchByTurnId.get(event.turnId);
      if (d) {
        if (terminal === "completed") await ctx.persistence.markTurnDispatchCompleted({ actor: ctx.actor, threadId: ctx.threadId, dispatchId: d.dispatchId, claimToken: d.claimToken });
        else if (terminal === "interrupted") await ctx.persistence.cancelTurnDispatch({ actor: ctx.actor, threadId: ctx.threadId, dispatchId: d.dispatchId, claimToken: d.claimToken, reason: "interrupted" });
        else {
          await ctx.persistence.markTurnDispatchFailed({ actor: ctx.actor, threadId: ctx.threadId, dispatchId: d.dispatchId, claimToken: d.claimToken, code: "TURN_COMPLETED_FAILED", reason: "turn/completed reported failed status" });
          await ctx.failAcceptedTurnSend({
            actor: ctx.actor,
            threadId: ctx.threadId,
            dispatchId: d.dispatchId,
            turnId: d.persistedTurnId,
            code: "TURN_COMPLETED_FAILED",
            reason: "turn/completed reported failed status",
          });
        }
      }
    }
    transitionTurnSettled(ctx, null, null);
    ctx.emitState();
    const terminalTurnId = event.turnId ? (ctx.resolvePersistedTurnId(event.turnId) ?? event.turnId) : undefined;
    await ctx.expireTurnServerRequests({
      threadId: ctx.threadId ?? event.threadId,
      ...(terminalTurnId ? { turnId: terminalTurnId } : {}),
    });
    await ctx.processDispatchQueue();
  }

  if (event.kind === "error") {
    if (ctx.actor && ctx.threadId && event.turnId) {
      const d = ctx.dispatchByTurnId.get(event.turnId);
      if (d) {
        await ctx.persistence.markTurnDispatchFailed({ actor: ctx.actor, threadId: ctx.threadId, dispatchId: d.dispatchId, claimToken: d.claimToken, code: "TURN_ERROR_EVENT", reason: "Runtime emitted error event for turn" });
        await ctx.failAcceptedTurnSend({
          actor: ctx.actor,
          threadId: ctx.threadId,
          dispatchId: d.dispatchId,
          turnId: d.persistedTurnId,
          code: "TURN_ERROR_EVENT",
          reason: "Runtime emitted error event for turn",
        });
      }
    }
    const isCurrentRuntimeTurn = !!event.turnId && event.turnId === ctx.runtimeTurnId;
    transitionTurnSettled(ctx, !event.turnId || isCurrentRuntimeTurn ? null : ctx.turnId, !event.turnId || isCurrentRuntimeTurn ? null : ctx.runtimeTurnId);
    ctx.emitState();
    const terminalTurnId = event.turnId ? (ctx.resolvePersistedTurnId(event.turnId) ?? event.turnId) : undefined;
    await ctx.expireTurnServerRequests({
      threadId: ctx.threadId ?? event.threadId,
      ...(terminalTurnId ? { turnId: terminalTurnId } : {}),
    });
    await ctx.processDispatchQueue();
  }

  const psr = parseManagedServerRequestFromEvent(event);
  if (psr && ctx.threadId) {
    const rtid = event.turnId ?? psr.turnId;
    const ptid = ctx.resolvePersistedTurnId(rtid) ?? psr.turnId;
    await ctx.registerPendingServerRequest({ ...psr, threadId: ctx.threadId, turnId: ptid, payloadJson: rewritePayloadTurnId({ kind: event.kind, payloadJson: psr.payloadJson, persistedTurnId: ptid, ...(rtid ? { runtimeTurnId: rtid } : {}) }) });
  }

  if (event.kind === "thread/tokenUsage/updated" && ctx.persistence.upsertTokenUsage) {
    try {
      if (ctx.threadId && ctx.actor) {
        let parsed: unknown; try { parsed = JSON.parse(event.payloadJson); } catch (_) { parsed = null; }
        const envelope = asObject(parsed); const payload = envelope ? asObject(envelope.params) ?? envelope : null;
        const tu = payload ? asObject(payload.tokenUsage) : null; const rtid = ctx.resolvePersistedTurnId(event.turnId) ?? ctx.turnId;
        if (tu && rtid) {
          const t = asObject(tu.total), l = asObject(tu.last);
          const mcw = typeof payload?.modelContextWindow === "number" ? payload.modelContextWindow : undefined;
          await ctx.persistence.upsertTokenUsage({ actor: ctx.actor, threadId: ctx.threadId, turnId: rtid, totalTokens: typeof t?.totalTokens === "number" ? t.totalTokens : 0, inputTokens: typeof t?.inputTokens === "number" ? t.inputTokens : 0, cachedInputTokens: typeof t?.cachedInputTokens === "number" ? t.cachedInputTokens : 0, outputTokens: typeof t?.outputTokens === "number" ? t.outputTokens : 0, reasoningOutputTokens: typeof t?.reasoningOutputTokens === "number" ? t.reasoningOutputTokens : 0, lastTotalTokens: typeof l?.totalTokens === "number" ? l.totalTokens : 0, lastInputTokens: typeof l?.inputTokens === "number" ? l.inputTokens : 0, lastCachedInputTokens: typeof l?.cachedInputTokens === "number" ? l.cachedInputTokens : 0, lastOutputTokens: typeof l?.outputTokens === "number" ? l.outputTokens : 0, lastReasoningOutputTokens: typeof l?.reasoningOutputTokens === "number" ? l.reasoningOutputTokens : 0, ...(mcw !== undefined ? { modelContextWindow: mcw } : {}) });
        }
      }
    } catch (error) { ctx.handlers?.onProtocolError?.({ message: `Failed to persist token usage: ${error instanceof Error ? error.message : String(error)}`, line: event.payloadJson }); }
  }

  ctx.handlers?.onEvent?.(event);
  if (!ctx.threadId) return;
  const delta = toIngestDelta(ctx, event, ctx.threadId);
  if (!delta) { ctx.skippedEventCount += 1; ctx.incrementSkippedKind(event.kind); return; }
  ctx.enqueuedEventCount += 1; ctx.incrementEnqueuedKind(event.kind);
  await enqueueIngestDelta(ctx, delta, event.kind === "turn/completed" || event.kind === "error");
  await flushPendingServerRequestRetries(ctx);
  if (event.turnId && (event.kind === "turn/completed" || event.kind === "error")) ctx.dispatchByTurnId.delete(event.turnId);
}

// ── Bridge global message handler ───────────────────────────────────

export async function handleBridgeGlobalMessage(ctx: HandlerCtx, message: ServerInboundMessage): Promise<void> {
  if (isChatgptAuthTokensRefreshRequest(message)) ctx.registerPendingAuthTokensRefreshRequest({ requestId: message.id, params: message.params, createdAt: Date.now() });
  if (isResponse(message) && typeof message.id === "number") {
    const pending = ctx.pendingRequests.get(message.id); ctx.pendingRequests.delete(message.id);
    if (pending) {
      ctx.setRuntimeThreadFromResponse(message, pending.method);
      if (pending.method === "thread/start" || pending.method === "thread/resume" || pending.method === "thread/fork") {
        await ctx.ensureThreadBinding(
          ctx.runtimeConversationId === null ? undefined : ctx.runtimeConversationId,
        );
      }
    }
    if (message.error && pending?.method === "turn/start") {
      if (ctx.actor && ctx.threadId && pending.dispatchId && pending.claimToken) {
        const code = typeof message.error.code === "number" ? String(message.error.code) : "TURN_START_FAILED";
        await ctx.persistence.markTurnDispatchFailed({ actor: ctx.actor, threadId: ctx.threadId, dispatchId: pending.dispatchId, claimToken: pending.claimToken, code, reason: message.error.message });
        if (pending.turnId) {
          await ctx.failAcceptedTurnSend({
            actor: ctx.actor,
            threadId: ctx.threadId,
            dispatchId: pending.dispatchId,
            turnId: pending.turnId,
            code,
            reason: message.error.message,
          });
        }
      }
      ctx.setActiveDispatch(null);
      transitionTurnSettled(ctx, null, null);
      ctx.interruptRequested = false;
      ctx.emitState();
      await ctx.processDispatchQueue();
    } else if (!message.error && pending?.method === "turn/start" && ctx.actor && ctx.threadId && pending.dispatchId && pending.claimToken) {
      const ro = asObject(message.result);
      const to = ro && asObject(ro.turn);
      const rtid = typeof to?.id === "string" ? to.id : pending.turnId;
      await ctx.persistence.markTurnDispatchStarted({ actor: ctx.actor, threadId: ctx.threadId, dispatchId: pending.dispatchId, claimToken: pending.claimToken, ...(ctx.runtimeConversationId ? { runtimeConversationId: ctx.runtimeConversationId } : {}), ...(rtid ? { runtimeTurnId: rtid } : {}) });
      if (rtid) ctx.dispatchByTurnId.set(rtid, { dispatchId: pending.dispatchId, claimToken: pending.claimToken, persistedTurnId: pending.turnId ?? rtid });
      ctx.setActiveDispatch(null);
    }
    if (pending?.resolve) { if (message.error) { const code = typeof message.error.code === "number" ? String(message.error.code) : "UNKNOWN"; pending.reject?.(new Error(`[${code}] ${message.error.message}`)); } else pending.resolve(message); }
  }
  ctx.handlers?.onGlobalMessage?.(message);
}
