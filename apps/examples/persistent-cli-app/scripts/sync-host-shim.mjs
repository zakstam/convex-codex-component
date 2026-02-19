import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCodexHostShim } from "@zakstam/codex-local-component/host/convex";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const chatPath = join(appRoot, "convex", "chat.ts");
const checkMode = process.argv.includes("--check");

const expected = renderCodexHostShim();
const current = readFileSync(chatPath, "utf8");

if (current !== expected) {
  if (checkMode) {
    throw new Error(
      "Host shim drift detected in convex/chat.ts. Run `pnpm run sync:host-shim`.",
    );
  }
  writeFileSync(chatPath, expected, "utf8");
  console.log("synced", chatPath);
} else {
  console.log("host shim up to date");
}
