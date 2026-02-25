import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createTauriBridgeClient,
  TauriBridgeClientSendError,
  generateTauriArtifacts,
  HELPER_ACK_BY_TYPE,
  helperCommandForTauriCommand,
  parseThreadReadSnapshotMessages,
  parseHelperCommand,
  TAURI_BRIDGE_COMMANDS,
} from "../dist/index.js";

test("root entrypoint does not re-export node-only local adapter", async () => {
  const indexPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const indexContents = await readFile(indexPath, "utf8");
  assert.equal(indexContents.includes("./local-adapter/bridge.js"), false);
});

test("TAURI_BRIDGE_COMMANDS exposes stable command metadata", () => {
  assert.equal(TAURI_BRIDGE_COMMANDS.length, 18);
  const names = TAURI_BRIDGE_COMMANDS.map((command) => command.tauriCommand);
  assert.ok(names.includes("start_bridge"));
  assert.ok(names.includes("open_thread"));
  assert.ok(names.includes("refresh_local_threads"));
  assert.ok(names.includes("get_bridge_state"));
});

test("parseHelperCommand accepts supported helper commands and validates payload presence", () => {
  const parsed = parseHelperCommand(
    JSON.stringify({ type: "respond_tool_user_input", payload: { requestId: "1", answers: {} } }),
  );
  assert.equal(parsed.type, "respond_tool_user_input");

  assert.throws(() => parseHelperCommand(JSON.stringify({ type: "respond_tool_user_input" })), /Missing payload/);
  assert.throws(() => parseHelperCommand(JSON.stringify({ type: "unknown" })), /Unsupported helper command/);
});

test("helperCommandForTauriCommand maps tauri command names to helper command names", () => {
  assert.equal(helperCommandForTauriCommand("send_user_turn"), "send_turn");
  assert.equal(helperCommandForTauriCommand("open_thread"), "open_thread");
  assert.equal(helperCommandForTauriCommand("get_bridge_state"), null);
});

test("HELPER_ACK_BY_TYPE tracks ack-required helper commands", () => {
  assert.equal(HELPER_ACK_BY_TYPE.start, false);
  assert.equal(HELPER_ACK_BY_TYPE.stop, false);
  assert.equal(HELPER_ACK_BY_TYPE.open_thread, true);
  assert.equal(HELPER_ACK_BY_TYPE.send_turn, true);
});

test("createTauriBridgeClient wraps invoke with expected payload envelopes", async () => {
  const calls = [];
  const client = createTauriBridgeClient(async (command, args) => {
    calls.push({ command, args });
    if (command === "get_bridge_state") {
      return { running: false, conversationId: null, runtimeConversationId: null, turnId: null, lastError: null };
    }
    return { ok: true };
  });

  await client.lifecycle.start({
    convexUrl: "https://example.convex.cloud",
    actor: { userId: "demo-user" },
    sessionId: "session-1",
  });
  await client.turns.send("hello");
  await client.lifecycle.openThread({ strategy: "start" });
  await client.account.read();
  const state = await client.lifecycle.getState();

  assert.equal(state.running, false);
  assert.deepEqual(calls[0], {
    command: "start_bridge",
    args: {
      config: {
        convexUrl: "https://example.convex.cloud",
        actor: { userId: "demo-user" },
        sessionId: "session-1",
      },
    },
  });
  assert.deepEqual(calls[1], { command: "send_user_turn", args: { text: "hello" } });
  assert.deepEqual(calls[2], { command: "open_thread", args: { config: { strategy: "start" } } });
  assert.deepEqual(calls[3], { command: "read_account", args: { config: {} } });
  assert.deepEqual(calls[4], { command: "get_bridge_state", args: undefined });
});

