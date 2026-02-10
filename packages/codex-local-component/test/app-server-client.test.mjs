import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAccountLoginCancelRequest,
  buildAccountLoginStartRequest,
  buildAccountLogoutRequest,
  buildAccountRateLimitsReadRequest,
  buildAccountReadRequest,
  buildChatgptAuthTokensRefreshResponse,
  buildCommandExecutionApprovalResponse,
  buildDynamicToolCallResponse,
  buildFileChangeApprovalResponse,
  buildThreadArchiveRequest,
  buildThreadForkRequest,
  buildThreadListRequest,
  buildThreadLoadedListRequest,
  buildThreadReadRequest,
  buildThreadResumeRequest,
  buildThreadRollbackRequest,
  buildThreadStartRequest,
  buildThreadUnarchiveRequest,
  buildToolRequestUserInputResponse,
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

test("app-server thread lifecycle builders pass dynamicTools on start and resume", () => {
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";
  const dynamicTools = [
    {
      name: "search_docs",
      description: "Search internal docs",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  ];

  const start = buildThreadStartRequest(1, { dynamicTools });
  const resume = buildThreadResumeRequest(2, { threadId, dynamicTools });

  assert.deepEqual(start.params.dynamicTools, dynamicTools);
  assert.deepEqual(resume.params.dynamicTools, dynamicTools);
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

test("app-server response builders create JSON-RPC response payloads for server requests", () => {
  assert.deepEqual(buildCommandExecutionApprovalResponse(10, "accept"), {
    id: 10,
    result: { decision: "accept" },
  });
  assert.deepEqual(buildFileChangeApprovalResponse("11", "decline"), {
    id: "11",
    result: { decision: "decline" },
  });
  assert.deepEqual(
    buildToolRequestUserInputResponse(12, {
      q1: { answers: ["A"] },
    }),
    {
      id: 12,
      result: { answers: { q1: { answers: ["A"] } } },
    },
  );
  assert.deepEqual(buildDynamicToolCallResponse(13, { success: true, contentItems: [] }), {
    id: 13,
    result: { success: true, contentItems: [] },
  });
  assert.deepEqual(
    buildChatgptAuthTokensRefreshResponse(14, {
      idToken: "id-token",
      accessToken: "access-token",
    }),
    {
      id: 14,
      result: { idToken: "id-token", accessToken: "access-token" },
    },
  );
});

test("app-server account/auth request builders create typed request envelopes", () => {
  assert.deepEqual(buildAccountReadRequest(20), {
    method: "account/read",
    id: 20,
    params: { refreshToken: false },
  });
  assert.deepEqual(buildAccountReadRequest(21, { refreshToken: true }).params.refreshToken, true);
  assert.deepEqual(
    buildAccountLoginStartRequest(22, { type: "apiKey", apiKey: "test-api-key" }),
    {
      method: "account/login/start",
      id: 22,
      params: { type: "apiKey", apiKey: "test-api-key" },
    },
  );
  assert.deepEqual(buildAccountLoginCancelRequest(23, { loginId: "login-1" }), {
    method: "account/login/cancel",
    id: 23,
    params: { loginId: "login-1" },
  });
  assert.deepEqual(buildAccountLogoutRequest(24), {
    method: "account/logout",
    id: 24,
    params: undefined,
  });
  assert.deepEqual(buildAccountRateLimitsReadRequest(25), {
    method: "account/rateLimits/read",
    id: 25,
    params: undefined,
  });
});
