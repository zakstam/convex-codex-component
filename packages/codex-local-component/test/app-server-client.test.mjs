import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTurnInterruptRequest,
  buildTurnStartTextRequest,
} from "../dist/app-server/index.js";

test("app-server request builders accept UUID-like thread IDs (including v7)", () => {
  const uuidV7Like = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  const turnStart = buildTurnStartTextRequest(1, {
    threadId: uuidV7Like,
    text: "hello",
  });
  const interrupt = buildTurnInterruptRequest(2, {
    threadId: uuidV7Like,
    turnId: "turn-1",
  });

  assert.equal(turnStart.params.threadId, uuidV7Like);
  assert.equal(interrupt.params.threadId, uuidV7Like);
});

test("app-server request builders reject malformed thread IDs", () => {
  assert.throws(() =>
    buildTurnStartTextRequest(1, {
      threadId: "thread-not-uuid",
      text: "hello",
    }),
  );
});
