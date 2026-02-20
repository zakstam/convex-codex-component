import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(process.cwd(), "../..");
const packageRoot = process.cwd();

const checks = [];

function addCheck(id, description, run) {
  checks.push({ id, description, run });
}

function read(pathname) {
  return readFileSync(pathname, "utf8");
}

function error(id, detected, expected, fix) {
  return { id, detected, expected, fix };
}

function run() {
  const failures = [];
  for (const check of checks) {
    const failure = check.run();
    if (failure) failures.push({ description: check.description, ...failure });
  }

  if (failures.length === 0) {
    console.log("doctor:integration: ok");
    process.exit(0);
  }

  console.error("doctor:integration: failed");
  for (const failure of failures) {
    console.error(`- [${failure.id}] ${failure.description}`);
    console.error(`  detected: ${failure.detected}`);
    console.error(`  expected: ${failure.expected}`);
    console.error(`  fix: ${failure.fix}`);
  }
  process.exit(1);
}

const packageReadmePath = resolve(packageRoot, "README.md");
const canonicalGuidePath = resolve(packageRoot, "docs/CANONICAL_INTEGRATION.md");
const apiReferencePath = resolve(packageRoot, "docs/API_REFERENCE.md");
const tauriReadmePath = resolve(repoRoot, "apps/examples/tauri-app/README.md");
const persistentCliReadmePath = resolve(repoRoot, "apps/examples/persistent-cli-app/README.md");

addCheck("E_DOCTOR_MISSING_FILE", "Required canonical docs must exist.", () => {
  const required = [
    packageReadmePath,
    canonicalGuidePath,
    apiReferencePath,
    tauriReadmePath,
    persistentCliReadmePath,
  ];
  const missing = required.filter((item) => !existsSync(item));
  if (missing.length === 0) return null;
  return error(
    "E_DOCTOR_MISSING_FILE",
    `Missing: ${missing.map((p) => p.replace(`${repoRoot}/`, "")).join(", ")}`,
    "All canonical docs and example README entrypoints are present.",
    "Restore missing docs and rerun `pnpm --filter @zakstam/codex-local-component run doctor:integration`.",
  );
});

addCheck("E_DOCTOR_CANONICAL_MARKER", "Canonical marker must be present in package docs.", () => {
  const marker = "Canonical default: runtime-owned host integration.";
  const docs = [packageReadmePath, canonicalGuidePath, apiReferencePath];
  const missing = docs.filter((pathname) => !read(pathname).includes(marker));
  if (missing.length === 0) return null;
  return error(
    "E_DOCTOR_CANONICAL_MARKER",
    `Marker missing in: ${missing.map((p) => p.replace(`${packageRoot}/`, "")).join(", ")}`,
    `All package docs contain "${marker}"`,
    `Add marker text to each missing doc.`,
  );
});

addCheck("E_DOCTOR_LEGACY_ALIAS", "Legacy external-id aliases must not appear in consumer docs.", () => {
  const legacyPattern = /\b(ByExternalId|externalThreadId|getExternalMapping|resolveByExternalId)\b/;
  const docs = [packageReadmePath, canonicalGuidePath, apiReferencePath, tauriReadmePath, persistentCliReadmePath];
  const offenders = docs.filter((pathname) => legacyPattern.test(read(pathname)));
  if (offenders.length === 0) return null;
  return error(
    "E_DOCTOR_LEGACY_ALIAS",
    `Legacy alias references in: ${offenders.map((p) => p.replace(`${repoRoot}/`, "")).join(", ")}`,
    "Only canonical thread-handle naming appears in public docs.",
    "Replace legacy symbols with canonical `threadHandle` / `*ByThreadHandle` naming.",
  );
});

addCheck("E_DOCTOR_README_ROUTING", "Example READMEs must route to package LLMS entrypoint.", () => {
  const marker = "packages/codex-local-component/LLMS.md";
  const files = [tauriReadmePath, persistentCliReadmePath];
  const missing = files.filter((pathname) => !read(pathname).includes(marker));
  if (missing.length === 0) return null;
  return error(
    "E_DOCTOR_README_ROUTING",
    `Missing LLMS routing in: ${missing.map((p) => p.replace(`${repoRoot}/`, "")).join(", ")}`,
    `Each example README includes "${marker}" as integration source of truth.`,
    "Add canonical routing block in each missing README.",
  );
});

run();
