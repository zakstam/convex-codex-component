# Command Matrix

Use this matrix to select commands by target context.

## External Consumer Project (Generic)

1. Install dependencies:
   - `pnpm add @zakstam/codex-local-component convex`
2. Generate Convex once:
   - `npx convex dev --once`
3. Sync host shim if project defines `sync:host-shim`:
   - `pnpm run sync:host-shim`
4. Verification:
   - `pnpm run dev:convex:once` (or app-specific equivalent)
   - `pnpm run check:host-shim` (when shim scripts exist)
   - `pnpm run typecheck`

## Monorepo Example: Persistent CLI

Working directory: `apps/examples/persistent-cli-app`

1. Start:
   - `pnpm run dev:convex`
   - `pnpm run sync:host-shim`
   - `pnpm start`
2. Verify:
   - `pnpm run dev:convex:once`
   - `pnpm run check:host-shim`
   - `pnpm run typecheck`

## Monorepo Example: Tauri

Working directory: `apps/examples/tauri-app`

1. Start:
   - `pnpm run dev:convex`
   - `pnpm run sync:host-shim`
   - `pnpm run dev`
2. Verify:
   - `pnpm run dev:convex:once`
   - `pnpm run check:host-shim`
   - `pnpm run typecheck`
   - `pnpm run tauri:check`

## Monorepo Example: CLI

Working directory: `apps/examples/cli-app`

1. Start:
   - `pnpm start`
