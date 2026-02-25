import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("schema tooling help commands execute", () => {
  const sync = spawnSync("node", ["./scripts/sync-protocol-schemas.mjs", "--help"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  const check = spawnSync("node", ["./scripts/check-protocol-schemas.mjs", "--help"], {
    cwd: packageRoot,
    encoding: "utf8",
  });

  assert.equal(sync.status, 0);
  assert.equal(check.status, 0);
  assert.match(sync.stdout, /schema:sync/);
  assert.match(check.stdout, /schema:check/);
});
