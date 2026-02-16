import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");

test("bridge contract and generated outputs exist", () => {
  const contractPath = join(appRoot, "bridge", "command-contract.json");
  const tauriBridgePath = join(appRoot, "src", "lib", "tauriBridge.generated.ts");
  const helperContractPath = join(appRoot, "src-node", "bridge-contract.generated.ts");
  const rustContractPath = join(appRoot, "src-tauri", "src", "bridge_contract_generated.rs");

  assert.equal(existsSync(contractPath), true, "missing bridge/command-contract.json");
  assert.equal(existsSync(tauriBridgePath), true, "missing src/lib/tauriBridge.generated.ts");
  assert.equal(existsSync(helperContractPath), true, "missing src-node/bridge-contract.generated.ts");
  assert.equal(existsSync(rustContractPath), true, "missing src-tauri/src/bridge_contract_generated.rs");

  const tauriBridge = readFileSync(tauriBridgePath, "utf8");
  const helperContract = readFileSync(helperContractPath, "utf8");
  const rustContract = readFileSync(rustContractPath, "utf8");

  assert.match(tauriBridge, /invoke\("start_bridge"/);
  assert.match(helperContract, /"respond_tool_user_input"/);
  assert.match(rustContract, /"set_disabled_tools"/);
});