test("createTauriBridgeClient openThread does not emit legacy threadId alias", async () => {
  const calls = [];
  const client = createTauriBridgeClient(async (command, args) => {
    calls.push({ command, args });
    return { ok: true };
  });

  await client.lifecycle.openThread({
    strategy: "resume",
    conversationId: "conversation-1",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "open_thread");
  assert.deepEqual(calls[0].args, {
    config: {
      strategy: "resume",
      conversationId: "conversation-1",
    },
  });
  assert.equal(Object.hasOwn(calls[0].args.config, "threadId"), false);
});

test("createTauriBridgeClient openThread fail-closes resume/fork without conversationId", async () => {
  const calls = [];
  const client = createTauriBridgeClient(async (command, args) => {
    calls.push({ command, args });
    return { ok: true };
  });

  assert.throws(
    () => client.lifecycle.openThread({ strategy: "resume" }),
    /conversationId is required when strategy="resume"\./,
  );
  assert.throws(
    () => client.lifecycle.openThread({ strategy: "fork", conversationId: "   " }),
    /conversationId is required when strategy="fork"\./,
  );

  assert.equal(calls.length, 0);
});

test("createTauriBridgeClient send keeps fail-fast behavior by default", async () => {
  const calls = [];
  const client = createTauriBridgeClient(async (command, args) => {
    calls.push({ command, args });
    if (command === "send_user_turn") {
      throw new Error("bridge helper is not running. Start runtime first.");
    }
    return { ok: true };
  });

  await assert.rejects(
    client.turns.send("hello"),
    /bridge helper is not running\. Start runtime first\./,
  );
  assert.deepEqual(calls, [{ command: "send_user_turn", args: { text: "hello" } }]);
});

test("createTauriBridgeClient lifecycleSafeSend auto-starts and retries send", async () => {
  const calls = [];
  let sendAttempts = 0;
  const client = createTauriBridgeClient(
    async (command, args) => {
      calls.push({ command, args });
      if (command === "send_user_turn") {
        sendAttempts += 1;
        if (sendAttempts === 1) {
          throw new Error("bridge helper is not running. Start runtime first.");
        }
      }
      if (command === "get_bridge_state") {
        return {
          running: true,
          conversationId: "conversation-1",
          runtimeConversationId: "runtime-conversation-1",
          turnId: null,
          lastError: null,
        };
      }
      return { ok: true };
    },
    { lifecycleSafeSend: true },
  );

  await client.lifecycle.start({
    convexUrl: "https://example.convex.cloud",
    actor: { userId: "demo-user" },
    sessionId: "session-1",
  });
  await client.turns.send("hello");

  assert.equal(sendAttempts, 2);
  assert.deepEqual(calls.map((entry) => entry.command), [
    "start_bridge",
    "send_user_turn",
    "start_bridge",
    "get_bridge_state",
    "send_user_turn",
  ]);
});

test("createTauriBridgeClient lifecycleSafeSend fails closed without cached start config", async () => {
  const client = createTauriBridgeClient(
    async (command) => {
      if (command === "send_user_turn") {
        throw new Error("bridge helper is not running. Start runtime first.");
      }
      return { ok: true };
    },
    { lifecycleSafeSend: true },
  );

  await assert.rejects(
    client.turns.send("hello"),
    (error) => {
      assert.ok(error instanceof TauriBridgeClientSendError);
      assert.equal(error.code, "E_TAURI_SEND_START_CONFIG_MISSING");
      return true;
    },
  );
});

test("createTauriBridgeClient lifecycleSafeSend fails with retry-exhausted when resend still fails", async () => {
  let startCalls = 0;
  const client = createTauriBridgeClient(
    async (command) => {
      if (command === "start_bridge") {
        startCalls += 1;
        return { ok: true };
      }
      if (command === "get_bridge_state") {
        return {
          running: true,
          conversationId: "conversation-1",
          runtimeConversationId: "runtime-conversation-1",
          turnId: null,
          lastError: null,
        };
      }
      if (command === "send_user_turn") {
        throw new Error("failed to write command: broken pipe");
      }
      return { ok: true };
    },
    { lifecycleSafeSend: true },
  );

  await client.lifecycle.start({
    convexUrl: "https://example.convex.cloud",
    actor: { userId: "demo-user" },
    sessionId: "session-1",
  });
  await assert.rejects(
    client.turns.send("hello"),
    (error) => {
      assert.ok(error instanceof TauriBridgeClientSendError);
      assert.equal(error.code, "E_TAURI_SEND_RETRY_EXHAUSTED");
      return true;
    },
  );
  assert.equal(startCalls, 2);
});

test("createTauriBridgeClient exposes lifecycle subscription when configured", async () => {
  const listeners = [];
  const unsubscribed = [];
  const client = createTauriBridgeClient(
    async (command) => {
      if (command === "get_bridge_state") {
        return { running: false, conversationId: null, runtimeConversationId: null, turnId: null, lastError: null };
      }
      return { ok: true };
    },
    {
      subscribeBridgeState: async (listener) => {
        listeners.push(listener);
        return () => {
          unsubscribed.push(true);
        };
      },
    },
  );

  const states = [];
  const off = await client.lifecycle.subscribe((state) => {
    states.push(state);
  });

  listeners[0]({
    running: true,
    conversationId: "thread-1",
    runtimeConversationId: "runtime-thread-1",
    turnId: "turn-1",
    lastError: null,
  });
  assert.equal(states.length, 1);
  assert.equal(states[0].running, true);
  assert.equal(states[0].conversationId, "thread-1");

  off();
  assert.equal(unsubscribed.length, 1);
});

test("createTauriBridgeClient sync hydration subscription receives snapshots and state updates", async () => {
  const globalListeners = [];
  const globalUnsubscribed = [];
  const client = createTauriBridgeClient(
    async (command) => {
      if (command === "get_bridge_state") {
        return { running: false, conversationId: null, runtimeConversationId: null, turnId: null, lastError: null };
      }
      return { ok: true };
    },
    {
      subscribeGlobalMessage: async (listener) => {
        globalListeners.push(listener);
        return () => {
          globalUnsubscribed.push(true);
        };
      },
    },
  );

  assert.equal(await client.syncHydration.getConversationSnapshot("conversation-1"), null);
  const seen = [];
  const off = await client.syncHydration.subscribe((snapshot) => {
    seen.push(snapshot);
  });

  globalListeners[0]({
    kind: "bridge/sync_hydration_snapshot",
    conversationId: "conversation-1",
    syncState: "syncing",
    updatedAtMs: 100,
    messages: [
      {
        messageId: "m-local-1",
        turnId: "t-1",
        role: "user",
        status: "completed",
        text: "hello",
        orderInTurn: 0,
        createdAt: 10,
        updatedAt: 10,
      },
    ],
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].conversationId, "conversation-1");
  assert.equal(seen[0].syncState, "syncing");
  assert.equal(seen[0].messages.length, 1);

  globalListeners[0]({
    kind: "bridge/sync_hydration_state",
    conversationId: "conversation-1",
    syncState: "synced",
    updatedAtMs: 101,
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].syncState, "synced");
  assert.equal(seen[1].messages.length, 1);

  const cached = await client.syncHydration.getConversationSnapshot("conversation-1");
  assert.ok(cached);
  assert.equal(cached.syncState, "synced");
  assert.equal(cached.messages.length, 1);

  off();
  assert.equal(globalUnsubscribed.length, 1);
});

test("createTauriBridgeClient sync hydration getConversationSnapshot eagerly attaches global listener", async () => {
  const globalListeners = [];
  const client = createTauriBridgeClient(
    async () => ({ ok: true }),
    {
      subscribeGlobalMessage: async (listener) => {
        globalListeners.push(listener);
        return () => {};
      },
    },
  );

  assert.equal(globalListeners.length, 0);
  assert.equal(await client.syncHydration.getConversationSnapshot("conversation-early"), null);
  assert.equal(globalListeners.length, 1);

  globalListeners[0]({
    kind: "bridge/sync_hydration_snapshot",
    conversationId: "conversation-early",
    syncState: "syncing",
    updatedAtMs: 100,
    messages: [
      {
        messageId: "m-local-early",
        turnId: "t-early",
        role: "user",
        status: "completed",
        text: "early snapshot",
        orderInTurn: 0,
        createdAt: 10,
        updatedAt: 10,
      },
    ],
  });

  const snapshot = await client.syncHydration.getConversationSnapshot("conversation-early");
  assert.ok(snapshot);
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.syncState, "syncing");
});

