import test from "node:test";
import assert from "node:assert/strict";
import * as host from "../dist/host/index.js";

function createComponentRefs() {
  return {
    codexLocal: {
      approvals: {},
      messages: {},
      reasoning: {},
      serverRequests: {},
      sync: {},
      threads: {},
      turns: {},
    },
  };
}

test("defineCodexHostDefinitions returns deterministic runtime-owned surface with clean names", () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  assert.ok(defs.mutations.ensureThread);
  assert.ok(defs.mutations.ensureSession);
  assert.ok(defs.mutations.ingestEvent);
  assert.ok(defs.mutations.scheduleDeleteThread);
  assert.ok(defs.mutations.cancelDeletion);
  assert.ok(defs.mutations.respondApproval);
  assert.ok(defs.mutations.interruptTurn);

  assert.ok(defs.queries.validateHostWiring);
  assert.ok(defs.queries.threadSnapshot);
  assert.ok(defs.queries.getDeletionStatus);
  assert.ok(defs.queries.dataHygiene);
  assert.ok(defs.queries.listThreadMessages);
  assert.ok(defs.queries.listTurnMessages);
  assert.ok(defs.queries.listPendingApprovals);
  assert.ok(defs.queries.listTokenUsage);
  assert.ok(defs.queries.listThreadReasoning);
});

test("defineCodexHostDefinitions output keys match HOST_SURFACE_MANIFEST keys", () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  assert.deepEqual(
    Object.keys(defs.mutations).sort(),
    [...host.HOST_SURFACE_MANIFEST.runtimeOwned.mutations].sort(),
  );
  assert.deepEqual(
    Object.keys(defs.queries).sort(),
    [...host.HOST_SURFACE_MANIFEST.runtimeOwned.queries].sort(),
  );
});

test("validateHostWiring reports missing component children as check failures", async () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  const result = await defs.queries.validateHostWiring.handler(
    {
      runQuery: async (_ref, _args) => {
        throw new Error('Child component ComponentName(Identifier("threads")) not found');
      },
    },
    { actor: {}, threadId: undefined },
  );

  assert.equal(result.ok, false);
  assert.ok(result.checks.length > 0);
  assert.ok(result.checks.every((check) => check.ok === false));
});

test("resolves codexLocal refs when components uses proxy-like property traps", async () => {
  const expectedResolveRef = Symbol("threads.resolve");
  const componentRefs = {
    approvals: {},
    messages: {},
    reasoning: {},
    serverRequests: {},
    sync: {},
    threads: { resolve: expectedResolveRef },
    turns: {},
  };
  const componentsProxy = new Proxy(
    {},
    {
      has: () => false,
      get: (_target, prop) => (prop === "codexLocal" ? componentRefs : undefined),
    },
  );

  const defs = host.defineCodexHostDefinitions({
    components: componentsProxy,
  });

  await assert.doesNotReject(
    defs.mutations.ensureThread.handler(
      {
        runMutation: async (ref, args) => {
          assert.equal(ref, componentRefs.threads.resolve);
          assert.equal(args.threadHandle, "thread-1");
          return { threadId: "thread-1", created: false };
        },
      },
      {
        actor: {},
        threadId: "thread-1",
      },
    ),
  );
});

test("ensureThread strips internal mapping fields from resolve result", async () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  const result = await defs.mutations.ensureThread.handler(
    {
      runMutation: async () => ({
        threadId: "thread-1",
        created: true,
        threadHandle: "runtime-handle-1",
      }),
    },
    { actor: {}, threadId: "thread-1" },
  );

  assert.deepEqual(result, { threadId: "thread-1", created: true });
});

test("ensureThread rejects threadHandle-only input", async () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  await assert.rejects(
    defs.mutations.ensureThread.handler(
      {
        runMutation: async () => {
          throw new Error("should not run");
        },
      },
      { actor: {}, threadHandle: "legacy-id" },
    ),
    /ensureThread requires threadId/,
  );
});

