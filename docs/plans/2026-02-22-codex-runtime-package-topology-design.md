# Codex Runtime Package Topology Design

Date: 2026-02-22
Status: Approved
Owner: Architecture planning

## Goal

Separate all non-core capabilities into dedicated packages with concrete contracts so we can add/remove/refactor integration packages without touching core runtime package code.

## Decisions Captured

- Core boundary is `runtime-core only`.
- We will use a staged roadmap across all non-core areas.
- Non-core packages import core contracts directly (no shared ports package).
- Evolution model is forward-only clean break (no compatibility shims).
- Convex host + persistence stay together in one package.
- Project/package naming moves to `codex-runtime` (full rename scope).
- React hooks move to dedicated package (`@zakstam/codex-runtime-react`).

## Approaches Considered

### 1) Vertical capability packages (selected)

- Split by capability (`convex`, `react`, `bridge-tauri`, `protocol-tooling`) around a runtime-only core.
- Best fit for isolation and ownership.

### 2) Layered technical packages

- Split by layers (`contracts`, `runtime`, `integrations`, `tooling`).
- Rejected due to cross-layer churn and weaker ownership for end-to-end features.

### 3) Single integrations package

- One package for all non-core features.
- Rejected because it recreates a second monolith and weakens change isolation.

## Recommendation (Canonical Format)

- Recommendation
  - Adopt a runtime-only core package (`@zakstam/codex-runtime`) and move all non-core features into capability packages, with Convex host + persistence combined in `@zakstam/codex-runtime-convex`.
- Why now
  - Existing architecture already targets adapter-first persistence and package isolation. Finalizing boundaries now avoids repeated refactors and import churn during upcoming package growth.
- Simplicity impact
  - Clear package responsibilities and fewer mixed exports from core.
- Maintenance impact
  - Strong ownership boundaries reduce accidental coupling and make CI checks/package docs easier to maintain.
- Scalability impact
  - New integrations can be added as independent packages without redesigning core contracts.
- Evidence
  - ADR direction already exists for adapter-first runtime and persistence package isolation.
  - Current core exports still include non-core surfaces (Convex helpers, bridge-related exports) and should be separated.
- Required dependent updates
  - Example apps (`convex/chat.ts`, bridge wiring, shim scripts).
  - All import paths and workspace dependencies.
  - CI scripts and boundary checks.
- Required docs updates
  - `README.md`, API/integration docs, runbooks, workflow docs, architecture decisions.
- Cleanup required
  - Remove legacy naming and old import paths in same sweep; no aliases/shims.

## Target Package Topology

1. `@zakstam/codex-runtime` (core)
- Runtime engine + public runtime contracts only.
- No Convex host bindings, no Convex persistence implementation, no Tauri bridge helpers, no protocol authoring/tooling implementation, no React hooks.

2. `@zakstam/codex-runtime-convex`
- Owns Convex host bindings and Convex persistence adapter together.
- Subpath exports:
  - `@zakstam/codex-runtime-convex/host`
  - `@zakstam/codex-runtime-convex/persistence`
  - `@zakstam/codex-runtime-convex/tooling` (shim sync/check helpers)

3. `@zakstam/codex-runtime-react`
- Owns React hooks/components.
- Adapter-neutral hooks remain here; Convex-specific hook adapters can be separate subpath or package-owned adapter wrappers.

4. `@zakstam/codex-runtime-bridge-tauri`
- Owns Tauri/local bridge integration and runtime wiring helpers.

5. `@zakstam/codex-runtime-protocol-tooling`
- Owns protocol schema parser/classifier/generation tooling.

## Contract and Dependency Rules

- Dependency direction:
  - Allowed: non-core -> core.
  - Forbidden: core -> non-core.
  - Forbidden: non-core internal-to-internal imports across packages unless through explicit public exports.
- Public thread boundary remains conversation-scoped (`conversationId` + `threadId` when thread targeting is needed).
- Generated component API types remain boundary types across app/host/package contracts.
- Component `_generated/dataModel` types stay internal to component implementation.

## Error Handling Rules

- Core defines canonical runtime error taxonomy.
- Integration packages map platform-specific failures into core error contracts at package boundaries.
- Fail-closed behavior remains explicit and package-local; no workaround aliases.

## Staged Roadmap

### Stage A: Core hard boundary + naming baseline

- Rename core package and repo/workspace identifiers to `codex-runtime` naming.
- Remove non-core exports from core.
- Add import-boundary checks preventing core from importing non-core.

### Stage B: Single Convex package unification

- Rename `@zakstam/codex-runtime-convex` to `@zakstam/codex-runtime-convex`.
- Move/merge Convex host bindings + shim tooling into this package.
- Update all example app Convex imports and scripts.

### Stage C: React package extraction

- Move hooks/components into `@zakstam/codex-runtime-react`.
- Update examples/docs/tests to consume react package paths.

### Stage D: Tauri bridge extraction

- Move Tauri/local bridge integration out of core into `@zakstam/codex-runtime-bridge-tauri`.
- Update tauri app/debug harness imports and runbooks.

### Stage E: Protocol tooling extraction

- Move parser/classifier/schema tooling into `@zakstam/codex-runtime-protocol-tooling`.
- Keep runtime-essential event contracts in core only if runtime requires them.

### Stage F: Final cleanup + enforcement

- Remove obsolete paths/docs/tests/aliases.
- Ensure examples and shim checks are in sync.
- Keep only canonical import paths.

## Validation and Success Criteria

- We can add/remove/refactor `-convex`, `-react`, `-bridge-tauri`, or `-protocol-tooling` without core code edits.
- Core package is runtime-only and integration-agnostic.
- Example apps compile with canonical new package imports.
- Boundary guards fail-closed on forbidden imports.
- Documentation reflects one canonical integration path per package.
