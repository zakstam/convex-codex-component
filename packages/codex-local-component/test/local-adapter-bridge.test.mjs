import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexLocalBridge } from "../dist/local-adapter/bridge.js";

const BRIDGE_BINARY = path.join(process.cwd(), "test", "bridge-process.cjs");

function withTempInputFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-test-"));
  const file = path.join(dir, "input.txt");
  fs.writeFileSync(file, "");
  return { dir, file };
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function waitFor(condition, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = condition();
    if (value) {
      return value;
    }
    await wait(10);
  }
  return false;
}

test("bridge start/stop guards and send behavior", async () => {
  const { dir, file } = withTempInputFile();
  process.env.BRIDGE_LINES = "";
  process.env.BRIDGE_INPUT_PATH = file;

  try {
    const onEventCalls = [];
    const bridge = new CodexLocalBridge(
      { codexBin: BRIDGE_BINARY },
      {
        onEvent: () => {
          onEventCalls.push(true);
        },
        onGlobalMessage: () => {},
        onProtocolError: () => {},
      },
    );

    bridge.start();
    bridge.send({ id: 1, result: { decision: "accept" } });
    const received = await waitFor(() => fs.readFileSync(file, "utf8"));
    assert.equal(received !== false, true);
    assert.equal(onEventCalls.length, 0);
    assert.throws(() => bridge.start(), /Bridge already started/);
    bridge.stop();
    await wait(5);

    const written = fs.readFileSync(file, "utf8");
    assert.match(written, /\{"id":1,"result":\{"decision":"accept"\}\}\n/);
  } finally {
    delete process.env.BRIDGE_INPUT_PATH;
    delete process.env.BRIDGE_LINES;
    cleanupTempDir(dir);
  }
});

test("bridge send requires started process", () => {
  const bridge = new CodexLocalBridge(
    { codexBin: BRIDGE_BINARY },
    {
      onEvent: () => {},
      onGlobalMessage: () => {},
      onProtocolError: () => {},
    },
  );
  assert.throws(() => bridge.send({ id: 1, result: { decision: "accept" } }), /Bridge not started/);
});

test("bridge parses stdout events and emits normalized turns", async () => {
  const { dir, file } = withTempInputFile();
  process.env.BRIDGE_LINES = JSON.stringify({
    jsonrpc: "2.0",
    method: "item/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "agentMessage",
        id: "item-1",
        text: "hello",
      },
    },
  }) + "\n";
  process.env.BRIDGE_INPUT_PATH = file;

  try {
    const events = [];
    const bridge = new CodexLocalBridge(
      { codexBin: BRIDGE_BINARY },
      {
        onEvent: (event) => {
          events.push(event);
        },
        onGlobalMessage: () => {},
        onProtocolError: () => {},
      },
    );

    bridge.start();
    const sawEvent = await waitFor(() => events.length >= 1);
    assert.equal(sawEvent, true);

    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "item/started");
    assert.equal(events[0].threadId, "thread-1");
    assert.equal(events[0].turnId, "turn-1");
    assert.equal(events[0].streamId, "thread-1:turn-1:0");
    assert.equal(events[0].cursorStart, 0);
    assert.equal(events[0].cursorEnd, 1);
    bridge.stop();
    await wait(5);
  } finally {
    delete process.env.BRIDGE_INPUT_PATH;
    delete process.env.BRIDGE_LINES;
    cleanupTempDir(dir);
  }
});

test("bridge logs raw lines in turns mode", async () => {
  const { dir, file } = withTempInputFile();
  process.env.CODEX_BRIDGE_RAW_LOG = "turns";
  process.env.BRIDGE_LINES = JSON.stringify({
    jsonrpc: "2.0",
    method: "turn/started",
    params: {
      threadId: "thread-raw",
      turn: {
        id: "turn-raw",
        items: [],
        status: "inProgress",
      },
    },
  }) + "\n";
  process.env.BRIDGE_INPUT_PATH = file;

  const previousError = console.error;
  const errorCalls = [];
  console.error = (...args) => {
    errorCalls.push(args.join(" "));
  };

  try {
    const bridge = new CodexLocalBridge(
      { codexBin: BRIDGE_BINARY },
      {
        onEvent: () => {},
        onGlobalMessage: () => {},
        onProtocolError: () => {},
      },
    );

    bridge.start();
    const sawRawLog = await waitFor(() => errorCalls.length >= 1);
    assert.equal(sawRawLog, true);

    bridge.stop();
    await wait(5);
    assert.match(errorCalls[0], /\[codex-bridge:raw-in\]/);
  } finally {
    console.error = previousError;
    delete process.env.CODEX_BRIDGE_RAW_LOG;
    delete process.env.BRIDGE_INPUT_PATH;
    delete process.env.BRIDGE_LINES;
    cleanupTempDir(dir);
  }
});

test("bridge reports protocol parse errors", async () => {
  const { dir, file } = withTempInputFile();
  process.env.BRIDGE_LINES = "not-json\n";
  process.env.BRIDGE_INPUT_PATH = file;
  const protocolErrors = [];

  try {
    const bridge = new CodexLocalBridge(
      { codexBin: BRIDGE_BINARY },
      {
        onEvent: () => {},
        onGlobalMessage: () => {},
        onProtocolError: (error) => {
          protocolErrors.push(error);
        },
      },
    );
    bridge.start();
    const sawProtocolError = await waitFor(() => protocolErrors.length === 1, 700);
    assert.equal(sawProtocolError, true);

    assert.match(protocolErrors[0].error.message, /Invalid JSON from codex app-server/);
    bridge.stop();
    await wait(5);
  } finally {
    delete process.env.BRIDGE_INPUT_PATH;
    delete process.env.BRIDGE_LINES;
    cleanupTempDir(dir);
  }
});
