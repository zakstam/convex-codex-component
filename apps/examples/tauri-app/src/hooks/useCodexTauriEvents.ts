import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";
import type { BridgeState } from "../lib/tauriBridge";
import type { ToastItem } from "../components/Toast";

export type PendingAuthRefreshRequest = {
  requestId: string | number;
  reason: string;
  previousAccountId: string | null;
};

type RuntimeLogEntry = { id: string; line: string };

type BridgeStateEvent = Partial<BridgeState>;

type UseCodexTauriEventsOptions = {
  setBridge: Dispatch<SetStateAction<BridgeState>>;
  setRuntimeLog: Dispatch<SetStateAction<RuntimeLogEntry[]>>;
  setAuthSummary: Dispatch<SetStateAction<string>>;
  setPendingAuthRefresh: Dispatch<SetStateAction<PendingAuthRefreshRequest[]>>;
  addToast: (type: ToastItem["type"], message: string) => void;
  refreshBridgeState: () => Promise<Partial<BridgeState> | null | undefined>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function useCodexTauriEvents({
  setBridge,
  setRuntimeLog,
  setAuthSummary,
  setPendingAuthRefresh,
  addToast,
  refreshBridgeState,
}: UseCodexTauriEventsOptions) {
  const setBridgeRef = useRef(setBridge);
  const setRuntimeLogRef = useRef(setRuntimeLog);
  const setAuthSummaryRef = useRef(setAuthSummary);
  const setPendingAuthRefreshRef = useRef(setPendingAuthRefresh);
  const addToastRef = useRef(addToast);
  const refreshBridgeStateRef = useRef(refreshBridgeState);
  const lastRunningRef = useRef<boolean | null>(null);

  useEffect(() => {
    setBridgeRef.current = setBridge;
    setRuntimeLogRef.current = setRuntimeLog;
    setAuthSummaryRef.current = setAuthSummary;
    setPendingAuthRefreshRef.current = setPendingAuthRefresh;
    addToastRef.current = addToast;
    refreshBridgeStateRef.current = refreshBridgeState;
  }, [addToast, refreshBridgeState, setAuthSummary, setBridge, setPendingAuthRefresh, setRuntimeLog]);

  useEffect(() => {
    let disposed = false;
    let unsubs: Array<() => void> = [];

    const attach = async () => {
      const nextUnsubs = await Promise.all([
        listen<BridgeStateEvent>("codex:bridge_state", (event) => {
          setBridgeRef.current((prev) => {
            const next = { ...prev, ...event.payload };
            const previousRunning = lastRunningRef.current ?? prev.running;
            if (previousRunning === false && next.running === true) {
              addToastRef.current("info", "Runtime started");
            } else if (previousRunning === true && next.running === false) {
              addToastRef.current("info", "Runtime stopped");
            }
            lastRunningRef.current = next.running;
            return next;
          });
        }),
        listen<{ kind: string; turnId?: string; threadId?: string }>("codex:event", (event) => {
          const line = `${event.payload.kind} (${event.payload.turnId ?? "-"})`;
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setRuntimeLogRef.current((prev) => [{ id, line }, ...prev].slice(0, 8));
        }),
        listen<{ message: string }>("codex:protocol_error", (event) => {
          setBridgeRef.current((prev) => ({ ...prev, lastError: event.payload.message }));
          console.error("[codex:protocol_error]", event.payload.message, event.payload);
          addToastRef.current("error", event.payload.message);
        }),
        listen<Record<string, unknown>>("codex:global_message", (event) => {
          const payload = event.payload ?? {};
          const record = asRecord(payload);
          if (!record) {
            return;
          }
          if (record.error) {
            console.error("[codex:global_message:error]", payload);
          } else if (record.kind === "sync/session_rolled_over") {
            console.warn("[codex:global_message:session_rolled_over]", payload);
          } else {
            console.debug("[codex:global_message]", payload);
          }

          const method = typeof record.method === "string" ? record.method : null;
          if (method === "account/chatgptAuthTokens/refresh") {
            const requestId = record.id;
            const params = asRecord(record.params);
            if ((typeof requestId === "string" || typeof requestId === "number") && params) {
              const reason = typeof params.reason === "string" ? params.reason : "unknown";
              const previousAccountId =
                typeof params.previousAccountId === "string" ? params.previousAccountId : null;
              setPendingAuthRefreshRef.current((prev) => {
                const key = `${typeof requestId}:${String(requestId)}`;
                const filtered = prev.filter(
                  (item) => `${typeof item.requestId}:${String(item.requestId)}` !== key,
                );
                return [...filtered, { requestId, reason, previousAccountId }];
              });
              addToastRef.current("info", "Auth token refresh requested by runtime");
            }
            return;
          }

          if (method === "account/login/completed") {
            const params = asRecord(record.params);
            const success = typeof params?.success === "boolean" ? params.success : null;
            if (success === true) {
              addToastRef.current("success", "Login completed");
            } else if (success === false) {
              addToastRef.current("error", "Login failed");
            }
            return;
          }

          if (
            record.kind === "account/read_result" ||
            record.kind === "account/login_start_result" ||
            record.kind === "account/login_cancel_result" ||
            record.kind === "account/logout_result" ||
            record.kind === "account/rate_limits_read_result"
          ) {
            setAuthSummaryRef.current(JSON.stringify(record.response ?? {}, null, 2));
          }
        }),
      ]);
      if (disposed) {
        for (const off of nextUnsubs) {
          off();
        }
        return;
      }
      unsubs = nextUnsubs;

      const state = await refreshBridgeStateRef.current();
      if (!disposed && state) {
        if (typeof state.running === "boolean") {
          lastRunningRef.current = state.running;
        }
        setBridgeRef.current((prev) => ({ ...prev, ...state }));
      }
    };

    void attach();

    return () => {
      disposed = true;
      for (const off of unsubs) {
        off();
      }
    };
  }, []);
}
