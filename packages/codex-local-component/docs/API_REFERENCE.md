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

## Canonical Host API

From `@zakstam/codex-local-component/host/convex`:

- `createCodexHost`
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
- Runtime-owned `ensureThread` is single-path and requires `threadId` or `externalThreadId`.
- For full implementation sequence, use `docs/CANONICAL_INTEGRATION.md`.
