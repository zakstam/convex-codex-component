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
  conversationId: string;
  turnId: string;
  itemId: string;
  reason?: string;
  questions?: ToolQuestion[];
};

type Props = {
  requests: PendingServerRequest[];
  submittingKey: string | null;
  toolDrafts: Record<string, Record<string, string>>;
  toolOtherDrafts: Record<string, Record<string, string>>;
  onRespondCommandOrFile: (
    request: PendingServerRequest,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) => void;
  onRespondToolUserInput: (request: PendingServerRequest) => void;
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

type UrgencyInfo = {
  level: "high" | "medium" | "low";
  label: string;
  icon: string;
};

function getUrgency(method: PendingServerRequest["method"]): UrgencyInfo {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return { level: "high", label: "Run Command", icon: "\u26a0" };
    case "item/fileChange/requestApproval":
      return { level: "medium", label: "File Change", icon: "\ud83d\udcc4" };
    case "item/tool/requestUserInput":
      return { level: "low", label: "Input Required", icon: "\u2753" };
    case "item/tool/call":
      return { level: "low", label: "Tool Call", icon: "\u2699" };
  }
}

function requestKey(requestId: string | number): string {
  return `${typeof requestId}:${String(requestId)}`;
}

function InlineApprovalItem({
  request,
  rKey,
  isSubmitting,
  toolDrafts,
  toolOtherDrafts,
  onRespondCommandOrFile,
  onRespondToolUserInput,
  setToolSelected,
  setToolOther,
}: {
  request: PendingServerRequest;
  rKey: string;
  isSubmitting: boolean;
  toolDrafts: Record<string, Record<string, string>>;
  toolOtherDrafts: Record<string, Record<string, string>>;
  onRespondCommandOrFile: Props["onRespondCommandOrFile"];
  onRespondToolUserInput: Props["onRespondToolUserInput"];
  setToolSelected: Props["setToolSelected"];
  setToolOther: Props["setToolOther"];
}) {
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
          <span className="urgency-icon" aria-hidden="true">
            {urgency.icon}
          </span>
          {urgency.label}
        </span>
      </div>

      {request.reason && (
        <p className="approval-reason">{request.reason}</p>
      )}

      {isCommandOrFile && (
        <div className="controls">
          <button
            className="secondary"
            disabled={isSubmitting}
            onClick={() => onRespondCommandOrFile(request, "accept")}
            aria-label="Allow"
          >
            Allow
          </button>
          <button
            className="secondary"
            disabled={isSubmitting}
            onClick={() =>
              onRespondCommandOrFile(request, "acceptForSession")
            }
            aria-label="Allow for session"
          >
            Allow for Session
          </button>
          <button
            className="danger"
            disabled={isSubmitting}
            onClick={() => onRespondCommandOrFile(request, "decline")}
            aria-label="Deny"
          >
            Deny
          </button>
          <button
            className="ghost inline-cancel-link"
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
            const selected = toolDrafts[rKey]?.[question.id] ?? "";
            const needsOther =
              selected === "__other__" ||
              !question.options ||
              question.options.length === 0;
            const showOtherInput = needsOther || question.isOther;

            return (
              <div className="tool-question" key={`${rKey}:${question.id}`}>
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
                    value={toolOtherDrafts[rKey]?.[question.id] ?? ""}
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

      {request.method === "item/tool/call" && (
        <p className="code approval-meta">Processing automatically...</p>
      )}
    </div>
  );
}

export function InlineApproval({
  requests,
  submittingKey,
  toolDrafts,
  toolOtherDrafts,
  onRespondCommandOrFile,
  onRespondToolUserInput,
  setToolSelected,
  setToolOther,
}: Props) {
  if (requests.length === 0) return null;

  return (
    <div
      className="inline-approval-list"
      role="region"
      aria-label="Pending approval requests"
    >
      {requests.map((request) => {
        const rKey = requestKey(request.requestId);
        return (
          <InlineApprovalItem
            key={rKey}
            request={request}
            rKey={rKey}
            isSubmitting={submittingKey === rKey}
            toolDrafts={toolDrafts}
            toolOtherDrafts={toolOtherDrafts}
            onRespondCommandOrFile={onRespondCommandOrFile}
            onRespondToolUserInput={onRespondToolUserInput}
            setToolSelected={setToolSelected}
            setToolOther={setToolOther}
          />
        );
      })}
    </div>
  );
}