test("createTauriBridgeClient sync hydration subscribe fails closed when global subscription is missing", async () => {
  const client = createTauriBridgeClient(async () => ({ ok: true }));
  await assert.rejects(
    client.syncHydration.subscribe(() => {}),
    /Global message subscription is not configured for this client\./,
  );
});

test("createTauriBridgeClient sync hydration retries subscription after initial subscribe failure", async () => {
  const globalListeners = [];
  let subscribeCalls = 0;
  const client = createTauriBridgeClient(
    async () => ({ ok: true }),
    {
      subscribeGlobalMessage: async (listener) => {
        subscribeCalls += 1;
        if (subscribeCalls === 1) {
          throw new Error("temporary subscription failure");
        }
        globalListeners.push(listener);
        return () => {};
      },
    },
  );

  await assert.rejects(
    client.syncHydration.subscribe(() => {}),
    /temporary subscription failure/,
  );
  const seen = [];
  await client.syncHydration.subscribe((snapshot) => {
    seen.push(snapshot);
  });

  assert.equal(subscribeCalls, 2);
  globalListeners[0]({
    kind: "bridge/sync_hydration_snapshot",
    conversationId: "conversation-retry",
    syncState: "syncing",
    updatedAtMs: 100,
    messages: [],
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].conversationId, "conversation-retry");
});

