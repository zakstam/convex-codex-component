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
import { CodexLocalBridge, type BridgeConfig } from "../../local-adapter/bridge.js";
import { randomSessionId } from "./runtimeHelpers.js";
import { createRuntimeCore } from "./runtimeCore.js";
import {
  createConvexPersistence,
  type ConvexPersistenceChatApi,
  type ConvexPersistenceOptions,
} from "../persistence/convex/convexPersistence.js";
import type {
  HostRuntimeConnectArgs,
  HostRuntimeImportLocalThreadArgs,
  HostRuntimeImportLocalThreadResult,
  HostRuntimeOpenThreadArgs,
  IngestDelta,
  HostRuntimePersistence,
  HostRuntimeHandlers,
  HostRuntimeState,
  RuntimeBridge,
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
  type HostRuntimeConnectArgs,
  type HostRuntimeOpenThreadArgs,
  type HostRuntimeState,
} from "./runtimeTypes.js";
export type { ConvexPersistenceChatApi, ConvexPersistenceOptions } from "../persistence/convex/convexPersistence.js";

type ManualPersistenceArgs = {
  bridge?: BridgeConfig;
  bridgeFactory?: (config: BridgeConfig, handlers: RuntimeBridgeHandlers) => RuntimeBridge;
  persistence: HostRuntimePersistence;
  handlers?: HostRuntimeHandlers;
};

type ConvexIntegratedArgs = {
  bridge?: BridgeConfig;
  bridgeFactory?: (config: BridgeConfig, handlers: RuntimeBridgeHandlers) => RuntimeBridge;
  convexUrl: string;
  chatApi: ConvexPersistenceChatApi;
  userId: string;
  persistenceOptions?: ConvexPersistenceOptions;
  handlers?: HostRuntimeHandlers;
};

export type CreateCodexHostRuntimeArgs = ManualPersistenceArgs | ConvexIntegratedArgs;

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

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
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

function buildThreadImportDeltas(args: {
  snapshotId: string;
  conversationId: string;
  turns: SnapshotTurn[];
}): IngestDelta[] {
  const deltas: IngestDelta[] = [];
  let cursor = 0;
  let createdAtMs = Date.now();

  const push = (deltaArgs: {
    turnId: string;
    streamSuffix: string;
    kind: string;
    payload: Record<string, unknown>;
  }) => {
    const cursorStart = cursor;
    const cursorEnd = cursor + 1;
    cursor = cursorEnd;
    deltas.push({
      type: "stream_delta",
      eventId: `thread-import:${args.snapshotId}:${args.conversationId}:${deltaArgs.turnId}:${cursorEnd}`,
      turnId: deltaArgs.turnId,
      streamId: `thread-import:${args.snapshotId}:${args.conversationId}:${deltaArgs.turnId}:${deltaArgs.streamSuffix}`,
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
      streamSuffix: "turn",
      kind: "turn/started",
      payload: {
        threadId: args.conversationId,
        turn: turnPayload,
      },
    });
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const item of items) {
      const itemId = typeof item.id === "string" ? item.id : null;
      const itemType = typeof item.type === "string" ? item.type : null;
      if (!itemId || !itemType) {
        continue;
      }
      push({
        turnId,
        streamSuffix: `item:${itemId}`,
        kind: "item/completed",
        payload: {
          threadId: args.conversationId,
          turnId,
          item,
        },
      });
    }
    if (status !== "inProgress") {
      push({
        turnId,
        streamSuffix: "terminal",
        kind: "turn/completed",
        payload: {
          threadId: args.conversationId,
          turn: turnPayload,
        },
      });
    }
  }

  return deltas;
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

function isConvexIntegrated(args: CreateCodexHostRuntimeArgs): args is ConvexIntegratedArgs {
  return "convexUrl" in args && "chatApi" in args && "userId" in args;
}

