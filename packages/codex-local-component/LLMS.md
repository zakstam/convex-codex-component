# LLMS: Canonical Consumer Integration (Single Path)

Canonical default: runtime-owned host integration (`dispatchManaged: false`).

## Actor Scope Contract

- Actor payload is `actor: { userId?: string }`.
- `userId` is optional:
- when present, data access is scoped to that user.
- when omitted, data access is scoped to anonymous-only rows.
- Do not send tenant/device identifiers.

## Hard Rule

- Follow this file as the only default implementation strategy.
- Do not implement dispatch-managed orchestration unless explicitly requested.
- Do not handwrite host wrapper surfaces; generate them.
- Always use app-generated Convex types from `./_generated/api` and `./_generated/server`.

## Required Implementation Steps

1. Install package dependencies.

```bash
pnpm add @zakstam/codex-local-component convex
```

2. Mount the component in `convex/convex.config.ts`.

```ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

3. Generate Convex app types once before host wiring.

```bash
npx convex dev --once
```

- Required so app-generated `./_generated/api` and `./_generated/server` exist and stay authoritative.

4. Generate host surfaces from the canonical manifest.

```bash
pnpm run host:generate
```

5. Keep host files in this split:

- `convex/chat.generated.ts`: generated preset wrappers (do not edit)
- `convex/chat.extensions.ts`: app-owned custom endpoints
- `convex/chat.ts`: stable entrypoint (`export *` from generated + extensions)

6. Use runtime-owned host preset behavior only.

- Generated wrappers are based on `defineRuntimeOwnedHostSlice(...)`.
- Construct runtime with explicit persistence wiring:

```ts
import { createCodexHostRuntime } from "@zakstam/codex-local-component/host";

const runtime = createCodexHostRuntime({
  persistence: {
    ensureThread,
    ensureSession,
    ingestSafe,
    upsertPendingServerRequest,
    resolvePendingServerRequest,
    listPendingServerRequests,
    enqueueTurnDispatch,
    claimNextTurnDispatch,
    markTurnDispatchStarted,
    markTurnDispatchCompleted,
    markTurnDispatchFailed,
    cancelTurnDispatch,
  },
});
```

- Runtime startup must be explicit runtime-owned:

```ts
await runtime.start({
  actor,
  sessionId,
  dispatchManaged: false,
  threadStrategy: "start",
});
```

7. Start turns through `runtime.sendTurn(text)`.

- Do not call `startClaimedTurn` in the canonical path.

8. Validate host wiring during startup.

- Query `chat.validateHostWiring` once at process boot.
- Fail fast if `ok` is `false`.

9. Use canonical host query/mutation endpoints in React hooks.

- `useCodexMessages` -> `chat.listThreadMessagesForHooks`
- `useCodexTurn` -> `chat.listTurnMessagesForHooks`
- `useCodexApprovals` -> `chat.listPendingApprovalsForHooks` + `chat.respondApprovalForHooks`
- `useCodexComposer` -> `chat.enqueueTurnDispatch`

## Required Consumer Commands

From repo root (or equivalent monorepo command wrappers):

```bash
pnpm run host:generate
pnpm run host:check
```

If your app does not define monorepo wrappers, run local equivalents:

```bash
pnpm run generate:host-surfaces
pnpm run check:host-surfaces
```

From each host app:

```bash
pnpm run dev:convex:once
pnpm run wiring:smoke
pnpm run typecheck
```

If your app does not define `wiring:smoke`, run the check inline with `ConvexHttpClient` against `chat.validateHostWiring`.

## Required Host Surface Ownership

- Generated surface owns preset endpoint exports.
- Extensions file owns only app-specific endpoints.
- Entrypoint file owns only re-exports.

If an endpoint belongs to preset behavior, add it in the package preset/manifest and regenerate. Do not manually patch generated host files.

## Advanced Appendix (Non-Default)

Dispatch-managed orchestration is advanced and non-default. Reference only when explicitly requested:

- `docs/DISPATCH_MANAGED_REFERENCE_HOST.md`
