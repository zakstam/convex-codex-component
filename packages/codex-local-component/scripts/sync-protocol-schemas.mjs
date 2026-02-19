import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const targetDir = resolve(scriptDir, "../src/protocol/schemas");
const manifestName = ".schema-manifest.json";
const manifestPath = join(targetDir, manifestName);
const requiredFiles = [
  "codex_app_server_protocol.schemas.json",
  "index.ts",
  "v2/index.ts",
];

function usage() {
  console.log(`Usage:
  pnpm --filter @zakstam/codex-local-component run schema:sync -- --source <dir> [--source-ref <ref>]

Options:
  --source <dir>      Directory containing generated Codex protocol schemas.
  --source-ref <ref>  Optional human-readable source reference stored in manifest.

Environment:
  CODEX_PROTOCOL_SCHEMA_SOURCE_DIR
  CODEX_PROTOCOL_SCHEMA_SOURCE_REF`);
}

function normalizeRel(path) {
  return path.split(sep).join("/");
}

function parseArgs(argv) {
  let source = process.env.CODEX_PROTOCOL_SCHEMA_SOURCE_DIR ?? null;
  let sourceRef = process.env.CODEX_PROTOCOL_SCHEMA_SOURCE_REF ?? null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--source") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --source");
      }
      source = value;
      i += 1;
      continue;
    }
    if (arg === "--source-ref") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --source-ref");
      }
      sourceRef = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { source, sourceRef };
}

function assertDirectory(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
  if (!statSync(path).isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

function assertRequiredFiles(path, label) {
  for (const rel of requiredFiles) {
    const abs = join(path, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      throw new Error(`${label} is missing required file: ${rel}`);
    }
  }
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
    if (entry.isFile()) {
      files.push(normalizeRel(relative(basePath, abs)));
    }
  }
  return files;
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitHeadForPath(path) {
  const result = spawnSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function buildManifest(path, sourceRef, sourceGitHead) {
  const files = listFilesRecursively(path)
    .filter((rel) => rel !== manifestName)
    .sort()
    .map((rel) => {
      const abs = join(path, rel);
      return {
        path: rel,
        sha256: hashFile(abs),
        size: statSync(abs).size,
      };
    });

  return {
    version: 1,
    source: {
      ref: sourceRef ?? null,
      gitHead: sourceGitHead ?? null,
    },
    files,
  };
}

function ensureNotNestedPath(sourcePath, destinationPath) {
  if (
    sourcePath.startsWith(`${destinationPath}${sep}`) ||
    destinationPath.startsWith(`${sourcePath}${sep}`)
  ) {
    throw new Error(
      `Refusing nested sync paths. source=${sourcePath} destination=${destinationPath}`,
    );
  }
}

function main() {
  const { source, sourceRef } = parseArgs(process.argv.slice(2));
  if (!source) {
    usage();
    throw new Error("Schema source is required. Provide --source or CODEX_PROTOCOL_SCHEMA_SOURCE_DIR.");
  }

  const sourceDir = resolve(process.cwd(), source);
  const resolvedTargetDir = resolve(targetDir);

  assertDirectory(sourceDir, "Schema source");
  assertRequiredFiles(sourceDir, "Schema source");
  const sourceGitHead = gitHeadForPath(sourceDir);

  if (sourceDir !== resolvedTargetDir) {
    ensureNotNestedPath(sourceDir, resolvedTargetDir);
    rmSync(resolvedTargetDir, { recursive: true, force: true });
    mkdirSync(dirname(resolvedTargetDir), { recursive: true });
    cpSync(sourceDir, resolvedTargetDir, { recursive: true });
  }

  assertDirectory(resolvedTargetDir, "Synced schema target");
  assertRequiredFiles(resolvedTargetDir, "Synced schema target");

  const manifest = buildManifest(resolvedTargetDir, sourceRef, sourceGitHead);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Synced protocol schemas to ${resolvedTargetDir}`);
  console.log(`Wrote schema manifest: ${manifestPath}`);
}

main();
