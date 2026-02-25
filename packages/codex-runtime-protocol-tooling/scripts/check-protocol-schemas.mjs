import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const manifestName = ".schema-manifest.json";
const requiredFiles = [
  "codex_app_server_protocol.schemas.json",
  "index.ts",
  "v2/index.ts",
];

function usage() {
  console.log(`Usage:\n  pnpm --filter @zakstam/codex-runtime-protocol-tooling run schema:check -- --target <dir> [--source <dir>]\n\nOptions:\n  --target <dir>      Target protocol schema directory to validate.\n  --source <dir>      Optional generated schema source directory to compare against.`);
}

function parseArgs(argv) {
  let target = process.env.CODEX_PROTOCOL_SCHEMA_TARGET_DIR ?? null;
  let source = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--target") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --target");
      target = value;
      i += 1;
      continue;
    }
    if (arg === "--source") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --source");
      source = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { target, source };
}

function normalizeRel(path) {
  return path.split(sep).join("/");
}

function listFilesRecursively(path, basePath = path) {
  const entries = readdirSync(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(abs, basePath));
      continue;
    }
    if (entry.isFile()) files.push(normalizeRel(relative(basePath, abs)));
  }
  return files;
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertDirectory(path, label) {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  if (!statSync(path).isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
}

function resolveFromInvocation(pathValue) {
  const cwdResolved = resolve(process.cwd(), pathValue);
  if (existsSync(cwdResolved)) {
    return cwdResolved;
  }
  const initCwd = process.env.INIT_CWD;
  if (typeof initCwd === "string" && initCwd.length > 0) {
    return resolve(initCwd, pathValue);
  }
  return cwdResolved;
}

function assertRequiredFiles(path, label) {
  for (const rel of requiredFiles) {
    const abs = join(path, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      throw new Error(`${label} is missing required file: ${rel}`);
    }
  }
}

function buildFileMap(path) {
  const files = listFilesRecursively(path)
    .filter((rel) => rel !== manifestName)
    .sort();
  const map = new Map();
  for (const rel of files) {
    const abs = join(path, rel);
    map.set(rel, {
      sha256: hashFile(abs),
      size: statSync(abs).size,
    });
  }
  return map;
}

function loadManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing schema manifest at ${manifestPath}. Run schema sync first.`);
  }
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (parsed === null || typeof parsed !== "object") throw new Error("Schema manifest must be an object.");
  if (parsed.version !== 1) throw new Error(`Unsupported schema manifest version: ${String(parsed.version)}`);
  if (!Array.isArray(parsed.files)) throw new Error("Schema manifest files field must be an array.");

  const map = new Map();
  for (const entry of parsed.files) {
    if (entry === null || typeof entry !== "object") throw new Error("Schema manifest file entries must be objects.");
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      throw new Error("Schema manifest file entry path must be a non-empty string.");
    }
    if (typeof entry.sha256 !== "string" || entry.sha256.length !== 64) {
      throw new Error(`Invalid sha256 in schema manifest for ${entry.path}`);
    }
    if (typeof entry.size !== "number" || !Number.isFinite(entry.size) || entry.size < 0) {
      throw new Error(`Invalid size in schema manifest for ${entry.path}`);
    }
    map.set(entry.path, { sha256: entry.sha256, size: entry.size });
  }
  return map;
}

function diffFileMaps(expected, actual) {
  const missing = [];
  const added = [];
  const changed = [];

  for (const [path, expectedInfo] of expected.entries()) {
    const actualInfo = actual.get(path);
    if (!actualInfo) {
      missing.push(path);
      continue;
    }
    if (actualInfo.sha256 !== expectedInfo.sha256 || actualInfo.size !== expectedInfo.size) {
      changed.push(path);
    }
  }

  for (const path of actual.keys()) {
    if (!expected.has(path)) added.push(path);
  }

  return { missing, added, changed };
}

function printDiff(diff) {
  const lines = [];
  for (const path of diff.missing) lines.push(`- missing: ${path}`);
  for (const path of diff.added) lines.push(`- added: ${path}`);
  for (const path of diff.changed) lines.push(`- changed: ${path}`);
  return lines.join("\n");
}

function assertGeneratedTsHeaders(targetDir, pathMap) {
  const missingHeader = [];
  for (const rel of pathMap.keys()) {
    if (!rel.endsWith(".ts")) continue;
    const abs = join(targetDir, rel);
    const firstLine = readFileSync(abs, "utf8").split(/\r?\n/u, 1)[0] ?? "";
    if (firstLine.trim() !== "// GENERATED CODE! DO NOT MODIFY BY HAND!") {
      missingHeader.push(rel);
    }
  }
  if (missingHeader.length > 0) {
    throw new Error(`Schema files missing generated header:\n${missingHeader.map((path) => `- ${path}`).join("\n")}`);
  }
}

function compareWithSource(sourceDir, targetMap) {
  assertDirectory(sourceDir, "Schema source");
  assertRequiredFiles(sourceDir, "Schema source");

  const sourceMap = buildFileMap(sourceDir);
  const diff = diffFileMaps(sourceMap, targetMap);
  if (diff.missing.length === 0 && diff.added.length === 0 && diff.changed.length === 0) return;
  throw new Error(`Schema target does not match provided source directory.\n${printDiff(diff)}`);
}

function main() {
  const { target, source } = parseArgs(process.argv.slice(2));
  if (!target) {
    usage();
    throw new Error("--target is required.");
  }

  const targetDir = resolveFromInvocation(target);
  const manifestPath = join(targetDir, manifestName);

  assertDirectory(targetDir, "Schema directory");
  assertRequiredFiles(targetDir, "Schema directory");

  const manifestMap = loadManifest(manifestPath);
  const currentMap = buildFileMap(targetDir);
  assertGeneratedTsHeaders(targetDir, currentMap);

  const diff = diffFileMaps(manifestMap, currentMap);
  if (diff.missing.length > 0 || diff.added.length > 0 || diff.changed.length > 0) {
    const detail = printDiff(diff);
    throw new Error(`Protocol schema drift detected.\n${detail}\nRun: pnpm --filter @zakstam/codex-runtime-protocol-tooling run schema:sync -- --target <schema-dir> --source <generated-schema-dir>`);
  }

  if (source) {
    const sourceDir = resolveFromInvocation(source);
    compareWithSource(sourceDir, currentMap);
  }

  console.log("Protocol schema manifest is up to date.");
}

main();
