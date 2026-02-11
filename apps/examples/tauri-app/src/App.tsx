import { useMemo, useState, useCallback } from "react";
import { useQuery } from "convex/react";
import {
  useCodexAccountAuth,
  useCodexConversationController,
  useCodexRuntimeBridge,
  useCodexThreadState,
  useCodexThreads,
} from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";
import {
  cancelAccountLogin,
  getBridgeState,
  interruptTurn,
  loginAccount,
  logoutAccount,
  readAccount,
  readAccountRateLimits,
  respondChatgptAuthTokensRefresh,
  respondCommandApproval,
  respondFileChangeApproval,
  respondToolUserInput,
  sendUserTurn,
  startBridge,
  stopBridge,
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
import { ToastContainer, type ToastItem } from "./components/Toast";
import { useCodexTauriEvents, type PendingAuthRefreshRequest } from "./hooks/useCodexTauriEvents";

const actor: ActorContext = {
  userId: "demo-user",
};

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
  runtimeThreadId?: string | null;
  status: string;
  createdAt?: number;
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
  const [bridge, setBridge] = useState<BridgeState>({
    running: false,
    localThreadId: null,
    turnId: null,
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
  const [idToken, setIdToken] = useState("");
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

  const threadId = bridge.localThreadId;
  const threads = useCodexThreads({
    list: {
      query: requireDefined(chatApi.listThreadsForPicker, "api.chat.listThreadsForPicker"),
      args: { actor, limit: 25 },
    },
    initialSelectedThreadId: "",
  });
  const selectedRuntimeThreadId = threads.selectedThreadId ?? "";

  const runtimeBridgeControls = useMemo(
    () => ({
      start: startBridge,
      stop: stopBridge,
      getState: getBridgeState,
      sendTurn: sendUserTurn,
      interrupt: interruptTurn,
    }),
    [],
  );
  const runtimeBridge = useCodexRuntimeBridge(runtimeBridgeControls);

  const accountAuth = useCodexAccountAuth<LoginAccountParams>({
    readAccount,
    loginAccount,
    cancelAccountLogin,
    logoutAccount,
    readAccountRateLimits,
    respondChatgptAuthTokensRefresh,
  });

  const startBridgeWithSelection = useCallback(async () => {
    const resumeThreadId = selectedRuntimeThreadId.trim() || undefined;
    await runtimeBridge.start({
      convexUrl: import.meta.env.VITE_CONVEX_URL,
      actor,
      sessionId,
      model: import.meta.env.VITE_CODEX_MODEL,
      cwd: import.meta.env.VITE_CODEX_CWD,
      deltaThrottleMs: 250,
      saveStreamDeltas: true,
      ...(resumeThreadId ? { threadStrategy: "resume" as const, runtimeThreadId: resumeThreadId } : {}),
    });
  }, [runtimeBridge, selectedRuntimeThreadId]);

  const conversation = useCodexConversationController({
    messages: {
      query: requireDefined(chatApi.listThreadMessagesForHooks, "api.chat.listThreadMessagesForHooks"),
      args: threadId ? { actor, threadId } : "skip",
      initialNumItems: 30,
      stream: true,
    },
    threadState: {
      query: requireDefined(chatApi.threadSnapshotSafe, "api.chat.threadSnapshotSafe"),
      args: threadId ? { actor, threadId } : "skip",
    },
    composer: {
      onSend: async (text: string) => {
        try {
          await sendUserTurn(text);
          setBridge((prev) => ({ ...prev, lastError: null }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const transientBridgeFailure =
            message.includes("Broken pipe") ||
            message.includes("bridge helper is not running") ||
            message.includes("failed to write command");

          if (transientBridgeFailure) {
            try {
              await startBridgeWithSelection();
              await sendUserTurn(text);
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

  const threadState = useCodexThreadState(
    requireDefined(chatApi.threadSnapshotSafe, "api.chat.threadSnapshotSafe"),
    threadId ? { actor, threadId } : "skip",
  );
  const threadActivity = conversation.activity;
  const ingestHealth = conversation.ingestHealth;

  const pendingServerRequestsRaw = useQuery(
    requireDefined(chatApi.listPendingServerRequestsForHooks, "api.chat.listPendingServerRequestsForHooks"),
    threadId ? { actor, threadId, limit: 50 } : "skip",
  );
  const pendingServerRequests = (pendingServerRequestsRaw ?? []) as PendingServerRequest[];
  useCodexTauriEvents({
    setBridge,
    setRuntimeLog,
    setAuthSummary,
    setPendingAuthRefresh,
    addToast,
    refreshBridgeState: runtimeBridge.refresh,
  });

  const onStartBridge = useCallback(async () => {
    await startBridgeWithSelection();
  }, [startBridgeWithSelection]);

  const onInsertDynamicToolPrompt = () => {
    const prompt =
      "Use the dynamic tool `tauri_get_runtime_snapshot` with includePendingRequests=true and summarize the response.";
    conversation.composer.setValue((prev) => (prev.trim() ? `${prev}\n\n${prompt}` : prompt));
  };

  const onRespondCommandOrFile = async (
    request: PendingServerRequest,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) => {
    const key = requestKey(request.requestId);
    setSubmittingRequestKey(key);
    try {
      if (request.method === "item/commandExecution/requestApproval") {
        await respondCommandApproval({ requestId: request.requestId, decision });
      } else {
        await respondFileChangeApproval({ requestId: request.requestId, decision });
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
      await respondToolUserInput({ requestId: request.requestId, answers });
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
    const id = idToken.trim();
    const access = accessToken.trim();
    if (!id || !access) {
      addToast("error", "ID token and access token are required.");
      return;
    }
    void runAuthAction("ChatGPT token login started", async () => {
      const params: LoginAccountParams = {
        type: "chatgptAuthTokens",
        idToken: id,
        accessToken: access,
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
    const id = idToken.trim();
    const access = accessToken.trim();
    if (!id || !access) {
      addToast("error", "Provide ID token and access token before responding.");
      return;
    }
    void runAuthAction("Auth refresh response sent", async () => {
      await accountAuth.respondChatgptAuthTokensRefresh({
        requestId,
        idToken: id,
        accessToken: access,
      });
      setPendingAuthRefresh((prev) =>
        prev.filter((item) => `${typeof item.requestId}:${String(item.requestId)}` !== `${typeof requestId}:${String(requestId)}`),
      );
    });
  };

  return (
    <div className="app" role="main">
      <section className="panel chat">
        <Header
          bridge={bridge}
          onStart={onStartBridge}
          onStop={() => void runtimeBridge.stop()}
          onInterrupt={() => void conversation.interrupt()}
        />
        <ThreadPicker
          threads={((threads.threads as { threads?: PickerThread[] } | undefined)?.threads ?? [])}
          selected={selectedRuntimeThreadId}
          onSelect={(runtimeThreadId) => threads.setSelectedThreadId(runtimeThreadId)}
          disabled={bridge.running}
        />
        <MessageList messages={displayMessages} status={messages.status} />
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

            <label className="auth-label" htmlFor="id-token-input">
              ChatGPT Token Login
            </label>
            <div className="auth-grid">
              <input
                id="id-token-input"
                type="password"
                value={idToken}
                onChange={(event) => setIdToken(event.target.value)}
                placeholder="idToken"
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
