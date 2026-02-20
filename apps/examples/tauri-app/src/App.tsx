import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  CodexProvider,
  useCodex,
  useCodexAccountAuth,
  useCodexRuntimeBridge,
  useCodexThreadState,
} from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";
import {
  bridge as tauriBridge,
  type ActorContext,
  type BridgeState,
  type LoginAccountParams,
} from "./lib/tauriBridge";
import { Header } from "./components/Header";
import { BridgeStatus } from "./components/BridgeStatus";
import { ThreadPicker } from "./components/ThreadPicker";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { ApprovalList } from "./components/ApprovalList";
import { EventLog } from "./components/EventLog";
import { TokenUsagePanel } from "./components/TokenUsagePanel";
import { ToolDisablePanel } from "./components/ToolDisablePanel";
import { ToastContainer, type ToastItem } from "./components/Toast";
import { useCodexTauriEvents, type PendingAuthRefreshRequest } from "./hooks/useCodexTauriEvents";
import { KNOWN_DYNAMIC_TOOLS, TAURI_RUNTIME_TOOL_PROMPT } from "./lib/dynamicTools";

const ACTOR_STORAGE_KEY = "codex-local-tauri-actor-user-id";
const DEFAULT_DELETE_DELAY_MS = 10 * 60 * 1000;
function resolveActorUserId(): string {
  if (typeof window === "undefined") {
    return "demo-user";
  }

  const stored = window.localStorage.getItem(ACTOR_STORAGE_KEY)?.trim();
  if (stored) {
    return stored;
  }

  while (true) {
    const entered = window.prompt("Enter a username for this Codex session:")?.trim();
    if (entered) {
      window.localStorage.setItem(ACTOR_STORAGE_KEY, entered);
      return entered;
    }
    if (entered === undefined) {
      throw new Error("Username is required to start the Tauri Codex host.");
    }
  }
}

const sessionId = crypto.randomUUID();

type ToolQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
};

type PendingServerRequest = {
  requestId: string | number;
  method:
    | "item/commandExecution/requestApproval"
    | "item/fileChange/requestApproval"
    | "item/tool/requestUserInput"
    | "item/tool/call";
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string;
  questions?: ToolQuestion[];
};

type PickerThread = {
  threadId: string;
  status: string;
  updatedAt?: number;
};

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

export default function App() {
  const [actorUserId, setActorUserId] = useState<string>(() => resolveActorUserId());
  const actorBinding = useQuery(
    requireDefined(chatApi.getActorBindingForBootstrap, "api.chat.getActorBindingForBootstrap"),
  );
  const preferredBoundUserId = actorBinding?.lockEnabled
    ? actorBinding.pinnedUserId?.trim() || actorBinding.boundUserId?.trim() || null
    : actorBinding?.pinnedUserId?.trim() || null;
  const actorReady = actorBinding !== undefined && (!preferredBoundUserId || preferredBoundUserId === actorUserId);
  const actor: ActorContext = useMemo(
    () => ({ userId: actorUserId }),
    [actorUserId],
  );

  return (
    <CodexProvider api={chatApi} actor={actor}>
      <AppContent
        actor={actor}
        actorReady={actorReady}
        preferredBoundUserId={preferredBoundUserId}
        onActorChange={setActorUserId}
      />
    </CodexProvider>
  );
}

