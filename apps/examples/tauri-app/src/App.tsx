import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useCodexApprovals, useCodexMessages, useCodexThreadState } from "@zakstam/codex-local-component/react";
import { api } from "../convex/_generated/api";
import { getBridgeState, interruptTurn, sendUserTurn, startBridge, stopBridge, type ActorContext, type BridgeState } from "./lib/tauriBridge";

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

function requireDefined<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing generated Convex reference: ${name}`);
  }
  return value;
}

const chatApi = requireDefined(api.chat, "api.chat");

export default function App() {
  const [bridge, setBridge] = useState<BridgeState>({
    running: false,
    threadId: null,
    turnId: null,
    lastError: null,
  });
  const [composer, setComposer] = useState("");
  const [runtimeLog, setRuntimeLog] = useState<Array<{ id: string; line: string }>>([]);

  const threadId = bridge.threadId;

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

  const approvals = useCodexApprovals(
    requireDefined(chatApi.listPendingApprovalsForHooks, "api.chat.listPendingApprovalsForHooks"),
    threadId ? { actor, threadId } : "skip",
    requireDefined(chatApi.respondApprovalForHooks, "api.chat.respondApprovalForHooks"),
    { initialNumItems: 20 },
  );

  const threadState = useCodexThreadState(
    requireDefined(chatApi.threadSnapshot, "api.chat.threadSnapshot"),
    threadId ? { actor, threadId } : "skip",
  );

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

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    if (!import.meta.env.VITE_CONVEX_URL) {
      return;
    }
    if (bridge.running) {
      return;
    }
    void onStartBridge();
  }, [bridge.running]);

  const onStartBridge = async () => {
    await startBridge({
      convexUrl: import.meta.env.VITE_CONVEX_URL,
      actor,
      sessionId,
      model: import.meta.env.VITE_CODEX_MODEL,
      cwd: import.meta.env.VITE_CODEX_CWD,
      deltaThrottleMs: 250,
      saveStreamDeltas: true,
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

  return (
    <div className="app">
      <section className="panel chat">
        <header className="header">
          <div>
            <h1>Codex Local Desktop</h1>
            <p className="meta">Tauri + Convex durable streams</p>
            <p className="meta">thread: {threadId ?? "(none yet)"}</p>
          </div>
          <div className="controls">
            <button onClick={onStartBridge} disabled={bridge.running}>Start Runtime</button>
            <button className="secondary" onClick={() => void stopBridge()} disabled={!bridge.running}>Stop</button>
            <button className="danger" onClick={() => void interruptTurn()} disabled={!bridge.turnId}>Interrupt</button>
          </div>
        </header>

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
          <p className="code">lastError: {bridge.lastError ?? "-"}</p>
        </section>

        <section className="panel card">
          <h2>Pending Approvals</h2>
          {approvals.results.length === 0 ? <p className="code">No pending approvals</p> : null}
          {approvals.results.map((approval) => (
            <div className="approval" key={approval.itemId}>
              <p><strong>{approval.kind}</strong></p>
              <p className="code">turn: {approval.turnId}</p>
              <div className="controls">
                <button
                  className="secondary"
                  onClick={() => void approvals.accept({ actor, threadId: approval.threadId, turnId: approval.turnId, itemId: approval.itemId })}
                >
                  Accept
                </button>
                <button
                  className="danger"
                  onClick={() => void approvals.decline({ actor, threadId: approval.threadId, turnId: approval.turnId, itemId: approval.itemId })}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
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
