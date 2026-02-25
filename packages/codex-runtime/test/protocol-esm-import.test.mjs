import test from "node:test";
import assert from "node:assert/strict";

test("protocol entrypoint imports in Node ESM without directory import errors", async () => {
  await assert.doesNotReject(async () => {
    await import("../dist/protocol/index.js");
  });
});
