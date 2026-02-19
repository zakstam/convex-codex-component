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

const passthrough = {
  mutation: (def) => def,
  query: (def) => def,
};

const explicitActorPolicy = {
  userId: "server-user",
};

test("createCodexHost returns deterministic runtime-owned surface with clean names", () => {
  const codex = host.createCodexHost({
    components: createComponentRefs(),
    ...passthrough,
    actorPolicy: explicitActorPolicy,
  });

  // Wrapped output uses clean public names (no ForHooks suffix)
  assert.ok(codex.mutations.ensureThread);
  assert.ok(codex.mutations.ensureSession);
  assert.ok(codex.mutations.ingestEvent);
  assert.ok(codex.mutations.scheduleDeleteThread);
  assert.ok(codex.mutations.cancelDeletion);
  assert.ok(codex.mutations.respondApproval);
  assert.ok(codex.mutations.interruptTurn);

  assert.ok(codex.queries.validateHostWiring);
  assert.ok(codex.queries.threadSnapshot);
  assert.ok(codex.queries.getDeletionStatus);
  assert.ok(codex.queries.dataHygiene);
  assert.ok(codex.queries.listThreadMessages);
  assert.ok(codex.queries.listTurnMessages);
  assert.ok(codex.queries.listPendingApprovals);
  assert.ok(codex.queries.listTokenUsage);

  assert.equal("defs" in codex, false);
});

test("createCodexHost output keys match HOST_SURFACE_MANIFEST keys", () => {
  const codex = host.createCodexHost({
    components: createComponentRefs(),
    ...passthrough,
    actorPolicy: explicitActorPolicy,
  });

  assert.deepEqual(
    Object.keys(codex.mutations).sort(),
    [...host.HOST_SURFACE_MANIFEST.runtimeOwned.mutations].sort(),
  );
  assert.deepEqual(
    Object.keys(codex.queries).sort(),
    [...host.HOST_SURFACE_MANIFEST.runtimeOwned.queries].sort(),
  );
});

