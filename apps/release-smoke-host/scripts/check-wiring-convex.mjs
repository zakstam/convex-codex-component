import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { resolveConvexUrl } from "../../shared/resolveConvexUrl.mjs";

async function main() {
  const convexUrl = resolveConvexUrl({
    includeConvexDirEnv: true,
    prioritizeVite: false,
  });
  assert.ok(convexUrl, "Missing Convex URL. Run `pnpm run dev:convex:once` first.");

  const convex = new ConvexHttpClient(convexUrl);
  const fallbackUserId = "release-smoke-host-wiring-check-user";
  const actor = {
    userId: process.env.ACTOR_USER_ID?.trim() || fallbackUserId,
  };
  const validation = await convex.query(api.chat.validateHostWiring, { actor });
  assert.equal(validation.ok, true, `validateHostWiring failed: ${JSON.stringify(validation.checks)}`);
  console.log("release-smoke-host wiring smoke passed");
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error("release-smoke-host wiring smoke failed: " + reason);
  process.exit(1);
});