test("threadSnapshot safe query returns missing_thread status for missing thread errors", async () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  const result = await defs.queries.threadSnapshot.handler(
    {
      runQuery: async () => {
        throw new Error("[E_THREAD_NOT_FOUND] Thread not found: missing-thread");
      },
    },
    { actor: {}, threadId: "missing-thread" },
  );

  assert.equal(result.threadStatus, "missing_thread");
  assert.equal(result.code, "E_THREAD_NOT_FOUND");
});

test("threadSnapshot returns forbidden state safely", async () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  const result = await defs.queries.threadSnapshot.handler(
    {
      runQuery: async () => {
        throw new Error("[E_AUTH_THREAD_FORBIDDEN] authorization failed");
      },
    },
    { actor: {}, threadId: "missing-thread" },
  );

  assert.equal(result.threadStatus, "forbidden_thread");
  assert.equal(result.code, "E_AUTH_THREAD_FORBIDDEN");
});

test("threadSnapshotByThreadHandle resolves legacy id to runtime thread and returns safe snapshot", async () => {
  const baseComponents = createComponentRefs();
  const resolveByThreadHandleRef = Symbol("threads.resolveByThreadHandle");
  const getStateRef = Symbol("threads.getState");
  const defs = host.defineCodexHostDefinitions({
    components: {
      codexLocal: {
        ...baseComponents.codexLocal,
        threads: {
          ...baseComponents.codexLocal.threads,
          resolveByThreadHandle: resolveByThreadHandleRef,
          getState: getStateRef,
        },
      },
    },
  });
  const calls = [];
  const result = await defs.queries.threadSnapshotByThreadHandle.handler(
    {
      runQuery: async (ref, args) => {
        if (ref === resolveByThreadHandleRef) {
          calls.push({ ref, args });
          return { threadId: "runtime-thread-1", threadHandle: "legacy-thread-1" };
        }
        if (ref === getStateRef) {
          calls.push({ ref, args });
          return { threadName: "legacy-name", threadId: "runtime-thread-1" };
        }
        throw new Error("Unexpected query call");
      },
    },
    { actor: { userId: "actor-user" }, threadHandle: "legacy-thread-1" },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].ref, resolveByThreadHandleRef);
  assert.deepEqual(calls[0].args, { actor: { userId: "actor-user" }, threadHandle: "legacy-thread-1" });
  assert.equal(calls[1].ref, getStateRef);
  assert.deepEqual(calls[1].args, { actor: { userId: "actor-user" }, threadId: "runtime-thread-1" });
  assert.equal(result.threadStatus, "ok");
  assert.deepEqual(result.data, { threadName: "legacy-name", threadId: "runtime-thread-1" });
});

test("threadSnapshotByThreadHandle returns missing thread fallback for unmapped legacy id", async () => {
  const baseComponents = createComponentRefs();
  const resolveByThreadHandleRef = Symbol("threads.resolveByThreadHandle");
  const defs = host.defineCodexHostDefinitions({
    components: {
      codexLocal: {
        ...baseComponents.codexLocal,
        threads: {
          ...baseComponents.codexLocal.threads,
          resolveByThreadHandle: resolveByThreadHandleRef,
        },
      },
    },
  });
  const result = await defs.queries.threadSnapshotByThreadHandle.handler(
    {
      runQuery: async () => null,
    },
    { actor: {}, threadHandle: "legacy-thread-2" },
  );
  assert.equal(result.threadStatus, "missing_thread");
  assert.equal(result.code, "E_THREAD_NOT_FOUND");
  assert.equal(result.message, "[E_THREAD_NOT_FOUND] Thread not found: legacy-thread-2");
});

