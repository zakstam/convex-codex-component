import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = process.cwd();

const targets = [
  "README.md",
  "LLMS.md",
  "docs/CANONICAL_INTEGRATION.md",
  "docs/API_REFERENCE.md",
  "docs/EXAMPLE_APPS_RUNBOOK.md",
];

const forbidden = [
  /\bByExternalId\b/g,
  /\bexternalThreadId\b/g,
  /\bgetExternalMapping\b/g,
  /\bresolveByExternalId\b/g,
];

const failures = [];

for (const relPath of targets) {
  const fullPath = resolve(packageRoot, relPath);
  const source = readFileSync(fullPath, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      failures.push(`${relPath} contains forbidden symbol: ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  console.error("check-canonical-symbols: failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("check-canonical-symbols: ok");
