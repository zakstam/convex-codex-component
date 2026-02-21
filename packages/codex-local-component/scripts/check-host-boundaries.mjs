#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/host", import.meta.url);

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const zones = [
  {
    name: "definitions",
    dir: join(root.pathname, "definitions"),
    forbidden: ["../runtime/", "../persistence/", "../runtime.js", "../persistence.js"],
  },
  {
    name: "runtime",
    dir: join(root.pathname, "runtime"),
    forbidden: ["../definitions/"],
  },
  {
    name: "persistence",
    dir: join(root.pathname, "persistence"),
    forbidden: ["../../definitions/", "../definitions/"],
  },
];

const importPattern = /from\s+["']([^"']+)["']/g;
const errors = [];

for (const zone of zones) {
  for (const file of listTsFiles(zone.dir)) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(importPattern)) {
      const spec = match[1];
      for (const forbidden of zone.forbidden) {
        if (spec.startsWith(forbidden)) {
          errors.push(
            `${relative(process.cwd(), file)} imports forbidden path \"${spec}\" for zone \"${zone.name}\"`,
          );
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error("[E_HOST_BOUNDARY_VIOLATION] Host bounded-context import policy failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Host bounded-context import policy passed.");
