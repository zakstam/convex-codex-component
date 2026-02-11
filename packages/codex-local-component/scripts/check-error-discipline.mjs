import { execSync } from "node:child_process";

const SRC_GLOBS = [
  "src",
  "--glob", "!**/component/_generated/**",
  "--glob", "!**/protocol/schemas/**",
  "--glob", "!**/protocol/schemas/v2/**",
];

function runRg(pattern) {
  try {
    return execSync(
      `rg -n --no-heading ${JSON.stringify(pattern)} ${SRC_GLOBS.map((part) => JSON.stringify(part)).join(" ")}`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    const out = error?.stdout?.toString?.()?.trim?.() ?? "";
    return out;
  }
}

const checks = [
  {
    label: "Disallowed empty catch blocks",
    pattern: "catch\\s*\\{",
  },
  {
    label: "Disallowed swallowed promise rejections",
    pattern: "\\.catch\\(\\s*\\([^)]*\\)\\s*=>\\s*undefined\\s*\\)",
  },
  {
    label: "Disallowed legacy terminal fallback literal",
    pattern: "\\?\\?\\s*\"stream error\"",
  },
  {
    label: "Disallowed legacy terminal fallback literal",
    pattern: "\\?\\?\\s*\"turn interrupted\"",
  },
  {
    label: "Disallowed legacy terminal fallback literal",
    pattern: "\\?\\?\\s*\"turn failed\"",
  },
];

const failures = [];
for (const check of checks) {
  const hits = runRg(check.pattern);
  if (hits) {
    failures.push(`${check.label}:\n${hits}`);
  }
}

if (failures.length > 0) {
  console.error("Error-discipline violations detected:");
  for (const failure of failures) {
    console.error(`\n${failure}`);
  }
  process.exit(1);
}
