import test from "node:test";
import assert from "node:assert/strict";
import { makeFunctionReference } from "convex/server";
import {
  createCodexOptimisticUpdate,
  codexOptimisticOps,
  codexOptimisticPresets,
} from "../dist/react/index.js";

class FakeOptimisticLocalStore {
  #rows = new Map();

  seed(query, args, value) {
    const rows = this.#rows.get(query) ?? [];
    rows.push({ args, value });
    this.#rows.set(query, rows);
  }

  getQuery(query, args) {
    const rows = this.#rows.get(query) ?? [];
    const row = rows.find((entry) => stableStringify(entry.args) === stableStringify(args));
    return row?.value;
  }

  getAllQueries(query) {
    return [...(this.#rows.get(query) ?? [])];
  }

  setQuery(query, args, value) {
    const rows = this.#rows.get(query) ?? [];
    const key = stableStringify(args);
    const index = rows.findIndex((entry) => stableStringify(entry.args) === key);
    if (index >= 0) {
      rows[index] = { args, value };
    } else {
      rows.push({ args, value });
    }
    this.#rows.set(query, rows);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

test("createCodexOptimisticUpdate composes operations in order", () => {
  const events = [];
  const query = makeFunctionReference("query:simple");
  const store = new FakeOptimisticLocalStore();
  store.seed(query, { id: "q1" }, { count: 1 });

  const optimisticUpdate = createCodexOptimisticUpdate(
    codexOptimisticOps.custom((_store, args) => {
      events.push(`custom:${args.id}`);
    }),
    codexOptimisticOps.set({
      query,
      args: (mutationArgs) => ({ id: mutationArgs.id }),
      value: (current) => ({ ...(current ?? { count: 0 }), count: (current?.count ?? 0) + 1 }),
    }),
  );

  optimisticUpdate(store, { id: "q1" });

  assert.deepEqual(events, ["custom:q1"]);
  assert.deepEqual(store.getQuery(query, { id: "q1" }), { count: 2 });
});

test("insert/replace/remove update paginated query page without mutating source", () => {
  const paginatedQuery = makeFunctionReference("query:paginated");
  const store = new FakeOptimisticLocalStore();

  const originalPage = [{ id: 1 }, { id: 2 }];
  const originalValue = { page: originalPage, continueCursor: "abc", isDone: false };
  store.seed(
    paginatedQuery,
    { conversationId: "c1", paginationOpts: { cursor: null, numItems: 10 } },
    originalValue,
  );

  const optimisticUpdate = createCodexOptimisticUpdate(
    codexOptimisticOps.insert({
      query: paginatedQuery,
      match: (queryArgs, mutationArgs) => queryArgs.conversationId === mutationArgs.conversationId,
      item: () => ({ id: 3 }),
      position: "end",
    }),
    codexOptimisticOps.replace({
      query: paginatedQuery,
      match: (queryArgs, mutationArgs) => queryArgs.conversationId === mutationArgs.conversationId,
      when: (item) => item.id === 2,
      replaceWith: (item) => ({ ...item, id: 22 }),
    }),
    codexOptimisticOps.remove({
      query: paginatedQuery,
      match: (queryArgs, mutationArgs) => queryArgs.conversationId === mutationArgs.conversationId,
      when: (item) => item.id === 1,
    }),
  );

  optimisticUpdate(store, { conversationId: "c1" });

  const updated = store.getQuery(
    paginatedQuery,
    { conversationId: "c1", paginationOpts: { cursor: null, numItems: 10 } },
  );

  assert.deepEqual(updated.page, [{ id: 22 }, { id: 3 }]);
  assert.deepEqual(originalValue.page, [{ id: 1 }, { id: 2 }]);
  assert.equal(updated.page === originalValue.page, false);
});

test("messages.send preset inserts optimistic user + assistant placeholders for matching non-stream queries", () => {
  const messagesQuery = makeFunctionReference("query:messages");
  const store = new FakeOptimisticLocalStore();

  const baseEntry = {
    page: [
      { turnId: "t-1", orderInTurn: 0, messageId: "m-0", role: "user", status: "completed", text: "old", createdAt: 1, updatedAt: 1 },
    ],
    continueCursor: "",
    isDone: false,
  };

  store.seed(
    messagesQuery,
    { conversationId: "c-1", paginationOpts: { cursor: null, numItems: 20 } },
    baseEntry,
  );
  store.seed(
    messagesQuery,
    {
      conversationId: "c-1",
      paginationOpts: { cursor: null, numItems: 20 },
      streamArgs: { kind: "list", startOrder: 0 },
    },
    {
      page: [{ turnId: "t-1", orderInTurn: 0, messageId: "stream-0", role: "assistant", status: "streaming", text: "", createdAt: 1, updatedAt: 1 }],
      continueCursor: "",
      isDone: false,
    },
  );

  const optimisticUpdate = codexOptimisticPresets.messages.send(messagesQuery);

  optimisticUpdate(store, {
    conversationId: "c-1",
    turnId: "t-1",
    text: "hello",
    messageId: "m-user",
    includeAssistantPlaceholder: true,
    assistantPlaceholderId: "m-assistant",
  });

  const updated = store.getQuery(messagesQuery, {
    conversationId: "c-1",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  const streamed = store.getQuery(messagesQuery, {
    conversationId: "c-1",
    paginationOpts: { cursor: null, numItems: 20 },
    streamArgs: { kind: "list", startOrder: 0 },
  });

  assert.equal(updated.page[0].messageId, "m-assistant");
  assert.equal(updated.page[0].status, "streaming");
  assert.equal(updated.page[1].messageId, "m-user");
  assert.equal(updated.page[1].status, "completed");
  assert.equal(updated.page[1].orderInTurn, 1);
  assert.equal(updated.page[0].orderInTurn, 2);
  assert.deepEqual(baseEntry.page, [
    { turnId: "t-1", orderInTurn: 0, messageId: "m-0", role: "user", status: "completed", text: "old", createdAt: 1, updatedAt: 1 },
  ]);
  assert.equal(streamed.page[0].messageId, "stream-0");
});

test("deletionStatus presets update status immutably", () => {
  const deletionStatusQuery = makeFunctionReference("query:deletionStatus");
  const store = new FakeOptimisticLocalStore();

  const current = {
    deletionJobId: "job-1",
    status: "scheduled",
    targetKind: "thread",
    deletedCountsByTable: [],
    createdAt: 100,
    updatedAt: 100,
  };

  store.seed(
    deletionStatusQuery,
    { actor: { userId: "u1" }, deletionJobId: "job-1" },
    current,
  );

  codexOptimisticPresets.deletionStatus.cancel(deletionStatusQuery)(store, {
    actor: { userId: "u1" },
    deletionJobId: "job-1",
  });

  const cancelled = store.getQuery(deletionStatusQuery, {
    actor: { userId: "u1" },
    deletionJobId: "job-1",
  });

  assert.equal(cancelled.status, "cancelled");
  assert.equal(typeof cancelled.cancelledAt, "number");
  assert.equal(cancelled === current, false);
  assert.equal(current.status, "scheduled");

  codexOptimisticPresets.deletionStatus.forceRun(deletionStatusQuery)(store, {
    actor: { userId: "u1" },
    deletionJobId: "job-1",
  });

  const running = store.getQuery(deletionStatusQuery, {
    actor: { userId: "u1" },
    deletionJobId: "job-1",
  });

  assert.equal(running.status, "running");
  assert.equal(typeof running.startedAt, "number");
});

test("legacy optimisticallySendCodexMessage is no longer exported", async () => {
  const reactExports = await import("../dist/react/index.js");
  assert.equal("optimisticallySendCodexMessage" in reactExports, false);
});
