import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runComponentFunctionValidatorsCheck } from "../scripts/check-component-function-validators.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "component-function-validator-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeComponentFile(rootDir, relativePath, contents) {
  const filePath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

test("reports missing returns validator for public component query", () => {
  withTempDir((rootDir) => {
    writeComponentFile(
      rootDir,
      "src/component/messages.ts",
      [
        'import { query } from "./_generated/server.js";',
        "",
        "export const list = query({",
        "  args: {},",
        "  handler: async () => ({ page: [], isDone: true, continueCursor: \"\" }),",
        "});",
        "",
      ].join("\n"),
    );

    const result = runComponentFunctionValidatorsCheck({ rootDir });
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.missingReturns, true);
  });
});

test("reports missing args validator for public component mutation", () => {
  withTempDir((rootDir) => {
    writeComponentFile(
      rootDir,
      "src/component/threads.ts",
      [
        'import { mutation } from "./_generated/server.js";',
        "",
        "export const create = mutation({",
        "  returns: { kind: \"placeholder\" },",
        "  handler: async () => null,",
        "});",
        "",
      ].join("\n"),
    );

    const result = runComponentFunctionValidatorsCheck({ rootDir });
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.missingArgs, true);
  });
});

test("passes when public component functions include both args and returns", () => {
  withTempDir((rootDir) => {
    writeComponentFile(
      rootDir,
      "src/component/threads.ts",
      [
        'import { mutation } from "./_generated/server.js";',
        "",
        "export const create = mutation({",
        "  args: {},",
        "  returns: { kind: \"placeholder\" },",
        "  handler: async () => null,",
        "});",
        "",
      ].join("\n"),
    );

    const result = runComponentFunctionValidatorsCheck({ rootDir });
    assert.equal(result.ok, true);
    assert.equal(result.failures.length, 0);
  });
});
