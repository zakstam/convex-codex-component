import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const DEFAULT_SOURCE_DIR = "src";
const DEFAULT_ALLOWLIST_PATH = "scripts/fallback-allowlist.json";
const DEFAULT_EXCLUDES = [
  "src/component/_generated/",
  "src/protocol/schemas/",
  "src/protocol/schemas/v2/",
];

function normalizeForMatch(value) {
  return value.split(path.sep).join("/");
}

function walkFiles(dirPath, visitor) {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, visitor);
      continue;
    }
    visitor(fullPath);
  }
}

function isFallbackRhs(node) {
  if (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    ts.isObjectLiteralExpression(node) ||
    ts.isArrayLiteralExpression(node) ||
    ts.isTemplateExpression(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return true;
  }
  if (ts.isIdentifier(node)) {
    return /(DEFAULT_|default|fallback)/i.test(node.text);
  }
  if (ts.isPropertyAccessExpression(node)) {
    return /(DEFAULT_|default|fallback)/i.test(node.name.text);
  }
  return false;
}

function stableId(key) {
  return `FB_${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

function makeSite({ relFilePath, kind, line, col, snippet, context }) {
  return {
    file: relFilePath,
    line,
    col,
    kind,
    snippet,
    context,
  };
}

function getSnippet(sourceText, node) {
  const raw = sourceText.slice(node.getStart(), node.getEnd()).replace(/\s+/g, " ").trim();
  return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
}

function getContextSnippet(sourceText, node) {
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isStatement(current) ||
      ts.isFunctionLike(current) ||
      ts.isClassLike(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isVariableDeclaration(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isPropertySignature(current) ||
      ts.isMethodSignature(current) ||
      ts.isEnumMember(current)
    ) {
      break;
    }
    current = current.parent;
  }
  if (!current || ts.isSourceFile(current)) {
    return getSnippet(sourceText, node);
  }
  return getSnippet(sourceText, current);
}

function enrichSitesWithStableIds(sites) {
  const occurrenceByKey = new Map();
  for (const site of sites) {
    const keyBase = `${site.file}|${site.kind}|${site.snippet}|${site.context}`;
    const occurrence = (occurrenceByKey.get(keyBase) ?? 0) + 1;
    occurrenceByKey.set(keyBase, occurrence);
    site.id = stableId(`${keyBase}|occurrence:${occurrence}`);
  }
  return sites;
}

function collectFallbackSites({ rootDir, sourceDir, excludes }) {
  const absSourceDir = path.resolve(rootDir, sourceDir);
  if (!existsSync(absSourceDir) || !statSync(absSourceDir).isDirectory()) {
    return [];
  }

  const sites = [];
  walkFiles(absSourceDir, (fullPath) => {
    if (!fullPath.endsWith(".ts") && !fullPath.endsWith(".tsx")) {
      return;
    }

    const relFromRoot = normalizeForMatch(path.relative(rootDir, fullPath));
    if (excludes.some((prefix) => relFromRoot.startsWith(prefix))) {
      return;
    }

    const sourceText = readFileSync(fullPath, "utf8");
    const sourceFile = ts.createSourceFile(fullPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const relFilePath = normalizeForMatch(path.relative(rootDir, fullPath));

    const visit = (node) => {
      if (ts.isBinaryExpression(node)) {
        if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          sites.push(
            makeSite({
              relFilePath,
              kind: "nullish-coalescing",
              line: pos.line + 1,
              col: pos.character + 1,
              snippet: getSnippet(sourceText, node),
              context: getContextSnippet(sourceText, node),
            }),
          );
        }
        if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken && isFallbackRhs(node.right)) {
          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          sites.push(
            makeSite({
              relFilePath,
              kind: "logical-or-fallback",
              line: pos.line + 1,
              col: pos.character + 1,
              snippet: getSnippet(sourceText, node),
              context: getContextSnippet(sourceText, node),
            }),
          );
        }
      }

      if (ts.isParameter(node) && node.initializer) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        sites.push(
          makeSite({
            relFilePath,
            kind: "parameter-default",
            line: pos.line + 1,
            col: pos.character + 1,
            snippet: getSnippet(sourceText, node),
            context: getContextSnippet(sourceText, node),
          }),
        );
      }

      if (ts.isBindingElement(node) && node.initializer) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        sites.push(
          makeSite({
            relFilePath,
            kind: "binding-default",
            line: pos.line + 1,
            col: pos.character + 1,
            snippet: getSnippet(sourceText, node),
            context: getContextSnippet(sourceText, node),
          }),
        );
      }

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  });

  sites.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    if (a.col !== b.col) return a.col - b.col;
    return a.kind.localeCompare(b.kind);
  });
  return enrichSitesWithStableIds(sites);
}

function readAllowlist(absAllowlistPath) {
  if (!existsSync(absAllowlistPath)) {
    return { version: 1, entries: [] };
  }
  const parsed = JSON.parse(readFileSync(absAllowlistPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid fallback allowlist format: ${absAllowlistPath}`);
  }
  return parsed;
}

