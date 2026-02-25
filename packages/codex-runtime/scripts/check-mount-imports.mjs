import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredConvexImports = [
  join(root, "../../apps/examples/persistent-cli-app/convex/convex.config.ts"),
];

for (const file of requiredConvexImports) {
  const source = readFileSync(file, "utf8");
  if (!source.includes('@zakstam/codex-runtime/convex.config')) {
    throw new Error(
      `Expected ${file} to import @zakstam/codex-runtime/convex.config`,
    );
  }
  if (source.includes('@zakstam/codex-runtime-convex/convex.config')) {
    throw new Error(
      `Unexpected convex mount import in ${file}. Use @zakstam/codex-runtime/convex.config.`,
    );
  }
}

console.log("mount-imports: ok");
