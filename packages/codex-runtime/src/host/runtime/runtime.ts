/**
 * Public CodexHostRuntime factory.
 * Delegates internal state management to runtimeCore.ts.
 */
import {
  buildAccountLoginCancelRequest,
  buildAccountLoginStartRequest,
  buildAccountLogoutRequest,
  buildAccountRateLimitsReadRequest,
  buildArchiveConversationRequest,
  buildAccountReadRequest,
  buildChatgptAuthTokensRefreshResponse,
  buildCommandExecutionApprovalResponse,
  buildDynamicToolCallResponse,
  buildFileChangeApprovalResponse,
  buildThreadArchiveRequest,
  buildThreadCompactStartRequest,
  buildThreadForkRequest,
  buildThreadListRequest,
  buildThreadLoadedListRequest,
  buildGetConversationSummaryRequest,
  buildThreadReadRequest,
  buildInterruptConversationRequest,
  buildListConversationsRequest,
  buildNewConversationRequest,
  buildResumeConversationRequest,
  buildForkConversationRequest,
  buildThreadResumeRequest,
  buildThreadRollbackRequest,
  buildThreadSetNameRequest,
  buildInitializeRequestWithCapabilities,
  buildInitializedNotification,
  buildThreadStartRequest,
  buildThreadUnarchiveRequest,
  buildToolRequestUserInputResponse,
  buildTurnInterruptRequest,
  buildTurnSteerTextRequest,
} from "../../app-server/client.js";
import clientPackage from "../../../package.json" with { type: "json" };
import { canonicalizeSnapshotItemId } from "../snapshotIdentity.js";
import { randomSessionId } from "./runtimeHelpers.js";
import { createRuntimeCore } from "./runtimeCore.js";
import { createCodexOnlyPersistence } from "../persistence/codexOnlyPersistence.js";
import type {
  HostRuntimeConnectArgs,
  HostRuntimeImportLocalThreadArgs,
  HostRuntimeImportLocalThreadResult,
  HostRuntimeOpenThreadArgs,
  HostRuntimeThreadListItem,
  HostRuntimeThreadListResult,
  IngestDelta,
  HostRuntimePersistence,
  HostRuntimeHandlers,
  HostRuntimeState,
  RuntimeBridge,
  RuntimeBridgeConfig,
  RuntimeBridgeHandlers,
} from "./runtimeTypes.js";
import type { CodexHostRuntime } from "./runtimeTypes.js";

// Re-export all public types
export {
  CodexHostRuntimeError,
  type CodexHostRuntime,
  type HostRuntimeErrorCode,
  type HostRuntimeHandlers,
  type HostRuntimeImportLocalThreadArgs,
  type HostRuntimeImportLocalThreadResult,
  type HostRuntimeLifecycleListener,
  type HostRuntimeLifecyclePhase,
  type HostRuntimeLifecycleSource,
  type HostRuntimePersistence,
  type HostRuntimePersistedServerRequest,
  type ActorContext,
  type IngestDelta,
  type HostRuntimeConnectArgs,
  type HostRuntimeOpenThreadArgs,
  type HostRuntimeState,
  type HostRuntimeThreadListItem,
  type HostRuntimeThreadListResult,
} from "./runtimeTypes.js";

type RuntimeBaseArgs = {
  bridge?: RuntimeBridgeConfig;
  bridgeFactory?: (config: RuntimeBridgeConfig, handlers: RuntimeBridgeHandlers) => RuntimeBridge;
  handlers?: HostRuntimeHandlers;
  persistence?: HostRuntimePersistence;
};
export type CreateCodexHostRuntimeArgs = RuntimeBaseArgs;

type SnapshotThreadItem = {
  type?: string;
  id?: string;
  [key: string]: unknown;
};

type SnapshotTurn = {
  id?: string;
  status?: string;
  error?: unknown;
  items?: SnapshotThreadItem[];
};

type UnknownRecord = { [key: string]: unknown };
const IMPORT_THREAD_SOURCE_CHUNK_SIZE = 128;

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return null;
}

function normalizeThreadListItem(value: unknown): HostRuntimeThreadListItem | null {
  if (!isUnknownRecord(value)) {
    return null;
  }
  const threadId = typeof value.id === "string" ? value.id : null;
  if (!threadId || threadId.length === 0) {
    return null;
  }
  const previewRaw = typeof value.preview === "string" ? value.preview.trim() : "";
  const preview = previewRaw.length > 0 ? previewRaw : "Untitled thread";
  const updatedAt = asNonNegativeInteger(value.updatedAt) ?? 0;
  const messageCount = asNonNegativeInteger(value.messageCount) ?? 0;
  return {
    threadId,
    preview,
    updatedAt,
    messageCount,
  };
}

