# Fallback Policy

The component enforces a fail-closed fallback policy for handwritten source:

- Any detected fallback/default construct must be explicitly allowlisted in `scripts/fallback-allowlist.json`.
- New fallback/default sites fail checks until the allowlist is intentionally updated.
- Removed fallback/default sites must also be removed from the allowlist (stale entries fail checks).
- Every allowlist entry must include:
  - `description` (manually edited, non-empty string)
  - `userApproved` (manually edited boolean)
  - `riskLevel` (manually editable string, defaults to `"default"`)

IDs are intentionally stable across line movement (line/col are metadata only), so reformatting or adding lines above existing code should not churn allowlist identities.
IDs are derived from semantic context (file, kind, snippet, surrounding statement/declaration context, and occurrence), which prevents duplicate IDs when the same snippet appears multiple times in one file.

## Scope

Checked source:

- `src/**/*.ts`
- `src/**/*.tsx`

Excluded:

- `src/component/_generated/**`
- `src/protocol/schemas/**`
- `src/protocol/schemas/v2/**`

## Commands

- Validate policy: `pnpm run check:fallback-policy`
- Refresh allowlist intentionally: `pnpm run check:fallback-policy:write`

## Review Workflow

1. Add or change fallback/default behavior in source.
2. Run `pnpm run check:fallback-policy` and confirm the failure is expected.
3. If intentional, run `pnpm run check:fallback-policy:write`.
4. Manually review/edit `description` and `userApproved` for any new entries in `scripts/fallback-allowlist.json`.
5. Review the exact diff and keep only intended entries.
6. Re-run `pnpm run check:fallback-policy` and `pnpm run ci`.
