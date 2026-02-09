import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type { CodexMutationRunner, CodexQueryRunner } from "./types.js";

type ApprovalsComponent = {
  approvals: {
    listPending: FunctionReference<"query", "public" | "internal", Record<string, unknown>, unknown>;
    respond: FunctionReference<"mutation", "public" | "internal", Record<string, unknown>, unknown>;
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
