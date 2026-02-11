import type {
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";
import type {
  CodexMutationRunner,
  CodexQueryRunner,
  GenericMutationRef,
  GenericQueryRef,
} from "./types.js";

type ApprovalsComponent = {
  approvals: {
    listPending: GenericQueryRef;
    respond: GenericMutationRef;
  };
};

export async function listPendingApprovals<Component extends ApprovalsComponent>(
  ctx: CodexQueryRunner,
  component: Component,
  args: FunctionArgs<Component["approvals"]["listPending"]>,
): Promise<FunctionReturnType<Component["approvals"]["listPending"]>> {
  return ctx.runQuery(component.approvals.listPending, args);
}

export async function respondToApproval<Component extends ApprovalsComponent>(
  ctx: CodexMutationRunner,
  component: Component,
  args: FunctionArgs<Component["approvals"]["respond"]>,
): Promise<FunctionReturnType<Component["approvals"]["respond"]>> {
  return ctx.runMutation(component.approvals.respond, args);
}