export function createCodexHostRuntime(args: CreateCodexHostRuntimeArgs): CodexHostRuntime {
  let persistence: HostRuntimePersistence;
  let defaultActor: { userId: string } | null = null;
  let defaultSessionId: string | null = null;

  if (isConvexIntegrated(args)) {
    const { ConvexHttpClient } = require("convex/browser") as { ConvexHttpClient: new (url: string) => { mutation: (...a: unknown[]) => Promise<unknown>; query: (...a: unknown[]) => Promise<unknown> } };
    const client = new ConvexHttpClient(args.convexUrl);
    const adapter = createConvexPersistence(client, args.chatApi, args.persistenceOptions);
    persistence = adapter;
    defaultActor = { userId: args.userId };
    defaultSessionId = randomSessionId();
  } else {
    persistence = args.persistence;
  }

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
    core.actor = connectArgs.actor ?? defaultActor ?? { userId: "anonymous" };
    const rawSessionId = connectArgs.sessionId ?? defaultSessionId;
    core.sessionId = rawSessionId ? `${rawSessionId}-${randomSessionId()}` : randomSessionId();
    core.conversationId = null;
    core.startupModel = connectArgs.model;
    core.startupCwd = connectArgs.cwd;
    core.ingestFlushMs = connectArgs.ingestFlushMs ?? 250;
    core.resetIngestMetrics();
    core.emitState(null);

    const bridgeConfig: BridgeConfig = {};
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
      onProcessExit: (code) => { core.setProcessExitError(code ?? "unknown"); core.emitState(); },
    };
    core.bridge = args.bridgeFactory
      ? args.bridgeFactory(bridgeConfig, bridgeHandlers)
      : new CodexLocalBridge(bridgeConfig, bridgeHandlers);
    core.bridge.start();

    core.sendMessage(buildInitializeRequestWithCapabilities(core.requestIdFn(), { name: "codex_local_host_runtime", title: "Codex Local Host Runtime", version: clientPackage.version }, { experimentalApi: Array.isArray(connectArgs.dynamicTools) && connectArgs.dynamicTools.length > 0 }), "initialize");
    core.sendMessage(buildInitializedNotification());
    core.setLifecycle("running", "runtime");
    core.emitState(null);
  };

  const openThread: CodexHostRuntime["openThread"] = async (openArgs: HostRuntimeOpenThreadArgs) => {
    if (!core.bridge) throw new Error("Bridge not started. Connect runtime first.");
    const strategy = openArgs.strategy;
    if ((strategy === "resume" || strategy === "fork") && !openArgs.conversationId) {
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
        threadId: openArgs.conversationId!,
        ...(openArgs.model ? { model: openArgs.model } : {}),
        ...(openArgs.cwd ? { cwd: openArgs.cwd } : {}),
        ...(openArgs.dynamicTools ? { dynamicTools: openArgs.dynamicTools } : {}),
      }));
      return response;
    }
    return core.sendRequest(buildThreadForkRequest(core.requestIdFn(), {
      threadId: openArgs.conversationId!,
      ...(openArgs.model ? { model: openArgs.model } : {}),
      ...(openArgs.cwd ? { cwd: openArgs.cwd } : {}),
    }));
  };

  const stop = async () => {
    core.setLifecycle("stopping", "runtime");
    core.emitState();
    core.clearFlushTimer();
    core.clearPendingServerRequestRetryTimer();
    await core.flushQueue();
    core.rejectAllPending();
    core.bridge?.stop();
    core.resetAll();
    core.setLifecycle("stopped", "runtime");
    core.resetIngestMetrics();
    core.emitState(null);
  };

  const sendTurn: CodexHostRuntime["sendTurn"] = async (text) => {
    if (!core.bridge) throw new Error("Bridge/thread not ready. Start runtime first.");
    if (!core.runtimeConversationId) throw core.runtimeError("E_RUNTIME_THREAD_NOT_OPEN", "Cannot send turn before opening a thread.");
    if (core.turnInFlight && !core.turnSettled) throw core.runtimeError("E_RUNTIME_DISPATCH_TURN_IN_FLIGHT", "A turn is already in flight.");
    await core.ensureThreadBinding(core.runtimeConversationId);
    const accepted = await core.acceptTurnSend(text);
    await core.processDispatchQueue();
    return accepted;
  };

  const steerTurn: CodexHostRuntime["steerTurn"] = async (text, options) => {
    if (!core.bridge) throw new Error("Bridge/thread not ready. Start runtime first.");
    if (!core.turnInFlight || core.turnSettled) {
      throw new Error("Cannot steer turn because no turn is currently in flight.");
    }
    const activeTurnId = core.turnId;
    if (!activeTurnId) throw new Error("Cannot steer turn before active turn id is known.");
    let expectedTurnId = activeTurnId;
    if (options && options.expectedTurnId !== undefined && options.expectedTurnId !== null) {
      expectedTurnId = options.expectedTurnId;
    }
    if (expectedTurnId !== activeTurnId) {
      throw new Error(`Cannot steer turn ${expectedTurnId}; active turn is ${activeTurnId}.`);
    }
    let threadId = core.runtimeConversationId;
    if (threadId === undefined || threadId === null) {
      threadId = core.threadId;
    }
    if (!threadId) throw new Error("Cannot steer turn before thread id is available.");
    await core.ensureThreadBinding(threadId);
    core.sendMessage(buildTurnSteerTextRequest(core.requestIdFn(), {
      threadId,
      expectedTurnId: activeTurnId,
      text,
    }), "turn/steer");
  };

  const interrupt = () => {
    if (!core.bridge || !core.runtimeConversationId) return;
    if (!core.turnId) { core.interruptRequested = true; return; }
    core.sendMessage(buildTurnInterruptRequest(core.requestIdFn(), { threadId: core.runtimeConversationId, turnId: core.turnId }), "turn/interrupt");
  };

  const resumeThread: CodexHostRuntime["resumeThread"] = async (tid, params) => {
    core.throwIfTurnMutationLocked();
    return core.sendRequest(buildThreadResumeRequest(core.requestIdFn(), { threadId: tid, ...(params ?? {}) }));
  };
  const forkThread: CodexHostRuntime["forkThread"] = async (tid, params) => {
    core.throwIfTurnMutationLocked();
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
    const runtimeThreadHandle = importArgs.runtimeThreadHandle.trim();
    if (runtimeThreadHandle.length === 0) {
      throw new Error("[E_IMPORT_THREAD_HANDLE_REQUIRED] runtimeThreadHandle is required.");
    }
    const targetConversationId = importArgs.conversationId?.trim() || runtimeThreadHandle;
    const snapshotResponse = await readThread(runtimeThreadHandle, true);
    const turns = extractThreadReadTurns(snapshotResponse);
    const importedTurnCount = turns.filter((turn) => typeof turn.id === "string").length;
    const importedMessageCount = turns.reduce((count, turn) => {
      const items = Array.isArray(turn.items) ? turn.items : [];
      const next = items.filter(
        (item) => typeof item.id === "string" && typeof item.type === "string",
      ).length;
      return count + next;
    }, 0);

    const ensuredThread = await persistence.ensureThread({
      actor: core.actor,
      conversationId: targetConversationId,
      ...(core.startupModel ? { model: core.startupModel } : {}),
      ...(core.startupCwd ? { cwd: core.startupCwd } : {}),
    });
    const trimmedSessionId = importArgs.sessionId?.trim();
    const importSessionId = trimmedSessionId && trimmedSessionId.length > 0
      ? trimmedSessionId
      : `thread-import-${randomSessionId()}`;
    await persistence.ensureSession({
      actor: core.actor,
      sessionId: importSessionId,
      threadId: ensuredThread.threadId,
      lastEventCursor: 0,
    });

    const deltas = buildThreadImportDeltas({
      snapshotId: randomSessionId(),
      conversationId: targetConversationId,
      turns,
    });
    if (deltas.length === 0) {
      return {
        conversationId: targetConversationId,
        threadId: ensuredThread.threadId,
        importedTurnCount,
        importedMessageCount,
        syncState: "synced",
        warnings: [],
      };
    }

    const ingest = await persistence.ingestSafe({
      actor: core.actor,
      sessionId: importSessionId,
      threadId: ensuredThread.threadId,
      deltas,
    });
    if (ingest.status === "rejected") {
      const reason = ingest.errors.map((error: { code: string; message: string }) => `${error.code}:${error.message}`).join("; ");
      throw new Error(`[E_IMPORT_THREAD_INGEST_FAILED] ${reason.length > 0 ? reason : "Ingest rejected."}`);
    }
    return {
      conversationId: targetConversationId,
      threadId: ensuredThread.threadId,
      importedTurnCount,
      importedMessageCount,
      syncState: ingest.status === "partial" ? "partial" : "synced",
      warnings: ingest.errors.map((error: { code: string; message: string }) => `${error.code}:${error.message}`),
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
  const listThreads: CodexHostRuntime["listThreads"] = async (params) =>
    core.sendRequest(buildThreadListRequest(core.requestIdFn(), params));
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