test("listThreadMessagesByThreadHandle resolves thread and returns safe payload", async () => {
  const baseComponents = createComponentRefs();
  const threadMessagesByThreadHandleRef = Symbol("threads.resolveByThreadHandle");
  const threadMessagesRef = Symbol("messages.listByThread");
  const defs = host.defineCodexHostDefinitions({
    components: {
      codexLocal: {
        ...baseComponents.codexLocal,
        threads: {
          ...baseComponents.codexLocal.threads,
          resolveByThreadHandle: threadMessagesByThreadHandleRef,
        },
        messages: {
          ...baseComponents.codexLocal.messages,
          listByThread: threadMessagesRef,
        },
      },
    },
  });
  const result = await defs.queries.listThreadMessagesByThreadHandle.handler(
    {
      runQuery: async (ref, args) => {
        if (ref === threadMessagesByThreadHandleRef) {
          assert.deepEqual(args, { actor: {}, threadHandle: "legacy-thread-3" });
          return { threadId: "thread-3", threadHandle: "legacy-thread-3" };
        }
        if (ref === threadMessagesRef) {
          assert.deepEqual(args, {
            actor: {},
            threadId: "thread-3",
            paginationOpts: { cursor: null, numItems: 10 },
          });
          return { page: [{ id: "m1" }], isDone: true, continueCursor: "cursor-1" };
        }
        throw new Error("Unexpected query call");
      },
    },
    { actor: {}, threadHandle: "legacy-thread-3", paginationOpts: { cursor: null, numItems: 10 } },
  );
  assert.equal(result.threadStatus, "ok");
  assert.equal(result.page.length, 1);
});

test("listThreadMessagesByThreadHandle returns missing-thread fallback payload", async () => {
  const baseComponents = createComponentRefs();
  const threadMessagesByThreadHandleRef = Symbol("threads.resolveByThreadHandle");
  const defs = host.defineCodexHostDefinitions({
    components: {
      codexLocal: {
        ...baseComponents.codexLocal,
        threads: {
          ...baseComponents.codexLocal.threads,
          resolveByThreadHandle: threadMessagesByThreadHandleRef,
        },
      },
    },
  });
  const result = await defs.queries.listThreadMessagesByThreadHandle.handler(
    {
      runQuery: async () => null,
    },
    { actor: {}, threadHandle: "legacy-thread-4", paginationOpts: { cursor: null, numItems: 10 } },
  );
  assert.equal(result.threadStatus, "missing_thread");
  assert.equal(result.code, "E_THREAD_NOT_FOUND");
  assert.equal(result.continueCursor, "");
  assert.equal(result.isDone, true);
  assert.deepEqual(result.page, []);
});

test("listTurnMessagesByThreadHandle resolves thread and returns safe payload", async () => {
  const baseComponents = createComponentRefs();
  const threadTurnRef = Symbol("threads.resolveByThreadHandle");
  const turnMessagesRef = Symbol("messages.getByTurn");
  const defs = host.defineCodexHostDefinitions({
    components: {
      codexLocal: {
        ...baseComponents.codexLocal,
        threads: {
          ...baseComponents.codexLocal.threads,
          resolveByThreadHandle: threadTurnRef,
        },
        messages: {
          ...baseComponents.codexLocal.messages,
          getByTurn: turnMessagesRef,
        },
      },
    },
  });
  const result = await defs.queries.listTurnMessagesByThreadHandle.handler(
    {
      runQuery: async (ref, args) => {
        if (ref === threadTurnRef) {
          assert.deepEqual(args, { actor: {}, threadHandle: "legacy-thread-5" });
          return { threadId: "thread-5", threadHandle: "legacy-thread-5" };
        }
        if (ref === turnMessagesRef) {
          assert.deepEqual(args, { actor: {}, threadId: "thread-5", turnId: "turn-5" });
          return [{ messageId: "m-1" }];
        }
        throw new Error("Unexpected query call");
      },
    },
    { actor: {}, threadHandle: "legacy-thread-5", turnId: "turn-5" },
  );
  assert.equal(result.threadStatus, "ok");
  assert.deepEqual(result.data, [{ messageId: "m-1" }]);
});

test("listTurnMessagesByThreadHandle returns missing-thread fallback payload", async () => {
  const baseComponents = createComponentRefs();
  const threadTurnRef = Symbol("threads.resolveByThreadHandle");
  const defs = host.defineCodexHostDefinitions({
    components: {
      codexLocal: {
        ...baseComponents.codexLocal,
        threads: {
          ...baseComponents.codexLocal.threads,
          resolveByThreadHandle: threadTurnRef,
        },
      },
    },
  });
  const result = await defs.queries.listTurnMessagesByThreadHandle.handler(
    {
      runQuery: async () => null,
    },
    { actor: {}, threadHandle: "legacy-thread-6", turnId: "turn-6" },
  );
  assert.equal(result.threadStatus, "missing_thread");
  assert.equal(result.code, "E_THREAD_NOT_FOUND");
  assert.deepEqual(result.data, []);
});

