# Host Integration Guide

Canonical default: runtime-owned host integration (`dispatchManaged: false`).

This doc is aligned to the single canonical implementation in `../LLMS.md`.

## Actor Scope Contract

Use `actor: { userId?: string }` at all host/component boundaries.

- `userId` present -> identified-user isolation.
- `userId` omitted -> anonymous-only isolation.
- Tenant/device identifiers are not part of the contract.

## Required Flow

1. Mount component in `convex/convex.config.ts`.
2. Generate host wrappers from manifest (`pnpm run host:generate`).
3. Keep host files split:
- `convex/chat.generated.ts` (generated)
- `convex/chat.extensions.ts` (app-owned)
- `convex/chat.ts` (stable re-export entrypoint)
4. Start runtime with `dispatchManaged: false`.
5. Submit turns through `runtime.sendTurn(text)`.
6. Run `chat.validateHostWiring` at startup.

## Mount the Component

```ts
import { defineApp } from "convex/server";
import codexLocal from "@zakstam/codex-local-component/convex.config";

const app = defineApp();
app.use(codexLocal);

export default app;
```

Run `npx convex dev` once so `components.codexLocal.*` types are generated.

## Generate and Check Host Surfaces

```bash
pnpm run host:generate
pnpm run host:check
```

Generated wrappers use app `mutation(...)` and `query(...)` exports directly so Convex codegen and app-generated types stay authoritative.

## Runtime Contract

Runtime startup must be explicit runtime-owned:

```ts
await runtime.start({
  actor,
  sessionId,
  dispatchManaged: false,
  threadStrategy: "start",
});
```

Turn start API for canonical flow:

```ts
await runtime.sendTurn(inputText);
```

## Thread Snapshot Contract

`chat.threadSnapshotSafe` is the canonical source for activity/integrity hooks.

- `createdAt` indicates when a row first appeared.
- `updatedAt` indicates the latest row mutation.
- `completedAt` is the terminal boundary signal when present.
- Terminal authority decisions should use `completedAt/updatedAt` before `createdAt`.

## Startup Wiring Validation

Call `chat.validateHostWiring` once when your host process starts.

Expected response shape:

- `ok: boolean`
- `checks: Array<{ name: string; ok: boolean; detail?: string }>`

If `ok` is `false`, fail startup and surface details in logs.

## Convex Boundary Rule

Convex-deployed code must not import `@zakstam/codex-local-component/protocol/parser`.
Use host wrapper exports (`@zakstam/codex-local-component/host/convex`) inside Convex functions.

## Advanced Appendix (Non-Default)

Dispatch-managed orchestration is advanced and non-default. Use only when explicitly requested:

- `DISPATCH_MANAGED_REFERENCE_HOST.md`