function normalizeThreadListResponse(response: unknown): HostRuntimeThreadListResult {
  const root = isUnknownRecord(response) ? response : null;
  const result = isUnknownRecord(root?.result) ? root.result : null;
  const dataRaw = Array.isArray(result?.data) ? result.data : [];
  const data = dataRaw
    .map((row) => normalizeThreadListItem(row))
    .filter((row): row is HostRuntimeThreadListItem => row !== null);
  const nextCursor = typeof result?.nextCursor === "string" ? result.nextCursor : null;
  return {
    data,
    nextCursor,
  };
}

function extractThreadMessageCountFromReadResponse(response: unknown): number {
  const root = isUnknownRecord(response) ? response : null;
  const result = isUnknownRecord(root?.result) ? root.result : null;
  const thread = isUnknownRecord(result?.thread) ? result.thread : null;
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  let messageCount = 0;

  for (const turnValue of turns) {
    const turn = isUnknownRecord(turnValue) ? turnValue : null;
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const itemValue of items) {
      const item = isUnknownRecord(itemValue) ? itemValue : null;
      if (!item) {
        continue;
      }
      const rawType = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
      if (!rawType) {
        continue;
      }
      if (
        rawType === "usermessage" ||
        rawType === "user_message" ||
        rawType === "assistantmessage" ||
        rawType === "assistant_message" ||
        rawType === "agentmessage" ||
        rawType === "agent_message" ||
        rawType === "toolmessage" ||
        rawType === "tool_message" ||
        rawType === "systemmessage" ||
        rawType === "system_message"
      ) {
        messageCount += 1;
      }
    }
  }

  return messageCount;
}

function asSnapshotTurn(value: unknown): SnapshotTurn | null {
  if (!isUnknownRecord(value)) {
    return null;
  }
  const record = value;
  const id = typeof record.id === "string" ? record.id : null;
  const status = typeof record.status === "string" ? record.status : null;
  const items = Array.isArray(record.items)
    ? record.items
      .map((item) => {
        if (!isUnknownRecord(item)) {
          return null;
        }
        return item;
      })
      .filter((item): item is SnapshotThreadItem => item !== null)
    : null;
  return {
    ...(id ? { id } : {}),
    ...(status ? { status } : {}),
    error: record.error,
    ...(items ? { items } : {}),
  };
}

function normalizeTurnStatus(status: string | undefined): "completed" | "interrupted" | "failed" | "inProgress" {
  if (status === "completed" || status === "interrupted" || status === "failed" || status === "inProgress") {
    return status;
  }
  return "completed";
}

function normalizeTurnError(
  status: "completed" | "interrupted" | "failed" | "inProgress",
  errorValue: unknown,
): { message: string } | null {
  if (status === "completed") {
    return null;
  }
  const errorRecord = isUnknownRecord(errorValue) ? errorValue : null;
  const message = typeof errorRecord?.message === "string" && errorRecord.message.trim().length > 0
    ? errorRecord.message
    : status === "interrupted"
      ? "Turn interrupted during local thread import."
      : "Turn failed during local thread import.";
  return { message };
}

function normalizeImportItemType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized;
}

function isRenderableImportMessageType(itemType: string): boolean {
  return (
    itemType === "usermessage" ||
    itemType === "user_message" ||
    itemType === "assistantmessage" ||
    itemType === "assistant_message" ||
    itemType === "agentmessage" ||
    itemType === "agent_message" ||
    itemType === "systemmessage" ||
    itemType === "system_message" ||
    itemType === "toolmessage" ||
    itemType === "tool_message"
  );
}

type SyncManifestEntry = { turnId: string; messageId: string };

function extractCanonicalMessageManifestFromSnapshotTurns(turns: SnapshotTurn[]): SyncManifestEntry[] {
  const entries: SyncManifestEntry[] = [];
  const seen = new Set<string>();
  for (const turn of turns) {
    const turnId = typeof turn.id === "string" ? turn.id : null;
    if (!turnId) {
      continue;
    }
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      if (!item) {
        continue;
      }
      const itemType = normalizeImportItemType(item.type);
      if (!itemType || !isRenderableImportMessageType(itemType)) {
        continue;
      }
      const messageId = canonicalizeSnapshotItemId({ turnId, item, itemIndex }).messageId;
      const key = JSON.stringify([turnId, messageId]);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({ turnId, messageId });
    }
  }
  entries.sort((a, b) => {
    if (a.turnId === b.turnId) {
      return a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0;
    }
    return a.turnId < b.turnId ? -1 : 1;
  });
  return entries;
}

type ThreadImportDiagnostics = {
  totalItems: number;
  renderableItems: number;
  generatedMessageIds: number;
  skippedMissingType: number;
};

