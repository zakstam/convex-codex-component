import test from "node:test";
import assert from "node:assert/strict";
import * as host from "../dist/host/index.js";

const actor = { userId: "u" };

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

test("defineRuntimeOwnedHostSlice returns deterministic runtime-owned surface", () => {
  const hostApi = host.createCodexConvexHost({
    components: createComponentRefs(),
    actorPolicy: { mode: "serverActor", serverActor: actor },
  });
  const defs = hostApi.defs;

  assert.ok(defs.mutations.ensureThread);
  assert.ok(defs.mutations.ingestEvent);
  assert.ok(defs.mutations.respondApprovalForHooks);
  assert.ok(defs.queries.validateHostWiring);
  assert.ok(defs.queries.dataHygiene);
  assert.ok(defs.queries.listThreadMessagesForHooks);
});

test("createCodexConvexHost serverActor mode matches defineRuntimeOwnedHostSlice output shape", () => {
  const fromSlice = host.defineRuntimeOwnedHostSlice({
    components: createComponentRefs(),
    serverActor: actor,
  });
  const fromFacade = host.createCodexConvexHost({
    components: createComponentRefs(),
    actorPolicy: { mode: "serverActor", serverActor: actor },
  });

  assert.deepEqual(Object.keys(fromFacade.defs.mutations).sort(), Object.keys(fromSlice.mutations).sort());
  assert.deepEqual(Object.keys(fromFacade.defs.queries).sort(), Object.keys(fromSlice.queries).sort());
});

test("validateHostWiring reports missing component children as check failures", async () => {
  const hostApi = host.createCodexConvexHost({
    components: createComponentRefs(),
    actorPolicy: { mode: "serverActor", serverActor: actor },
  });
  const defs = hostApi.defs;

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
  const hostApi = host.createCodexConvexHost({
    components: createComponentRefs(),
    actorPolicy: { mode: "serverActor", serverActor: actor },
  });
  const defs = hostApi.defs;

  const mutation = (def) => ({ kind: "mutation", def });
  const query = (def) => ({ kind: "query", def });

  const wrappedMutation = mutation(defs.mutations.ensureThread);
  const wrappedQuery = query(defs.queries.threadSnapshot);

  assert.equal(wrappedMutation.kind, "mutation");
  assert.equal(wrappedQuery.kind, "query");
  assert.ok(typeof wrappedMutation.def.handler === "function");
  assert.ok(typeof wrappedQuery.def.handler === "function");
});

test("register wraps every mutation/query key", () => {
  const hostApi = host.createCodexConvexHost({
    components: createComponentRefs(),
    actorPolicy: { mode: "serverActor", serverActor: actor },
  });

  const wrapped = hostApi.register({
    mutation: (definition) => ({ kind: "mutation", definition }),
    query: (definition) => ({ kind: "query", definition }),
  });

  assert.deepEqual(
    Object.keys(wrapped.mutations).sort(),
    Object.keys(hostApi.defs.mutations).sort(),
  );
  assert.deepEqual(
    Object.keys(wrapped.queries).sort(),
    Object.keys(hostApi.defs.queries).sort(),
  );
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

  const defs = host.defineRuntimeOwnedHostSlice({
    components: componentsProxy,
    serverActor: actor,
  });

  await assert.doesNotReject(
    defs.mutations.ensureThread.handler(
      {
        runMutation: async (ref, args) => {
          assert.equal(ref, componentRefs.threads.resolve);
          assert.equal(args.externalThreadId, "thread-1");
          assert.equal(args.localThreadId, "thread-1");
          return { threadId: "thread-1", externalThreadId: undefined };
        },
      },
      {
        actor,
        localThreadId: "thread-1",
      },
    ),
  );
});

test("manifest mutations/queries stay in parity with runtime-owned preset definitions", () => {
  const defs = host.defineRuntimeOwnedHostSlice({
    components: createComponentRefs(),
    serverActor: actor,
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

test("createCodexConvexHost guarded mode applies actor guards to runtime-owned handlers", async () => {
  const hostApi = host.createCodexConvexHost({
    components: createComponentRefs(),
    actorPolicy: {
      mode: "guarded",
      serverActor: actor,
      resolveMutationActor: async (_ctx, incoming) => ({
        userId: `${incoming.userId}-mut`,
      }),
      resolveQueryActor: async (_ctx, incoming) => ({
        userId: `${incoming.userId}-qry`,
      }),
    },
  });
  const defs = hostApi.defs;

  let mutationSeenActor = null;
  await defs.mutations.ensureSession.handler(
    {
      runMutation: async (_ref, args) => {
        mutationSeenActor = args.actor;
        return { threadId: "t1", created: true, externalThreadId: "t1" };
      },
    },
    {
      actor: { userId: "u1" },
      threadId: "t1",
    },
  );
  assert.deepEqual(mutationSeenActor, { userId: "u1-mut" });

  let querySeenActor = null;
  await defs.queries.threadSnapshot.handler(
    {
      runQuery: async (_ref, args) => {
        querySeenActor = args.actor;
        return null;
      },
    },
    {
      actor: { userId: "u1" },
      threadId: "t1",
    },
  );
  assert.deepEqual(querySeenActor, { userId: "u1-qry" });
});

test("removed helper exports are absent from host public surface", () => {
  assert.equal("defineRuntimeOwnedHostEndpoints" in host, false);
  assert.equal("defineGuardedRuntimeOwnedHostEndpoints" in host, false);
  assert.equal("guardRuntimeOwnedHostDefinitions" in host, false);
  assert.equal("wrapHostDefinitions" in host, false);
});
