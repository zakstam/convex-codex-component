import test from "node:test";
import assert from "node:assert/strict";
import { hasRecoverableIngestErrors } from "../dist/host/index.js";

test("hasRecoverableIngestErrors returns false when all errors are non-recoverable", () => {
  const result = hasRecoverableIngestErrors([
    { recoverable: false },
    { recoverable: false },
  ]);

  assert.equal(result, false);
});

test("hasRecoverableIngestErrors returns true when any error is recoverable", () => {
  const result = hasRecoverableIngestErrors([
    { recoverable: false },
    { recoverable: true },
  ]);

  assert.equal(result, true);
});