test("listPendingServerRequestsByThreadHandle resolves thread and returns request payload", async () => {
  const baseComponents = createComponentRefs();
  const threadServerRequestRef = Symbol("threads.resolveByThreadHandle");
  const pendingServerRequestRef = Symbol("serverRequests.listPending");
  const defs = host.defineCodexHostDefinitions({
    components: {
      codexLocal: {
        ...baseComponents.codexLocal,
        threads: {
          ...baseComponents.codexLocal.threads,
          resolveByThreadHandle: threadServerRequestRef,
        },
        serverRequests: {
          ...baseComponents.codexLocal.serverRequests,
          listPending: pendingServerRequestRef,
        },
      },
    },
  });
  const result = await defs.queries.listPendingServerRequestsByThreadHandle.handler(
    {
      runQuery: async (ref, args) => {
        if (ref === threadServerRequestRef) {
          assert.deepEqual(args, { actor: {}, threadHandle: "legacy-thread-7" });
          return { threadId: "thread-7", threadHandle: "legacy-thread-7" };
        }
        if (ref === pendingServerRequestRef) {
          assert.deepEqual(args, { actor: {}, threadId: "thread-7", limit: 2 });
          return [{ requestId: 1 }];
        }
        throw new Error("Unexpected query call");
      },
    },
    { actor: {}, threadHandle: "legacy-thread-7", limit: 2 },
  );
  assert.deepEqual(result, [{ requestId: 1 }]);
});

test("listPendingServerRequestsByThreadHandle returns [] when legacy thread is unmapped", async () => {
  const baseComponents = createComponentRefs();
  const threadServerRequestRef = Symbol("threads.resolveByThreadHandle");
  const defs = host.defineCodexHostDefinitions({
    components: {
      codexLocal: {
        ...baseComponents.codexLocal,
        threads: {
          ...baseComponents.codexLocal.threads,
          resolveByThreadHandle: threadServerRequestRef,
        },
      },
    },
  });
  const result = await defs.queries.listPendingServerRequestsByThreadHandle.handler(
    {
      runQuery: async () => null,
    },
    { actor: {}, threadHandle: "legacy-thread-8" },
  );
  assert.deepEqual(result, []);
});

test("listPendingServerRequests returns [] when thread is missing", async () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  const result = await defs.queries.listPendingServerRequests.handler(
    {
      runQuery: async () => {
        throw new Error("[E_THREAD_NOT_FOUND] Thread not found: missing-thread");
      },
    },
    { actor: {}, threadId: "missing-thread" },
  );

  assert.deepEqual(result, []);
});

test("listPendingServerRequests rethrows non-thread-read errors", async () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  await assert.rejects(
      () =>
      defs.queries.listPendingServerRequests.handler(
        {
          runQuery: async () => {
            throw new Error("database write failed");
          },
        },
        { actor: {}, threadId: "thread-1" },
      ),
    /database write failed/,
  );
});

test("removed exports are absent from host public surface", () => {
  assert.equal("createCodexHost" in host, false);
  assert.equal("createCodexConvexHost" in host, false);
  assert.equal("defineRuntimeOwnedHostSlice" in host, false);
  assert.equal("defineRuntimeOwnedHostEndpoints" in host, false);
  assert.equal("defineGuardedRuntimeOwnedHostEndpoints" in host, false);
  assert.equal("guardRuntimeOwnedHostDefinitions" in host, false);
  assert.equal("wrapHostDefinitions" in host, false);
});

test("renderCodexHostShim emits deterministic explicit endpoint exports", () => {
  const source = host.renderCodexHostShim({
    extensionExports: ["getActorBindingForBootstrap", "listThreadsForPicker"],
  });

  assert.ok(source.includes("defineCodexHostDefinitions"));
  assert.ok(source.includes("export const ensureThread = mutation(codex.mutations.ensureThread);"));
  assert.ok(source.includes("export const listThreadReasoning = query(codex.queries.listThreadReasoning);"));
  assert.ok(source.includes("export { getActorBindingForBootstrap, listThreadsForPicker } from \"./chat.extensions\";"));
});
