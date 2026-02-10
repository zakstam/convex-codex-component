import { useEffect, useMemo, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery } from "convex/react";
import { useCodexMessages, useCodexThreadState } from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";
import {
  getBridgeState,
  interruptTurn,
  respondCommandApproval,
  respondFileChangeApproval,
  respondToolUserInput,
  sendUserTurn,
  startBridge,
  stopBridge,
  type ActorContext,
  type BridgeState,
} from "./lib/tauriBridge";
import { Header } from "./components/Header";
import { BridgeStatus } from "./components/BridgeStatus";
import { ThreadPicker } from "./components/ThreadPicker";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { ApprovalList } from "./components/ApprovalList";
import { EventLog } from "./components/EventLog";
import { ToastContainer, type ToastItem } from "./components/Toast";

function loadStableDeviceId(): string {
  if (typeof window === "undefined") {
    return `tauri-${Math.random().toString(36).slice(2, 8)}`;
  }
  const key = "codex-local-tauri-device-id";
  const existing = window.localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const created = `tauri-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(key, created);
  return created;
}

const actor: ActorContext = {
  tenantId: "demo-tenant",
  userId: "demo-user",
  deviceId: loadStableDeviceId(),
};

const sessionId = crypto.randomUUID();

type BridgeStateEvent = Partial<BridgeState>;

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
  });
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [runtimeLog, setRuntimeLog] = useState<Array<{ id: string; line: string }>>([]);
  const [selectedRuntimeThreadId, setSelectedRuntimeThreadId] = useState<string>("");
  const [toolDrafts, setToolDrafts] = useState<Record<string, Record<string, string>>>({});
  const [toolOtherDrafts, setToolOtherDrafts] = useState<Record<string, Record<string, string>>>({});
  const [submittingRequestKey, setSubmittingRequestKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastItem["type"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const threadId = bridge.localThreadId;
  const listedThreads = useQuery(
    requireDefined(chatApi.listThreadsForPicker, "api.chat.listThreadsForPicker"),
    { actor, limit: 25 },
  );

  const messageArgs = useMemo(() => {
    if (!threadId) {
      return "skip" as const;
    }
    return { actor, threadId };
  }, [threadId]);

  const messages = useCodexMessages(
    requireDefined(chatApi.listThreadMessagesForHooks, "api.chat.listThreadMessagesForHooks"),
    messageArgs,
    { initialNumItems: 30, stream: true },
  );

  const threadState = useCodexThreadState(
    requireDefined(chatApi.threadSnapshot, "api.chat.threadSnapshot"),
    threadId ? { actor, threadId } : "skip",
  );

  const pendingServerRequestsRaw = useQuery(
    requireDefined(chatApi.listPendingServerRequestsForHooks, "api.chat.listPendingServerRequestsForHooks"),
    threadId ? { actor, threadId, limit: 50 } : "skip",
  );
  const pendingServerRequests = (pendingServerRequestsRaw ?? []) as PendingServerRequest[];

  useEffect(() => {
    let unsubs: Array<() => void> = [];

    const attach = async () => {
      const [stateUnsub, eventUnsub, errorUnsub, globalUnsub] = await Promise.all([
        listen<BridgeStateEvent>("codex:bridge_state", (event) => {
          setBridge((prev) => {
            const next = { ...prev, ...event.payload };
            if (!prev.running && next.running) addToast("info", "Runtime started");
            if (prev.running && !next.running) addToast("info", "Runtime stopped");
            return next;
          });
        }),
        listen<{ kind: string; turnId?: string; threadId?: string }>("codex:event", (event) => {
          const line = `${event.payload.kind} (${event.payload.turnId ?? "-"})`;
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setRuntimeLog((prev) => [{ id, line }, ...prev].slice(0, 8));
        }),
        listen<{ message: string }>("codex:protocol_error", (event) => {
          setBridge((prev) => ({ ...prev, lastError: event.payload.message }));
          console.error("[codex:protocol_error]", event.payload.message, event.payload);
          addToast("error", event.payload.message);
        }),
        listen<Record<string, unknown>>("codex:global_message", (event) => {
          const payload = event.payload ?? {};
          if (payload.error) {
            console.error("[codex:global_message:error]", payload);
          } else if (payload.kind === "sync/session_rolled_over") {
            console.warn("[codex:global_message:session_rolled_over]", payload);
          } else {
            console.debug("[codex:global_message]", payload);
          }
        }),
      ]);
      unsubs = [stateUnsub, eventUnsub, errorUnsub, globalUnsub];

      const state = await getBridgeState();
      setBridge(state);
    };

    void attach();

    return () => {
      for (const off of unsubs) {
        off();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onStartBridge = async () => {
    const resumeThreadId = selectedRuntimeThreadId.trim() || undefined;
    await startBridge({
      convexUrl: import.meta.env.VITE_CONVEX_URL,
      actor,
      sessionId,
      model: import.meta.env.VITE_CODEX_MODEL,
      cwd: import.meta.env.VITE_CODEX_CWD,
      deltaThrottleMs: 250,
      saveStreamDeltas: true,
      ...(resumeThreadId ? { threadStrategy: "resume" as const, runtimeThreadId: resumeThreadId } : {}),
    });
  };

  const onSubmit = async () => {
    const text = composer.trim();
    if (!text) return;

    setSending(true);
    try {
      await sendUserTurn(text);
      setComposer("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transientBridgeFailure =
        message.includes("Broken pipe") ||
        message.includes("bridge helper is not running") ||
        message.includes("failed to write command");

      if (transientBridgeFailure) {
        try {
          await onStartBridge();
          await sendUserTurn(text);
          setComposer("");
          setBridge((prev) => ({ ...prev, lastError: null }));
          return;
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          setBridge((prev) => ({ ...prev, lastError: retryMessage }));
          addToast("error", retryMessage);
          return;
        }
      }

      setBridge((prev) => ({ ...prev, lastError: message }));
      addToast("error", message);
    } finally {
      setSending(false);
    }
  };

  const onInsertDynamicToolPrompt = () => {
    const prompt =
      "Use the dynamic tool `tauri_get_runtime_snapshot` with includePendingRequests=true and summarize the response.";
    setComposer((prev) => (prev.trim() ? `${prev}\n\n${prompt}` : prompt));
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

  return (
    <div className="app" role="main">
      <section className="panel chat">
        <Header
          bridge={bridge}
          onStart={onStartBridge}
          onStop={() => void stopBridge()}
          onInterrupt={() => void interruptTurn()}
        />
        <ThreadPicker
          threads={listedThreads?.threads ?? []}
          selected={selectedRuntimeThreadId}
          onSelect={setSelectedRuntimeThreadId}
          disabled={bridge.running}
        />
        <MessageList messages={messages.results} status={messages.status} />
        <Composer
          value={composer}
          onChange={setComposer}
          onSubmit={onSubmit}
          onInsertToolPrompt={onInsertDynamicToolPrompt}
          disabled={!bridge.running}
          sending={sending}
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
        <EventLog threadState={threadState} runtimeLog={runtimeLog} />
      </aside>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
