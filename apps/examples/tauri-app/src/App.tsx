import { useEffect, useMemo, useState } from "react";
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
  method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/tool/requestUserInput";
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
    threadId: null,
    turnId: null,
    lastError: null,
    pendingServerRequestCount: 0,
  });
  const [composer, setComposer] = useState("");
  const [runtimeLog, setRuntimeLog] = useState<Array<{ id: string; line: string }>>([]);
  const [selectedRuntimeThreadId, setSelectedRuntimeThreadId] = useState<string>("");
  const [toolDrafts, setToolDrafts] = useState<Record<string, Record<string, string>>>({});
  const [toolOtherDrafts, setToolOtherDrafts] = useState<Record<string, Record<string, string>>>({});
  const [submittingRequestKey, setSubmittingRequestKey] = useState<string | null>(null);

  const threadId = bridge.threadId;
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
      const [stateUnsub, eventUnsub, errorUnsub] = await Promise.all([
        listen<BridgeStateEvent>("codex:bridge_state", (event) => {
          setBridge((prev) => ({ ...prev, ...event.payload }));
        }),
        listen<{ kind: string; turnId?: string; threadId?: string }>("codex:event", (event) => {
          const line = `${event.payload.kind} (${event.payload.turnId ?? "-"})`;
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setRuntimeLog((prev) => [{ id, line }, ...prev].slice(0, 8));
        }),
        listen<{ message: string }>("codex:protocol_error", (event) => {
          setBridge((prev) => ({ ...prev, lastError: event.payload.message }));
        }),
      ]);
      unsubs = [stateUnsub, eventUnsub, errorUnsub];

      const state = await getBridgeState();
      setBridge(state);
    };

    void attach();

    return () => {
      for (const off of unsubs) {
        off();
      }
    };
  }, []);

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
    if (!text) {
      return;
    }
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
          const retryMessage =
            retryError instanceof Error ? retryError.message : String(retryError);
          setBridge((prev) => ({ ...prev, lastError: retryMessage }));
          return;
        }
      }

      setBridge((prev) => ({ ...prev, lastError: message }));
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
        await respondCommandApproval({
          requestId: request.requestId,
          decision,
        });
      } else {
        await respondFileChangeApproval({
          requestId: request.requestId,
          decision,
        });
      }
      setBridge((prev) => ({ ...prev, lastError: null }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBridge((prev) => ({ ...prev, lastError: message }));
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
        return;
      }

      if (!other) {
        setBridge((prev) => ({ ...prev, lastError: `Missing answer for question: ${question.header}` }));
        return;
      }
      answers[question.id] = { answers: [other] };
    }

    setSubmittingRequestKey(key);
    try {
      await respondToolUserInput({
        requestId: request.requestId,
        answers,
      });
      setBridge((prev) => ({ ...prev, lastError: null }));
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
    } finally {
      setSubmittingRequestKey((current) => (current === key ? null : current));
    }
  };

  const setToolSelected = (request: PendingServerRequest, questionId: string, value: string) => {
    const key = requestKey(request.requestId);
    setToolDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? {}),
        [questionId]: value,
      },
    }));
  };

  const setToolOther = (request: PendingServerRequest, questionId: string, value: string) => {
    const key = requestKey(request.requestId);
    setToolOtherDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? {}),
        [questionId]: value,
      },
    }));
  };

  return (
    <div className="app">
      <section className="panel chat">
        <header className="header">
          <div>
            <h1>Codex Local Desktop</h1>
            <p className="meta">Tauri + Convex durable streams</p>
            <p className="meta">thread: {threadId ?? "(none yet)"}</p>
            <p className="meta">runtimeThread: {bridge.runtimeThreadId ?? "(none yet)"}</p>
          </div>
          <div className="controls">
            <button onClick={onStartBridge} disabled={bridge.running}>Start Runtime</button>
            <button className="secondary" onClick={() => void stopBridge()} disabled={!bridge.running}>Stop</button>
            <button className="danger" onClick={() => void interruptTurn()} disabled={!bridge.turnId}>Interrupt</button>
          </div>
        </header>

        <div className="panel card">
          <h2>Resume Previous Thread</h2>
          <p className="meta">Pick a previously persisted thread mapping, then start runtime to resume it.</p>
          <select
            value={selectedRuntimeThreadId}
            onChange={(event) => setSelectedRuntimeThreadId(event.target.value)}
            disabled={bridge.running}
          >
            <option value="">Start a new thread</option>
            {(listedThreads?.threads ?? [])
              .filter((thread) => !!thread.runtimeThreadId)
              .map((thread) => (
                <option key={thread.threadId} value={thread.runtimeThreadId ?? ""}>
                  {thread.threadId} • {thread.status} • runtime:{thread.runtimeThreadId}
                </option>
              ))}
          </select>
        </div>

        <div className="messages">
          {messages.results.map((message) => (
            <article className={`msg ${message.role === "user" ? "user" : "assistant"}`} key={message.messageId}>
              <p className="label">
                {message.role}
                <span className="status">{message.status}</span>
              </p>
              <div>{message.text || "(empty)"}</div>
            </article>
          ))}
        </div>

        <div className="composer">
          <textarea
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            placeholder="Send a turn to the local codex runtime"
          />
          <button onClick={onSubmit} disabled={!bridge.running}>Send</button>
        </div>
      </section>

      <aside className="side">
        <section className="panel card">
          <h2>Bridge State</h2>
          <p className="code">running: {String(bridge.running)}</p>
          <p className="code">turnId: {bridge.turnId ?? "-"}</p>
          <p className="code">pendingServerRequests: {bridge.pendingServerRequestCount ?? 0}</p>
          <p className="code">lastError: {bridge.lastError ?? "-"}</p>
        </section>

        <section className="panel card">
          <h2>Pending Requests</h2>
          {pendingServerRequests.length === 0 ? <p className="code">No pending server requests</p> : null}
          {pendingServerRequests.map((request) => {
            const key = requestKey(request.requestId);
            const isSubmitting = submittingRequestKey === key;

            return (
              <div className="approval" key={key}>
                <p><strong>{request.method}</strong></p>
                <p className="code">requestId: {String(request.requestId)}</p>
                <p className="code">turn: {request.turnId}</p>
                <p className="code">item: {request.itemId}</p>
                {request.reason ? <p className="code">reason: {request.reason}</p> : null}

                {(request.method === "item/commandExecution/requestApproval" ||
                  request.method === "item/fileChange/requestApproval") ? (
                  <div className="controls">
                    <button
                      className="secondary"
                      disabled={isSubmitting}
                      onClick={() => void onRespondCommandOrFile(request, "accept")}
                    >
                      Accept
                    </button>
                    <button
                      className="secondary"
                      disabled={isSubmitting}
                      onClick={() => void onRespondCommandOrFile(request, "acceptForSession")}
                    >
                      Accept Session
                    </button>
                    <button
                      className="danger"
                      disabled={isSubmitting}
                      onClick={() => void onRespondCommandOrFile(request, "decline")}
                    >
                      Decline
                    </button>
                    <button
                      className="danger"
                      disabled={isSubmitting}
                      onClick={() => void onRespondCommandOrFile(request, "cancel")}
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}

                {request.method === "item/tool/requestUserInput" ? (
                  <div>
                    {(request.questions ?? []).map((question) => {
                      const selected = toolDrafts[key]?.[question.id] ?? "";
                      const needsOther = selected === "__other__" || (!question.options || question.options.length === 0);
                      const showOtherInput = needsOther || question.isOther;

                      return (
                        <div className="approval" key={`${key}:${question.id}`}>
                          <p><strong>{question.header}</strong></p>
                          <p className="code">{question.question}</p>
                          {question.options && question.options.length > 0 ? (
                            <select
                              value={selected}
                              onChange={(event) => setToolSelected(request, question.id, event.target.value)}
                              disabled={isSubmitting}
                            >
                              <option value="">Select an option</option>
                              {question.options.map((option) => (
                                <option key={option.label} value={option.label}>
                                  {option.label} - {option.description}
                                </option>
                              ))}
                              {question.isOther ? <option value="__other__">Other</option> : null}
                            </select>
                          ) : null}
                          {showOtherInput ? (
                            <input
                              value={toolOtherDrafts[key]?.[question.id] ?? ""}
                              onChange={(event) => setToolOther(request, question.id, event.target.value)}
                              placeholder={question.isSecret ? "Enter secret" : "Enter answer"}
                              type={question.isSecret ? "password" : "text"}
                              disabled={isSubmitting}
                            />
                          ) : null}
                        </div>
                      );
                    })}

                    <div className="controls">
                      <button
                        className="secondary"
                        disabled={isSubmitting}
                        onClick={() => void onRespondToolUserInput(request)}
                      >
                        Submit Answers
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>

        <section className="panel card">
          <h2>Thread Snapshot</h2>
          <p className="code">messages: {threadState?.recentMessages.length ?? 0}</p>
          <p className="code">streams: {threadState?.streamStats.length ?? 0}</p>
          <p className="code">events:</p>
          {runtimeLog.map((entry) => (
            <p className="code" key={entry.id}>{entry.line}</p>
          ))}
        </section>
      </aside>
    </div>
  );
}
