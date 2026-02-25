import { useState, useCallback, type Dispatch, type SetStateAction } from "react";
import { bridge as tauriBridge, type BridgeState } from "../lib/tauriBridge";
import type { ToastItem } from "../components/Toast";

function requestKey(requestId: string | number): string {
  return `${typeof requestId}:${String(requestId)}`;
}

// ── Types ───────────────────────────────────────────────────────────────────

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

// ── Props ───────────────────────────────────────────────────────────────────

export type UseApprovalsProps = {
  addToast: (type: ToastItem["type"], message: string) => void;
  setBridge: Dispatch<SetStateAction<BridgeState>>;
};

// ── Return type ─────────────────────────────────────────────────────────────

export type UseApprovalsReturn = {
  toolDrafts: Record<string, Record<string, string>>;
  toolOtherDrafts: Record<string, Record<string, string>>;
  submittingRequestKey: string | null;
  onRespondCommandOrFile: (
    request: PendingServerRequest,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) => Promise<void>;
  onRespondToolUserInput: (request: PendingServerRequest) => Promise<void>;
  setToolSelected: (request: PendingServerRequest, questionId: string, value: string) => void;
  setToolOther: (request: PendingServerRequest, questionId: string, value: string) => void;
};

// ── Hook implementation ─────────────────────────────────────────────────────

export function useApprovals({ addToast, setBridge }: UseApprovalsProps): UseApprovalsReturn {
  const [toolDrafts, setToolDrafts] = useState<Record<string, Record<string, string>>>({});
  const [toolOtherDrafts, setToolOtherDrafts] = useState<Record<string, Record<string, string>>>({});
  const [submittingRequestKey, setSubmittingRequestKey] = useState<string | null>(null);

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
  }, [addToast, setBridge]);

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
  }, [addToast, setBridge, toolDrafts, toolOtherDrafts]);

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

  return {
    toolDrafts,
    toolOtherDrafts,
    submittingRequestKey,
    onRespondCommandOrFile,
    onRespondToolUserInput,
    setToolSelected,
    setToolOther,
  };
}
