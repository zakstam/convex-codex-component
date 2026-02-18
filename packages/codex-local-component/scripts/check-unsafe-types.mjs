import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const DEFAULT_SOURCE_DIR = "src";
const DEFAULT_ALLOWLIST_PATH = "scripts/unsafe-cast-allowlist.json";
const DEFAULT_EXCLUDES = [
  "**/component/_generated/**",
  "**/protocol/schemas/**",
  "**/protocol/schemas/v2/**",
];

function stableId(key) {
  return `UC_${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

function normalizeForMatch(value) {
  return value.split(path.sep).join("/");
}

function normalizePathForMatch(absPath, rootDir) {
  return normalizeForMatch(path.relative(rootDir, absPath));
}

function isExcluded(relFilePath, excludes) {
  const normalized = normalizeForMatch(relFilePath);
  return excludes.some((exclude) => {
    if (exclude === "**/component/_generated/**") {
      return normalized.includes("component/_generated/");
    }
    if (exclude === "**/protocol/schemas/**") {
      return normalized.includes("protocol/schemas/");
    }
    if (exclude === "**/protocol/schemas/v2/**") {
      return normalized.includes("protocol/schemas/v2/");
    }
    const trimmed = normalizeForMatch(exclude)
      .replace(/^!\*\*\//, "")
      .replace(/^\*\*\//, "")
      .replace(/^!/, "")
      .replace(/\/\*\*$/g, "");
    return normalized.includes(trimmed);
  });
}

function collectSourceFiles(rootDir, sourceDir, excludes) {
  const absSourceDir = path.resolve(rootDir, sourceDir);
  if (!existsSync(absSourceDir) || !statSync(absSourceDir).isDirectory()) {
    return [];
  }

  const stack = [absSourceDir];
  const files = [];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!/\.(tsx?|d\.ts)$/.test(entry.name)) {
        continue;
      }
      const relPath = normalizePathForMatch(absPath, rootDir);
      if (isExcluded(relPath, excludes)) {
        continue;
      }
      files.push(absPath);
    }
  }
  return files;
}

function runFallbackSearch({
  pattern,
  rootDir,
  sourceDir,
  excludes,
}) {
  const regex = new RegExp(pattern);
  const files = collectSourceFiles(rootDir, sourceDir, excludes);
  const out = [];

  for (const absPath of files) {
    const relPath = normalizePathForMatch(absPath, rootDir);
    const lines = readFileSync(absPath, "utf8").split(/\r?\n/);
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
      const text = lines[lineNumber] ?? "";
      if (regex.test(text)) {
        out.push(`${relPath}:${lineNumber + 1}:${text}`);
      }
    }
  }

  return out.join("\n");
}

function runRg({
  pattern,
  rootDir,
  sourceDir,
  excludes = DEFAULT_EXCLUDES,
}) {
  const args = ["-n", "--no-heading", pattern, sourceDir];
  for (const exclude of excludes) {
    args.push("--glob", `!${exclude}`);
  }
  const out = spawnSync("rg", args, {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (out.error?.code === "ENOENT") {
    return runFallbackSearch({
      pattern,
      rootDir,
      sourceDir,
      excludes,
    }).trim();
  }
  if (
    out.status === 127 &&
    (out.stderr ?? "").includes("not found")
  ) {
    return runFallbackSearch({
      pattern,
      rootDir,
      sourceDir,
      excludes,
    }).trim();
  }
  if (out.status === 0) {
    return (out.stdout ?? "").trim();
  }
  if (out.status === 1) {
    return ((out.stdout ?? "") || "").trim();
  }
  throw new Error((out.stderr ?? out.stdout ?? "rg failed").trim() || "rg failed");
}

function parseRgLine(line) {
  const firstColon = line.indexOf(":");
  if (firstColon === -1) return null;
  const secondColon = line.indexOf(":", firstColon + 1);
  if (secondColon === -1) return null;
  const file = line.slice(0, firstColon);
  const lineNumber = Number(line.slice(firstColon + 1, secondColon));
  const snippet = line.slice(secondColon + 1);
  if (!file || !Number.isFinite(lineNumber) || lineNumber < 1) return null;
  return { file, line: lineNumber, snippet };
}

function buildFileLineCache(rootDir) {
  const cache = new Map();
  return (relPath) => {
    if (cache.has(relPath)) {
      return cache.get(relPath);
    }
    const absPath = path.resolve(rootDir, relPath);
    const content = readFileSync(absPath, "utf8");
    const lines = content.split(/\r?\n/);
    cache.set(relPath, lines);
    return lines;
  };
}

function findNeighborLine(lines, fromIndex, direction) {
  let idx = fromIndex + direction;
  let steps = 0;
  while (idx >= 0 && idx < lines.length && steps < 8) {
    const text = lines[idx]?.trim() ?? "";
    if (text.length > 0) {
      return text;
    }
    idx += direction;
    steps += 1;
  }
  return "";
}

function collectUnsafeCastSites({
  rootDir,
  sourceDir = DEFAULT_SOURCE_DIR,
  excludes = DEFAULT_EXCLUDES,
}) {
  const raw = runRg({
    pattern: " as ",
    rootDir,
    sourceDir,
    excludes,
  });
  if (!raw) return [];
  const getLines = buildFileLineCache(rootDir);
  const parsed = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseRgLine)
    .filter(Boolean)
    .filter((hit) => !hit.snippet.includes("export * as "))
    .filter((hit) => !hit.snippet.includes("export { default as "))
    .filter((hit) => !hit.snippet.includes("import * as "))
    .filter((hit) => !hit.snippet.includes(" as const"));

  parsed.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  const occurrenceBySignature = new Map();
  const sites = parsed.map((hit) => {
    const relFilePath = normalizeForMatch(hit.file);
    const lines = getLines(relFilePath);
    const lineIndex = Math.max(0, hit.line - 1);
    const previousLine = findNeighborLine(lines, lineIndex, -1);
    const nextLine = findNeighborLine(lines, lineIndex, 1);
    const snippet = hit.snippet.trim();
    const context = `prev:${previousLine} | next:${nextLine}`.slice(0, 320);
    const signature = `${relFilePath}|${snippet}|${context}`;
    const occurrence = (occurrenceBySignature.get(signature) ?? 0) + 1;
    occurrenceBySignature.set(signature, occurrence);
    return {
      id: stableId(`${signature}|occurrence:${occurrence}`),
      file: relFilePath,
      line: hit.line,
      col: Math.max(1, hit.snippet.indexOf(" as ") + 1),
      snippet,
      context,
      legacyLine: `${relFilePath}:${hit.line}:${snippet}`,
    };
  });
  return sites;
}

function collectAnyHits({
  rootDir,
  sourceDir = DEFAULT_SOURCE_DIR,
  excludes = DEFAULT_EXCLUDES,
}) {
  return runRg({
    pattern: "\\bany\\b",
    rootDir,
    sourceDir,
    excludes,
  });
}

function readAllowlist(absAllowlistPath) {
  if (!existsSync(absAllowlistPath)) {
    return { version: 1, entries: [] };
  }
  const parsed = JSON.parse(readFileSync(absAllowlistPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid unsafe cast allowlist format: ${absAllowlistPath}`);
  }
  return parsed;
}

