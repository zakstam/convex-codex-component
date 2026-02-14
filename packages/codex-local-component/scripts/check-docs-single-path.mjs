import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = process.cwd();
const repoRoot = resolve(packageRoot, "../..");

const CANONICAL_MARKER =
  "Canonical default: runtime-owned host integration.";
const LLMS_PATH = "packages/codex-local-component/LLMS.md";

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

const canonicalDocs = [
  "README.md",
  "docs/HOST_INTEGRATION.md",
  "docs/CLIENT_AND_REACT_HOOKS.md",
  "docs/OPERATIONS_AND_ERRORS.md",
];

for (const relPath of canonicalDocs) {
  const source = readPackageFile(relPath);
  assertIncludes(source, CANONICAL_MARKER, relPath);
}

const runtimeOwnedDoc = readPackageFile("docs/RUNTIME_OWNED_REFERENCE_HOST.md");
assertIncludes(runtimeOwnedDoc, CANONICAL_MARKER, "docs/RUNTIME_OWNED_REFERENCE_HOST.md");
assertIncludes(runtimeOwnedDoc, "../LLMS.md", "docs/RUNTIME_OWNED_REFERENCE_HOST.md");

const linkedDocs = [
  "README.md",
  "apps/examples/cli-app/README.md",
  "apps/examples/persistent-cli-app/README.md",
  "apps/examples/tauri-app/README.md",
  "apps/release-smoke-host/README.md",
  "apps/release-smoke-host/convex/README.md",
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
