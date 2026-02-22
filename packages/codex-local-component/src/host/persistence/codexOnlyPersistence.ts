import type {
  ActorContext,
  HostRuntimePersistence,
  HostRuntimePersistedServerRequest,
} from "../runtime/runtimeTypes.js";

type DispatchEntry = {
  dispatchId: string;
  turnId: string;
  idempotencyKey: string;
  inputText: string;
};

type PendingRequestRecord = HostRuntimePersistedServerRequest & {
  conversationId: string;
};

function toRequestKey(requestId: string | number): string {
  return typeof requestId === "number" ? String(requestId) : requestId;
}

export function createCodexOnlyPersistence(): HostRuntimePersistence {
  const requestById = new Map<string, PendingRequestRecord>();
  const conversationByThreadId = new Map<string, string>();
  const dispatchQueue: DispatchEntry[] = [];

  function assertDurableSyncUnavailable(): never {
    throw new Error("[E_PERSISTENCE_DISABLED] Durable sync/import APIs are unavailable when runtime mode is codex-only.");
  }

  return {
    mode: "codex-only",
    ensureThread: async (args) => {
      conversationByThreadId.set(args.conversationId, args.conversationId);
      return { threadId: args.conversationId, created: false };
    },
    ensureSession: async (args) => ({
      sessionId: args.sessionId,
      threadId: args.threadId,
      status: "active",
    }),
    ingestSafe: async () => ({ status: "ok", errors: [] }),
    upsertPendingServerRequest: async ({ request }) => {
      requestById.set(toRequestKey(request.requestId), {
        requestId: request.requestId,
        method: request.method,
        threadId: request.threadId,
        turnId: request.turnId,
        itemId: request.itemId,
        status: "pending",
        ...(request.reason ? { reason: request.reason } : {}),
        ...(request.questions ? { questions: request.questions } : {}),
        payloadJson: request.payloadJson,
        createdAt: request.createdAt,
        updatedAt: request.createdAt,
        conversationId: conversationByThreadId.get(request.threadId) ?? request.threadId,
      });
    },
    resolvePendingServerRequest: async (args) => {
      requestById.delete(toRequestKey(args.requestId));
    },
    listPendingServerRequests: async (args) =>
      Array.from(requestById.values())
        .filter((request) => request.conversationId === args.conversationId)
        .map((request) => {
          const normalized: HostRuntimePersistedServerRequest = {
            requestId: request.requestId,
            method: request.method,
            threadId: request.threadId,
            turnId: request.turnId,
            itemId: request.itemId,
            payloadJson: request.payloadJson,
            status: request.status,
            ...(request.reason ? { reason: request.reason } : {}),
            ...(request.questions ? { questions: request.questions } : {}),
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
          };
          return normalized;
        }),
    acceptTurnSend: async (args) => {
      const dispatchId = args.dispatchId ?? `${args.turnId}-dispatch`;
      dispatchQueue.push({
        dispatchId,
        turnId: args.turnId,
        idempotencyKey: args.idempotencyKey,
        inputText: args.inputText,
      });
      return {
        dispatchId,
        turnId: args.turnId,
        accepted: true,
      };
    },
    failAcceptedTurnSend: async () => undefined,
    claimNextTurnDispatch: async (args) => {
      const next = dispatchQueue.shift();
      if (!next) {
        return null;
      }
      return {
        dispatchId: next.dispatchId,
        turnId: next.turnId,
        idempotencyKey: next.idempotencyKey,
        inputText: next.inputText,
        claimToken: `${next.dispatchId}-claim`,
        leaseExpiresAt: Date.now() + (args.leaseMs ?? 15_000),
        attemptCount: 1,
      };
    },
    markTurnDispatchStarted: async () => undefined,
    markTurnDispatchCompleted: async () => undefined,
    markTurnDispatchFailed: async () => undefined,
    cancelTurnDispatch: async () => undefined,
    startConversationSyncSource: async () => assertDurableSyncUnavailable(),
    appendConversationSyncSourceChunk: async () => assertDurableSyncUnavailable(),
    sealConversationSyncSource: async () => assertDurableSyncUnavailable(),
    cancelConversationSyncJob: async () => assertDurableSyncUnavailable(),
    getConversationSyncJob: async () => assertDurableSyncUnavailable(),
    waitForConversationSyncJobTerminal: async () => assertDurableSyncUnavailable(),
  };
}
