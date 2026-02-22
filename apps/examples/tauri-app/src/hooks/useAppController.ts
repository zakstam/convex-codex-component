import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  codexOptimisticPresets,
  createCodexReactPreset,
  useCodex,
  useCodexAccountAuth,
  useCodexOptimisticMutation,
  useCodexRuntimeBridge,
  useCodexThreadState,
} from "@zakstam/codex-local-component/react";
import { api } from "../../convex/_generated/api";
import {
  bridge as tauriBridge,
  subscribeTauriInvokeCapture,
  type ActorContext,
  type BridgeState,
  type LoginAccountParams,
} from "../lib/tauriBridge";
import type { ToastItem } from "../components/Toast";
import { useCodexTauriEvents, type PendingAuthRefreshRequest } from "./useCodexTauriEvents";
import { KNOWN_DYNAMIC_TOOLS, TAURI_RUNTIME_TOOL_PROMPT } from "../lib/dynamicTools";
import {
  classifyReproErrorClasses,
  type TauriReproArtifactV1,
  type TauriReproCaptureCommand,
  type TauriReproObservedEvent,
} from "../lib/reproArtifact";

// ── Constants ────────────────────────────────────────────────────────────────

const ACTOR_STORAGE_KEY = "codex-local-tauri-actor-user-id";
const SHOW_LOCAL_THREADS_STORAGE_KEY = "codex-local-tauri-show-local-threads";
const DEFAULT_DELETE_DELAY_MS = 10 * 60 * 1000;

// ── Shared utility (also used at module scope in App.tsx) ────────────────────

