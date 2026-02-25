import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_COMPONENT_DIR = "src/component";

function normalizePathForDisplay(absPath, rootDir) {
  return path.relative(rootDir, absPath).split(path.sep).join("/");
}

function collectTypeScriptFiles(dirPath) {
  const out = [];
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    return out;
  }

  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "_generated") {
          continue;
        }
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }
      out.push(absPath);
    }
  }
  return out;
}

function collectPublicFunctionValidatorFailures(filePath, rootDir) {
  const source = readFileSync(filePath, "utf8");
  const failures = [];
  const pattern =
    /export const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(query|mutation|action)\s*\(\s*\{/g;

  let match;
  while ((match = pattern.exec(source)) !== null) {
    const fnName = match[1];
    const fnKind = match[2];
    const afterStart = source.slice(match.index + match[0].length);
    const handlerIndex = afterStart.indexOf("handler:");
    const signatureSlice =
      handlerIndex >= 0 ? afterStart.slice(0, handlerIndex) : afterStart.slice(0, 2000);

    const hasArgs = /\bargs\s*:/.test(signatureSlice);
    const hasReturns = /\breturns\s*:/.test(signatureSlice);
    if (hasArgs && hasReturns) {
      continue;
    }

    failures.push({
      file: normalizePathForDisplay(filePath, rootDir),
      functionName: fnName,
      functionKind: fnKind,
      missingArgs: !hasArgs,
      missingReturns: !hasReturns,
    });
  }

  return failures;
}

export function runComponentFunctionValidatorsCheck({
  rootDir = process.cwd(),
  componentDir = DEFAULT_COMPONENT_DIR,
} = {}) {
  const absComponentDir = path.resolve(rootDir, componentDir);
  const files = collectTypeScriptFiles(absComponentDir);

  const failures = files.flatMap((filePath) =>
    collectPublicFunctionValidatorFailures(filePath, rootDir)
  );

  return {
    ok: failures.length === 0,
    failures,
  };
}

function formatFailure(failure) {
  const missing = [];
  if (failure.missingArgs) missing.push("args");
  if (failure.missingReturns) missing.push("returns");
  return `${failure.file}:${failure.functionName} (${failure.functionKind}) missing ${missing.join(" + ")}`;
}

function main() {
  const result = runComponentFunctionValidatorsCheck();
  if (!result.ok) {
    console.error("check-component-function-validators: failed");
    for (const failure of result.failures) {
      console.error(`- ${formatFailure(failure)}`);
    }
    process.exit(1);
  }
  console.log("check-component-function-validators: ok");
}

const isCliInvocation = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCliInvocation) {
  main();
}
