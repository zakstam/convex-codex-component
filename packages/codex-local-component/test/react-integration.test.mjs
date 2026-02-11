import test from "node:test";
import assert from "node:assert/strict";
import {
  codexThreadScopeArgs,
  codexThreadTurnScopeArgs,
} from "../dist/react-integration/index.js";

test("codexThreadScopeArgs returns skip when threadId is missing", () => {
  const actor = { userId: "u" };
  assert.equal(codexThreadScopeArgs(actor, undefined), "skip");
  assert.equal(codexThreadScopeArgs(actor, null), "skip");
  assert.equal(codexThreadScopeArgs(actor, ""), "skip");
});

test("codexThreadScopeArgs builds canonical actor/thread args", () => {
  const actor = { userId: "u" };
  assert.deepEqual(codexThreadScopeArgs(actor, "thread-1"), {
    actor,
    threadId: "thread-1",
  });
});

test("codexThreadTurnScopeArgs returns skip when thread or turn is missing", () => {
  const actor = { userId: "u" };
  assert.equal(codexThreadTurnScopeArgs(actor, undefined, "turn-1"), "skip");
  assert.equal(codexThreadTurnScopeArgs(actor, "thread-1", undefined), "skip");
  assert.equal(codexThreadTurnScopeArgs(actor, "", "turn-1"), "skip");
  assert.equal(codexThreadTurnScopeArgs(actor, "thread-1", ""), "skip");
});

test("codexThreadTurnScopeArgs builds canonical actor/thread/turn args", () => {
  const actor = { userId: "u" };
  assert.deepEqual(codexThreadTurnScopeArgs(actor, "thread-1", "turn-1"), {
    actor,
    threadId: "thread-1",
    turnId: "turn-1",
  });
});
