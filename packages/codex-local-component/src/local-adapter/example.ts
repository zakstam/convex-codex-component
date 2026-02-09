import { CodexLocalBridge } from "./bridge.js";

const bridge = new CodexLocalBridge(
  {
    ...(process.env.CODEX_BIN ? { codexBin: process.env.CODEX_BIN } : {}),
    cwd: process.cwd(),
  },
  {
    onEvent: async (event) => {
      // Persist thread-scoped stream events to Convex sync APIs.
      console.log("thread-event", event.kind, event.threadId, event.cursorEnd);
    },
    onGlobalMessage: async (message, classification) => {
      // Handle account/config/global notifications separately.
      console.log("global-message", classification.kind, JSON.stringify(message));
    },
    onProtocolError: async ({ line, error }) => {
      // Fail loudly and send to telemetry.
      console.error("protocol-error", error.message, line);
    },
    onProcessExit: (code) => {
      console.log("codex-process-exit", code);
    },
  },
);

bridge.start();
