/**
 * Internal runtime core: state, server requests, dispatch, and turn lifecycle.
 * Used by runtime.ts to compose the public CodexHostRuntime API.
 * Bridge handlers and ingest are in runtimeCoreHandlers.ts.
 */
import {
  buildTurnStartTextRequest,
} from "../../app-server/client.js";
import type { CodexResponse, NormalizedEvent, ServerInboundMessage, RpcId } from "../../protocol/generated.js";
import type { ClientOutboundWireMessage } from "../../protocol/outbound.js";
import { isTurnNotFound } from "../../errors.js";
import {
  randomSessionId,
  toRequestKey,
} from "./runtimeHelpers.js";
import type {
  ActorContext,
  ClientMessage,
  ClientRequestMessage,
  HostRuntimeErrorCode,
  HostRuntimeLifecyclePhase,
  HostRuntimeLifecycleSource,
  HostRuntimePersistence,
  HostRuntimeHandlers,
  HostRuntimePersistedServerRequest,
  HostRuntimeState,
  IngestDelta,
  PendingAuthTokensRefreshRequest,
  PendingRequest,
  PendingServerRequest,
  PendingServerRequestRetryEntry,
  RuntimeBridge,
  RuntimeServerRequestStatus,
} from "./runtimeTypes.js";
import { CodexHostRuntimeError } from "./runtimeTypes.js";
import {
  clearPendingServerRequestRetryTimer as clearRetryTimer,
  enqueuePendingServerRequestRetry,
  flushQueue as flushQueueHandler,
  handleBridgeEvent as bridgeEventHandler,
  handleBridgeGlobalMessage as bridgeGlobalHandler,
  type HandlerCtx,
} from "./runtimeCoreHandlers.js";

export type RuntimeCoreArgs = {
  persistence: HostRuntimePersistence;
  handlers?: HostRuntimeHandlers;
};

