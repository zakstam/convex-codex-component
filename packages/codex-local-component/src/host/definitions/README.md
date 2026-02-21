# Host Definitions Lane

## Purpose

Owns the typed host-definition surface for runtime-owned Convex `query` and `mutation` bindings.
This lane defines what apps export through generated host shims.

## Files Owned Here

- `convexPreset.ts`
- `convexPresetMutations.ts`
- `surfaceManifest.ts`
- `generatedTypingBoundary.ts`
- `shim.ts`
- `index.ts`

## Forbidden Dependencies

Do not import host runtime internals from `src/host/runtime/**`.
Do not import host persistence internals from `src/host/persistence/**`.
Keep this lane focused on definitions/contracts only.

## Expected Checks

- Always run: `pnpm --filter @zakstam/codex-local-component run check:host-boundaries`
- Run in example apps when host shim surface changes: `pnpm run check:host-shim`
