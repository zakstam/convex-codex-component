# API Reference

This package now documents one integration path only.

Use this path in order:

1. Mount `@zakstam/codex-local-component/convex.config`.
2. Define host endpoints with `createCodexHost(...)` from `@zakstam/codex-local-component/host/convex`.
3. Start runtime with `createCodexHostRuntime(...)` from `@zakstam/codex-local-component/host`.
4. Build UI with hooks from `@zakstam/codex-local-component/react`.

## Canonical Imports

- `@zakstam/codex-local-component/convex.config`
- `@zakstam/codex-local-component/host/convex`
- `@zakstam/codex-local-component/host`
- `@zakstam/codex-local-component/react`
- `@zakstam/codex-local-component/_generated/component.js`
- `@zakstam/codex-local-component/test`

## Canonical Host API

From `@zakstam/codex-local-component/host/convex`:

- `createCodexHost`
- `CodexHostActorResolver`
- `HostActorContext`

From `@zakstam/codex-local-component/host`:

- `createCodexHostRuntime`

## Canonical React API

From `@zakstam/codex-local-component/react`:

- `CodexProvider`
- `useCodex`
- `useCodexChat`
- `useCodexMessages`
- `useCodexThreadActivity`
- `useCodexThreadState`
- `useCodexThreads`
- `useCodexTokenUsage`

## Notes

- `createCodexHost` is the only documented host-wiring entrypoint.
- `createCodexHost` requires explicit `actorPolicy`.
- `actorPolicy.serverActor.userId` must be a non-empty string.
- `createCodexHost` rejects shorthand `actorPolicy` inputs (`"server"` or `{ userId: "server" }`).
- `createCodexHost` optionally accepts `actorResolver` (`mutation`/`query`) to resolve `args.actor` before host handlers run.
- Export Convex host functions with `mutation(codex.defs.mutations.*)` / `query(codex.defs.queries.*)` to keep generated `api.chat.*` args/returns fully typed.
- Runtime-owned `ensureThread` is single-path and requires `threadId` or `externalThreadId`.
- Runtime-owned lifecycle endpoints: `deleteThread`, `scheduleDeleteThread`, `deleteTurn`, `scheduleDeleteTurn`, `purgeActorData`, `schedulePurgeActorData`, `cancelDeletion`, `forceRunDeletion`, `getDeletionStatus`.
- `@zakstam/codex-local-component/test` exports `register` and `schema` for component-oriented test setup.
- For full implementation sequence, use `docs/CANONICAL_INTEGRATION.md`.
