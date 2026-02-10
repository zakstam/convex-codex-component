import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const generatedDir = join(appRoot, "convex", "_generated");

const required = ["api.d.ts", "api.js", "server.d.ts", "server.js", "dataModel.d.ts"];
for (const file of required) {
  const path = join(generatedDir, file);
  if (!existsSync(path)) {
    throw new Error(`Missing generated Convex file: ${path}. Run \`pnpm run dev:convex:once\`.`);
  }
}

const convexDir = join(appRoot, "convex");
const hostFiles = readdirSync(convexDir)
  .filter((name) => name.endsWith(".ts") && name !== "convex.config.ts")
  .map((name) => join(convexDir, name));
const generatedApi = readFileSync(join(generatedDir, "api.d.ts"), "utf8");
const refPattern = /\bapi\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/g;
const missing = [];

for (const hostFile of hostFiles) {
  const source = readFileSync(hostFile, "utf8");
  const refs = new Set();
  for (const match of source.matchAll(refPattern)) {
    refs.add(`${match[1]}.${match[2]}`);
  }
  for (const ref of refs) {
    const [group, fn] = ref.split(".");
    if (!generatedApi.includes(`${group}:`) || !generatedApi.includes(`${fn}:`)) {
      missing.push(`${hostFile} -> api.${ref}`);
    }
  }
}

if (missing.length > 0) {
  throw new Error(
    `[check-generated-convex] Missing generated refs:\n${missing.join("\n")}\n` +
      "Run `pnpm run dev:convex:once` to regenerate Convex API types.",
  );
}
