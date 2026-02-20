import test from "node:test";
import assert from "node:assert/strict";
import * as host from "../dist/host/index.js";

function createComponentRefs() {
  return {
    codexLocal: {
      approvals: {},
      messages: {
        listByThread: Symbol("messages.listByThread"),
      },
      reasoning: {},
      serverRequests: {},
      sync: {},
      threads: {
        resolve: Symbol("threads.resolve"),
        resolveByThreadHandle: Symbol("threads.resolveByThreadHandle"),
        deleteCascade: Symbol("threads.deleteCascade"),
      },
      turns: {
        interrupt: Symbol("turns.interrupt"),
      },
      tokenUsage: {},
    },
  };
}

test("thread handle contract is consistent across create/list/send/delete", async () => {
  const threadHandle = "thread-handle-1";
  const internalThreadId = "thread-internal-1";
  const turnId = "turn-1";
  const refs = createComponentRefs().codexLocal;

  const defs = host.defineCodexHostDefinitions({
    components: { codexLocal: refs },
  });

  const calls = [];
  const ctx = {
    runMutation: async (ref, args) => {
      calls.push({ kind: "mutation", ref, args });
      if (ref === refs.threads.resolve) {
        assert.equal(args.threadHandle, threadHandle);
        return { threadId: internalThreadId, created: true };
      }
      if (ref === refs.turns.interrupt) {
        assert.equal(args.threadId, internalThreadId);
        assert.equal(args.turnId, turnId);
        return null;
      }
      if (ref === refs.threads.deleteCascade) {
        assert.equal(args.threadId, internalThreadId);
        return { deletionJobId: "job-1" };
      }
      throw new Error("Unexpected mutation call");
    },
    runQuery: async (ref, args) => {
      calls.push({ kind: "query", ref, args });
      if (ref === refs.threads.resolveByThreadHandle) {
        assert.equal(args.threadHandle, threadHandle);
        return { threadId: internalThreadId, threadHandle };
      }
      if (ref === refs.messages.listByThread) {
        assert.equal(args.threadId, internalThreadId);
        return { page: [], isDone: true, continueCursor: "" };
      }
      throw new Error("Unexpected query call");
    },
  };

  await defs.mutations.ensureThread.handler(ctx, { actor: {}, threadHandle });
  await defs.queries.listThreadMessages.handler(ctx, {
    actor: {},
    threadHandle,
    paginationOpts: { cursor: null, numItems: 10 },
  });
  await defs.mutations.interruptTurn.handler(ctx, {
    actor: {},
    threadHandle,
    turnId,
  });
  await defs.mutations.deleteThread.handler(ctx, {
    actor: {},
    threadHandle,
  });

  const publicThreadHandleArgs = calls
    .map((entry) => entry.args)
    .filter((args) => args && typeof args === "object" && "threadHandle" in args);
  assert.equal(publicThreadHandleArgs.length >= 4, true);
});