function buildThreadImportDeltas(args: {
  snapshotId: string;
  conversationId: string;
  turns: SnapshotTurn[];
}): { deltas: IngestDelta[]; diagnostics: ThreadImportDiagnostics } {
  const deltas: IngestDelta[] = [];
  const diagnostics: ThreadImportDiagnostics = {
    totalItems: 0,
    renderableItems: 0,
    generatedMessageIds: 0,
    skippedMissingType: 0,
  };
  const nextCursorByStreamId = new Map<string, number>();
  let eventSequence = 0;
  let createdAtMs = Date.now();

  const push = (deltaArgs: {
    turnId: string;
    kind: string;
    payload: Record<string, unknown>;
  }) => {
    const streamId = `thread-import:${args.snapshotId}:${args.conversationId}:${deltaArgs.turnId}:import`;
    const cursorStart = nextCursorByStreamId.get(streamId) ?? 0;
    const cursorEnd = cursorStart + 1;
    nextCursorByStreamId.set(streamId, cursorEnd);
    eventSequence += 1;
    deltas.push({
      type: "stream_delta",
      eventId: `thread-import:${args.snapshotId}:${args.conversationId}:${deltaArgs.turnId}:${eventSequence}`,
      turnId: deltaArgs.turnId,
      streamId,
      kind: deltaArgs.kind,
      payloadJson: JSON.stringify({
        method: deltaArgs.kind,
        params: deltaArgs.payload,
      }),
      cursorStart,
      cursorEnd,
      createdAt: createdAtMs++,
      threadId: args.conversationId,
    });
  };

  for (const turn of args.turns) {
    const turnId = typeof turn.id === "string" ? turn.id : null;
    if (!turnId) {
      continue;
    }
    const status = normalizeTurnStatus(turn.status);
    const normalizedError = normalizeTurnError(status, turn.error);
    const turnPayload = {
      id: turnId,
      items: [],
      status,
      ...(normalizedError ? { error: normalizedError } : { error: null }),
    };
    push({
      turnId,
      kind: "turn/started",
      payload: {
        threadId: args.conversationId,
        turn: turnPayload,
      },
    });
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      if (!item) {
        continue;
      }
      diagnostics.totalItems += 1;
      const itemType = typeof item.type === "string" ? item.type : null;
      if (!itemType) {
        diagnostics.skippedMissingType += 1;
        continue;
      }
      const normalizedItemType = normalizeImportItemType(itemType);
      const isRenderable = normalizedItemType ? isRenderableImportMessageType(normalizedItemType) : false;
      const canonicalId = canonicalizeSnapshotItemId({ turnId, item, itemIndex });
      if (isRenderable) {
        diagnostics.renderableItems += 1;
        if (canonicalId.generated) {
          diagnostics.generatedMessageIds += 1;
        }
      }
      const normalizedItem = { ...item, id: canonicalId.messageId };
      push({
        turnId,
        kind: "item/completed",
        payload: {
          threadId: args.conversationId,
          turnId,
          item: normalizedItem,
        },
      });
    }
    if (status !== "inProgress") {
      push({
        turnId,
        kind: "turn/completed",
        payload: {
          threadId: args.conversationId,
          turn: turnPayload,
        },
      });
    }
  }

  return { deltas, diagnostics };
}

function extractThreadReadTurns(response: unknown): SnapshotTurn[] {
  if (!isUnknownRecord(response)) {
    throw new Error("[E_IMPORT_THREAD_READ_FAILED][UNKNOWN] thread/read failed");
  }
  const error = isUnknownRecord(response.error) ? response.error : null;
  if (error) {
    const code = typeof error.code === "number" ? String(error.code) : "UNKNOWN";
    const message = typeof error.message === "string" ? error.message : "thread/read failed";
    throw new Error(`[E_IMPORT_THREAD_READ_FAILED][${code}] ${message}`);
  }
  const result = isUnknownRecord(response.result) ? response.result : null;
  const thread = result && isUnknownRecord(result.thread) ? result.thread : null;
  const turns = thread && Array.isArray(thread.turns) ? thread.turns : [];
  return turns.map((turn) => asSnapshotTurn(turn)).filter((turn): turn is SnapshotTurn => turn !== null);
}

