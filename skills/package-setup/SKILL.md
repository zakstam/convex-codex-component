---
name: package-setup
description: Fail-closed setup workflow for integrating `@zakstam/codex-local-component` in a consumer project using the canonical runtime-owned React path. Use when onboarding a project to this package, wiring Convex host definitions with `defineCodexHostDefinitions(...)`, syncing/checking host shims, validating prerequisites, or diagnosing setup drift.
---

# Package Setup

Use this skill to execute package setup with deterministic ordering and fail-closed checks.

## Workflow

1. Read `packages/codex-local-component/README.md`.
2. Read `packages/codex-local-component/docs/CANONICAL_INTEGRATION.md`.
3. Read `packages/codex-local-component/docs/API_REFERENCE.md`.
4. Read `packages/codex-local-component/docs/EXAMPLE_APPS_RUNBOOK.md`.
5. Execute `references/setup-checklist.md`.
6. Use `references/command-matrix.md` when the target environment or app needs command-specific routing.
7. Use `references/troubleshooting.md` when any prerequisite or verification gate fails.

## Fail-Closed Rules

- Stop immediately when required prerequisites are missing.
- Do not continue setup after failed `check:host-shim` or failed `typecheck`.
- Do not use wrapper/facade host APIs (`createCodexHost` or similar).
- Keep public host contract to `threadId` only.
- Keep authentication consumer-managed with `actor: { userId?: string }`.

## Required Output Contract

- Report every completed setup step in order.
- Report every command run and whether it passed or failed.
- For each failure, report the exact blocking prerequisite and the fix required before continuing.