test("createTauriBridgeClient sync hydration ignores stale job terminal update from prior job", async () => {
  const globalListeners = [];
  const client = createTauriBridgeClient(
    async () => ({ ok: true }),
    {
      subscribeGlobalMessage: async (listener) => {
        globalListeners.push(listener);
        return () => {};
      },
    },
  );

  const seen = [];
  await client.syncHydration.subscribe((snapshot) => {
    seen.push(snapshot);
  });

  globalListeners[0]({
    kind: "bridge/sync_hydration_snapshot",
    conversationId: "conversation-1",
    syncState: "syncing",
    updatedAtMs: 100,
    syncJobId: "job-a",
    syncJobPolicyVersion: 1,
    messages: [],
  });
  globalListeners[0]({
    kind: "bridge/sync_hydration_snapshot",
    conversationId: "conversation-1",
    syncState: "syncing",
    updatedAtMs: 101,
    syncJobId: "job-b",
    syncJobPolicyVersion: 1,
    messages: [],
  });
  globalListeners[0]({
    kind: "bridge/sync_hydration_state",
    conversationId: "conversation-1",
    syncState: "synced",
    updatedAtMs: 102,
    syncJobId: "job-a",
    syncJobPolicyVersion: 1,
  });

  const snapshot = await client.syncHydration.getConversationSnapshot("conversation-1");
  assert.ok(snapshot);
  assert.equal(snapshot.syncJobId, "job-b");
  assert.equal(snapshot.syncState, "syncing");
  assert.equal(seen[seen.length - 1]?.syncJobId, "job-b");
});

test("generateTauriArtifacts returns command-aligned rust and permission outputs", () => {
  const artifacts = generateTauriArtifacts();

  assert.match(artifacts.rustContractSource, /pub const BRIDGE_COMMANDS/);
  assert.match(artifacts.rustDispatchSource, /helper_command_for_tauri_command/);
  assert.match(artifacts.rustInvokeHandlersSource, /tauri::generate_handler!/);

  assert.equal(artifacts.permissionFiles.length, 17);
  const startPermission = artifacts.permissionFiles.find((file) => file.filename === "start_bridge.toml");
  assert.ok(startPermission);
  assert.match(startPermission.contents, /allow-start-bridge/);
});

test("parseThreadReadSnapshotMessages supports runtime thread/read item casing variants", () => {
  const messages = parseThreadReadSnapshotMessages({
    result: {
      thread: {
        id: "thread-1",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            items: [
              { type: "userMessage", id: "user-1", content: [{ type: "text", text: "hello" }] },
              { type: "agentMessage", id: "assistant-1", text: "world" },
              { type: "systemMessage", id: "system-1", text: "system note" },
              { type: "toolMessage", id: "tool-1", text: "tool output" },
            ],
          },
          {
            id: "turn-2",
            status: "inProgress",
            items: [
              { type: "UserMessage", id: "user-2", text: "next" },
              { type: "AssistantMessage", id: "assistant-2", text: "streaming..." },
            ],
          },
        ],
      },
    },
  });

  assert.equal(messages.length, 6);
  assert.equal(messages[0].messageId, "user-1");
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].messageId, "assistant-1");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].status, "completed");
  assert.equal(messages[2].messageId, "system-1");
  assert.equal(messages[2].role, "system");
  assert.equal(messages[3].messageId, "tool-1");
  assert.equal(messages[3].role, "tool");
  assert.equal(messages[5].messageId, "assistant-2");
  assert.equal(messages[5].status, "streaming");
});
