import test from "node:test";
import assert from "node:assert/strict";
import {
  defineDispatchManagedHostSlice,
  defineRuntimeOwnedHostSlice,
  HOST_SURFACE_MANIFEST,
  wrapHostDefinitions,
} from "../dist/host/index.js";

const actor = { userId: "u" };

function createComponentRefs() {
  return {
    codexLocal: {
      approvals: {},
      dispatch: {},
      messages: {},
      reasoning: {},
      serverRequests: {},
      sync: {},
      threads: {},
      turns: {},
    },
  };
}

test("defineDispatchManagedHostSlice returns deterministic full dispatch surface", () => {
  const defs = defineDispatchManagedHostSlice({
    components: createComponentRefs(),
    serverActor: actor,
  });

  assert.ok(defs.mutations.ensureThread);
  assert.ok(defs.mutations.ingestBatch);
  assert.ok(defs.mutations.respondApprovalForHooks);
  assert.ok(defs.mutations.upsertPendingServerRequestForHooks);
  assert.ok(defs.queries.listThreadMessagesForHooks);
  assert.ok(defs.queries.validateHostWiring);
  assert.ok(defs.queries.listThreadReasoningForHooks);
  assert.ok(defs.queries.getDispatchObservability);
  assert.ok(defs.queries.listPendingServerRequestsForHooks);
});

test("defineRuntimeOwnedHostSlice returns deterministic runtime-owned surface", () => {
  const defs = defineRuntimeOwnedHostSlice({
    components: createComponentRefs(),
    serverActor: actor,
  });

  assert.ok(defs.mutations.ensureThread);
  assert.ok(defs.mutations.claimNextTurnDispatch);
  assert.ok(defs.mutations.ingestEvent);
  assert.ok(defs.mutations.respondApprovalForHooks);
  assert.ok(defs.queries.validateHostWiring);
  assert.ok(defs.queries.getDispatchObservability);
  assert.ok(defs.queries.dataHygiene);
  assert.ok(defs.queries.listThreadMessagesForHooks);
});

test("validateHostWiring reports missing component children as check failures", async () => {
  const defs = defineRuntimeOwnedHostSlice({
    components: createComponentRefs(),
    serverActor: actor,
  });

  const result = await defs.queries.validateHostWiring.handler(
    {
      runQuery: async (_ref, _args) => {
        throw new Error('Child component ComponentName(Identifier("threads")) not found');
      },
    },
    { actor },
  );

  assert.equal(result.ok, false);
  assert.ok(result.checks.length > 0);
  assert.ok(result.checks.every((check) => check.ok === false));
});

test("definitions are wrapper-consumable by mutation/query builders", () => {
  const defs = defineRuntimeOwnedHostSlice({
    components: createComponentRefs(),
    serverActor: actor,
  });

  const mutation = (def) => ({ kind: "mutation", def });
  const query = (def) => ({ kind: "query", def });

  const wrappedMutation = mutation(defs.mutations.ensureThread);
  const wrappedQuery = query(defs.queries.threadSnapshot);

  assert.equal(wrappedMutation.kind, "mutation");
  assert.equal(wrappedQuery.kind, "query");
  assert.ok(typeof wrappedMutation.def.handler === "function");
  assert.ok(typeof wrappedQuery.def.handler === "function");
});

test("wrapHostDefinitions wraps every mutation/query key", () => {
  const defs = defineRuntimeOwnedHostSlice({
    components: createComponentRefs(),
    serverActor: actor,
  });

  const wrapped = wrapHostDefinitions(defs, {
    mutation: (definition) => ({ kind: "mutation", definition }),
    query: (definition) => ({ kind: "query", definition }),
  });

  assert.deepEqual(
    Object.keys(wrapped.mutations).sort(),
    Object.keys(defs.mutations).sort(),
  );
  assert.deepEqual(
    Object.keys(wrapped.queries).sort(),
    Object.keys(defs.queries).sort(),
  );
});

test("resolves codexLocal refs when components uses proxy-like property traps", async () => {
  const expectedCreateRef = Symbol("threads.create");
  const componentRefs = {
    approvals: {},
    dispatch: {},
    messages: {},
    reasoning: {},
    serverRequests: {},
    sync: {},
    threads: { create: expectedCreateRef },
    turns: {},
  };
  const componentsProxy = new Proxy(
    {},
    {
      has: () => false,
      get: (_target, prop) => (prop === "codexLocal" ? componentRefs : undefined),
    },
  );

  const defs = defineRuntimeOwnedHostSlice({
    components: componentsProxy,
    serverActor: actor,
  });

  await assert.doesNotReject(
    defs.mutations.ensureThread.handler(
      {
        runMutation: async (ref, args) => {
          assert.equal(ref, componentRefs.threads.create);
          assert.equal(args.threadId, "thread-1");
          return { threadId: "thread-1", externalThreadId: undefined };
        },
      },
      {
        actor,
        threadId: "thread-1",
      },
    ),
  );
});

test("manifest mutations/queries stay in parity with dispatch-managed preset definitions", () => {
  const defs = defineDispatchManagedHostSlice({
    components: createComponentRefs(),
    serverActor: actor,
  });

  assert.deepEqual(
    Object.keys(defs.mutations).sort(),
    [...HOST_SURFACE_MANIFEST.dispatchManaged.mutations].sort(),
  );
  assert.deepEqual(
    Object.keys(defs.queries).sort(),
    [...HOST_SURFACE_MANIFEST.dispatchManaged.queries].sort(),
  );
});

test("manifest mutations/queries stay in parity with runtime-owned preset definitions", () => {
  const defs = defineRuntimeOwnedHostSlice({
    components: createComponentRefs(),
    serverActor: actor,
  });

  assert.deepEqual(
    Object.keys(defs.mutations).sort(),
    [...HOST_SURFACE_MANIFEST.runtimeOwned.mutations].sort(),
  );
  assert.deepEqual(
    Object.keys(defs.queries).sort(),
    [...HOST_SURFACE_MANIFEST.runtimeOwned.queries].sort(),
  );
});
