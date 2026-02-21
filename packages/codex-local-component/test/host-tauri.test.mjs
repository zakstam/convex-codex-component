import test from "node:test";
import assert from "node:assert/strict";
import {
  createTauriBridgeClient,
  TauriBridgeClientSendError,
  generateTauriArtifacts,
  HELPER_ACK_BY_TYPE,
  helperCommandForTauriCommand,
  parseHelperCommand,
  TAURI_BRIDGE_COMMANDS,
} from "../dist/host/tauri.js";

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
      return { running: false, localThreadId: null, turnId: null, lastError: null };
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
        return { running: true, localThreadId: "local-thread-1", turnId: null, lastError: null };
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
        return { running: true, localThreadId: "local-thread-1", turnId: null, lastError: null };
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
        return { running: false, localThreadId: null, conversationId: null, turnId: null, lastError: null };
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
    localThreadId: "thread-1",
    conversationId: "thread-1",
    turnId: "turn-1",
    lastError: null,
  });
  assert.equal(states.length, 1);
  assert.equal(states[0].running, true);
  assert.equal(states[0].conversationId, "thread-1");

  off();
  assert.equal(unsubscribed.length, 1);
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