function writeAllowlistFile(absAllowlistPath, sites) {
  const previous = readAllowlist(absAllowlistPath);
  const previousById = new Map((previous.entries ?? []).map((entry) => [entry.id, entry]));
  const signatureOf = (entry) => `${entry.file}|${entry.snippet}|${entry.context ?? ""}`;
  const previousBySignature = new Map((previous.entries ?? []).map((entry) => [signatureOf(entry), entry]));
  const previousByLegacyLine = new Map(
    (previous.entries ?? [])
      .map((entry) =>
        typeof entry.legacyLine === "string"
          ? [entry.legacyLine, entry]
          : [`${entry.file}:${entry.line}:${entry.snippet}`, entry],
      ),
  );

  const out = {
    version: 1,
    entries: sites.map((site) => {
      const previousEntry =
        previousById.get(site.id) ??
        previousBySignature.get(signatureOf(site)) ??
        previousByLegacyLine.get(site.legacyLine);
      return {
        description:
          typeof previousEntry?.description === "string"
            ? previousEntry.description
            : "Legacy allowlisted cast; review as needed.",
        userApproved:
          typeof previousEntry?.userApproved === "boolean"
            ? previousEntry.userApproved
            : false,
        riskLevel:
          typeof previousEntry?.riskLevel === "string"
            ? previousEntry.riskLevel
            : "default",
        id: site.id,
        file: site.file,
        line: site.line,
        col: site.col,
        snippet: site.snippet,
        context: site.context,
      };
    }),
  };
  mkdirSync(path.dirname(absAllowlistPath), { recursive: true });
  writeFileSync(absAllowlistPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
}

export function runUnsafeTypesCheck({
  rootDir = process.cwd(),
  sourceDir = DEFAULT_SOURCE_DIR,
  allowlistPath = DEFAULT_ALLOWLIST_PATH,
  excludes = DEFAULT_EXCLUDES,
  writeAllowlist = false,
} = {}) {
  const anyHits = collectAnyHits({ rootDir, sourceDir, excludes });
  const currentSites = collectUnsafeCastSites({ rootDir, sourceDir, excludes });
  const absAllowlistPath = path.resolve(rootDir, allowlistPath);

  if (writeAllowlist) {
    writeAllowlistFile(absAllowlistPath, currentSites);
    return {
      ok: anyHits.length === 0,
      anyHits,
      missing: [],
      stale: [],
      invalidMetadata: [],
      currentSites,
    };
  }

  const allowlist = readAllowlist(absAllowlistPath);
  const allowlistEntries = Array.isArray(allowlist.entries) ? allowlist.entries : [];
  const invalidMetadata = allowlistEntries.filter((entry) => {
    const hasDescription =
      typeof entry.description === "string" && entry.description.trim().length > 0;
    const hasUserApproved = typeof entry.userApproved === "boolean";
    const hasRiskLevel = typeof entry.riskLevel === "string" && entry.riskLevel.trim().length > 0;
    return !hasDescription || !hasUserApproved || !hasRiskLevel;
  });

  const allowedById = new Map(allowlistEntries.map((entry) => [entry.id, entry]));
  const currentById = new Map(currentSites.map((site) => [site.id, site]));
  const missing = currentSites.filter((site) => !allowedById.has(site.id));
  const stale = allowlistEntries.filter((entry) => !currentById.has(entry.id));
  return {
    ok:
      anyHits.length === 0 &&
      missing.length === 0 &&
      stale.length === 0 &&
      invalidMetadata.length === 0,
    anyHits,
    missing,
    stale,
    invalidMetadata,
    currentSites,
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has("--write-allowlist");
  const result = runUnsafeTypesCheck({ writeAllowlist: write });

  if (write) {
    if (result.anyHits) {
      console.error("Disallowed `any` usage detected in handwritten source:");
      console.error(result.anyHits);
      process.exit(1);
    }
    const count = result.currentSites.length;
    console.log(`Wrote unsafe cast allowlist with ${count} entries to ${DEFAULT_ALLOWLIST_PATH}`);
    return;
  }

  if (result.anyHits) {
    console.error("Disallowed `any` usage detected in handwritten source:");
    console.error(result.anyHits);
  }

  if (result.missing.length > 0) {
    console.error("Unsafe cast policy violations (new casts outside allowlist):");
    for (const site of result.missing) {
      console.error(`- ${site.id} ${site.file}:${site.line}:${site.col} ${site.snippet}`);
    }
  }

  if (result.stale.length > 0) {
    console.error("Unsafe cast allowlist contains stale entries:");
    for (const entry of result.stale) {
      const line = entry.line ?? "?";
      const col = entry.col ?? "?";
      console.error(`- ${entry.id} ${entry.file}:${line}:${col}`);
    }
  }

  if (result.invalidMetadata.length > 0) {
    console.error("Unsafe cast allowlist entries missing required manual metadata:");
    for (const entry of result.invalidMetadata) {
      const line = entry.line ?? "?";
      const col = entry.col ?? "?";
      console.error(
        `- ${entry.id} ${entry.file}:${line}:${col} description=${JSON.stringify(entry.description)} userApproved=${entry.userApproved} riskLevel=${JSON.stringify(entry.riskLevel)}`,
      );
    }
  }

  if (!result.ok) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
