import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SRC_GLOBS = [
  "src",
  "--glob", "!**/component/_generated/**",
  "--glob", "!**/protocol/schemas/**",
  "--glob", "!**/protocol/schemas/v2/**",
];

function runRg(pattern) {
  try {
    return execSync(`rg -n --no-heading ${JSON.stringify(pattern)} ${SRC_GLOBS.map((part) => JSON.stringify(part)).join(' ')}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const out = error?.stdout?.toString()?.trim?.() ?? '';
    return out;
  }
}

const anyHits = runRg('\\bany\\b');
if (anyHits) {
  console.error('Disallowed `any` usage detected in handwritten source:');
  console.error(anyHits);
  process.exit(1);
}

const allCastHitsRaw = runRg(' as ');
if (!allCastHitsRaw) {
  process.exit(0);
}

const allowlist = new Set(
  readFileSync(new URL('./unsafe-cast-allowlist.txt', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);

const disallowedCasts = allCastHitsRaw
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.includes('export * as '))
  .filter((line) => !line.includes('export { default as '))
  .filter((line) => !line.includes('import * as '))
  .filter((line) => !line.includes(' as const'))
  .filter((line) => !allowlist.has(line));

if (disallowedCasts.length > 0) {
  console.error('New type casts detected outside allowlist:');
  for (const line of disallowedCasts) {
    console.error(line);
  }
  console.error('\nIf intentional, add the exact line(s) to scripts/unsafe-cast-allowlist.txt');
  process.exit(1);
}
