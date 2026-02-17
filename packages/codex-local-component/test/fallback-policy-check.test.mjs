import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runFallbackPolicyCheck } from "../scripts/check-fallback-policy.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "fallback-policy-"));
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

test("runFallbackPolicyCheck reports missing allowlist entries", () => {
  withTempDir((root) => {
    writeSourceFile(
      root,
      "src/feature.ts",
      "export const value = input ?? 1;\n",
    );
    writeSourceFile(
      root,
      "scripts/fallback-allowlist.json",
      JSON.stringify({ version: 1, entries: [] }, null, 2),
    );

    const result = runFallbackPolicyCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/fallback-allowlist.json",
    });
    assert.equal(result.ok, false);
    assert.equal(result.missing.length, 1);
    assert.equal(result.invalidMetadata.length, 0);
  });
});

test("runFallbackPolicyCheck passes with matching allowlist", () => {
  withTempDir((root) => {
    writeSourceFile(
      root,
      "src/feature.ts",
      "export const value = input ?? 1;\n",
    );
    const seed = runFallbackPolicyCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/fallback-allowlist.json",
      writeAllowlist: true,
    });
    assert.equal(seed.ok, true);

    const result = runFallbackPolicyCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/fallback-allowlist.json",
    });
    assert.equal(result.ok, true);
    assert.equal(result.missing.length, 0);
    assert.equal(result.stale.length, 0);
    assert.equal(result.invalidMetadata.length, 0);
  });
});

test("runFallbackPolicyCheck reports stale allowlist entries", () => {
  withTempDir((root) => {
    writeSourceFile(
      root,
      "src/feature.ts",
      "export const value = input ?? 1;\n",
    );
    runFallbackPolicyCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/fallback-allowlist.json",
      writeAllowlist: true,
    });

    writeSourceFile(root, "src/feature.ts", "export const value = 1;\n");
    const result = runFallbackPolicyCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/fallback-allowlist.json",
    });
    assert.equal(result.ok, false);
    assert.equal(result.stale.length, 1);
    assert.equal(result.invalidMetadata.length, 0);
  });
});

test("runFallbackPolicyCheck reports missing manual metadata fields", () => {
  withTempDir((root) => {
    writeSourceFile(root, "src/feature.ts", "export const value = input ?? 1;\n");
    writeSourceFile(
      root,
      "scripts/fallback-allowlist.json",
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              id: "FB_bad",
              file: "src/feature.ts",
              line: 1,
              col: 22,
              kind: "nullish-coalescing",
              snippet: "input ?? 1",
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = runFallbackPolicyCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/fallback-allowlist.json",
    });
    assert.equal(result.ok, false);
    assert.equal(result.invalidMetadata.length, 1);
  });
});

test("runFallbackPolicyCheck keeps ids stable when only line numbers shift", () => {
  withTempDir((root) => {
    writeSourceFile(root, "src/feature.ts", "export const value = input ?? 1;\n");
    const seeded = runFallbackPolicyCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/fallback-allowlist.json",
      writeAllowlist: true,
    });
    const originalId = seeded.currentSites[0]?.id;
    assert.equal(typeof originalId, "string");

    writeSourceFile(root, "src/feature.ts", "\n\nexport const value = input ?? 1;\n");
    const result = runFallbackPolicyCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/fallback-allowlist.json",
    });
    assert.equal(result.ok, true);
    assert.equal(result.missing.length, 0);
    assert.equal(result.stale.length, 0);
    assert.equal(result.currentSites[0]?.id, originalId);
  });
});

test("runFallbackPolicyCheck assigns unique ids to duplicate snippets in same file", () => {
  withTempDir((root) => {
    writeSourceFile(
      root,
      "src/feature.ts",
      [
        "export function a(input?: number) {",
        "  return input ?? 1;",
        "}",
        "",
        "export function b(input?: number) {",
        "  return input ?? 1;",
        "}",
        "",
      ].join("\n"),
    );

    const seeded = runFallbackPolicyCheck({
      rootDir: root,
      sourceDir: "src",
      allowlistPath: "scripts/fallback-allowlist.json",
      writeAllowlist: true,
    });
    assert.equal(seeded.currentSites.length, 2);
    assert.notEqual(seeded.currentSites[0]?.id, seeded.currentSites[1]?.id);
  });
});