test("validateHostWiring reports missing component children as check failures", async () => {
  const codex = host.createCodexHost({
    components: createComponentRefs(),
    ...passthrough,
    actorPolicy: explicitActorPolicy,
  });

  const result = await codex.queries.validateHostWiring.handler(
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

test("mutation and query wrappers are called by createCodexHost", () => {
  const mutationCalls = [];
  const queryCalls = [];

  const codex = host.createCodexHost({
    components: createComponentRefs(),
    mutation: (def) => {
      mutationCalls.push(def);
      return { kind: "mutation", def };
    },
    query: (def) => {
      queryCalls.push(def);
      return { kind: "query", def };
    },
    actorPolicy: explicitActorPolicy,
  });

  // Every mutation key should have been passed through the mutation wrapper
  const expectedMutationCount = host.HOST_SURFACE_MANIFEST.runtimeOwned.mutations.length;
  assert.equal(mutationCalls.length, expectedMutationCount);

  // Every query key should have been passed through the query wrapper
  const expectedQueryCount = host.HOST_SURFACE_MANIFEST.runtimeOwned.queries.length;
  assert.equal(queryCalls.length, expectedQueryCount);

  // Wrapped output carries the wrapper return shape
  assert.equal(codex.mutations.ensureThread.kind, "mutation");
  assert.ok(typeof codex.mutations.ensureThread.def.handler === "function");
  assert.equal(codex.queries.threadSnapshot.kind, "query");
  assert.ok(typeof codex.queries.threadSnapshot.def.handler === "function");
});

test("actorResolver.mutation replaces actor before mutation handlers run", async () => {
  const resolverCalls = [];
  const mutationCalls = [];

  const codex = host.createCodexHost({
    components: createComponentRefs(),
    ...passthrough,
    actorPolicy: explicitActorPolicy,
    actorResolver: {
      mutation: async (_ctx, actor) => {
        resolverCalls.push(actor);
        return { userId: `bound:${actor.userId ?? "anonymous"}` };
      },
    },
  });

  await codex.mutations.ensureThread.handler(
    {
      runMutation: async (_ref, args) => {
        mutationCalls.push(args);
        return { threadId: args.threadId, externalThreadId: undefined };
      },
    },
    { actor: { userId: "client-user" }, threadId: "thread-1" },
  );

  assert.equal(resolverCalls.length, 1);
  assert.equal(resolverCalls[0].userId, "client-user");
  assert.equal(mutationCalls.length, 1);
  assert.equal(mutationCalls[0].actor.userId, "bound:client-user");
});

test("actorResolver.query replaces actor before query handlers run", async () => {
  const resolverCalls = [];
  const queryCalls = [];

  const codex = host.createCodexHost({
    components: createComponentRefs(),
    ...passthrough,
    actorPolicy: explicitActorPolicy,
    actorResolver: {
      query: async (_ctx, actor) => {
        resolverCalls.push(actor);
        return { userId: `bound:${actor.userId ?? "anonymous"}` };
      },
    },
  });

  await codex.queries.listPendingServerRequests.handler(
    {
      runQuery: async (_ref, args) => {
        queryCalls.push(args);
        return [];
      },
    },
    { actor: { userId: "client-user" }, threadId: "thread-1", limit: 10 },
  );

  assert.equal(resolverCalls.length, 1);
  assert.equal(resolverCalls[0].userId, "client-user");
  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0].actor.userId, "bound:client-user");
});

test("wrapped output has all expected mutation and query keys", () => {
  const codex = host.createCodexHost({
    components: createComponentRefs(),
    mutation: (def) => ({ wrapped: true, def }),
    query: (def) => ({ wrapped: true, def }),
    actorPolicy: explicitActorPolicy,
  });

  assert.deepEqual(
    Object.keys(codex.mutations).sort(),
    [...host.HOST_SURFACE_MANIFEST.runtimeOwned.mutations].sort(),
  );
  assert.deepEqual(
    Object.keys(codex.queries).sort(),
    [...host.HOST_SURFACE_MANIFEST.runtimeOwned.queries].sort(),
  );

  // Every wrapped value carries the wrapper shape
  for (const key of Object.keys(codex.mutations)) {
    assert.equal(codex.mutations[key].wrapped, true, `mutation ${key} should be wrapped`);
  }
  for (const key of Object.keys(codex.queries)) {
    assert.equal(codex.queries[key].wrapped, true, `query ${key} should be wrapped`);
  }
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

  const codex = host.createCodexHost({
    components: componentsProxy,
    ...passthrough,
    actorPolicy: explicitActorPolicy,
  });

  await assert.doesNotReject(
    codex.mutations.ensureThread.handler(
      {
        runMutation: async (ref, args) => {
          assert.equal(ref, componentRefs.threads.resolve);
          assert.equal(args.externalThreadId, "thread-1");
          return { threadId: "thread-1", externalThreadId: undefined };
        },
      },
      {
        actor: {},
        threadId: "thread-1",
      },
    ),
  );
});

test("wrapped keys match HOST_SURFACE_MANIFEST and defs is not exposed", () => {
  const codex = host.createCodexHost({
    components: createComponentRefs(),
    ...passthrough,
    actorPolicy: explicitActorPolicy,
  });

  assert.equal("defs" in codex, false);

  // Wrapped keys also match manifest
  assert.deepEqual(
    Object.keys(codex.mutations).sort(),
    [...host.HOST_SURFACE_MANIFEST.runtimeOwned.mutations].sort(),
  );
  assert.deepEqual(
    Object.keys(codex.queries).sort(),
    [...host.HOST_SURFACE_MANIFEST.runtimeOwned.queries].sort(),
  );
});

test("createCodexHost rejects legacy wrapped actorPolicy shape", () => {
  assert.throws(
    () =>
      host.createCodexHost({
        components: createComponentRefs(),
        ...passthrough,
        actorPolicy: {
          mode: "serverActor",
          serverActor: { userId: "server-user" },
        },
      }),
    /object: \{ userId: string \}/,
  );
});

test("createCodexHost throws when actorPolicy.userId is missing", () => {
  assert.throws(
    () =>
      host.createCodexHost({
        components: createComponentRefs(),
        ...passthrough,
        actorPolicy: {},
      }),
    /object: \{ userId: string \}/,
  );
});

test("createCodexHost throws when actorPolicy is omitted", () => {
  assert.throws(
    () =>
      host.createCodexHost({
        components: createComponentRefs(),
        ...passthrough,
      }),
    /explicit actorPolicy/,
  );
});

test("createCodexHost rejects string actorPolicy shorthand", () => {
  assert.throws(
    () =>
      host.createCodexHost({
        components: createComponentRefs(),
        ...passthrough,
        actorPolicy: "server-user",
      }),
    /object: \{ userId: string \}/,
  );
});

test("createCodexHost rejects legacy actorPolicy mode wrapper", () => {
  assert.throws(
    () =>
      host.createCodexHost({
        components: createComponentRefs(),
        ...passthrough,
        actorPolicy: {
          mode: "serverActor",
          serverActor: { userId: "server-user" },
        },
      }),
    /object: \{ userId: string \}/,
  );
});

test("createCodexHost throws when actorPolicy.userId is blank", () => {
  assert.throws(
    () =>
      host.createCodexHost({
        components: createComponentRefs(),
        ...passthrough,
        actorPolicy: { userId: "   " },
      }),
    /actorPolicy\.userId/,
  );
});

test("removed exports are absent from host public surface", () => {
  // Old facade function
  assert.equal("createCodexConvexHost" in host, false);
  // Old standalone slice builder
  assert.equal("defineRuntimeOwnedHostSlice" in host, false);
  // Legacy helpers from earlier refactors
  assert.equal("defineRuntimeOwnedHostEndpoints" in host, false);
  assert.equal("defineGuardedRuntimeOwnedHostEndpoints" in host, false);
  assert.equal("guardRuntimeOwnedHostDefinitions" in host, false);
  assert.equal("wrapHostDefinitions" in host, false);
});
