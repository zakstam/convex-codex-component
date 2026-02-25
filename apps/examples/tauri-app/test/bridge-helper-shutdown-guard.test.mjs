import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const helperSource = readFileSync(
  new URL("../src-node/bridge-helper.ts", import.meta.url),
  "utf8",
);

test("bridge helper enforces bounded shutdown timeout", () => {
  assert.equal(
    helperSource.includes("FORCED_SHUTDOWN_TIMEOUT_MS"),
    true,
    "expected explicit forced shutdown timeout constant",
  );
  assert.equal(
    helperSource.includes("Promise.race"),
    true,
    "expected shutdown to race cleanup against timeout",
  );
});

test("bridge helper self-terminates when parent process is gone", () => {
  assert.equal(
    helperSource.includes("process.ppid"),
    true,
    "expected helper to monitor parent pid",
  );
  assert.equal(
    helperSource.includes("parent-process-disconnected"),
    true,
    "expected dedicated shutdown reason when parent disappears",
  );
});