function requireDefined<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing generated Convex reference: ${name}`);
  }
  return value;
}

function requestKey(requestId: string | number): string {
  return `${typeof requestId}:${String(requestId)}`;
}

const chatApi = requireDefined(api.chat, "api.chat");
const reactApi = createCodexReactPreset(chatApi);

export { chatApi, reactApi, requestKey, requireDefined, ACTOR_STORAGE_KEY };

const sessionId = crypto.randomUUID();

// ── Types used by hook logic ─────────────────────────────────────────────────

export type ToolQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
};

export type PendingServerRequest = {
  requestId: string | number;
  method:
    | "item/commandExecution/requestApproval"
    | "item/fileChange/requestApproval"
    | "item/tool/requestUserInput"
    | "item/tool/call";
  conversationId: string;
  turnId: string;
  itemId: string;
  reason?: string;
  questions?: ToolQuestion[];
};

export type RuntimeThreadBindingRow = {
  runtimeConversationId: string;
  conversationId: string;
};

export type LocalRuntimeThreadRow = {
  conversationId: string;
  preview: string;
  messageCount: number;
};

// ── Hook props ───────────────────────────────────────────────────────────────

export type UseAppControllerProps = {
  actor: ActorContext;
  actorReady: boolean;
  preferredBoundUserId: string | null;
  onActorChange: (userId: string) => void;
  requestConfirm: (message: string) => Promise<boolean>;
};

// ── Hook return type ─────────────────────────────────────────────────────────

export type UseAppControllerReturn = {
  /** Bridge state (running, conversationId, etc.) and runtime log entries. */
  bridge: BridgeState;
  runtimeLog: Array<{ id: string; line: string }>;

  /** Conversation state from useCodex. */
  conversation: ReturnType<typeof useCodex>;
  displayMessages: Array<ReturnType<typeof useCodex>["messages"]["results"][number]>;
  latestReasoning: ReturnType<typeof useCodex>["messages"]["results"][number] | null;
  selectedConversationId: string;
  tokenByTurnId: Map<string, { totalTokens: number; inputTokens: number; outputTokens: number }>;

  /** Thread picker state. */
  pickerThreads: Array<{
    conversationId: string;
    status: string;
    preview: string;
    scope: "persisted" | "local_unsynced";
    updatedAt?: number;
    messageCount?: number;
  }>;
  showLocalThreads: boolean;
  onToggleShowLocalThreads: (next: boolean) => Promise<void>;
  onSelectConversationId: (nextConversationId: string) => Promise<void>;

  /** Approval state. */
  pendingServerRequests: PendingServerRequest[];
  submittingRequestKey: string | null;
  toolDrafts: Record<string, Record<string, string>>;
  toolOtherDrafts: Record<string, Record<string, string>>;
  onRespondCommandOrFile: (
    request: PendingServerRequest,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) => Promise<void>;
  onRespondToolUserInput: (request: PendingServerRequest) => Promise<void>;
  setToolSelected: (request: PendingServerRequest, questionId: string, value: string) => void;
  setToolOther: (request: PendingServerRequest, questionId: string, value: string) => void;

  /** Auth state. */
  authSummary: string;
  pendingAuthRefresh: PendingAuthRefreshRequest[];
  apiKey: string;
  setApiKey: (value: string) => void;
  chatgptAccountId: string;
  setChatgptAccountId: (value: string) => void;
  chatgptPlanType: string;
  setChatgptPlanType: (value: string) => void;
  accessToken: string;
  setAccessToken: (value: string) => void;
  cancelLoginId: string;
  setCancelLoginId: (value: string) => void;
  accountAuthIsBusy: boolean;
  onAccountRead: (refreshToken: boolean) => void;
  onLoginApiKey: () => void;
  onLoginChatgpt: () => void;
  onLoginChatgptTokens: () => void;
  onCancelLogin: () => void;
  onLogout: () => void;
  onReadRateLimits: () => void;
  onRespondAuthRefresh: (requestId: string | number) => void;

  /** Cleanup / deletion state. */
  onHardDeleteThread: (conversationId: string) => Promise<void>;
  onDeleteCurrentThread: () => Promise<void>;
  onDeleteLatestTurn: () => Promise<void>;
  onPurgeActorData: () => Promise<void>;
  onUndoScheduledDeletion: () => Promise<void>;
  onForceScheduledDeletion: () => Promise<void>;
  deletionStatus: {
    status?: string;
    phase?: string;
    scheduledFor?: number;
    errorMessage?: string;
  } | undefined;
  activeDeletionJobId: string | null;
  activeDeletionLabel: string | null;
  scheduledDeleteCountdown: number | null;
  cleanupConversationId: string | null;
  latestThreadTurnId: string | null;

  /** Repro recording state. */
  reproRecording: boolean;
  reproCommandCount: number;
  reproObservedCount: number;
  lastCapturedInvokeCommand: string | null;
  lastReproArtifactName: string | null;
  startReproRecording: () => void;
  stopReproRecording: () => void;
  exportReproRecording: () => void;

  /** Tool policy. */
  onSetDisabledTools: (nextTools: string[]) => Promise<void>;
  onInsertDynamicToolPrompt: () => void;

  /** Toast state. */
  toasts: ToastItem[];
  addToast: (type: ToastItem["type"], message: string) => void;
  dismissToast: (id: string) => void;

  /** Bridge controls. */
  onStartBridge: () => Promise<void>;
  onStop: () => void;
  onInterrupt: () => void;
};

// ── Hook implementation ──────────────────────────────────────────────────────

export function useAppController({
  actor,
  actorReady,
  preferredBoundUserId,
  onActorChange,
  requestConfirm,
}: UseAppControllerProps): UseAppControllerReturn {
  const actorUserId = actor.userId ?? "";

  // ── Bridge state ─────────────────────────────────────────────────────────
  const [bridge, setBridge] = useState<BridgeState>({
    running: false,
    conversationId: null,
    runtimeConversationId: null,
    turnId: null,
    disabledTools: [],
    lastError: null,
    pendingServerRequestCount: 0,
    ingestEnqueuedEventCount: 0,
    ingestSkippedEventCount: 0,
    ingestEnqueuedByKind: [],
    ingestSkippedByKind: [],
  });
  const [runtimeLog, setRuntimeLog] = useState<Array<{ id: string; line: string }>>([]);

  // ── Approval drafts ──────────────────────────────────────────────────────
  const [toolDrafts, setToolDrafts] = useState<Record<string, Record<string, string>>>({});
  const [toolOtherDrafts, setToolOtherDrafts] = useState<Record<string, Record<string, string>>>({});
  const [submittingRequestKey, setSubmittingRequestKey] = useState<string | null>(null);

  // ── Toasts ───────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // ── Auth form state ──────────────────────────────────────────────────────
  const [apiKey, setApiKey] = useState("");
  const [chatgptAccountId, setChatgptAccountId] = useState("");
  const [chatgptPlanType, setChatgptPlanType] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [cancelLoginId, setCancelLoginId] = useState("");
  const [authSummary, setAuthSummary] = useState<string>("No account action yet.");
  const [pendingAuthRefresh, setPendingAuthRefresh] = useState<PendingAuthRefreshRequest[]>([]);

  // ── Local thread state ───────────────────────────────────────────────────
  const [showLocalThreads, setShowLocalThreads] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(SHOW_LOCAL_THREADS_STORAGE_KEY) === "1";
  });
  const [localRuntimeThreads, setLocalRuntimeThreads] = useState<LocalRuntimeThreadRow[]>([]);
  const [selectedLocalConversationId, setSelectedLocalConversationId] = useState<string | null>(null);

  // ── Repro recording state ────────────────────────────────────────────────
  const [reproRecording, setReproRecording] = useState(false);
  const [lastReproArtifactName, setLastReproArtifactName] = useState<string | null>(null);
  const [reproCommandCount, setReproCommandCount] = useState(0);
  const [reproObservedCount, setReproObservedCount] = useState(0);
  const [lastCapturedInvokeCommand, setLastCapturedInvokeCommand] = useState<string | null>(null);
  const reproStartedAtRef = useRef<number | null>(null);
  const reproCommandsRef = useRef<TauriReproCaptureCommand[]>([]);
  const reproObservedRef = useRef<TauriReproObservedEvent[]>([]);

  // ── Toast callbacks ──────────────────────────────────────────────────────
  const addToast = useCallback((type: ToastItem["type"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Repro recording callbacks ────────────────────────────────────────────
  const startReproRecording = useCallback(() => {
    reproCommandsRef.current = [];
    reproObservedRef.current = [];
    reproStartedAtRef.current = Date.now();
    setReproCommandCount(0);
    setReproObservedCount(0);
    setLastCapturedInvokeCommand(null);
    setLastReproArtifactName(null);
    setReproRecording(true);
    addToast("info", "Repro recording started.");
  }, [addToast]);

  const stopReproRecording = useCallback(() => {
    setReproRecording(false);
    addToast("info", "Repro recording stopped.");
  }, [addToast]);

  const exportReproRecording = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const startedAtMs = reproStartedAtRef.current ?? Date.now();
    const commands = [...reproCommandsRef.current];
    const observed = [...reproObservedRef.current];
    if (commands.length === 0 && observed.length === 0) {
      addToast("error", "No repro events captured yet.");
      return;
    }
    const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
    const convexUrlHost = convexUrl
      ? (() => {
          try {
            return new URL(convexUrl).host;
          } catch {
            return undefined;
          }
        })()
      : undefined;
    const artifact: TauriReproArtifactV1 = {
      version: "tauri-repro-v1",
      createdAtMs: startedAtMs,
      redaction: {
        messageTextRedacted: true,
      },
      env: {
        userAgent: window.navigator.userAgent,
        runtimeMode: import.meta.env.MODE,
        ...(convexUrlHost ? { convexUrlHost } : {}),
      },
      commands,
      observed,
      diagnostics: {
        errorClasses: classifyReproErrorClasses(commands, observed),
      },
    };
    const fileName = `tauri-repro-${new Date(startedAtMs).toISOString().replaceAll(":", "-")}.json`;
    const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" });
    const href = window.URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = href;
    anchor.download = fileName;
    window.document.body.appendChild(anchor);
    anchor.click();
    window.document.body.removeChild(anchor);
    window.URL.revokeObjectURL(href);
    setLastReproArtifactName(fileName);
    addToast("success", `Repro artifact exported: ${fileName}`);
  }, [addToast]);

  // ── Effect: sync preferred actor binding ─────────────────────────────────
  useEffect(() => {
    const preferredUserId = preferredBoundUserId;
    if (!preferredUserId || preferredUserId === actorUserId) {
      return;
    }
    onActorChange(preferredUserId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTOR_STORAGE_KEY, preferredUserId);
    }
    addToast(
      "info",
      `Using bound host username "${preferredUserId}" to match Convex actor lock.`,
    );
  }, [actorUserId, addToast, onActorChange, preferredBoundUserId]);

  // ── Effect: repro invoke capture subscription ────────────────────────────
  useEffect(() => {
    return subscribeTauriInvokeCapture((event) => {
      if (!reproRecording) {
        return;
      }
      reproCommandsRef.current.push({
        tsMs: event.tsMs,
        phase: event.phase,
        command: event.command,
        ...(event.args !== undefined ? { args: event.args } : {}),
        ...(event.result !== undefined ? { result: event.result } : {}),
        ...(event.error !== undefined ? { error: event.error } : {}),
      });
      setReproCommandCount(reproCommandsRef.current.length);
      if (event.phase === "invoke_start") {
        setLastCapturedInvokeCommand(event.command);
      }
    });
  }, [reproRecording]);

  // ── Runtime bridge ───────────────────────────────────────────────────────
  const runtimeBridgeControls = useMemo(
    () => ({
      start: tauriBridge.lifecycle.start,
      stop: tauriBridge.lifecycle.stop,
      getState: tauriBridge.lifecycle.getState,
      sendTurn: tauriBridge.turns.send,
      interrupt: tauriBridge.turns.interrupt,
    }),
    [],
  );
  const runtimeBridge = useCodexRuntimeBridge(runtimeBridgeControls);

  // ── Account auth ─────────────────────────────────────────────────────────
  const accountAuth = useCodexAccountAuth<LoginAccountParams>({
    readAccount: tauriBridge.account.read,
    loginAccount: tauriBridge.account.login,
    cancelAccountLogin: tauriBridge.account.cancelLogin,
    logoutAccount: tauriBridge.account.logout,
    readAccountRateLimits: tauriBridge.account.readRateLimits,
    respondChatgptAuthTokensRefresh: tauriBridge.account.respondChatgptAuthTokensRefresh,
  });

  // ── Ref breaks the circular dependency ───────────────────────────────────
  const selectedConversationIdRef = useRef("");
  const waitForBridgeReady = useCallback(async () => {
    const timeoutMs = 12_000;
    const pollMs = 200;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await tauriBridge.lifecycle.getState();
      if (state.running && typeof state.conversationId === "string" && state.conversationId.length > 0) {
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error("Bridge started, but no local thread became ready within 12s.");
  }, []);

  const connectBridge = useCallback(
    async (startSource: "manual_start_button" | "composer_retry" | "auto_startup") => {
      if (!actorReady) {
        throw new Error("Actor identity is still synchronizing. Please retry in a moment.");
      }
      await runtimeBridge.start({
        convexUrl: import.meta.env.VITE_CONVEX_URL,
        actor,
        sessionId,
        startSource,
        model: import.meta.env.VITE_CODEX_MODEL,
        cwd: import.meta.env.VITE_CODEX_CWD,
        disabledTools: bridge.disabledTools ?? [],
        deltaThrottleMs: 250,
        saveStreamDeltas: true,
      });
      const state = await tauriBridge.lifecycle.getState();
      setBridge((prev) => ({
        ...prev,
        running: state.running,
        conversationId: state.conversationId ?? null,
        runtimeConversationId: state.runtimeConversationId ?? null,
        turnId: state.turnId ?? null,
        lastError: state.lastError ?? null,
      }));
    },
    [actor, actorReady, bridge.disabledTools, runtimeBridge],
  );

  const startBridgeWithSelection = useCallback(
    async (startSource: "manual_start_button" | "composer_retry" | "auto_startup") => {
      const resumeConversationId = selectedConversationIdRef.current.trim() || undefined;
      await connectBridge(startSource);
      await tauriBridge.lifecycle.openThread(
        resumeConversationId
          ? { strategy: "resume", conversationId: resumeConversationId }
          : { strategy: "start" },
      );
      const readyState = await waitForBridgeReady();
      setBridge((prev) => ({
        ...prev,
        running: readyState.running,
        conversationId: readyState.conversationId ?? null,
        runtimeConversationId: readyState.runtimeConversationId ?? null,
        turnId: readyState.turnId ?? null,
        lastError: readyState.lastError ?? null,
      }));
    },
    [connectBridge, waitForBridgeReady],
  );

  const autoStartAttemptedRef = useRef(false);

  // ── Composer config ──────────────────────────────────────────────────────
  const composerConfig = useMemo(
    () => ({
      optimistic: { enabled: true },
      onSend: async (text: string) => {
        try {
          const selectedConversationId = selectedConversationIdRef.current.trim();
          if (selectedConversationId.length > 0) {
            const syncSnapshot = await tauriBridge.syncHydration.getConversationSnapshot(selectedConversationId);
            if (syncSnapshot?.syncState === "syncing") {
              throw new Error("Conversation sync is still in progress. Please wait for sync to finish before sending.");
            }
          }
          let stateBeforeSend = await tauriBridge.lifecycle.getState();
          if (!stateBeforeSend.running) {
            await connectBridge("composer_retry");
            stateBeforeSend = await tauriBridge.lifecycle.getState();
          }
          if (selectedConversationId.length > 0) {
            if (stateBeforeSend.conversationId !== selectedConversationId) {
              await tauriBridge.lifecycle.openThread({
                strategy: "resume",
                conversationId: selectedConversationId,
              });
              stateBeforeSend = await waitForBridgeReady();
            }
          } else if (!stateBeforeSend.conversationId) {
            await startBridgeWithSelection("composer_retry");
          }
          await tauriBridge.turns.send(text);
          setBridge((prev) => ({ ...prev, lastError: null }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setBridge((prev) => ({ ...prev, lastError: message }));
          addToast("error", message);
          throw error;
        }
      },
    }),
    [addToast, connectBridge, startBridgeWithSelection, waitForBridgeReady],
  );

  // ── useCodex conversation ────────────────────────────────────────────────
  const conversation = useCodex({
    actorReady,
    ...(selectedLocalConversationId ? { conversationId: selectedLocalConversationId } : {}),
    threads: {
      list: {
        query: requireDefined(chatApi.listThreadsForPicker, "api.chat.listThreadsForPicker"),
        args: actorReady ? { actor, limit: 25 } : "skip",
      },
      initialSelectedConversationId: "",
    },
    composer: composerConfig,
    interrupt: {
      onInterrupt: async () => {
        await runtimeBridge.interrupt();
      },
    },
  });

  // ── Derive picker values from composed threads ───────────────────────────
  const threads = conversation.threads!;
  const selectedConversationId = selectedLocalConversationId ?? (threads.selectedConversationId ?? "");
  const localRuntimeConversationIds = useMemo(
    () => localRuntimeThreads.map((thread) => thread.conversationId),
    [localRuntimeThreads],
  );
  const localRuntimeConversationPreviewById = useMemo(() => {
    const map = new Map<string, string>();
    for (const thread of localRuntimeThreads) {
      map.set(thread.conversationId, thread.preview);
    }
    return map;
  }, [localRuntimeThreads]);
  const localRuntimeConversationMessageCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const thread of localRuntimeThreads) {
      map.set(thread.conversationId, thread.messageCount);
    }
    return map;
  }, [localRuntimeThreads]);
  const localBindingsRaw = useQuery(
    requireDefined(chatApi.listRuntimeConversationBindingsForPicker, "api.chat.listRuntimeConversationBindingsForPicker"),
    actorReady && showLocalThreads && localRuntimeConversationIds.length > 0
      ? { actor, runtimeConversationIds: localRuntimeConversationIds }
      : "skip",
  );
  const localBindings = (localBindingsRaw ?? []) as RuntimeThreadBindingRow[];
  const localBindingByRuntimeThreadId = useMemo(() => {
    const map = new Map<string, RuntimeThreadBindingRow>();
    for (const row of localBindings) {
      map.set(row.runtimeConversationId, row);
    }
    return map;
  }, [localBindings]);
  const pickerThreads = useMemo(
    () => {
      const persisted =
        (((threads.threads as { threads?: Array<{ conversationId: string; status: string; updatedAt?: number; preview: string }> } | undefined)?.threads ?? [])
          .map((thread) => ({
            conversationId: thread.conversationId,
            status: thread.status,
            preview: thread.preview,
            scope: "persisted" as const,
            ...(thread.updatedAt !== undefined ? { updatedAt: thread.updatedAt } : {}),
          })));

      if (!showLocalThreads) {
        return persisted;
      }

      const persistedHandles = new Set(persisted.map((thread) => thread.conversationId));
      const localUnsynced = localRuntimeConversationIds
        .filter((runtimeConversationId) => !localBindingByRuntimeThreadId.has(runtimeConversationId))
        .filter((runtimeConversationId) => !persistedHandles.has(runtimeConversationId))
        .map((runtimeConversationId) => ({
          conversationId: runtimeConversationId,
          status: "local-unsynced",
          preview: localRuntimeConversationPreviewById.get(runtimeConversationId) ?? "Untitled thread",
          scope: "local_unsynced" as const,
          ...(localRuntimeConversationMessageCountById.has(runtimeConversationId)
            ? { messageCount: localRuntimeConversationMessageCountById.get(runtimeConversationId) as number }
            : {}),
        }));

      return [...persisted, ...localUnsynced];
    },
    [
      localBindingByRuntimeThreadId,
      localRuntimeConversationIds,
      localRuntimeConversationMessageCountById,
      localRuntimeConversationPreviewById,
      showLocalThreads,
      threads.threads,
    ],
  );
  const localUnsyncedConversationIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const thread of pickerThreads) {
      if (thread.scope === "local_unsynced") {
        set.add(thread.conversationId);
      }
    }
    return set;
  }, [pickerThreads]);
  selectedConversationIdRef.current = selectedConversationId;

  // ── Effect: persist showLocalThreads to localStorage ─────────────────────
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SHOW_LOCAL_THREADS_STORAGE_KEY, showLocalThreads ? "1" : "0");
  }, [showLocalThreads]);

  // ── Effect: clear local threads when bridge stops ────────────────────────
  useEffect(() => {
    if (bridge.running) {
      return;
    }
    setLocalRuntimeThreads([]);
  }, [bridge.running]);

  // ── Effect: auto-start bridge ────────────────────────────────────────────
  useEffect(() => {
    if (!actorReady) {
      autoStartAttemptedRef.current = false;
      return;
    }
    if (bridge.running || autoStartAttemptedRef.current) {
      return;
    }
    autoStartAttemptedRef.current = true;
    void connectBridge("auto_startup").catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setBridge((prev) => ({ ...prev, lastError: message }));
      addToast("error", message);
    });
  }, [actorReady, addToast, bridge.running, connectBridge]);

  // ── Messages / display ───────────────────────────────────────────────────
  const cleanupConversationId = conversation.effectiveConversationId || null;

  const messages = conversation.messages;
  const displayMessages = useMemo(
    () => messages.results.filter((message) => message.sourceItemType !== "reasoning"),
    [messages.results],
  );
  const latestReasoning = useMemo(() => {
    const reasoningMessages = messages.results.filter(
      (message) => message.sourceItemType === "reasoning",
    );
    if (reasoningMessages.length === 0) {
      return null;
    }
    const latest = reasoningMessages[reasoningMessages.length - 1]!;
    const latestIndex = messages.results.findIndex((message) => message.messageId === latest.messageId);
    const hasFinalAssistantAfter =
      latestIndex >= 0 &&
      messages.results.slice(latestIndex + 1).some((message) => {
        if (message.role !== "assistant") {
          return false;
        }
        if (message.sourceItemType === "reasoning") {
          return false;
        }
        return message.status === "completed";
      });
    if (hasFinalAssistantAfter) {
      return null;
    }
    return latest;
  }, [messages.results]);

  const tokenUsage = conversation.tokenUsage;

  const tokenByTurnId = useMemo(() => {
    const map = new Map<string, { totalTokens: number; inputTokens: number; outputTokens: number }>();
    if (!tokenUsage || tokenUsage.status !== "ready") return map;
    for (const turn of tokenUsage.turns) {
      map.set(turn.turnId, {
        totalTokens: turn.last.totalTokens,
        inputTokens: turn.last.inputTokens,
        outputTokens: turn.last.outputTokens,
      });
    }
    return map;
  }, [tokenUsage]);

  // ── Pending server requests ──────────────────────────────────────────────
  const pendingServerRequestsRaw = useQuery(
    requireDefined(chatApi.listPendingServerRequestsByConversation, "api.chat.listPendingServerRequestsByConversation"),
    conversation.effectiveConversationId && actorReady
      ? { actor, conversationId: conversation.effectiveConversationId, limit: 50 }
      : "skip",
  );
  const pendingServerRequests = (pendingServerRequestsRaw ?? []) as PendingServerRequest[];

  // ── Deletion mutations ───────────────────────────────────────────────────
  const scheduleDeleteThreadMutation = useMutation(
    requireDefined(chatApi.scheduleDeleteThread, "api.chat.scheduleDeleteThread"),
  );
  const scheduleDeleteTurnMutation = useMutation(
    requireDefined(chatApi.scheduleDeleteTurn, "api.chat.scheduleDeleteTurn"),
  );
  const purgeActorDataMutation = useMutation(
    requireDefined(chatApi.schedulePurgeActorData, "api.chat.schedulePurgeActorData"),
  );
  const deleteThreadMutation = useMutation(
    requireDefined(chatApi.deleteThread, "api.chat.deleteThread"),
  );
  const deletionStatusQuery = requireDefined(chatApi.getDeletionStatus, "api.chat.getDeletionStatus");
  const cancelDeletionMutation = useCodexOptimisticMutation(
    requireDefined(chatApi.cancelDeletion, "api.chat.cancelDeletion"),
    codexOptimisticPresets.deletionStatus.cancel(deletionStatusQuery),
  );
  const forceRunDeletionMutation = useCodexOptimisticMutation(
    requireDefined(chatApi.forceRunDeletion, "api.chat.forceRunDeletion"),
    codexOptimisticPresets.deletionStatus.forceRun(deletionStatusQuery),
  );
  const [activeDeletionJobId, setActiveDeletionJobId] = useState<string | null>(null);
  const [activeDeletionLabel, setActiveDeletionLabel] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const deletionStatus = useQuery(
    requireDefined(chatApi.getDeletionStatus, "api.chat.getDeletionStatus"),
    activeDeletionJobId && actorReady ? { actor, deletionJobId: activeDeletionJobId } : "skip",
  );
  const cleanupThreadState = useCodexThreadState(
    requireDefined(chatApi.threadSnapshotByConversation, "api.chat.threadSnapshotByConversation"),
    cleanupConversationId && actorReady ? { actor, conversationId: cleanupConversationId } : "skip",
  );
  const cleanupThreadStateTurns = cleanupThreadState?.threadStatus === "ok" ? cleanupThreadState.data.turns : null;
  const latestThreadTurnId = useMemo(() => {
    if (!cleanupThreadStateTurns || cleanupThreadStateTurns.length === 0) {
      return null;
    }
    return cleanupThreadStateTurns[0]?.turnId ?? null;
  }, [cleanupThreadState?.threadStatus, cleanupThreadStateTurns]);

  // ── Effect: deletion job status watcher ──────────────────────────────────
  useEffect(() => {
    if (!activeDeletionJobId || !deletionStatus) {
      return;
    }
    if (deletionStatus.status === "completed") {
      addToast(
        "success",
        `${activeDeletionLabel ?? "Deletion job"} completed (${activeDeletionJobId.slice(0, 8)}).`,
      );
      setActiveDeletionJobId(null);
      setActiveDeletionLabel(null);
      return;
    }
    if (deletionStatus.status === "failed") {
      addToast(
        "error",
        `${activeDeletionLabel ?? "Deletion job"} failed: ${deletionStatus.errorMessage ?? "unknown error"}`,
      );
      setActiveDeletionJobId(null);
      setActiveDeletionLabel(null);
      return;
    }
    if (deletionStatus.status === "cancelled") {
      addToast(
        "info",
        `${activeDeletionLabel ?? "Deletion job"} cancelled (${activeDeletionJobId.slice(0, 8)}).`,
      );
      setActiveDeletionJobId(null);
      setActiveDeletionLabel(null);
    }
  }, [activeDeletionJobId, activeDeletionLabel, addToast, deletionStatus]);

  // ── Effect: countdown timer for scheduled deletion ───────────────────────
  useEffect(() => {
    if (deletionStatus?.status !== "scheduled" || deletionStatus.scheduledFor === undefined) {
      return;
    }
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [deletionStatus?.scheduledFor, deletionStatus?.status]);

  const scheduledDeleteCountdown = useMemo(() => {
    if (deletionStatus?.status !== "scheduled" || deletionStatus.scheduledFor === undefined) {
      return null;
    }
    return Math.max(0, deletionStatus.scheduledFor - nowMs);
  }, [deletionStatus?.scheduledFor, deletionStatus?.status, nowMs]);

  // ── Tauri event subscriptions ────────────────────────────────────────────
  useCodexTauriEvents({
    setBridge,
    setRuntimeLog,
    setAuthSummary,
    setPendingAuthRefresh,
    onLocalThreadsLoaded: (threads) => {
      setLocalRuntimeThreads(threads);
    },
    addToast,
    refreshBridgeState: runtimeBridge.refresh,
    subscribeBridgeLifecycle: tauriBridge.lifecycle.subscribe,
    onObservedEvent: (event) => {
      if (!reproRecording) {
        return;
      }
      reproObservedRef.current.push({
        tsMs: event.tsMs,
        kind: event.kind,
        payload: event.payload,
      });
      setReproObservedCount(reproObservedRef.current.length);
    },
  });

  // ── Bridge control callbacks ─────────────────────────────────────────────
  const onStartBridge = useCallback(async () => {
    autoStartAttemptedRef.current = true;
    await connectBridge("manual_start_button");
  }, [connectBridge]);

  const onStop = useCallback(() => {
    void runtimeBridge.stop();
  }, [runtimeBridge]);

  const onInterrupt = useCallback(() => {
    void conversation.interrupt();
  }, [conversation]);

  // ── Thread picker callbacks ──────────────────────────────────────────────
  const onToggleShowLocalThreads = useCallback(
    async (next: boolean) => {
      setShowLocalThreads(next);
      if (!next) {
        setLocalRuntimeThreads([]);
        setSelectedLocalConversationId(null);
        return;
      }
      if (!bridge.running) {
        return;
      }
      try {
        await tauriBridge.lifecycle.refreshLocalThreads();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addToast("error", message);
      }
    },
    [addToast, bridge.running],
  );

  const onInsertDynamicToolPrompt = useCallback(() => {
    const prompt = TAURI_RUNTIME_TOOL_PROMPT;
    conversation.composer.setValue((prev) => (prev.trim() ? `${prev}\n\n${prompt}` : prompt));
  }, [conversation.composer]);

  const onSetDisabledTools = useCallback(async (nextTools: string[]) => {
    const normalized = [...new Set(nextTools.filter((tool) => tool.trim().length > 0))].sort();
    try {
      await tauriBridge.tools.setDisabled({ tools: normalized });
      setBridge((current) => ({
        ...current,
        disabledTools: normalized,
      }));
      addToast("success", `Tool policy updated (${normalized.length} blocked).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addToast("error", message);
    }
  }, [addToast]);

  const onSelectConversationId = useCallback(
    async (nextConversationId: string) => {
      const normalizedConversationId = nextConversationId.trim();
      const isLocalUnsyncedSelection =
        normalizedConversationId.length > 0 && localUnsyncedConversationIdSet.has(normalizedConversationId);
      setSelectedLocalConversationId(isLocalUnsyncedSelection ? normalizedConversationId : null);
      threads.setSelectedConversationId(normalizedConversationId);
      if (!bridge.running) {
        return;
      }
      try {
        await tauriBridge.lifecycle.openThread(
          normalizedConversationId.length > 0
            ? { strategy: "resume", conversationId: normalizedConversationId }
            : { strategy: "start" },
        );
        const state = await tauriBridge.lifecycle.getState();
        setBridge((prev) => ({
          ...prev,
          running: state.running,
          conversationId: state.conversationId ?? null,
          runtimeConversationId: state.runtimeConversationId ?? null,
          turnId: state.turnId ?? null,
          lastError: state.lastError ?? null,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setBridge((prev) => ({ ...prev, lastError: message }));
        addToast("error", message);
      }
    },
    [addToast, bridge.running, localUnsyncedConversationIdSet, threads],
  );

  // ── Approval callbacks ───────────────────────────────────────────────────
  const onRespondCommandOrFile = useCallback(async (
    request: PendingServerRequest,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) => {
    const key = requestKey(request.requestId);
    setSubmittingRequestKey(key);
    try {
      if (request.method === "item/commandExecution/requestApproval") {
        await tauriBridge.approvals.respondCommand({ requestId: request.requestId, decision });
      } else {
        await tauriBridge.approvals.respondFileChange({ requestId: request.requestId, decision });
      }
      setBridge((prev) => ({ ...prev, lastError: null }));
      addToast("success", `Approval ${decision === "accept" || decision === "acceptForSession" ? "accepted" : "declined"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBridge((prev) => ({ ...prev, lastError: message }));
      addToast("error", message);
    } finally {
      setSubmittingRequestKey((current) => (current === key ? null : current));
    }
  }, [addToast]);

  const onRespondToolUserInput = useCallback(async (request: PendingServerRequest) => {
    const key = requestKey(request.requestId);
    const selectedByQuestion = toolDrafts[key] ?? {};
    const otherByQuestion = toolOtherDrafts[key] ?? {};
    const answers: Record<string, { answers: string[] }> = {};

    for (const question of request.questions ?? []) {
      const selected = (selectedByQuestion[question.id] ?? "").trim();
      const other = (otherByQuestion[question.id] ?? "").trim();

      if (selected === "__other__") {
        if (!other) {
          setBridge((prev) => ({ ...prev, lastError: `Missing answer for question: ${question.header}` }));
          addToast("error", `Missing answer for: ${question.header}`);
          return;
        }
        answers[question.id] = { answers: [other] };
        continue;
      }

      if (selected) {
        answers[question.id] = { answers: [selected] };
        continue;
      }

      if (question.options && question.options.length > 0) {
        setBridge((prev) => ({ ...prev, lastError: `Select an option for: ${question.header}` }));
        addToast("error", `Select an option for: ${question.header}`);
        return;
      }

      if (!other) {
        setBridge((prev) => ({ ...prev, lastError: `Missing answer for question: ${question.header}` }));
        addToast("error", `Missing answer for: ${question.header}`);
        return;
      }
      answers[question.id] = { answers: [other] };
    }

    setSubmittingRequestKey(key);
    try {
      await tauriBridge.approvals.respondToolInput({ requestId: request.requestId, answers });
      setBridge((prev) => ({ ...prev, lastError: null }));
      addToast("success", "Answers submitted");
      setToolDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setToolOtherDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBridge((prev) => ({ ...prev, lastError: message }));
      addToast("error", message);
    } finally {
      setSubmittingRequestKey((current) => (current === key ? null : current));
    }
  }, [addToast, toolDrafts, toolOtherDrafts]);

  const setToolSelected = useCallback((request: PendingServerRequest, questionId: string, value: string) => {
    const key = requestKey(request.requestId);
    setToolDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [questionId]: value },
    }));
  }, []);

  const setToolOther = useCallback((request: PendingServerRequest, questionId: string, value: string) => {
    const key = requestKey(request.requestId);
    setToolOtherDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [questionId]: value },
    }));
  }, []);

  // ── Auth callbacks ───────────────────────────────────────────────────────
  const runAuthAction = useCallback(async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      setBridge((prev) => ({ ...prev, lastError: null }));
      addToast("success", name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBridge((prev) => ({ ...prev, lastError: message }));
      addToast("error", message);
    }
  }, [addToast]);

  const onAccountRead = useCallback((refreshToken: boolean) => {
    void runAuthAction(refreshToken ? "Account read (refresh requested)" : "Account read", async () => {
      await accountAuth.readAccount({ refreshToken });
    });
  }, [accountAuth, runAuthAction]);

  const onLoginApiKey = useCallback(() => {
    const key = apiKey.trim();
    if (!key) {
      addToast("error", "API key is required.");
      return;
    }
    void runAuthAction("API key login started", async () => {
      const params: LoginAccountParams = { type: "apiKey", apiKey: key };
      await accountAuth.loginAccount({ params });
    });
  }, [accountAuth, addToast, apiKey, runAuthAction]);

  const onLoginChatgpt = useCallback(() => {
    void runAuthAction("ChatGPT login started", async () => {
      const params: LoginAccountParams = { type: "chatgpt" };
      await accountAuth.loginAccount({ params });
    });
  }, [accountAuth, runAuthAction]);

  const onLoginChatgptTokens = useCallback(() => {
    const accountId = chatgptAccountId.trim();
    const planType = chatgptPlanType.trim();
    const access = accessToken.trim();
    if (!accountId || !access) {
      addToast("error", "ChatGPT account id and access token are required.");
      return;
    }
    void runAuthAction("ChatGPT token login started", async () => {
      const params: LoginAccountParams = {
        type: "chatgptAuthTokens",
        accessToken: access,
        chatgptAccountId: accountId,
        ...(planType ? { chatgptPlanType: planType } : {}),
      };
      await accountAuth.loginAccount({ params });
    });
  }, [accessToken, accountAuth, addToast, chatgptAccountId, chatgptPlanType, runAuthAction]);

  const onCancelLogin = useCallback(() => {
    const loginId = cancelLoginId.trim();
    if (!loginId) {
      addToast("error", "Login ID is required.");
      return;
    }
    void runAuthAction("Login cancel requested", async () => {
      await accountAuth.cancelAccountLogin({ loginId });
    });
  }, [accountAuth, addToast, cancelLoginId, runAuthAction]);

  const onLogout = useCallback(() => {
    void runAuthAction("Logout requested", async () => {
      await accountAuth.logoutAccount();
    });
  }, [accountAuth, runAuthAction]);

  const onReadRateLimits = useCallback(() => {
    void runAuthAction("Rate limits read requested", async () => {
      await accountAuth.readAccountRateLimits();
    });
  }, [accountAuth, runAuthAction]);

  const onRespondAuthRefresh = useCallback((requestId: string | number) => {
    const accountId = chatgptAccountId.trim();
    const planType = chatgptPlanType.trim();
    const access = accessToken.trim();
    if (!accountId || !access) {
      addToast("error", "Provide ChatGPT account id and access token before responding.");
      return;
    }
    void runAuthAction("Auth refresh response sent", async () => {
      await accountAuth.respondChatgptAuthTokensRefresh({
        requestId,
        accessToken: access,
        chatgptAccountId: accountId,
        ...(planType ? { chatgptPlanType: planType } : {}),
      });
      setPendingAuthRefresh((prev) =>
        prev.filter((item) => `${typeof item.requestId}:${String(item.requestId)}` !== `${typeof requestId}:${String(requestId)}`),
      );
    });
  }, [accessToken, accountAuth, addToast, chatgptAccountId, chatgptPlanType, runAuthAction]);

  // ── Deletion callbacks ───────────────────────────────────────────────────
  const onDeleteCurrentThread = useCallback(async () => {
    if (!cleanupConversationId || !actorReady || bridge.running) {
      return;
    }
    const confirmed = await requestConfirm("Delete this conversation? Scheduled deletions run after 10 minutes unless you undo.");
    if (!confirmed) {
      return;
    }
    try {
      const result = await scheduleDeleteThreadMutation({
        actor,
        conversationId: cleanupConversationId,
        reason: "tauri-ui-delete-thread",
        delayMs: DEFAULT_DELETE_DELAY_MS,
      });
      setActiveDeletionJobId(result.deletionJobId);
      setActiveDeletionLabel("Thread delete");
      addToast("info", `Scheduled thread delete job ${result.deletionJobId.slice(0, 8)}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addToast("error", message);
    }
  }, [actor, actorReady, addToast, bridge.running, cleanupConversationId, requestConfirm, scheduleDeleteThreadMutation]);

  const onDeleteLatestTurn = useCallback(async () => {
    if (!cleanupConversationId || !latestThreadTurnId || !actorReady || bridge.running) {
      return;
    }
    const confirmed = await requestConfirm("Delete the last response? Scheduled deletions run after 10 minutes unless you undo.");
    if (!confirmed) {
      return;
    }
    try {
      const result = await scheduleDeleteTurnMutation({
        actor,
        conversationId: cleanupConversationId,
        turnId: latestThreadTurnId,
        reason: "tauri-ui-delete-turn",
        delayMs: DEFAULT_DELETE_DELAY_MS,
      });
      setActiveDeletionJobId(result.deletionJobId);
      setActiveDeletionLabel("Turn delete");
      addToast("info", `Scheduled turn delete job ${result.deletionJobId.slice(0, 8)}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addToast("error", message);
    }
  }, [actor, actorReady, addToast, bridge.running, cleanupConversationId, latestThreadTurnId, requestConfirm, scheduleDeleteTurnMutation]);

  const onPurgeActorData = useCallback(async () => {
    if (!actorReady || bridge.running) {
      return;
    }
    const confirmed = await requestConfirm("Delete all your data? This schedules a purge of every conversation and message for your account.");
    if (!confirmed) {
      return;
    }
    try {
      const result = await purgeActorDataMutation({
        actor,
        reason: "tauri-ui-purge-actor",
        delayMs: DEFAULT_DELETE_DELAY_MS,
      });
      setActiveDeletionJobId(result.deletionJobId);
      setActiveDeletionLabel("Actor purge");
      addToast("info", `Scheduled actor purge job ${result.deletionJobId.slice(0, 8)}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addToast("error", message);
    }
  }, [actor, actorReady, addToast, bridge.running, requestConfirm, purgeActorDataMutation]);

  const onUndoScheduledDeletion = useCallback(async () => {
    if (!activeDeletionJobId || !actorReady || bridge.running) {
      return;
    }
    try {
      const result = await cancelDeletionMutation({
        actor,
        deletionJobId: activeDeletionJobId,
      });
      if (result.cancelled) {
        addToast("success", `Cancelled deletion job ${activeDeletionJobId.slice(0, 8)}.`);
      } else {
        addToast("info", `Deletion job ${activeDeletionJobId.slice(0, 8)} is no longer cancellable.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addToast("error", message);
    }
  }, [activeDeletionJobId, actor, actorReady, addToast, bridge.running, cancelDeletionMutation]);

  const onForceScheduledDeletion = useCallback(async () => {
    if (!activeDeletionJobId || !actorReady || bridge.running) {
      return;
    }
    const confirmed = await requestConfirm("Force deletion now and bypass the grace period?");
    if (!confirmed) {
      return;
    }
    try {
      const result = await forceRunDeletionMutation({
        actor,
        deletionJobId: activeDeletionJobId,
      });
      if (result.forced) {
        addToast("info", `Forced deletion job ${activeDeletionJobId.slice(0, 8)} to run now.`);
      } else {
        addToast("info", `Deletion job ${activeDeletionJobId.slice(0, 8)} is no longer force-runnable.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addToast("error", message);
    }
  }, [activeDeletionJobId, actor, actorReady, addToast, bridge.running, requestConfirm, forceRunDeletionMutation]);

  const onHardDeleteThread = useCallback(async (conversationId: string) => {
    if (!actorReady) return;
    const confirmed = await requestConfirm("Permanently delete this conversation?");
    if (!confirmed) return;
    try {
      await deleteThreadMutation({
        actor,
        conversationId,
        reason: "tauri-ui-hard-delete-thread",
      });
      addToast("info", "Conversation deleted.");
      if (conversationId === selectedConversationId) {
        void onSelectConversationId("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addToast("error", message);
    }
  }, [actor, actorReady, addToast, deleteThreadMutation, onSelectConversationId, requestConfirm, selectedConversationId]);

  // ── Return ───────────────────────────────────────────────────────────────
  return {
    // bridge state
    bridge,
    runtimeLog,

    // conversation state
    conversation,
    displayMessages,
    latestReasoning,
    selectedConversationId,
    tokenByTurnId,

    // thread picker state
    pickerThreads,
    showLocalThreads,
    onToggleShowLocalThreads,
    onSelectConversationId,

    // approval state
    pendingServerRequests,
    submittingRequestKey,
    toolDrafts,
    toolOtherDrafts,
    onRespondCommandOrFile,
    onRespondToolUserInput,
    setToolSelected,
    setToolOther,

    // auth state
    authSummary,
    pendingAuthRefresh,
    apiKey,
    setApiKey,
    chatgptAccountId,
    setChatgptAccountId,
    chatgptPlanType,
    setChatgptPlanType,
    accessToken,
    setAccessToken,
    cancelLoginId,
    setCancelLoginId,
    accountAuthIsBusy: accountAuth.isBusy,
    onAccountRead,
    onLoginApiKey,
    onLoginChatgpt,
    onLoginChatgptTokens,
    onCancelLogin,
    onLogout,
    onReadRateLimits,
    onRespondAuthRefresh,

    // cleanup / deletion state
    onHardDeleteThread,
    onDeleteCurrentThread,
    onDeleteLatestTurn,
    onPurgeActorData,
    onUndoScheduledDeletion,
    onForceScheduledDeletion,
    deletionStatus,
    activeDeletionJobId,
    activeDeletionLabel,
    scheduledDeleteCountdown,
    cleanupConversationId,
    latestThreadTurnId,

    // repro recording state
    reproRecording,
    reproCommandCount,
    reproObservedCount,
    lastCapturedInvokeCommand,
    lastReproArtifactName,
    startReproRecording,
    stopReproRecording,
    exportReproRecording,

    // tool policy
    onSetDisabledTools,
    onInsertDynamicToolPrompt,

    // toast state
    toasts,
    addToast,
    dismissToast,

    // bridge controls
    onStartBridge,
    onStop,
    onInterrupt,
  };
}
