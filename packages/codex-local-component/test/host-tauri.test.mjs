import test from "node:test";
import assert from "node:assert/strict";
import {
  createTauriBridgeClient,
  generateTauriArtifacts,
  HELPER_ACK_BY_TYPE,
  helperCommandForTauriCommand,
  parseHelperCommand,
  TAURI_BRIDGE_COMMANDS,
} from "../dist/host/tauri.js";

test("TAURI_BRIDGE_COMMANDS exposes stable command metadata", () => {
  assert.equal(TAURI_BRIDGE_COMMANDS.length, 16);
  const names = TAURI_BRIDGE_COMMANDS.map((command) => command.tauriCommand);
  assert.ok(names.includes("start_bridge"));
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
  assert.equal(helperCommandForTauriCommand("get_bridge_state"), null);
});

test("HELPER_ACK_BY_TYPE tracks ack-required helper commands", () => {
  assert.equal(HELPER_ACK_BY_TYPE.start, false);
  assert.equal(HELPER_ACK_BY_TYPE.stop, false);
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

  await client.startBridge({
    convexUrl: "https://example.convex.cloud",
    actor: { userId: "demo-user" },
    sessionId: "session-1",
  });
  await client.sendUserTurn("hello");
  await client.readAccount();
  const state = await client.getBridgeState();

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
  assert.deepEqual(calls[2], { command: "read_account", args: { config: {} } });
  assert.deepEqual(calls[3], { command: "get_bridge_state", args: undefined });
});

test("generateTauriArtifacts returns command-aligned rust and permission outputs", () => {
  const artifacts = generateTauriArtifacts();

  assert.match(artifacts.rustContractSource, /pub const BRIDGE_COMMANDS/);
  assert.match(artifacts.rustDispatchSource, /helper_command_for_tauri_command/);
  assert.match(artifacts.rustInvokeHandlersSource, /tauri::generate_handler!/);

  assert.equal(artifacts.permissionFiles.length, 15);
  const startPermission = artifacts.permissionFiles.find((file) => file.filename === "start_bridge.toml");
  assert.ok(startPermission);
  assert.match(startPermission.contents, /allow-start-bridge/);
});
