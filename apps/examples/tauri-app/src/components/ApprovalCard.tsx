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
    | "item/tool/requestUserInput";
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string;
  questions?: ToolQuestion[];
};

type Props = {
  request: PendingServerRequest;
  requestKey: string;
  isSubmitting: boolean;
  onRespondCommandOrFile: (
    request: PendingServerRequest,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) => void;
  onRespondToolUserInput: (request: PendingServerRequest) => void;
  toolDrafts: Record<string, Record<string, string>>;
  toolOtherDrafts: Record<string, Record<string, string>>;
  setToolSelected: (
    request: PendingServerRequest,
    questionId: string,
    value: string,
  ) => void;
  setToolOther: (
    request: PendingServerRequest,
    questionId: string,
    value: string,
  ) => void;
};

function getUrgency(method: string): { level: string; label: string } {
  if (method === "item/commandExecution/requestApproval")
    return { level: "high", label: "COMMAND" };
  if (method === "item/fileChange/requestApproval")
    return { level: "medium", label: "FILE CHANGE" };
  return { level: "low", label: "INPUT" };
}

export function ApprovalCard({
  request,
  requestKey: key,
  isSubmitting,
  onRespondCommandOrFile,
  onRespondToolUserInput,
  toolDrafts,
  toolOtherDrafts,
  setToolSelected,
  setToolOther,
}: Props) {
  const urgency = getUrgency(request.method);
  const isCommandOrFile =
    request.method === "item/commandExecution/requestApproval" ||
    request.method === "item/fileChange/requestApproval";

  return (
    <div
      className={`approval urgency-${urgency.level}`}
      role="alert"
      aria-label={`${urgency.label} approval request`}
    >
      <div className="approval-header">
        <span className={`urgency-badge ${urgency.level}`}>
          {urgency.label}
        </span>
        <span className="code approval-meta">
          turn: {request.turnId.slice(0, 12)}...
        </span>
      </div>
      {request.reason && (
        <p className="approval-reason">{request.reason}</p>
      )}
      <p className="code approval-meta">item: {request.itemId}</p>

      {isCommandOrFile && (
        <div className="controls">
          <button
            className="secondary"
            disabled={isSubmitting}
            onClick={() => onRespondCommandOrFile(request, "accept")}
            aria-label="Accept"
          >
            Accept
          </button>
          <button
            className="secondary"
            disabled={isSubmitting}
            onClick={() => onRespondCommandOrFile(request, "acceptForSession")}
            aria-label="Accept for session"
          >
            Accept Session
          </button>
          <button
            className="danger"
            disabled={isSubmitting}
            onClick={() => onRespondCommandOrFile(request, "decline")}
            aria-label="Decline"
          >
            Decline
          </button>
          <button
            className="danger"
            disabled={isSubmitting}
            onClick={() => onRespondCommandOrFile(request, "cancel")}
            aria-label="Cancel"
          >
            Cancel
          </button>
        </div>
      )}

      {request.method === "item/tool/requestUserInput" && (
        <div className="tool-questions">
          {(request.questions ?? []).map((question) => {
            const selected = toolDrafts[key]?.[question.id] ?? "";
            const needsOther =
              selected === "__other__" ||
              !question.options ||
              question.options.length === 0;
            const showOtherInput = needsOther || question.isOther;

            return (
              <div className="tool-question" key={`${key}:${question.id}`}>
                <p className="tool-question-header">
                  <strong>{question.header}</strong>
                </p>
                <p className="code">{question.question}</p>
                {question.options && question.options.length > 0 && (
                  <select
                    value={selected}
                    onChange={(e) =>
                      setToolSelected(request, question.id, e.target.value)
                    }
                    disabled={isSubmitting}
                    aria-label={question.header}
                  >
                    <option value="">Select an option</option>
                    {question.options.map((option) => (
                      <option key={option.label} value={option.label}>
                        {option.label} — {option.description}
                      </option>
                    ))}
                    {question.isOther && (
                      <option value="__other__">Other</option>
                    )}
                  </select>
                )}
                {showOtherInput && (
                  <input
                    value={toolOtherDrafts[key]?.[question.id] ?? ""}
                    onChange={(e) =>
                      setToolOther(request, question.id, e.target.value)
                    }
                    placeholder={
                      question.isSecret ? "Enter secret" : "Enter answer"
                    }
                    type={question.isSecret ? "password" : "text"}
                    disabled={isSubmitting}
                    aria-label={`Answer for ${question.header}`}
                  />
                )}
              </div>
            );
          })}
          <div className="controls">
            <button
              className="secondary"
              disabled={isSubmitting}
              onClick={() => onRespondToolUserInput(request)}
              aria-label="Submit answers"
            >
              Submit Answers
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