function AppContent({
  actor,
  actorReady,
  preferredBoundUserId,
  onActorChange,
}: {
  actor: ActorContext;
  actorReady: boolean;
  preferredBoundUserId: string | null;
  onActorChange: (userId: string) => void;
}) {
  const actorUserId = actor.userId ?? "";
  const [bridge, setBridge] = useState<BridgeState>({
    running: false,
    localThreadId: null,
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
  const [toolDrafts, setToolDrafts] = useState<Record<string, Record<string, string>>>({});
  const [toolOtherDrafts, setToolOtherDrafts] = useState<Record<string, Record<string, string>>>({});
  const [submittingRequestKey, setSubmittingRequestKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [chatgptAccountId, setChatgptAccountId] = useState("");
  const [chatgptPlanType, setChatgptPlanType] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [cancelLoginId, setCancelLoginId] = useState("");
  const [authSummary, setAuthSummary] = useState<string>("No account action yet.");
  const [pendingAuthRefresh, setPendingAuthRefresh] = useState<PendingAuthRefreshRequest[]>([]);

  const addToast = useCallback((type: ToastItem["type"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

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

  const accountAuth = useCodexAccountAuth<LoginAccountParams>({
    readAccount: tauriBridge.account.read,
    loginAccount: tauriBridge.account.login,
    cancelAccountLogin: tauriBridge.account.cancelLogin,
    logoutAccount: tauriBridge.account.logout,
    readAccountRateLimits: tauriBridge.account.readRateLimits,
    respondChatgptAuthTokensRefresh: tauriBridge.account.respondChatgptAuthTokensRefresh,
  });

  // Ref breaks the circular dependency: startBridgeWithSelection → selectedThreadId
  // → conversation.threads → useCodex() → composer.onSend → startBridgeWithSelection
  const selectedThreadIdRef = useRef("");

  const startBridgeWithSelection = useCallback(
    async (startSource: "manual_start_button" | "composer_retry") => {
      const resumeThreadId = selectedThreadIdRef.current.trim() || undefined;
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
        ...(resumeThreadId ? { threadStrategy: "resume" as const, threadId: resumeThreadId } : {}),
      });
    },
    [actor, actorReady, bridge.disabledTools, runtimeBridge],
  );

  const conversation = useCodex({
    // threadId omitted — derived from threads.selectedThreadId
    actorReady,
    threads: {
      list: {
        query: requireDefined(chatApi.listThreadsForPicker, "api.chat.listThreadsForPicker"),
        args: actorReady ? { actor, limit: 25 } : "skip",
      },
      initialSelectedThreadId: "",
    },
    composer: {
      onSend: async (text: string) => {
        try {
          await tauriBridge.turns.send(text);
          setBridge((prev) => ({ ...prev, lastError: null }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const transientBridgeFailure =
            message.includes("Broken pipe") ||
            message.includes("bridge helper is not running") ||
            message.includes("failed to write command");

          if (transientBridgeFailure) {
            try {
              await startBridgeWithSelection("composer_retry");
              await tauriBridge.turns.send(text);
              setBridge((prev) => ({ ...prev, lastError: null }));
              return;
            } catch (retryError) {
              const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
              setBridge((prev) => ({ ...prev, lastError: retryMessage }));
              addToast("error", retryMessage);
              throw retryError;
            }
          }

          setBridge((prev) => ({ ...prev, lastError: message }));
          addToast("error", message);
          throw error;
        }
      },
    },
    interrupt: {
      onInterrupt: async () => {
        await runtimeBridge.interrupt();
      },
    },
  });

  // ── Derive picker values from composed threads ──────────────────────
  const threads = conversation.threads!;
  const selectedThreadId = threads.selectedThreadId ?? "";
  const pickerThreads = useMemo(
    () => ((threads.threads as { threads?: PickerThread[] } | undefined)?.threads ?? []),
    [threads.threads],
  );
  selectedThreadIdRef.current = selectedThreadId;

  // Sync bridge-created threads into the picker selection
  useEffect(() => {
    if (bridge.localThreadId && conversation.threads) {
      conversation.threads.setSelectedThreadId(bridge.localThreadId);
    }
  }, [bridge.localThreadId, conversation.threads]);

  const cleanupThreadId = conversation.effectiveThreadId || null;

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

  const threadState = conversation.threadState;
  const threadActivity = conversation.activity;
  const ingestHealth = conversation.ingestHealth;
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

  const pendingServerRequestsRaw = useQuery(
    requireDefined(chatApi.listPendingServerRequests, "api.chat.listPendingServerRequests"),
    conversation.effectiveThreadId && actorReady ? { actor, threadId: conversation.effectiveThreadId, limit: 50 } : "skip",
  );
  const pendingServerRequests = (pendingServerRequestsRaw ?? []) as PendingServerRequest[];
  const scheduleDeleteThreadMutation = useMutation(
    requireDefined(chatApi.scheduleDeleteThread, "api.chat.scheduleDeleteThread"),
  );
  const scheduleDeleteTurnMutation = useMutation(
    requireDefined(chatApi.scheduleDeleteTurn, "api.chat.scheduleDeleteTurn"),
  );
  const purgeActorDataMutation = useMutation(
    requireDefined(chatApi.schedulePurgeActorData, "api.chat.schedulePurgeActorData"),
  );
  const cancelDeletionMutation = useMutation(
    requireDefined(chatApi.cancelDeletion, "api.chat.cancelDeletion"),
  );
  const forceRunDeletionMutation = useMutation(
    requireDefined(chatApi.forceRunDeletion, "api.chat.forceRunDeletion"),
  );
  const [activeDeletionJobId, setActiveDeletionJobId] = useState<string | null>(null);
  const [activeDeletionLabel, setActiveDeletionLabel] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const deletionStatus = useQuery(
    requireDefined(chatApi.getDeletionStatus, "api.chat.getDeletionStatus"),
    activeDeletionJobId && actorReady ? { actor, deletionJobId: activeDeletionJobId } : "skip",
  );
  const cleanupThreadState = useCodexThreadState(
    requireDefined(chatApi.threadSnapshot, "api.chat.threadSnapshot"),
    cleanupThreadId && actorReady ? { actor, threadId: cleanupThreadId } : "skip",
  );
  const cleanupThreadStateTurns = cleanupThreadState?.threadStatus === "ok" ? cleanupThreadState.data.turns : null;
  const latestThreadTurnId = useMemo(() => {
    if (!cleanupThreadStateTurns || cleanupThreadStateTurns.length === 0) {
      return null;
    }
    return cleanupThreadStateTurns[0]?.turnId ?? null;
  }, [cleanupThreadState?.threadStatus, cleanupThreadStateTurns]);

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

  useCodexTauriEvents({
    setBridge,
    setRuntimeLog,
    setAuthSummary,
    setPendingAuthRefresh,
    addToast,
    refreshBridgeState: runtimeBridge.refresh,
  });

  const onStartBridge = useCallback(async () => {
    await startBridgeWithSelection("manual_start_button");
  }, [startBridgeWithSelection]);

  const onInsertDynamicToolPrompt = () => {
    const prompt = TAURI_RUNTIME_TOOL_PROMPT;
    conversation.composer.setValue((prev) => (prev.trim() ? `${prev}\n\n${prompt}` : prompt));
  };

  const onSetDisabledTools = async (nextTools: string[]) => {
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
  };

  const onRespondCommandOrFile = async (
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
  };

  const onRespondToolUserInput = async (request: PendingServerRequest) => {
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
  };

  const setToolSelected = (request: PendingServerRequest, questionId: string, value: string) => {
    const key = requestKey(request.requestId);
    setToolDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [questionId]: value },
    }));
  };

  const setToolOther = (request: PendingServerRequest, questionId: string, value: string) => {
    const key = requestKey(request.requestId);
    setToolOtherDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [questionId]: value },
    }));
  };

  const runAuthAction = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      setBridge((prev) => ({ ...prev, lastError: null }));
      addToast("success", name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBridge((prev) => ({ ...prev, lastError: message }));
      addToast("error", message);
    }
  };

  const onAccountRead = (refreshToken: boolean) =>
    void runAuthAction(refreshToken ? "Account read (refresh requested)" : "Account read", async () => {
      await accountAuth.readAccount({ refreshToken });
    });

  const onLoginApiKey = () => {
    const key = apiKey.trim();
    if (!key) {
      addToast("error", "API key is required.");
      return;
    }
    void runAuthAction("API key login started", async () => {
      const params: LoginAccountParams = { type: "apiKey", apiKey: key };
      await accountAuth.loginAccount({ params });
    });
  };

  const onLoginChatgpt = () =>
    void runAuthAction("ChatGPT login started", async () => {
      const params: LoginAccountParams = { type: "chatgpt" };
      await accountAuth.loginAccount({ params });
    });

  const onLoginChatgptTokens = () => {
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
  };

  const onCancelLogin = () => {
    const loginId = cancelLoginId.trim();
    if (!loginId) {
      addToast("error", "Login ID is required.");
      return;
    }
    void runAuthAction("Login cancel requested", async () => {
      await accountAuth.cancelAccountLogin({ loginId });
    });
  };

  const onLogout = () =>
    void runAuthAction("Logout requested", async () => {
      await accountAuth.logoutAccount();
    });

  const onReadRateLimits = () =>
    void runAuthAction("Rate limits read requested", async () => {
      await accountAuth.readAccountRateLimits();
    });

  const onRespondAuthRefresh = (requestId: string | number) => {
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
  };

  const onDeleteCurrentThread = async () => {
    if (!cleanupThreadId || !actorReady || bridge.running) {
      return;
    }
    const confirmed = window.confirm(
      `Delete persisted Codex data for thread ${cleanupThreadId.slice(0, 12)}...?`,
    );
    if (!confirmed) {
      return;
    }
    try {
      const result = await scheduleDeleteThreadMutation({
        actor,
        threadId: cleanupThreadId,
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
  };

  const onDeleteLatestTurn = async () => {
    if (!cleanupThreadId || !latestThreadTurnId || !actorReady || bridge.running) {
      return;
    }
    const confirmed = window.confirm(
      `Delete persisted Codex data for turn ${latestThreadTurnId.slice(0, 12)}...?`,
    );
    if (!confirmed) {
      return;
    }
    try {
      const result = await scheduleDeleteTurnMutation({
        actor,
        threadId: cleanupThreadId,
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
  };

  const onPurgeActorData = async () => {
    if (!actorReady || bridge.running) {
      return;
    }
    const confirmed = window.confirm(
      `Purge all persisted Codex data for actor ${actor.userId}? This cannot be undone.`,
    );
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
  };

  const onUndoScheduledDeletion = async () => {
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
  };

  const onForceScheduledDeletion = async () => {
    if (!activeDeletionJobId || !actorReady || bridge.running) {
      return;
    }
    const confirmed = window.confirm("Force deletion now and bypass the grace period?");
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
  };

  return (
    <div className="app" role="main">
      <section className="panel chat">
        <Header
          bridge={bridge}
          actorUserId={actorUserId}
          actorReady={actorReady}
          preferredBoundUserId={preferredBoundUserId}
          onStart={onStartBridge}
          onStop={() => void runtimeBridge.stop()}
          onInterrupt={() => void conversation.interrupt()}
        />
        <ThreadPicker
          threads={pickerThreads}
          selected={selectedThreadId}
          onSelect={(nextThreadId) => threads.setSelectedThreadId(nextThreadId)}
          disabled={bridge.running}
        />
        <MessageList messages={displayMessages} status={messages.status} tokenByTurnId={tokenByTurnId} />
        {latestReasoning && (
          <div className="reasoning-banner" aria-live="polite" aria-label="Latest reasoning">
            <p className="reasoning-banner-label">Thinking</p>
            <p className="reasoning-banner-text">{latestReasoning.text || "(empty)"}</p>
          </div>
        )}
        <Composer
          value={conversation.composer.value}
          onChange={(value) => conversation.composer.setValue(value)}
          onSubmit={() => void conversation.composer.send()}
          onInsertToolPrompt={onInsertDynamicToolPrompt}
          disabled={!bridge.running}
          sending={conversation.composer.isSending}
        />
      </section>

      <aside className="side">
        <BridgeStatus bridge={bridge} />
        <ToolDisablePanel
          availableTools={[...KNOWN_DYNAMIC_TOOLS]}
          disabledTools={bridge.disabledTools ?? []}
          running={bridge.running}
          onSetDisabledTools={onSetDisabledTools}
        />
        <ApprovalList
          requests={pendingServerRequests}
          submittingRequestKey={submittingRequestKey}
          requestKeyFn={requestKey}
          onRespondCommandOrFile={onRespondCommandOrFile}
          onRespondToolUserInput={onRespondToolUserInput}
          toolDrafts={toolDrafts}
          toolOtherDrafts={toolOtherDrafts}
          setToolSelected={setToolSelected}
          setToolOther={setToolOther}
        />
        <TokenUsagePanel tokenUsage={tokenUsage} />
        <section className="panel card" aria-label="Data cleanup controls">
          <h2>Data cleanup</h2>
          <div className="auth-controls">
            <p className="meta">
              Stop runtime before scheduling cleanup of persisted data.
            </p>
            <p className="meta">
              Scheduled deletions run after 10 minutes unless you undo.
            </p>
            <div className="auth-row">
              <button
                className="danger"
                onClick={() => void onDeleteCurrentThread()}
                disabled={!cleanupThreadId || !actorReady || bridge.running}
              >
                Schedule Thread Delete
              </button>
              <button
                className="danger"
                onClick={() => void onDeleteLatestTurn()}
                disabled={!cleanupThreadId || !latestThreadTurnId || !actorReady || bridge.running}
              >
                Schedule Turn Delete
              </button>
            </div>
            <div className="auth-row">
              <button
                className="danger"
                onClick={() => void onPurgeActorData()}
                disabled={!actorReady || bridge.running}
              >
                Schedule Actor Purge
              </button>
            </div>
            <div className="auth-row">
              <button
                className="secondary"
                onClick={() => void onUndoScheduledDeletion()}
                disabled={
                  !activeDeletionJobId ||
                  !actorReady ||
                  bridge.running ||
                  deletionStatus?.status !== "scheduled"
                }
              >
                Undo Scheduled Delete
              </button>
              <button
                className="danger"
                onClick={() => void onForceScheduledDeletion()}
                disabled={
                  !activeDeletionJobId ||
                  !actorReady ||
                  bridge.running ||
                  deletionStatus?.status !== "scheduled"
                }
              >
                Delete Now (Force)
              </button>
            </div>
            <pre className="auth-summary code">
              {activeDeletionJobId
                ? `${activeDeletionLabel ?? "job"} ${activeDeletionJobId}\nstatus: ${deletionStatus?.status ?? "queued"}${
                    deletionStatus?.phase ? `\nphase: ${deletionStatus.phase}` : ""
                  }${
                    deletionStatus?.scheduledFor
                      ? `\nscheduledFor: ${new Date(deletionStatus.scheduledFor).toLocaleTimeString()}`
                      : ""
                  }${
                    scheduledDeleteCountdown !== null
                      ? `\nstartsIn: ${Math.ceil(scheduledDeleteCountdown / 60000)} min`
                      : ""
                  }`
                : "No active deletion job"}
            </pre>
          </div>
        </section>
        <section className="panel card" aria-label="Account and auth controls">
          <h2>Account/Auth</h2>
          <div className="auth-controls">
            <div className="auth-row">
              <button
                className="secondary"
                onClick={() => onAccountRead(false)}
                disabled={!bridge.running || accountAuth.isBusy}
              >
                Read Account
              </button>
              <button
                className="secondary"
                onClick={() => onAccountRead(true)}
                disabled={!bridge.running || accountAuth.isBusy}
              >
                Read + Refresh
              </button>
              <button
                className="danger"
                onClick={onLogout}
                disabled={!bridge.running || accountAuth.isBusy}
              >
                Logout
              </button>
            </div>

            <label className="auth-label" htmlFor="api-key-login">
              API Key Login
            </label>
            <div className="auth-row">
              <input
                id="api-key-login"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
                disabled={!bridge.running || accountAuth.isBusy}
              />
              <button onClick={onLoginApiKey} disabled={!bridge.running || accountAuth.isBusy}>
                Login
              </button>
            </div>

            <label className="auth-label" htmlFor="chatgpt-login">
              ChatGPT Login
            </label>
            <div className="auth-row">
              <button
                id="chatgpt-login"
                className="secondary"
                onClick={onLoginChatgpt}
                disabled={!bridge.running || accountAuth.isBusy}
              >
                Start OAuth Login
              </button>
            </div>

            <label className="auth-label" htmlFor="chatgpt-account-id-input">
              ChatGPT Token Login
            </label>
            <div className="auth-grid">
              <input
                id="chatgpt-account-id-input"
                type="text"
                value={chatgptAccountId}
                onChange={(event) => setChatgptAccountId(event.target.value)}
                placeholder="chatgptAccountId"
                disabled={!bridge.running || accountAuth.isBusy}
              />
              <input
                type="text"
                value={chatgptPlanType}
                onChange={(event) => setChatgptPlanType(event.target.value)}
                placeholder="chatgptPlanType (optional)"
                disabled={!bridge.running || accountAuth.isBusy}
              />
              <input
                type="password"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                placeholder="accessToken"
                disabled={!bridge.running || accountAuth.isBusy}
              />
            </div>
            <div className="auth-row">
              <button onClick={onLoginChatgptTokens} disabled={!bridge.running || accountAuth.isBusy}>
                Login With Tokens
              </button>
            </div>

            <label className="auth-label" htmlFor="cancel-login-id">
              Cancel Login
            </label>
            <div className="auth-row">
              <input
                id="cancel-login-id"
                type="text"
                value={cancelLoginId}
                onChange={(event) => setCancelLoginId(event.target.value)}
                placeholder="loginId"
                disabled={!bridge.running || accountAuth.isBusy}
              />
              <button
                className="secondary"
                onClick={onCancelLogin}
                disabled={!bridge.running || accountAuth.isBusy}
              >
                Cancel
              </button>
              <button
                className="secondary"
                onClick={onReadRateLimits}
                disabled={!bridge.running || accountAuth.isBusy}
              >
                Read Rate Limits
              </button>
            </div>

            {pendingAuthRefresh.length > 0 && (
              <div className="auth-refresh-list">
                <h3>Pending Auth Token Refresh</h3>
                {pendingAuthRefresh.map((request) => (
                  <div className="auth-refresh-item" key={`${typeof request.requestId}:${String(request.requestId)}`}>
                    <p className="code auth-refresh-meta">
                      id={String(request.requestId)} reason={request.reason}
                      {request.previousAccountId ? ` previousAccountId=${request.previousAccountId}` : ""}
                    </p>
                    <button
                      className="secondary"
                      onClick={() => onRespondAuthRefresh(request.requestId)}
                      disabled={!bridge.running || accountAuth.isBusy}
                    >
                      Respond With Tokens
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h3>Last Auth Result</h3>
            <pre className="auth-summary code">{authSummary}</pre>
          </div>
        </section>
        <EventLog
          threadState={threadState}
          threadActivity={threadActivity}
          ingestHealth={ingestHealth}
          runtimeLog={runtimeLog}
        />
      </aside>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
