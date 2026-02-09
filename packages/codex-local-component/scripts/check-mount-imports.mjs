import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredConvexImports = [
  join(root, "../../apps/examples/persistent-cli-app/convex/convex.config.ts"),
  join(root, "../../apps/release-smoke-host/convex/convex.config.ts"),
];

for (const file of requiredConvexImports) {
  const source = readFileSync(file, "utf8");
  if (!source.includes('@convex-dev/codex-local-component/convex.config')) {
    throw new Error(
      `Expected ${file} to import @convex-dev/codex-local-component/convex.config`,
    );
  }
  if (source.includes('@convex-dev/codex-local-component";')) {
    throw new Error(
      `Unexpected root package mount import in ${file}. Use /convex.config.`,
    );
  }
}

console.log("mount-imports: ok");
