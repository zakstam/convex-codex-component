import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const packageRoot = process.cwd();
const distRoot = resolve(packageRoot, "dist");
const docsPath = resolve(packageRoot, "docs/API_REFERENCE.md");

const sectionMap = {
  ".": "index.d.ts",
  "react": "react/index.d.ts",
  host: "host/index.d.ts",
  "host/convex": "host/convex-entry.d.ts",
  protocol: "protocol/index.d.ts",
  "convex.config": "component/convex.config.d.ts",
};

const failures = [];

function parseSectionsFromMarkdown(text) {
  const sections = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const sectionMatch = line.match(
      /^##\s*`@zakstam\/codex-runtime\/([^`]+)`/,
    );
    if (sectionMatch) {
      if (current) {
        sections.push(current);
      }
      const literal = `@zakstam/codex-runtime/${sectionMatch[1]}`;
      const moduleName = literal.startsWith("@zakstam/codex-runtime/")
        ? literal.slice("@zakstam/codex-runtime/".length)
        : ".";
      current = { moduleName, apis: new Set() };
      continue;
    }

    if (line.startsWith("## ") && current) {
      sections.push(current);
      current = null;
      continue;
    }

    if (line.startsWith("## `@zakstam/codex-runtime`")) {
      if (current) {
        sections.push(current);
      }
      current = { moduleName: ".", apis: new Set() };
      continue;
    }

    if (!current) {
      continue;
    }

    const rowMatch = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (rowMatch && !["API", "API |", "Type"].includes(rowMatch[1])) {
      current.apis.add(rowMatch[1]);
    }
  }
  if (current) {
    sections.push(current);
  }
  return sections;
}

function toDtsPath(specifier, baseDir) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const resolved = resolve(baseDir, specifier);
  if (existsSync(`${resolved}.d.ts`)) return `${resolved}.d.ts`;
  if (specifier.endsWith(".js")) {
    return resolve(baseDir, specifier.replace(/\.js$/, ".d.ts"));
  }
  if (specifier.endsWith(".d.ts")) {
    return resolved;
  }
  return `${resolved}.d.ts`;
}

function addNamesFromNamedExport(
  text,
  currentFile,
  names,
  visiting,
  baseDir,
) {
  const namedExportRe =
    /export\s+(type\s+)?\{([^}]+)\}\s*(?:from\s+["']([^"']+)["'])?/g;
  let match;
  while ((match = namedExportRe.exec(text)) !== null) {
    const namesPart = match[2];
    const from = match[3];
    for (const raw of namesPart.split(",")) {
      const token = raw.trim().replace(/^type\s+/, "");
      if (!token) continue;
      const asMatch = token.match(/^(.+)\\s+as\\s+([^\\s]+)$/);
      const name = asMatch ? asMatch[2] : token.split(/\\s+/)[0];
      names.add(name);
    }

    if (from && from.startsWith(".")) {
      const nested = toDtsPath(from, baseDir);
      if (nested) {
        collectExportsFromDts(nested, names, visiting);
      }
    }
  }
}

function addNamesFromNamespaceExport(
  text,
  currentFile,
  names,
) {
  const namespaceExportRe =
    /export\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = namespaceExportRe.exec(text)) !== null) {
    names.add(match[1]);
  }
}

function addNamesFromStarExport(text, currentFile, names, visiting, baseDir) {
  const starExportRe = /export\s+\*\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = starExportRe.exec(text)) !== null) {
    const from = match[1];
    if (!from.startsWith(".")) continue;
    const nested = toDtsPath(from, baseDir);
    if (nested) {
      collectExportsFromDts(nested, names, visiting);
    }
  }
}

function addDefaultExportNames(text, names) {
  const defaultExportRe = /export\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let match;
  while ((match = defaultExportRe.exec(text)) !== null) {
    const name = match[1];
    if (name === "_default") {
      names.add("default");
      continue;
    }
    names.add(name);
    names.add("default");
  }
}

function addDeclaredNames(text, names) {
  const declarationRe =
    /export\s+(?:declare\s+)?(?:const|let|var|class|interface|type|enum|function|abstract\s+class|namespace)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let match;
  while ((match = declarationRe.exec(text)) !== null) {
    names.add(match[1]);
  }
}

function collectExportsFromDts(filePath, names = new Set(), visiting = new Set()) {
  if (!existsSync(filePath) || visiting.has(filePath)) return names;
  visiting.add(filePath);

  const raw = readFileSync(filePath, "utf8");
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /(^|\s)\/\/.*$/gm,
    "",
  );
  const dir = dirname(filePath);

  addNamesFromNamespaceExport(text, filePath, names);
  addNamesFromNamedExport(text, filePath, names, visiting, dir);
  addNamesFromStarExport(text, filePath, names, visiting, dir);
  addDefaultExportNames(text, names);
  addDeclaredNames(text, names);
  return names;
}

function main() {
  const docs = readFileSync(docsPath, "utf8");
  const sections = parseSectionsFromMarkdown(docs);

  for (const section of sections) {
    const dtsRel = sectionMap[section.moduleName];
    if (!dtsRel) {
      continue;
    }

    const dtsFile = resolve(distRoot, dtsRel);
    const exported = collectExportsFromDts(dtsFile, new Set(), new Set());
    const listed = [...section.apis].sort();

    const missing = listed.filter((api) => !exported.has(api));
    if (missing.length > 0) {
      failures.push(
        `${section.moduleName}: listed APIs missing from export surface: ${missing.join(", ")}`,
      );
    }
  }

  const tracked = new Set(Object.keys(sectionMap));
  for (const section of sections) {
    if (tracked.has(section.moduleName) && section.apis.size === 0) {
      failures.push(
        `${section.moduleName}: no API rows found; this section is probably malformed`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("check-api-reference-useful: failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("check-api-reference-useful: ok");
}

main();
