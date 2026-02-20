# Setup Checklist

Follow these steps in order. Stop on first failure.

## 1) Preconditions

1. Confirm dependency installation at repo root:
   - `pnpm install`
2. Confirm package docs map is present:
   - `packages/codex-local-component/README.md`
   - `packages/codex-local-component/docs/CANONICAL_INTEGRATION.md`
   - `packages/codex-local-component/docs/API_REFERENCE.md`
   - `packages/codex-local-component/docs/EXAMPLE_APPS_RUNBOOK.md`
3. Confirm target project has a Convex app and generated `_generated` files.

## 2) Canonical Host Wiring

1. Mount component in `convex/convex.config.ts` via `@zakstam/codex-local-component/convex.config`.
2. Define host definitions in app-owned `convex/chat.ts` using:
   - `defineCodexHostDefinitions(...)` from `@zakstam/codex-local-component/host/convex`
3. Export explicit Convex `mutation/query` constants from `convex/chat.ts`.
4. Keep host thread boundary contract as `threadId` only.

## 3) Runtime Wiring

1. Start runtime with `createCodexHostRuntime(...)` from `@zakstam/codex-local-component/host`.
2. Keep actor boundary as `actor: { userId?: string }`.
3. Keep authentication and actor identity policy in consumer app code.
4. Call `chat.validateHostWiring` during startup.

## 4) UI Wiring (Canonical)

1. Use `@zakstam/codex-local-component/react`.
2. Wire `CodexProvider` and `useCodex` against `api.chat`.
3. Use `useCodexRuntimeBridge` if runtime controls are required.

## 5) Validation Gates

Run in target app directory:

1. `npx convex dev --once`
2. `pnpm run dev:convex:once`
3. `pnpm run check:host-shim`
4. `pnpm run typecheck`

Do not continue on failure.

## 6) Completion Output

Report:

1. Files touched for setup.
2. Commands run.
3. Pass/fail state of each validation gate.
4. Any unresolved blockers.