export function createCodexHostRuntime(args: CreateCodexHostRuntimeArgs): CodexHostRuntime {
  if (!args || typeof args !== "object") {
    throw new Error("[E_RUNTIME_CONFIG_INVALID] Runtime factory expects an object argument.");
  }

  const persistence = args.persistence ?? createCodexOnlyPersistence();

  const lifecycleSubscribers = new Set<(state: HostRuntimeState) => void>();
  let lifecycleSnapshot: HostRuntimeState;
  const notifyLifecycle = (state: HostRuntimeState) => {
    lifecycleSnapshot = state;
    for (const listener of lifecycleSubscribers) {
      listener(state);
    }
  };

  const core = createRuntimeCore({
    persistence,
    handlers: {
      onState: (state) => {
        notifyLifecycle(state);
        args.handlers?.onState?.(state);
      },
      ...(args.handlers?.onEvent ? { onEvent: args.handlers.onEvent } : {}),
      ...(args.handlers?.onGlobalMessage ? { onGlobalMessage: args.handlers.onGlobalMessage } : {}),
      ...(args.handlers?.onProtocolError ? { onProtocolError: args.handlers.onProtocolError } : {}),
    },
  });
  lifecycleSnapshot = core.getState();

  const connect = async (connectArgs: HostRuntimeConnectArgs): Promise<void> => {
    if (core.bridge) { core.emitState(); return; }
    core.setLifecycle("starting", "runtime");
    core.actor = connectArgs.actor ?? { anonymousId: randomSessionId() };
    const rawSessionId = connectArgs.sessionId;
    core.sessionId = rawSessionId ? `${rawSessionId}-${randomSessionId()}` : randomSessionId();
    core.conversationId = null;
    core.startupModel = connectArgs.model;
    core.startupCwd = connectArgs.cwd;
    core.ingestFlushMs = connectArgs.ingestFlushMs ?? 250;
    core.resetIngestMetrics();
    core.emitState(null);

    const bridgeConfig: RuntimeBridgeConfig = {};
    if (args.bridge?.codexBin !== undefined) bridgeConfig.codexBin = args.bridge.codexBin;
    const resolvedCwd = connectArgs.cwd ?? args.bridge?.cwd;
    if (resolvedCwd !== undefined) bridgeConfig.cwd = resolvedCwd;

    const bridgeHandlers: RuntimeBridgeHandlers = {
      onEvent: async (event) => {
        try { await core.handleBridgeEvent(event); }
        catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const coded = core.runtimeError("E_RUNTIME_PROTOCOL_EVENT_INVALID", `Failed to process event "${event.kind}": ${reason}`);
          args.handlers?.onProtocolError?.({ message: coded.message, line: event.payloadJson });
        }
      },
      onGlobalMessage: async (message) => { await core.handleBridgeGlobalMessage(message); },
      onProtocolError: async ({ line, error }) => {
        const message = error instanceof Error ? error.message : String(error);
        core.setProtocolError(message); core.emitState();
        args.handlers?.onProtocolError?.({ message, line });
      },
      onProcessExit: (code) => {
        core.clearFlushTimer();
        core.clearPendingServerRequestRetryTimer();
        core.rejectAllPending();
        core.resetAll();
        core.setProcessExitError(code ?? "unknown");
        core.emitState();
      },
    };
    if (!args.bridgeFactory) {
      throw new Error(
        "Bridge factory is required. Install @zakstam/codex-runtime-bridge-tauri and pass bridgeFactory.",
      );
    }
    const bridge = args.bridgeFactory(bridgeConfig, bridgeHandlers);
    core.bridge = bridge;
    bridge.start();

    core.sendMessage(buildInitializeRequestWithCapabilities(core.requestIdFn(), { name: "codex_local_host_runtime", title: "Codex Local Host Runtime", version: clientPackage.version }, { experimentalApi: Array.isArray(connectArgs.dynamicTools) && connectArgs.dynamicTools.length > 0 }), "initialize");
    core.sendMessage(buildInitializedNotification());
    core.setLifecycle("running", "runtime");
    core.emitState(null);
  };

  const openThread: CodexHostRuntime["openThread"] = async (openArgs: HostRuntimeOpenThreadArgs) => {
    if (!core.bridge) throw new Error("Bridge not started. Connect runtime first.");
    core.throwIfTurnMutationLocked();
    const strategy = openArgs.strategy;
    const normalizedConversationId = openArgs.conversationId?.trim();
    const normalizedPersistedConversationId = openArgs.persistedConversationId?.trim();
    core.preferPersistedConversationBinding = false;
    if (normalizedPersistedConversationId && normalizedPersistedConversationId.length > 0) {
      core.conversationId = normalizedPersistedConversationId;
      core.preferPersistedConversationBinding = true;
    }
    if ((strategy === "resume" || strategy === "fork") && (!normalizedConversationId || normalizedConversationId.length === 0)) {
      throw new Error(`conversationId is required when strategy="${strategy}".`);
    }
    if (strategy === "start") {
      const response = await core.sendRequest(buildThreadStartRequest(core.requestIdFn(), {
        ...(openArgs.model ? { model: openArgs.model } : {}),
        ...(openArgs.cwd ? { cwd: openArgs.cwd } : {}),
        ...(openArgs.dynamicTools ? { dynamicTools: openArgs.dynamicTools } : {}),
      }));
      return response;
    }
    if (strategy === "resume") {
      const response = await core.sendRequest(buildThreadResumeRequest(core.requestIdFn(), {
        threadId: normalizedConversationId!,
        ...(openArgs.model ? { model: openArgs.model } : {}),
        ...(openArgs.cwd ? { cwd: openArgs.cwd } : {}),
        ...(openArgs.dynamicTools ? { dynamicTools: openArgs.dynamicTools } : {}),
      }));
      return response;
    }
    return core.sendRequest(buildThreadForkRequest(core.requestIdFn(), {
      threadId: normalizedConversationId!,
      ...(openArgs.model ? { model: openArgs.model } : {}),
      ...(openArgs.cwd ? { cwd: openArgs.cwd } : {}),
    }));
  };

  const stop = async () => {
    core.setLifecycle("stopping", "runtime");
    core.emitState();
    core.clearFlushTimer();
    core.clearPendingServerRequestRetryTimer();
    let flushError: unknown = null;
    try {
      await core.flushQueue();
    } catch (error) {
      flushError = error;
      args.handlers?.onProtocolError?.({
        message: `Runtime stop flush failed: ${error instanceof Error ? error.message : String(error)}`,
        line: "[runtime:stop]",
      });
    } finally {
      core.rejectAllPending();
      core.bridge?.stop();
      core.resetAll();
      core.setLifecycle("stopped", "runtime");
      core.resetIngestMetrics();
      core.emitState(null);
    }
    if (flushError) {
      throw flushError;
    }
  };

  const sendTurn: CodexHostRuntime["sendTurn"] = async (text) => {
    if (!core.bridge) throw new Error("Bridge/thread not ready. Start runtime first.");
    if (!core.runtimeConversationId) throw core.runtimeError("E_RUNTIME_THREAD_NOT_OPEN", "Cannot send turn before opening a thread.");
    if (core.turnInFlight && !core.turnSettled) throw core.runtimeError("E_RUNTIME_DISPATCH_TURN_IN_FLIGHT", "A turn is already in flight.");
    await core.ensureThreadBinding(core.runtimeConversationId);
    const accepted = await core.acceptTurnSend(text);
    try {
      await core.processDispatchQueue();
    } catch (error) {
      if (core.actor && core.threadId) {
        const reason = error instanceof Error ? error.message : String(error);
        await core.failAcceptedTurnSend({
          actor: core.actor,
          threadId: core.threadId,
          dispatchId: accepted.dispatchId,
          turnId: accepted.turnId,
          code: "TURN_DISPATCH_CLAIM_FAILED",
          reason,
        });
      }
      throw error;
    }
    return { turnId: accepted.turnId, accepted: true };
  };

  const steerTurn: CodexHostRuntime["steerTurn"] = async (text, options) => {
    if (!core.bridge) throw new Error("Bridge/thread not ready. Start runtime first.");
    if (!core.turnInFlight || core.turnSettled) {
      throw new Error("Cannot steer turn because no turn is currently in flight.");
    }
    const activePersistedTurnId = core.turnId;
    if (!activePersistedTurnId) throw new Error("Cannot steer turn before active turn id is known.");
    const activeRuntimeTurnId = core.runtimeTurnId;
    if (!activeRuntimeTurnId) throw new Error("Cannot steer turn before runtime turn id is known.");
    let expectedTurnId = activePersistedTurnId;
    if (options && options.expectedTurnId !== undefined && options.expectedTurnId !== null) {
      expectedTurnId = options.expectedTurnId;
    }
    if (expectedTurnId !== activePersistedTurnId) {
      throw new Error(`Cannot steer turn ${expectedTurnId}; active turn is ${activePersistedTurnId}.`);
    }
    let threadId = core.runtimeConversationId;
    if (threadId === undefined || threadId === null) {
      threadId = core.threadId;
    }
    if (!threadId) throw new Error("Cannot steer turn before thread id is available.");
    await core.ensureThreadBinding(threadId);
    core.sendMessage(buildTurnSteerTextRequest(core.requestIdFn(), {
      threadId,
      expectedTurnId: activeRuntimeTurnId,
      text,
    }), "turn/steer");
  };

  const interrupt = () => {
    if (!core.bridge || !core.runtimeConversationId) return;
    if (!core.runtimeTurnId) { core.interruptRequested = true; return; }
    core.sendMessage(buildTurnInterruptRequest(core.requestIdFn(), { threadId: core.runtimeConversationId, turnId: core.runtimeTurnId }), "turn/interrupt");
  };

  const resumeThread: CodexHostRuntime["resumeThread"] = async (tid, params) => {
    core.throwIfTurnMutationLocked();
    core.preferPersistedConversationBinding = false;
    return core.sendRequest(buildThreadResumeRequest(core.requestIdFn(), { threadId: tid, ...(params ?? {}) }));
  };
  const forkThread: CodexHostRuntime["forkThread"] = async (tid, params) => {
    core.throwIfTurnMutationLocked();
    core.preferPersistedConversationBinding = false;
    return core.sendRequest(buildThreadForkRequest(core.requestIdFn(), { threadId: tid, ...(params ?? {}) }));
  };
  const archiveThread: CodexHostRuntime["archiveThread"] = async (tid) => {
    core.throwIfTurnMutationLocked();
    return core.sendRequest(buildThreadArchiveRequest(core.requestIdFn(), { threadId: tid }));
  };
  const setThreadName: CodexHostRuntime["setThreadName"] = async (tid, name) => {
    core.throwIfTurnMutationLocked();
    return core.sendRequest(buildThreadSetNameRequest(core.requestIdFn(), { threadId: tid, name }));
  };
  const unarchiveThread: CodexHostRuntime["unarchiveThread"] = async (tid) => {
    core.throwIfTurnMutationLocked();
    return core.sendRequest(buildThreadUnarchiveRequest(core.requestIdFn(), { threadId: tid }));
  };
  const compactThread: CodexHostRuntime["compactThread"] = async (tid) => {
    core.throwIfTurnMutationLocked();
    return core.sendRequest(buildThreadCompactStartRequest(core.requestIdFn(), { threadId: tid }));
  };
  const rollbackThread: CodexHostRuntime["rollbackThread"] = async (tid, n) => {
    core.throwIfTurnMutationLocked();
    return core.sendRequest(buildThreadRollbackRequest(core.requestIdFn(), { threadId: tid, numTurns: n }));
  };
  const readThread: CodexHostRuntime["readThread"] = async (tid, includeTurns = false) =>
    core.sendRequest(buildThreadReadRequest(core.requestIdFn(), { threadId: tid, includeTurns }));
  const importLocalThreadToPersistence: CodexHostRuntime["importLocalThreadToPersistence"] = async (
    importArgs: HostRuntimeImportLocalThreadArgs,
  ): Promise<HostRuntimeImportLocalThreadResult> => {
    if (!core.bridge) {
      throw new Error("[E_IMPORT_THREAD_BRIDGE_NOT_READY] Bridge not started. Connect runtime first.");
    }
    if (!core.actor) {
      throw new Error("[E_IMPORT_THREAD_ACTOR_MISSING] Actor is required before importing local threads.");
    }
    const actor = core.actor;
    const runtimeThreadHandle = importArgs.runtimeThreadHandle.trim();
    if (runtimeThreadHandle.length === 0) {
      throw new Error("[E_IMPORT_THREAD_HANDLE_REQUIRED] runtimeThreadHandle is required.");
    }
    const targetConversationId = importArgs.conversationId?.trim() || runtimeThreadHandle;
    const snapshotResponse = await readThread(runtimeThreadHandle, true);
    const turns = extractThreadReadTurns(snapshotResponse);
    const importedTurnCount = turns.filter((turn) => typeof turn.id === "string").length;
    const canonicalManifest = extractCanonicalMessageManifestFromSnapshotTurns(turns);
    const importedMessageCount = canonicalManifest.length;
    const expectedManifestJson = JSON.stringify(canonicalManifest);

    const ensuredThread = await persistence.ensureThread({
      actor,
      conversationId: targetConversationId,
      runtimeConversationId: runtimeThreadHandle,
      ...(core.startupModel ? { model: core.startupModel } : {}),
      ...(core.startupCwd ? { cwd: core.startupCwd } : {}),
    });
    const trimmedSessionId = importArgs.sessionId?.trim();
    const importSessionId = trimmedSessionId && trimmedSessionId.length > 0
      ? trimmedSessionId
      : `thread-import-${randomSessionId()}`;
    await persistence.ensureSession({
      actor,
      sessionId: importSessionId,
      threadId: ensuredThread.threadId,
      lastEventCursor: 0,
    });

    const { deltas, diagnostics } = buildThreadImportDeltas({
      snapshotId: randomSessionId(),
      conversationId: targetConversationId,
      turns,
    });
    const importWarnings: string[] = [];
    if (diagnostics.generatedMessageIds > 0) {
      importWarnings.push(`W_IMPORT_THREAD_GENERATED_MESSAGE_IDS:${diagnostics.generatedMessageIds}`);
    }
    if (diagnostics.skippedMissingType > 0) {
      importWarnings.push(`W_IMPORT_THREAD_SKIPPED_ITEMS_MISSING_TYPE:${diagnostics.skippedMissingType}`);
    }
    if (deltas.length === 0) {
      const emptySource = await persistence.startConversationSyncSource({
        actor,
        conversationId: targetConversationId,
        runtimeConversationId: runtimeThreadHandle,
        threadId: ensuredThread.threadId,
      });
      const emptyJob = await persistence.sealConversationSyncSource({
        actor,
        sourceId: emptySource.sourceId,
        expectedChecksum: "0:0:0",
        expectedMessageCount: importedMessageCount,
        expectedManifestJson,
      });
      const emptyTerminal = await persistence.waitForConversationSyncJobTerminal({
        actor,
        conversationId: targetConversationId,
        jobId: emptyJob.jobId,
      });
      return {
        conversationId: targetConversationId,
        threadId: ensuredThread.threadId,
        syncJobId: emptyJob.jobId,
        syncJobPolicyVersion: emptySource.policyVersion,
        syncJobState: emptyTerminal.state,
        lastCursor: emptyTerminal.lastCursor,
        ...(emptyTerminal.lastErrorCode ? { errorCode: emptyTerminal.lastErrorCode } : {}),
        importedTurnCount,
        importedMessageCount,
        syncState: "synced",
        warnings: importWarnings,
      };
    }

    const source = await persistence.startConversationSyncSource({
      actor,
      conversationId: targetConversationId,
      runtimeConversationId: runtimeThreadHandle,
      threadId: ensuredThread.threadId,
    });
    let totalChunkCount = 0;
    let totalChunkMessageCount = 0;
    let totalChunkByteSize = 0;
    for (let offset = 0; offset < deltas.length; offset += IMPORT_THREAD_SOURCE_CHUNK_SIZE) {
      const chunk = deltas.slice(offset, offset + IMPORT_THREAD_SOURCE_CHUNK_SIZE);
      const messageCount = chunk.reduce((count, delta) => {
        if (delta.type !== "stream_delta" || delta.kind !== "item/completed") {
          return count;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(delta.payloadJson);
        } catch (_error) {
          return count;
        }
        if (typeof parsed !== "object" || parsed === null) {
          return count;
        }
        const params = (parsed as { params?: unknown }).params;
        if (typeof params !== "object" || params === null) {
          return count;
        }
        const item = (params as { item?: unknown }).item;
        if (typeof item !== "object" || item === null) {
          return count;
        }
        const itemType = normalizeImportItemType((item as { type?: unknown }).type);
        if (!itemType || !isRenderableImportMessageType(itemType)) {
          return count;
        }
        return count + 1;
      }, 0);
      const payloadJson = JSON.stringify(chunk);
      totalChunkCount += 1;
      totalChunkMessageCount += messageCount;
      totalChunkByteSize += payloadJson.length;
      await persistence.appendConversationSyncSourceChunk({
        actor,
        sourceId: source.sourceId,
        chunkIndex: Math.floor(offset / IMPORT_THREAD_SOURCE_CHUNK_SIZE),
        payloadJson,
        messageCount,
        byteSize: payloadJson.length,
      });
    }

    const expectedChecksum = `${totalChunkCount}:${totalChunkMessageCount}:${totalChunkByteSize}`;
    const job = await persistence.sealConversationSyncSource({
      actor,
      sourceId: source.sourceId,
      expectedChecksum,
      expectedMessageCount: importedMessageCount,
      expectedManifestJson,
    });

    const terminal = await persistence.waitForConversationSyncJobTerminal({
      actor,
      conversationId: targetConversationId,
      jobId: job.jobId,
    });
    const warnings: string[] = [...importWarnings];
    if (terminal.lastErrorCode) {
      warnings.push(`${terminal.lastErrorCode}:${terminal.lastErrorMessage ?? ""}`);
    }
    const hasPartial = terminal.state !== "synced";
    return {
      conversationId: targetConversationId,
      threadId: ensuredThread.threadId,
      syncJobId: job.jobId,
      syncJobPolicyVersion: source.policyVersion,
      syncJobState: terminal.state,
      lastCursor: terminal.lastCursor,
      ...(terminal.lastErrorCode ? { errorCode: terminal.lastErrorCode } : {}),
      importedTurnCount,
      importedMessageCount,
      syncState: hasPartial ? "partial" : "synced",
      warnings,
    };
  };
  const readAccount: CodexHostRuntime["readAccount"] = async (params) =>
    core.sendRequest(buildAccountReadRequest(core.requestIdFn(), params));
  const loginAccount: CodexHostRuntime["loginAccount"] = async (params) =>
    core.sendRequest(buildAccountLoginStartRequest(core.requestIdFn(), params));
  const cancelAccountLogin: CodexHostRuntime["cancelAccountLogin"] = async (params) =>
    core.sendRequest(buildAccountLoginCancelRequest(core.requestIdFn(), params));
  const logoutAccount: CodexHostRuntime["logoutAccount"] = async () =>
    core.sendRequest(buildAccountLogoutRequest(core.requestIdFn()));
  const readAccountRateLimits: CodexHostRuntime["readAccountRateLimits"] = async () =>
    core.sendRequest(buildAccountRateLimitsReadRequest(core.requestIdFn()));
  const listThreads: CodexHostRuntime["listThreads"] = async (params) => {
    const response = await core.sendRequest(buildThreadListRequest(core.requestIdFn(), params));
    const normalized = normalizeThreadListResponse(response);
    if (normalized.data.length === 0) {
      return normalized;
    }

    const enriched = [...normalized.data];
    const maxConcurrentReads = 4;
    let nextIndex = 0;
    const workerCount = Math.min(maxConcurrentReads, enriched.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= enriched.length) {
          return;
        }
        const thread = enriched[currentIndex];
        if (!thread) {
          continue;
        }
        try {
          const threadId = thread.threadId;
          const readResponse = await core.sendRequest(
            buildThreadReadRequest(core.requestIdFn(), {
              threadId,
              includeTurns: true,
            }),
          );
          enriched[currentIndex] = {
            ...thread,
            messageCount: extractThreadMessageCountFromReadResponse(readResponse),
          };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          args.handlers?.onProtocolError?.({
            message: `Failed to enrich thread messageCount for ${thread.threadId}: ${reason}`,
            line: "[runtime:listThreads]",
          });
          enriched[currentIndex] = {
            ...thread,
            messageCount: thread.messageCount,
          };
        }
      }
    });

    await Promise.all(workers);

    return {
      ...normalized,
      data: enriched,
    };
  };
  const listLoadedThreads: CodexHostRuntime["listLoadedThreads"] = async (params) =>
    core.sendRequest(buildThreadLoadedListRequest(core.requestIdFn(), params));
  const newConversation: CodexHostRuntime["newConversation"] = async (params) =>
    core.sendRequest(buildNewConversationRequest(core.requestIdFn(), params));
  const resumeConversation: CodexHostRuntime["resumeConversation"] = async (params) =>
    core.sendRequest(buildResumeConversationRequest(core.requestIdFn(), params));
  const listConversations: CodexHostRuntime["listConversations"] = async (params) =>
    core.sendRequest(buildListConversationsRequest(core.requestIdFn(), params));
  const forkConversation: CodexHostRuntime["forkConversation"] = async (params) =>
    core.sendRequest(buildForkConversationRequest(core.requestIdFn(), params));
  const archiveConversation: CodexHostRuntime["archiveConversation"] = async (params) =>
    core.sendRequest(buildArchiveConversationRequest(core.requestIdFn(), params));
  const interruptConversation: CodexHostRuntime["interruptConversation"] = async (params) =>
    core.sendRequest(buildInterruptConversationRequest(core.requestIdFn(), params));
  const getConversationSummary: CodexHostRuntime["getConversationSummary"] = async (params) =>
    core.sendRequest(buildGetConversationSummaryRequest(core.requestIdFn(), params));

  const respondCommandApproval: CodexHostRuntime["respondCommandApproval"] = async (a) => {
    const p = core.getPendingServerRequest(a.requestId);
    if (p.method !== "item/commandExecution/requestApproval") throw new Error(`Server request ${String(a.requestId)} is ${p.method}, expected item/commandExecution/requestApproval`);
    await core.sendServerRequestResponse(a.requestId, buildCommandExecutionApprovalResponse(a.requestId, a.decision));
  };
  const respondFileChangeApproval: CodexHostRuntime["respondFileChangeApproval"] = async (a) => {
    const p = core.getPendingServerRequest(a.requestId);
    if (p.method !== "item/fileChange/requestApproval") throw new Error(`Server request ${String(a.requestId)} is ${p.method}, expected item/fileChange/requestApproval`);
    await core.sendServerRequestResponse(a.requestId, buildFileChangeApprovalResponse(a.requestId, a.decision));
  };
  const respondToolUserInput: CodexHostRuntime["respondToolUserInput"] = async (a) => {
    const p = core.getPendingServerRequest(a.requestId);
    if (p.method !== "item/tool/requestUserInput") throw new Error(`Server request ${String(a.requestId)} is ${p.method}, expected item/tool/requestUserInput`);
    await core.sendServerRequestResponse(a.requestId, buildToolRequestUserInputResponse(a.requestId, a.answers));
  };
  const respondDynamicToolCall: CodexHostRuntime["respondDynamicToolCall"] = async (a) => {
    const p = core.getPendingServerRequest(a.requestId);
    if (p.method !== "item/tool/call") throw new Error(`Server request ${String(a.requestId)} is ${p.method}, expected item/tool/call`);
    await core.sendServerRequestResponse(a.requestId, buildDynamicToolCallResponse(a.requestId, { success: a.success, contentItems: a.contentItems }));
  };
  const respondChatgptAuthTokensRefresh: CodexHostRuntime["respondChatgptAuthTokensRefresh"] = async (a) => {
    core.getPendingAuthTokensRefreshRequest(a.requestId);
    core.sendMessage(buildChatgptAuthTokensRefreshResponse(a.requestId, { accessToken: a.accessToken, chatgptAccountId: a.chatgptAccountId, chatgptPlanType: a.chatgptPlanType ?? null }));
    core.resolvePendingAuthTokensRefreshRequest(a.requestId);
  };

  return {
    connect, openThread, stop, sendTurn, steerTurn, interrupt,
    resumeThread, forkThread, archiveThread, setThreadName, unarchiveThread, compactThread, rollbackThread,
    readThread, importLocalThreadToPersistence, readAccount, loginAccount, cancelAccountLogin, logoutAccount,
    readAccountRateLimits, listThreads, listLoadedThreads,
    newConversation, resumeConversation, listConversations, forkConversation, archiveConversation,
    interruptConversation, getConversationSummary,
    listPendingServerRequests: core.listPendingServerRequests,
    respondCommandApproval, respondFileChangeApproval, respondToolUserInput,
    respondDynamicToolCall, respondChatgptAuthTokensRefresh,
    getState: core.getState,
    getLifecycleState: () => lifecycleSnapshot,
    subscribeLifecycle: (listener) => {
      lifecycleSubscribers.add(listener);
      listener(lifecycleSnapshot);
      return () => {
        lifecycleSubscribers.delete(listener);
      };
    },
  };
}
