import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveThreadPreview,
  UNTITLED_THREAD_PREVIEW,
} from "../dist/component/threadPreview.js";

test("deriveThreadPreview prefers explicit thread name from lifecycle events", () => {
  const preview = deriveThreadPreview({
    lifecycleEvents: [
      {
        kind: "thread/name/updated",
        payloadJson: JSON.stringify({
          jsonrpc: "2.0",
          method: "thread/name/updated",
          params: { threadName: "Release planning" },
        }),
      },
    ],
    firstUserMessageText: "first user message",
  });

  assert.equal(preview, "Release planning");
});

test("deriveThreadPreview falls back to first user message when name update clears thread name", () => {
  const preview = deriveThreadPreview({
    lifecycleEvents: [
      {
        kind: "thread/name/updated",
        payloadJson: JSON.stringify({
          jsonrpc: "2.0",
          method: "thread/name/updated",
          params: {},
        }),
      },
      {
        kind: "thread/name/updated",
        payloadJson: JSON.stringify({
          jsonrpc: "2.0",
          method: "thread/name/updated",
          params: { threadName: "Older name" },
        }),
      },
    ],
    firstUserMessageText: "summarize this log",
  });

  assert.equal(preview, "summarize this log");
});

test("deriveThreadPreview returns untitled fallback when both name and message are missing", () => {
  const preview = deriveThreadPreview({
    lifecycleEvents: [],
    firstUserMessageText: "   ",
  });

  assert.equal(preview, UNTITLED_THREAD_PREVIEW);
});
