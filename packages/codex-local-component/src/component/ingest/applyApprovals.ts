import { now } from "../utils.js";
import type { IngestContext, NormalizedInboundEvent } from "./types.js";
import { userScopeFromActor } from "../scope.js";
import type { IngestStateCache } from "./stateCache.js";

export function collectApprovalEffects(ingest: IngestContext, event: NormalizedInboundEvent): void {
  if (!event.turnId) {
    return;
  }

  if (event.approvalRequest) {
    ingest.collected.pendingApprovals.set(`${event.turnId}:${event.approvalRequest.itemId}`, event.approvalRequest);
  }

  if (event.approvalResolution) {
    ingest.collected.resolvedApprovals.set(
      `${event.turnId}:${event.approvalResolution.itemId}`,
      event.approvalResolution,
    );
  }
}

export async function finalizeApprovals(
  ingest: IngestContext,
  cache: IngestStateCache,
): Promise<void> {
  for (const [key, approval] of ingest.collected.pendingApprovals) {
    const turnId = key.split(":")[0];
    if (!turnId) {
      continue;
    }

    const existing = await cache.getApprovalRecord(turnId, approval.itemId);
    if (existing) {
      continue;
    }

    const approvalId = await ingest.ctx.db.insert("codex_approvals", {
      userScope: userScopeFromActor(ingest.args.actor),
      ...(ingest.args.actor.userId !== undefined ? { userId: ingest.args.actor.userId } : {}),
      threadId: ingest.args.threadId,
      turnId,
      itemId: approval.itemId,
      kind: approval.kind,
      status: "pending",
      ...(approval.reason ? { reason: approval.reason } : {}),
      createdAt: now(),
    });
    cache.setApprovalRecord(turnId, approval.itemId, {
      _id: approvalId,
      status: "pending",
    });
  }

  for (const [key, resolution] of ingest.collected.resolvedApprovals) {
    const turnId = key.split(":")[0];
    if (!turnId) {
      continue;
    }

    const existing = await cache.getApprovalRecord(turnId, resolution.itemId);
    if (!existing || existing.status !== "pending") {
      continue;
    }

    await ingest.ctx.db.patch(existing._id, {
      status: resolution.status,
      decidedBy: "runtime",
      decidedAt: now(),
    });
    cache.setApprovalRecord(turnId, resolution.itemId, {
      ...existing,
      status: resolution.status,
    });
  }
}
