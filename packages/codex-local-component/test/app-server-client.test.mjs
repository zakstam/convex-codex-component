import test from "node:test";
import assert from "node:assert/strict";
import {
  buildThreadArchiveRequest,
  buildThreadForkRequest,
  buildThreadListRequest,
  buildThreadLoadedListRequest,
  buildThreadReadRequest,
  buildThreadResumeRequest,
  buildThreadRollbackRequest,
  buildThreadUnarchiveRequest,
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

test("app-server thread lifecycle builders create typed request envelopes", () => {
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  assert.deepEqual(buildThreadResumeRequest(1, { threadId }).method, "thread/resume");
  assert.deepEqual(buildThreadForkRequest(2, { threadId }).method, "thread/fork");
  assert.deepEqual(buildThreadArchiveRequest(3, { threadId }).method, "thread/archive");
  assert.deepEqual(buildThreadUnarchiveRequest(4, { threadId }).method, "thread/unarchive");
  assert.deepEqual(buildThreadRollbackRequest(5, { threadId, numTurns: 2 }).method, "thread/rollback");
  assert.deepEqual(buildThreadReadRequest(6, { threadId }).params.includeTurns, false);
  assert.deepEqual(buildThreadReadRequest(7, { threadId, includeTurns: true }).params.includeTurns, true);
  assert.deepEqual(buildThreadListRequest(8, {}).method, "thread/list");
  assert.deepEqual(buildThreadLoadedListRequest(9, {}).method, "thread/loaded/list");
});

test("app-server request builders reject malformed thread IDs", () => {
  assert.throws(() =>
    buildTurnStartTextRequest(1, {
      threadId: "thread-not-uuid",
      text: "hello",
    }),
  );
  assert.throws(() =>
    buildThreadResumeRequest(2, {
      threadId: "thread-not-uuid",
    }),
  );
});
