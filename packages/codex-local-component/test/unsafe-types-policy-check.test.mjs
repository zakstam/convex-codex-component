import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runUnsafeTypesCheck } from "../scripts/check-unsafe-types.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "unsafe-types-policy-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeSourceFile(root, relPath, content) {
  const filePath = path.join(root, relPath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

test("runUnsafeTypesCheck reports missing allowlist entries", () => {
  withTempDir((root) => {
    writeSourceFile(root, "src/feature.ts", "export const value = input as string;\n");
    writeSourceFile(
      root,
      "scripts/unsafe-cast-allowlist.json",
      JSON.stringify({ version: 1, entries: [] }, null, 2),
    );
    const result = runUnsafeTypesCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/unsafe-cast-allowlist.json",
    });
    assert.equal(result.ok, false);
    assert.equal(result.missing.length, 1);
  });
});

test("runUnsafeTypesCheck passes with matching allowlist", () => {
  withTempDir((root) => {
    writeSourceFile(root, "src/feature.ts", "export const value = input as string;\n");
    runUnsafeTypesCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/unsafe-cast-allowlist.json",
      writeAllowlist: true,
    });
    const result = runUnsafeTypesCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/unsafe-cast-allowlist.json",
    });
    assert.equal(result.ok, true);
    assert.equal(result.missing.length, 0);
    assert.equal(result.stale.length, 0);
    assert.equal(result.invalidMetadata.length, 0);
  });
});

test("runUnsafeTypesCheck reports stale allowlist entries", () => {
  withTempDir((root) => {
    writeSourceFile(root, "src/feature.ts", "export const value = input as string;\n");
    runUnsafeTypesCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/unsafe-cast-allowlist.json",
      writeAllowlist: true,
    });
    writeSourceFile(root, "src/feature.ts", "export const value = input;\n");
    const result = runUnsafeTypesCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/unsafe-cast-allowlist.json",
    });
    assert.equal(result.ok, false);
    assert.equal(result.stale.length, 1);
  });
});

test("runUnsafeTypesCheck reports missing manual metadata fields", () => {
  withTempDir((root) => {
    writeSourceFile(root, "src/feature.ts", "export const value = input as string;\n");
    runUnsafeTypesCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/unsafe-cast-allowlist.json",
      writeAllowlist: true,
    });
    const p = path.join(root, "scripts/unsafe-cast-allowlist.json");
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    parsed.entries[0].description = "";
    delete parsed.entries[0].riskLevel;
    writeFileSync(p, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    const result = runUnsafeTypesCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/unsafe-cast-allowlist.json",
    });
    assert.equal(result.ok, false);
    assert.equal(result.invalidMetadata.length, 1);
  });
});

test("runUnsafeTypesCheck keeps ids stable when only line numbers shift", () => {
  withTempDir((root) => {
    writeSourceFile(
      root,
      "src/feature.ts",
      [
        "export function run(input: unknown) {",
        "  const value = input as string;",
        "  return value;",
        "}",
        "",
      ].join("\n"),
    );
    const seeded = runUnsafeTypesCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/unsafe-cast-allowlist.json",
      writeAllowlist: true,
    });
    const originalId = seeded.currentSites[0]?.id;
    assert.equal(typeof originalId, "string");

    writeSourceFile(
      root,
      "src/feature.ts",
      [
        "",
        "",
        "export function run(input: unknown) {",
        "  const value = input as string;",
        "  return value;",
        "}",
        "",
      ].join("\n"),
    );
    const result = runUnsafeTypesCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/unsafe-cast-allowlist.json",
    });
    assert.equal(result.ok, true);
    assert.equal(result.currentSites[0]?.id, originalId);
  });
});

test("runUnsafeTypesCheck assigns unique ids to duplicate snippets in same file", () => {
  withTempDir((root) => {
    writeSourceFile(
      root,
      "src/feature.ts",
      [
        "export function first(input: unknown) {",
        "  return input as string;",
        "}",
        "",
        "export function second(input: unknown) {",
        "  return input as string;",
        "}",
        "",
      ].join("\n"),
    );
    const seeded = runUnsafeTypesCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/unsafe-cast-allowlist.json",
      writeAllowlist: true,
    });
    assert.equal(seeded.currentSites.length, 2);
    assert.notEqual(seeded.currentSites[0]?.id, seeded.currentSites[1]?.id);
  });
});
