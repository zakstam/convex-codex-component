import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = process.cwd();
const repoRoot = resolve(packageRoot, "../..");

const CANONICAL_MARKER =
  "Canonical default: runtime-owned host integration.";
const LLMS_PATH = "packages/codex-local-component/LLMS.md";
const RUNBOOK_PATH = "docs/EXAMPLE_APPS_RUNBOOK.md";

const failures = [];

function readPackageFile(relPath) {
  const fullPath = resolve(packageRoot, relPath);
  if (!existsSync(fullPath)) {
    failures.push(`Missing required file: ${relPath}`);
    return "";
  }
  return readFileSync(fullPath, "utf8");
}

function readRepoFile(relPath) {
  const fullPath = resolve(repoRoot, relPath);
  if (!existsSync(fullPath)) {
    failures.push(`Missing required file: ${relPath}`);
    return "";
  }
  return readFileSync(fullPath, "utf8");
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    failures.push(`${label} missing required text: ${needle}`);
  }
}

function assertNotRegex(source, pattern, label) {
  if (pattern.test(source)) {
    failures.push(`${label} contains forbidden pattern: ${pattern}`);
  }
}

const llms = readPackageFile("LLMS.md");
assertIncludes(llms, CANONICAL_MARKER, "LLMS.md");
assertIncludes(llms, "## Hard Rule", "LLMS.md");
assertIncludes(llms, RUNBOOK_PATH, "LLMS.md");

const packageReadme = readPackageFile("README.md");
assertIncludes(packageReadme, CANONICAL_MARKER, "README.md");
assertIncludes(packageReadme, RUNBOOK_PATH, "README.md");
assertIncludes(
  packageReadme,
  "pnpm --filter @zakstam/codex-local-component run doctor:integration",
  "README.md",
);

const packageJson = readPackageFile("package.json");
assertIncludes(packageJson, RUNBOOK_PATH, "package.json");

const canonicalDocs = [
  "README.md",
  "docs/CANONICAL_INTEGRATION.md",
  RUNBOOK_PATH,
];

for (const relPath of canonicalDocs) {
  const source = readPackageFile(relPath);
  assertIncludes(source, CANONICAL_MARKER, relPath);
}

assertIncludes(
  readPackageFile("docs/CANONICAL_INTEGRATION.md"),
  "pnpm --filter @zakstam/codex-local-component run doctor:integration",
  "docs/CANONICAL_INTEGRATION.md",
);

const linkedDocs = [
  "README.md",
  "apps/examples/cli-app/README.md",
  "apps/examples/persistent-cli-app/README.md",
  "apps/examples/tauri-app/README.md",
];

for (const relPath of linkedDocs) {
  const source = readRepoFile(relPath);
  assertIncludes(source, LLMS_PATH, relPath);
}

if (failures.length > 0) {
  console.error("docs-single-path: failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("docs-single-path: ok");
