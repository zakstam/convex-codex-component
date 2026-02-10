import { ApprovalCard } from "./ApprovalCard";
import { EmptyState } from "./EmptyState";

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

type Props = {
  requests: PendingServerRequest[];
  submittingRequestKey: string | null;
  requestKeyFn: (requestId: string | number) => string;
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

export function ApprovalList({
  requests,
  submittingRequestKey,
  requestKeyFn,
  onRespondCommandOrFile,
  onRespondToolUserInput,
  toolDrafts,
  toolOtherDrafts,
  setToolSelected,
  setToolOther,
}: Props) {
  return (
    <section className="panel card" aria-label="Pending requests">
      <h2>Pending Requests</h2>
      {requests.length === 0 && (
        <EmptyState
          title="No pending requests"
          description="Approval requests will appear here."
        />
      )}
      {requests.map((request) => {
        const key = requestKeyFn(request.requestId);
        return (
          <ApprovalCard
            key={key}
            request={request}
            requestKey={key}
            isSubmitting={submittingRequestKey === key}
            onRespondCommandOrFile={onRespondCommandOrFile}
            onRespondToolUserInput={onRespondToolUserInput}
            toolDrafts={toolDrafts}
            toolOtherDrafts={toolOtherDrafts}
            setToolSelected={setToolSelected}
            setToolOther={setToolOther}
          />
        );
      })}
    </section>
  );
}
