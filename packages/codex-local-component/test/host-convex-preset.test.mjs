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
  assert.ok(defs.queries.threadSnapshotStrict);
  assert.ok(defs.queries.getDeletionStatus);
  assert.ok(defs.queries.dataHygiene);
  assert.ok(defs.queries.dataHygieneStrict);
  assert.ok(defs.queries.listThreadMessages);
  assert.ok(defs.queries.listThreadMessagesStrict);
  assert.ok(defs.queries.listTurnMessages);
  assert.ok(defs.queries.listTurnMessagesStrict);
  assert.ok(defs.queries.listPendingApprovals);
  assert.ok(defs.queries.listTokenUsage);
  assert.ok(defs.queries.listThreadReasoningStrict);
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
          assert.equal(args.externalThreadId, "thread-1");
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
        externalThreadId: "runtime-handle-1",
      }),
    },
    { actor: {}, threadId: "thread-1" },
  );

  assert.deepEqual(result, { threadId: "thread-1", created: true });
});

test("ensureThread rejects externalThreadId-only input", async () => {
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
      { actor: {}, externalThreadId: "legacy-id" },
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

test("threadSnapshotStrict rethrows missing thread errors", async () => {
  const defs = host.defineCodexHostDefinitions({
    components: createComponentRefs(),
  });

  await assert.rejects(
    defs.queries.threadSnapshotStrict.handler(
      {
        runQuery: async () => {
          throw new Error("[E_THREAD_NOT_FOUND] Thread not found: missing-thread");
        },
      },
      { actor: {}, threadId: "missing-thread" },
    ),
    /\[E_THREAD_NOT_FOUND\]/,
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