function writeAllowlistFile(absAllowlistPath, sites) {
  const previous = readAllowlist(absAllowlistPath);
  const previousById = new Map(
    (previous.entries ?? []).map((entry) => [entry.id, entry]),
  );
  const signatureOf = (entry) =>
    `${entry.file}|${entry.kind}|${entry.snippet}|${entry.context ?? ""}`;
  const legacySignatureOf = (entry) => `${entry.file}|${entry.kind}|${entry.snippet}`;
  const signatureWithLocationOf = (entry) =>
    `${entry.file}|${entry.kind}|${entry.snippet}|${entry.line}|${entry.col}`;
  const previousBySignature = new Map(
    (previous.entries ?? []).map((entry) => [signatureOf(entry), entry]),
  );
  const previousBySignatureWithLocation = new Map(
    (previous.entries ?? []).map((entry) => [signatureWithLocationOf(entry), entry]),
  );
  const previousByLegacySignature = new Map();
  for (const entry of previous.entries ?? []) {
    const key = legacySignatureOf(entry);
    const list = previousByLegacySignature.get(key) ?? [];
    list.push(entry);
    previousByLegacySignature.set(key, list);
  }
  const out = {
    version: 1,
    entries: sites.map((site) => ({
      ...(function resolveManualFields() {
        const legacyMatches = previousByLegacySignature.get(legacySignatureOf(site)) ?? [];
        const previousEntry =
          previousBySignatureWithLocation.get(signatureWithLocationOf(site)) ??
          previousById.get(site.id) ??
          previousBySignature.get(signatureOf(site)) ??
          (legacyMatches.length === 1 ? legacyMatches[0] : undefined);
        return {
          description:
            typeof previousEntry?.description === "string"
              ? previousEntry.description
              : "TODO: add manual description",
          userApproved:
            typeof previousEntry?.userApproved === "boolean"
              ? previousEntry.userApproved
              : false,
          riskLevel:
            typeof previousEntry?.riskLevel === "string"
              ? previousEntry.riskLevel
              : "default",
        };
      })(),
      id: site.id,
      file: site.file,
      line: site.line,
      col: site.col,
      kind: site.kind,
      snippet: site.snippet,
      context: site.context,
    })),
  };
  mkdirSync(path.dirname(absAllowlistPath), { recursive: true });
  writeFileSync(absAllowlistPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
}

export function runFallbackPolicyCheck({
  rootDir = process.cwd(),
  sourceDir = DEFAULT_SOURCE_DIR,
  allowlistPath = DEFAULT_ALLOWLIST_PATH,
  excludes = DEFAULT_EXCLUDES,
  writeAllowlist = false,
} = {}) {
  const absAllowlistPath = path.resolve(rootDir, allowlistPath);
  const currentSites = collectFallbackSites({ rootDir, sourceDir, excludes });

  if (writeAllowlist) {
    writeAllowlistFile(absAllowlistPath, currentSites);
    return { ok: true, missing: [], stale: [], currentSites };
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
    ok: missing.length === 0 && stale.length === 0 && invalidMetadata.length === 0,
    missing,
    stale,
    invalidMetadata,
    currentSites,
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has("--write-allowlist");
  const result = runFallbackPolicyCheck({ writeAllowlist: write });
  if (write) {
    const count = result.currentSites.length;
    console.log(`Wrote fallback allowlist with ${count} entries to ${DEFAULT_ALLOWLIST_PATH}`);
    return;
  }
  if (result.ok) {
    return;
  }

  if (result.missing.length > 0) {
    console.error("Fallback policy violations (new/unapproved fallback sites):");
    for (const site of result.missing) {
      console.error(`- ${site.id} ${site.file}:${site.line}:${site.col} [${site.kind}] ${site.snippet}`);
    }
  }
  if (result.stale.length > 0) {
    console.error("Fallback allowlist contains stale entries:");
    for (const entry of result.stale) {
      const file = entry.file ?? "unknown";
      const line = entry.line ?? "?";
      const col = entry.col ?? "?";
      const kind = entry.kind ?? "unknown";
      console.error(`- ${entry.id} ${file}:${line}:${col} [${kind}]`);
    }
  }
  if (result.invalidMetadata.length > 0) {
    console.error("Fallback allowlist entries missing required manual metadata:");
    for (const entry of result.invalidMetadata) {
      const file = entry.file ?? "unknown";
      const line = entry.line ?? "?";
      const col = entry.col ?? "?";
      const description =
        typeof entry.description === "string" ? entry.description : "<missing>";
      const userApproved =
        typeof entry.userApproved === "boolean"
          ? String(entry.userApproved)
          : "<missing>";
      const riskLevel =
        typeof entry.riskLevel === "string" ? entry.riskLevel : "<missing>";
      console.error(
        `- ${entry.id} ${file}:${line}:${col} description=${JSON.stringify(description)} userApproved=${userApproved} riskLevel=${JSON.stringify(riskLevel)}`,
      );
    }
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
