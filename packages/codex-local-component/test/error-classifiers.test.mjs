import test from "node:test";
import assert from "node:assert/strict";
import {
  isRecoverableIngestError,
  isSessionForbidden,
  isThreadForbidden,
  isThreadMissing,
  isTurnNotFound,
  parseErrorCode,
} from "../dist/errors.js";

test("parseErrorCode extracts bracketed codes", () => {
  assert.equal(parseErrorCode(new Error("[E_AUTH_THREAD_FORBIDDEN] authorization failed")), "E_AUTH_THREAD_FORBIDDEN");
  assert.equal(parseErrorCode("plain error"), null);
});

test("thread classifiers identify missing and forbidden states", () => {
  assert.equal(isThreadMissing(new Error("Thread not found for scope: thread-1")), true);
  assert.equal(isThreadForbidden(new Error("[E_AUTH_THREAD_FORBIDDEN] authorization failed")), true);
  assert.equal(isSessionForbidden(new Error("[E_AUTH_SESSION_FORBIDDEN] authorization failed")), true);
});

test("isRecoverableIngestError accepts structured safe-ingest entries", () => {
  assert.equal(isRecoverableIngestError([{ code: "SESSION_NOT_FOUND", recoverable: false }]), true);
  assert.equal(isRecoverableIngestError([{ code: "UNKNOWN", recoverable: false }]), false);
  assert.equal(isRecoverableIngestError([{ recoverable: true }]), true);
});

test("isTurnNotFound identifies turn-not-found errors", () => {
  assert.equal(isTurnNotFound(new Error("Turn not found: turn-123")), true);
  assert.equal(isTurnNotFound(new Error("[E_TURN_NOT_FOUND] no such turn")), true);
  assert.equal(isTurnNotFound(new Error("Thread not found")), false);
  assert.equal(isTurnNotFound(new Error("some other error")), false);
});

test("isRecoverableIngestError handles raw sync error strings", () => {
  assert.equal(isRecoverableIngestError(new Error("[E_SYNC_SESSION_NOT_FOUND] missing session")), true);
  assert.equal(isRecoverableIngestError(new Error("[E_SYNC_OUT_OF_ORDER] gap")), false);
});
