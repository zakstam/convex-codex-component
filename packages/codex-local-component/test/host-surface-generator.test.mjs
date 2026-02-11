import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderHostChatGenerated,
  renderHostPresetMatrixMarkdown,
} from "../dist/host/surfaceGenerator.js";

const here = dirname(fileURLToPath(import.meta.url));

function readSnapshot(name) {
  return readFileSync(join(here, "snapshots", name), "utf8");
}

test("renderHostChatGenerated snapshot: dispatchManaged", () => {
  const rendered = renderHostChatGenerated({
    profile: "dispatchManaged",
    serverDeviceIdDefault: "dispatch-device",
  });
  assert.equal(rendered, readSnapshot("chat.generated.dispatchManaged.ts"));
});

test("renderHostChatGenerated snapshot: runtimeOwned", () => {
  const rendered = renderHostChatGenerated({
    profile: "runtimeOwned",
    serverDeviceIdDefault: "runtime-device",
  });
  assert.equal(rendered, readSnapshot("chat.generated.runtimeOwned.ts"));
});

test("renderHostPresetMatrixMarkdown snapshot", () => {
  const rendered = renderHostPresetMatrixMarkdown();
  assert.equal(rendered, readSnapshot("HOST_PRESET_MATRIX.md"));
});