export function createRuntimeCore(args: RuntimeCoreArgs) {
  let bridge: RuntimeBridge | null = null;
  let actor: ActorContext | null = null;
  let sessionId: string | null = null;
  let threadId: string | null = null;
  let runtimeConversationId: string | null = null;
  let conversationId: string | null = null;
  let turnId: string | null = null;
  let turnInFlight = false;
  let turnSettled = false;
  let interruptRequested = false;
  let nextRequestId = 1;
  let claimLoopRunning = false;
  const dispatchByTurnId = new Map<
    string,
    { dispatchId: string; claimToken: string; persistedTurnId: string }
  >();
  let activeDispatch:
    | { dispatchId: string; claimToken: string; turnId: string; text: string }
    | null = null;
  let startupModel: string | undefined;
  let startupCwd: string | undefined;

  let ingestQueue: IngestDelta[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushTail: Promise<void> = Promise.resolve();
  let ingestFlushMs = 250;
  const pendingServerRequests = new Map<string, PendingServerRequest>();
  const pendingServerRequestRetries = new Map<string, PendingServerRequestRetryEntry>();
  let pendingServerRequestRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingAuthTokensRefreshRequests = new Map<string, PendingAuthTokensRefreshRequest>();
  const enqueuedByKind = new Map<string, number>();
  const skippedByKind = new Map<string, number>();
  let enqueuedEventCount = 0;
  let skippedEventCount = 0;
  let lastErrorCode: HostRuntimeErrorCode | null = null;
  let lastErrorMessage: string | null = null;
  let lifecyclePhase: HostRuntimeLifecyclePhase = "idle";
  let lifecycleSource: HostRuntimeLifecycleSource = "runtime";
  let lifecycleUpdatedAtMs = Date.now();
  const pendingRequests = new Map<number, PendingRequest>();

  const incrementCount = (counts: Map<string, number>, kind: string) => { counts.set(kind, (counts.get(kind) ?? 0) + 1); };
  const snapshotKindCounts = (counts: Map<string, number>): Array<{ kind: string; count: number }> =>
    Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([kind, count]) => ({ kind, count }));
  const resetIngestMetrics = () => { enqueuedByKind.clear(); skippedByKind.clear(); enqueuedEventCount = 0; skippedEventCount = 0; };

  const emitState = (error?: { code: HostRuntimeErrorCode; message: string } | null) => {
    if (error === undefined) { /* keep */ } else if (error === null) { lastErrorCode = null; lastErrorMessage = null; }
    else { lastErrorCode = error.code; lastErrorMessage = `[${error.code}] ${error.message}`; }
    lifecycleUpdatedAtMs = Date.now();
    args.handlers?.onState?.({
      running: !!bridge,
      phase: lifecyclePhase,
      source: lifecycleSource,
      updatedAtMs: lifecycleUpdatedAtMs,
      runtimeConversationId,
      conversationId,
      turnId,
      turnInFlight,
      pendingServerRequestCount: pendingServerRequests.size,
      ingestMetrics: { enqueuedEventCount, skippedEventCount, enqueuedByKind: snapshotKindCounts(enqueuedByKind), skippedByKind: snapshotKindCounts(skippedByKind) },
      lastErrorCode, lastError: lastErrorMessage,
    });
  };

  const setLifecycle = (phase: HostRuntimeLifecyclePhase, source: HostRuntimeLifecycleSource) => {
    lifecyclePhase = phase;
    lifecycleSource = source;
    lifecycleUpdatedAtMs = Date.now();
  };

  const runtimeError = (code: HostRuntimeErrorCode, message: string): CodexHostRuntimeError => {
    const e = new CodexHostRuntimeError(code, message); emitState({ code, message }); return e;
  };

  const clearFlushTimer = () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } };
  const requestIdFn = () => { const id = nextRequestId; nextRequestId += 1; return id; };
  const assertRuntimeReady = (): RuntimeBridge => { if (!bridge) throw new Error("Bridge not started"); return bridge; };

  const sendMessage = (message: ClientMessage, trackedMethod?: string) => {
    const b = assertRuntimeReady(); b.send(message);
    if ("id" in message && typeof message.id === "number" && trackedMethod) pendingRequests.set(message.id, { method: trackedMethod });
  };
  const sendRequest = (message: ClientRequestMessage): Promise<CodexResponse> => {
    const b = assertRuntimeReady();
    if (typeof message.id !== "number") throw new Error("Runtime requires numeric request ids.");
    const mid = message.id;
    return new Promise<CodexResponse>((resolve, reject) => { pendingRequests.set(mid, { method: message.method, resolve, reject }); b.send(message); });
  };

  // ── Server request CRUD ─────────────────────────────────────────────

  const registerPendingServerRequest = async (request: PendingServerRequest) => {
    pendingServerRequests.set(toRequestKey(request.requestId), request);
    if (actor) {
      try { await args.persistence.upsertPendingServerRequest({ actor, request }); }
      catch (error) { if (isTurnNotFound(error)) enqueuePendingServerRequestRetry(handlerCtx, request, error); else throw error; }
    }
    emitState();
  };
  const resolvePendingServerRequest = async (a: { requestId: RpcId; status: Exclude<RuntimeServerRequestStatus, "pending">; responseJson?: string }) => {
    const key = toRequestKey(a.requestId); const pending = pendingServerRequests.get(key); if (!pending) return;
    pendingServerRequests.delete(key); pendingServerRequestRetries.delete(key);
    if (actor) await args.persistence.resolvePendingServerRequest({ actor, threadId: pending.threadId, requestId: pending.requestId, status: a.status, resolvedAt: Date.now(), ...(a.responseJson ? { responseJson: a.responseJson } : {}) });
    emitState();
  };
  const expireTurnServerRequests = async (turn: { threadId: string; turnId?: string | null }) => {
    if (!turn.turnId) return;
    const ids: RpcId[] = []; for (const r of pendingServerRequests.values()) { if (r.threadId === turn.threadId && r.turnId === turn.turnId) ids.push(r.requestId); }
    for (const rid of ids) await resolvePendingServerRequest({ requestId: rid, status: "expired" });
  };
  const getPendingServerRequest = (rid: RpcId): PendingServerRequest => {
    const p = pendingServerRequests.get(toRequestKey(rid)); if (!p) throw new Error(`No pending server request found for id ${String(rid)}`); return p;
  };
  const sendServerRequestResponse = async (rid: RpcId, resp: ClientOutboundWireMessage): Promise<void> => {
    getPendingServerRequest(rid); sendMessage(resp);
    await resolvePendingServerRequest({ requestId: rid, status: "answered", responseJson: JSON.stringify(resp) });
  };

  // ── Auth tokens refresh ─────────────────────────────────────────────

  const registerPendingAuthTokensRefreshRequest = (r: PendingAuthTokensRefreshRequest): void => { pendingAuthTokensRefreshRequests.set(toRequestKey(r.requestId), r); };
  const getPendingAuthTokensRefreshRequest = (rid: RpcId): PendingAuthTokensRefreshRequest => {
    const p = pendingAuthTokensRefreshRequests.get(toRequestKey(rid)); if (!p) throw new Error(`No pending auth token refresh request found for id ${String(rid)}`); return p;
  };
  const resolvePendingAuthTokensRefreshRequest = (rid: RpcId): void => { pendingAuthTokensRefreshRequests.delete(toRequestKey(rid)); };

  // ── Turn lifecycle ──────────────────────────────────────────────────

  const throwIfTurnMutationLocked = () => { if (turnInFlight && !turnSettled) throw new Error("Cannot change thread lifecycle while a turn is in flight."); };
  const setRuntimeThreadFromResponse = (message: CodexResponse, method: string) => {
    if (message.error || !message.result || typeof message.result !== "object") return;
    if (!("thread" in message.result) || typeof message.result.thread !== "object" || message.result.thread === null) return;
    if (!("id" in message.result.thread) || typeof message.result.thread.id !== "string") return;
    if (method === "thread/start" || method === "thread/resume" || method === "thread/fork") {
      runtimeConversationId = message.result.thread.id; if (!conversationId) conversationId = message.result.thread.id; emitState();
    }
  };

  const ensureThreadBinding = async (preferred?: string): Promise<void> => {
    if (!actor || !sessionId || threadId) return;
    const next = preferred === undefined ? runtimeConversationId : preferred; if (!next) return;
    const binding = await args.persistence.ensureThread({
      actor,
      conversationId: conversationId === null ? next : conversationId,
      ...(startupModel !== undefined ? { model: startupModel } : {}),
      ...(startupCwd !== undefined ? { cwd: startupCwd } : {}),
    });
    threadId = binding.threadId; if (!conversationId) conversationId = next;
    await args.persistence.ensureSession({ actor, sessionId, threadId, lastEventCursor: 0 }); emitState();
  };

  // ── Dispatch ────────────────────────────────────────────────────────

  const sendClaimedDispatch = async (claimed: { dispatchId: string; turnId: string; inputText: string; claimToken: string }) => {
    if (!runtimeConversationId) throw new Error("Cannot dispatch turn before runtime thread is ready.");
    activeDispatch = { dispatchId: claimed.dispatchId, claimToken: claimed.claimToken, turnId: claimed.turnId, text: claimed.inputText };
    turnId = claimed.turnId; turnInFlight = true; turnSettled = false; emitState();
    const reqId = requestIdFn();
    pendingRequests.set(reqId, { method: "turn/start", dispatchId: claimed.dispatchId, claimToken: claimed.claimToken, turnId: claimed.turnId });
    assertRuntimeReady().send(buildTurnStartTextRequest(reqId, { threadId: runtimeConversationId, text: claimed.inputText }));
  };

  const processDispatchQueue = async (): Promise<void> => {
    if (claimLoopRunning) return;
    claimLoopRunning = true;
    try {
      while (true) {
        if (!actor || !threadId || (turnInFlight && !turnSettled)) return;
        const claimed = await args.persistence.claimNextTurnDispatch({ actor, threadId, claimOwner: sessionId ?? "runtime-owner" });
        if (!claimed) return;
        try { await sendClaimedDispatch(claimed); }
        catch (error) {
          if (actor && threadId) {
            const reason = error instanceof Error ? error.message : String(error);
            await args.persistence.markTurnDispatchFailed({ actor, threadId, dispatchId: claimed.dispatchId, claimToken: claimed.claimToken, code: "TURN_START_DISPATCH_SEND_FAILED", reason });
            await args.persistence.failAcceptedTurnSend({ actor, threadId, dispatchId: claimed.dispatchId, turnId: claimed.turnId, code: "TURN_START_DISPATCH_SEND_FAILED", reason });
          }
          turnInFlight = false; turnSettled = true; turnId = null; activeDispatch = null; emitState(); continue;
        }
        return;
      }
    } finally { claimLoopRunning = false; }
  };

  const acceptTurnSend = async (inputText: string): Promise<{ turnId: string; accepted: true }> => {
    if (!actor || !threadId) {
      throw new Error("Cannot accept turn send before thread binding is ready.");
    }
    const accepted = await args.persistence.acceptTurnSend({
      actor,
      threadId,
      inputText,
      idempotencyKey: randomSessionId(),
      dispatchId: randomSessionId(),
      turnId: randomSessionId(),
    });
    if (!accepted.accepted) {
      throw new Error("Turn send was not accepted by persistence.");
    }
    return { turnId: accepted.turnId, accepted: true };
  };

  const resolvePersistedTurnId = (rtid?: string): string | null => { if (rtid) return dispatchByTurnId.get(rtid)?.persistedTurnId ?? rtid; return turnId; };
  const failAcceptedTurnSend = async (argsForFailure: {
    actor: ActorContext;
    threadId: string;
    dispatchId: string;
    turnId: string;
    code?: string;
    reason: string;
  }): Promise<void> => {
    await args.persistence.failAcceptedTurnSend(argsForFailure);
  };

  // ── Handler context ─────────────────────────────────────────────────

  const handlerCtx: HandlerCtx = {
    get actor() { return actor; },
    get sessionId() { return sessionId; },
    get threadId() { return threadId; },
    get runtimeConversationId() { return runtimeConversationId; },
    set runtimeConversationId(v) { runtimeConversationId = v; },
    get turnId() { return turnId; },
    get turnInFlight() { return turnInFlight; },
    set turnInFlight(v) { turnInFlight = v; },
    get turnSettled() { return turnSettled; },
    set turnSettled(v) { turnSettled = v; },
    get interruptRequested() { return interruptRequested; },
    set interruptRequested(v) { interruptRequested = v; },
    get activeDispatch() { return activeDispatch; },
    setActiveDispatch: (v) => { activeDispatch = v; },
    setTurnId: (v) => { turnId = v; },
    get ingestQueue() { return ingestQueue; },
    get flushTimer() { return flushTimer; },
    setFlushTimer: (v) => { flushTimer = v; },
    get flushTail() { return flushTail; },
    setFlushTail: (v) => { flushTail = v; },
    get ingestFlushMs() { return ingestFlushMs; },
    get enqueuedEventCount() { return enqueuedEventCount; },
    set enqueuedEventCount(v) { enqueuedEventCount = v; },
    get skippedEventCount() { return skippedEventCount; },
    set skippedEventCount(v) { skippedEventCount = v; },
    incrementEnqueuedKind: (kind) => incrementCount(enqueuedByKind, kind),
    incrementSkippedKind: (kind) => incrementCount(skippedByKind, kind),
    pendingServerRequestRetries,
    get pendingServerRequestRetryTimer() { return pendingServerRequestRetryTimer; },
    setPendingServerRequestRetryTimer: (v) => { pendingServerRequestRetryTimer = v; },
    dispatchByTurnId,
    pendingRequests,
    persistence: args.persistence,
    handlers: args.handlers,
    emitState,
    runtimeError,
    requestIdFn,
    sendMessage,
    clearFlushTimer,
    ensureThreadBinding,
    processDispatchQueue,
    failAcceptedTurnSend,
    registerPendingServerRequest,
    resolvePendingServerRequest,
    expireTurnServerRequests,
    setRuntimeThreadFromResponse,
    registerPendingAuthTokensRefreshRequest,
    resolvePersistedTurnId,
  };

  return {
    get bridge() { return bridge; },
    set bridge(v) { bridge = v; },
    get actor() { return actor; },
    set actor(v) { actor = v; },
    get sessionId() { return sessionId; },
    set sessionId(v) { sessionId = v; },
    get conversationId() { return conversationId; },
    set conversationId(v) { conversationId = v; },
    get threadId() { return threadId; },
    get runtimeConversationId() { return runtimeConversationId; },
    get turnId() { return turnId; },
    get turnInFlight() { return turnInFlight; },
    get turnSettled() { return turnSettled; },
    get activeDispatch() { return activeDispatch; },
    get interruptRequested() { return interruptRequested; },
    set interruptRequested(v) { interruptRequested = v; },
    get startupModel() { return startupModel; },
    set startupModel(v) { startupModel = v; },
    get startupCwd() { return startupCwd; },
    set startupCwd(v) { startupCwd = v; },
    get ingestFlushMs() { return ingestFlushMs; },
    set ingestFlushMs(v) { ingestFlushMs = v; },

    emitState, runtimeError, clearFlushTimer, requestIdFn, assertRuntimeReady,
    sendMessage, sendRequest,
    clearPendingServerRequestRetryTimer: () => clearRetryTimer(handlerCtx),
    flushQueue: () => flushQueueHandler(handlerCtx),
    resetIngestMetrics,
    ensureThreadBinding, sendClaimedDispatch, processDispatchQueue,
    acceptTurnSend,
    throwIfTurnMutationLocked,
    getPendingServerRequest, sendServerRequestResponse,
    getPendingAuthTokensRefreshRequest, resolvePendingAuthTokensRefreshRequest,
    registerPendingAuthTokensRefreshRequest,
    handleBridgeEvent: (event: NormalizedEvent) => bridgeEventHandler(handlerCtx, event),
    handleBridgeGlobalMessage: (message: ServerInboundMessage) => bridgeGlobalHandler(handlerCtx, message),

    resetAll() {
      bridge = null; actor = null; sessionId = null; threadId = null; runtimeConversationId = null;
      conversationId = null; turnId = null; turnInFlight = false; turnSettled = false;
      interruptRequested = false;
      claimLoopRunning = false; dispatchByTurnId.clear(); activeDispatch = null;
      startupModel = undefined; startupCwd = undefined; pendingRequests.clear();
      pendingServerRequests.clear(); pendingServerRequestRetries.clear();
      pendingAuthTokensRefreshRequests.clear(); ingestQueue = [];
      flushTail = Promise.resolve();
      lifecyclePhase = "idle";
      lifecycleSource = "runtime";
      lifecycleUpdatedAtMs = Date.now();
    },
    rejectAllPending() { for (const [, p] of pendingRequests) p.reject?.(new Error("Bridge stopped before request completed.")); },
    listPendingServerRequests: async (): Promise<HostRuntimePersistedServerRequest[]> => {
      if (actor) return args.persistence.listPendingServerRequests({ actor });
      return [];
    },
    getState: (): HostRuntimeState => ({
      running: !!bridge,
      phase: lifecyclePhase,
      source: lifecycleSource,
      updatedAtMs: lifecycleUpdatedAtMs,
      runtimeConversationId,
      conversationId,
      turnId,
      turnInFlight,
      pendingServerRequestCount: pendingServerRequests.size,
      ingestMetrics: { enqueuedEventCount, skippedEventCount, enqueuedByKind: snapshotKindCounts(enqueuedByKind), skippedByKind: snapshotKindCounts(skippedByKind) },
      lastErrorCode, lastError: lastErrorMessage,
    }),
    setProtocolError(msg: string) { setLifecycle("error", "protocol_error"); lastErrorCode = null; lastErrorMessage = msg; },
    setProcessExitError(code: number | string) { setLifecycle("error", "process_exit"); lastErrorCode = null; lastErrorMessage = `codex exited with code ${String(code)}`; },
    setLifecycle,
  };
}

export type RuntimeCore = ReturnType<typeof createRuntimeCore>;
