import test from "node:test";
import assert from "node:assert/strict";
import { classifyMessage, extractStreamId, extractTurnId } from "../dist/protocol/classifier.js";

test("classifyMessage keeps modern turn notifications thread-scoped", () => {
  const message = {
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-9",
        items: [],
        status: "completed",
        error: null,
      },
    },
  };

  assert.deepEqual(classifyMessage(message), {
    scope: "thread",
    kind: "turn/completed",
    threadId: "thread-1",
  });
  assert.equal(extractTurnId(message), "turn-9");
});

test("classifyMessage reads thread id from thread/started params.thread.id", () => {
  const message = {
    jsonrpc: "2.0",
    method: "thread/started",
    params: {
      thread: {
        id: "thread-from-object",
        preview: "",
        modelProvider: "openai",
        createdAt: 1,
        updatedAt: 1,
        path: "/tmp/x",
        cwd: "/tmp",
        cliVersion: "0.0.0",
        source: "cli",
        gitInfo: { sha: null, branch: null, originUrl: null },
        turns: [],
      },
    },
  };

  assert.deepEqual(classifyMessage(message), {
    scope: "thread",
    kind: "thread/started",
    threadId: "thread-from-object",
  });
});

test("extractTurnId reads modern turn and item shapes", () => {
  assert.equal(
    extractTurnId({
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-modern", items: [], status: "inProgress", error: null },
      },
    }),
    "turn-modern",
  );

  assert.equal(
    extractTurnId({
      jsonrpc: "2.0",
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-modern",
        item: { type: "plan", id: "item-1", text: "a" },
      },
    }),
    "turn-modern",
  );
});

test("extractTurnId ignores unsupported payload envelopes", () => {
  assert.equal(
    extractTurnId({
      jsonrpc: "2.0",
      method: "unsupported/task_complete",
      params: {
        id: "0",
        msg: { type: "task_complete" },
      },
    }),
    undefined,
  );

  assert.equal(
    extractTurnId({
      jsonrpc: "2.0",
      method: "unsupported/task_complete",
      params: {
        id: "0",
        msg: { type: "task_complete", turn_id: "turn-ignored-1" },
      },
    }),
    undefined,
  );
});

test("extractStreamId returns undefined for modern generated protocol", () => {
  const message = {
    jsonrpc: "2.0",
    method: "turn/started",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        items: [],
        status: "inProgress",
        error: null,
      },
    },
  };
  assert.equal(extractStreamId(message), undefined);
});

test("classifyMessage rejects thread-scoped messages missing threadId", () => {
  const message = {
    jsonrpc: "2.0",
    method: "item/started",
    params: {
      turnId: "turn-1",
      item: {
        type: "plan",
        id: "item-1",
        text: "test",
      },
    },
  };

  assert.throws(
    () => classifyMessage(message),
    /Thread-scoped protocol message missing threadId/,
  );
});

test("classifyMessage ignores unsupported conversationId fields", () => {
  const message = {
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId: "thread-modern-id",
      conversationId: "thread-ignored-id",
      turn: {
        id: "turn-10",
        items: [],
        status: "completed",
        error: null,
      },
    },
  };

  assert.deepEqual(classifyMessage(message), {
    scope: "thread",
    kind: "turn/completed",
    threadId: "thread-modern-id",
  });
});
