import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { resolveConvexUrl } from "../../../shared/resolveConvexUrl.mjs";

async function main() {
  const convexUrl = resolveConvexUrl({
    includeConvexDirEnv: false,
    prioritizeVite: true,
  });
  assert.ok(convexUrl, "Missing Convex URL. Run `pnpm run dev:convex:once` first.");

  const convex = new ConvexHttpClient(convexUrl);
  const actor = {
    tenantId: process.env.ACTOR_TENANT_ID ?? "demo-tenant",
    userId: process.env.ACTOR_USER_ID ?? "demo-user",
    deviceId: process.env.ACTOR_DEVICE_ID ?? "tauri-wiring-smoke",
  };
  const validation = await convex.query(api.chat.validateHostWiring, { actor });
  assert.equal(validation.ok, true, `validateHostWiring failed: ${JSON.stringify(validation.checks)}`);
  console.log("tauri wiring smoke passed");
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error("tauri wiring smoke failed: " + reason);
  process.exit(1);
});
