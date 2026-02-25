# @zakstam/codex-runtime-protocol-tooling

Schema maintenance tooling for `@zakstam/codex-runtime` protocol generated files.

## Commands

- `schema:sync`: sync generated schema files into a target directory and write a manifest.
- `schema:check`: validate target directory contents against the manifest (and optional source dir).

## Usage

```bash
pnpm --filter @zakstam/codex-runtime-protocol-tooling run schema:sync -- --target ./packages/codex-runtime/src/protocol/schemas --source /path/to/codex/generated/schemas
pnpm --filter @zakstam/codex-runtime-protocol-tooling run schema:check -- --target ./packages/codex-runtime/src/protocol/schemas
```
