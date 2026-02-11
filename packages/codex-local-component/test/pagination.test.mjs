import test from "node:test";
import assert from "node:assert/strict";
import { decodeKeysetCursor, encodeKeysetCursor } from "../dist/component/pagination.js";

test("decodeKeysetCursor decodes valid JSON cursor", () => {
  const cursor = encodeKeysetCursor({ createdAt: 10, id: "a" });
  assert.deepEqual(decodeKeysetCursor(cursor), { createdAt: 10, id: "a" });
});

test("decodeKeysetCursor fail-closes on invalid JSON", () => {
  assert.throws(
    () => decodeKeysetCursor("{"),
    /E_KEYSET_CURSOR_INVALID/,
  );
});
