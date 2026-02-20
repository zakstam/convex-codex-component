/**
 * Public CodexHostRuntime factory.
 * Delegates internal state management to runtimeCore.ts.
 */
import {
  buildAccountLoginCancelRequest,
  buildAccountLoginStartRequest,
  buildAccountLogoutRequest,
  buildAccountRateLimitsReadRequest,
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
  buildThreadReadRequest,
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
} from "../app-server/client.js";
import clientPackage from "../../package.json" with { type: "json" };
import { CodexLocalBridge, type BridgeConfig } from "../local-adapter/bridge.js";
import { randomSessionId } from "./runtimeHelpers.js";
import { createRuntimeCore } from "./runtimeCore.js";
import { createConvexPersistence, type ConvexPersistenceChatApi, type ConvexPersistenceOptions } from "./convexPersistence.js";
import type {
  HostRuntimeConnectArgs,
  HostRuntimeOpenThreadArgs,
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
  type HostRuntimeLifecycleListener,
  type HostRuntimeLifecyclePhase,
  type HostRuntimeLifecycleSource,
  type HostRuntimePersistence,
  type HostRuntimePersistedServerRequest,
  type HostRuntimeConnectArgs,
  type HostRuntimeOpenThreadArgs,
  type HostRuntimeState,
} from "./runtimeTypes.js";
export type { ConvexPersistenceChatApi, ConvexPersistenceOptions } from "./convexPersistence.js";

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
    core.threadHandle = null;
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
    if ((strategy === "resume" || strategy === "fork") && !openArgs.threadHandle) {
      throw new Error(`threadHandle is required when strategy="${strategy}".`);
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
        threadId: openArgs.threadHandle!,
        ...(openArgs.model ? { model: openArgs.model } : {}),
        ...(openArgs.cwd ? { cwd: openArgs.cwd } : {}),
        ...(openArgs.dynamicTools ? { dynamicTools: openArgs.dynamicTools } : {}),
      }));
      return response;
    }
    return core.sendRequest(buildThreadForkRequest(core.requestIdFn(), {
      threadId: openArgs.threadHandle!,
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
    if (!core.runtimeThreadId) throw core.runtimeError("E_RUNTIME_THREAD_NOT_OPEN", "Cannot send turn before opening a thread.");
    if (core.turnInFlight && !core.turnSettled) throw core.runtimeError("E_RUNTIME_DISPATCH_TURN_IN_FLIGHT", "A turn is already in flight.");
    await core.ensureThreadBinding(core.runtimeThreadId);
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
    let threadId = core.runtimeThreadId;
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
    if (!core.bridge || !core.runtimeThreadId) return;
    if (!core.turnId) { core.interruptRequested = true; return; }
    core.sendMessage(buildTurnInterruptRequest(core.requestIdFn(), { threadId: core.runtimeThreadId, turnId: core.turnId }), "turn/interrupt");
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
    readThread, readAccount, loginAccount, cancelAccountLogin, logoutAccount,
    readAccountRateLimits, listThreads, listLoadedThreads,
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
