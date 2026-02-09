import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const componentDir = join(root, "..", "..", "packages", "codex-local-component");
const patternPrefix = "zakstam-codex-local-component-";

for (const name of readdirSync(componentDir)) {
  if (name.startsWith(patternPrefix) && name.endsWith(".tgz")) {
    unlinkSync(join(componentDir, name));
  }
}

execSync("pnpm pack", {
  cwd: componentDir,
  stdio: "inherit",
});

const tgzFiles = readdirSync(componentDir)
  .filter((name) => name.startsWith(patternPrefix) && name.endsWith(".tgz"))
  .sort();

const latest = tgzFiles[tgzFiles.length - 1];
if (!latest) {
  throw new Error("No codex-local-component .tgz package was produced.");
}

const tgzPath = join(componentDir, latest);
execSync(`npm install --no-save "${tgzPath}"`, {
  cwd: root,
  stdio: "inherit",
});
unlinkSync(tgzPath);

console.log(`[prepare:component] installed ${latest}`);
