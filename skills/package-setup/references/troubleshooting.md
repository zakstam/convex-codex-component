# Troubleshooting

Apply fail-closed handling for every failure.

## Missing Convex URL

Symptoms:

- `Missing Convex URL` in startup logs.

Required action:

1. Run `pnpm run dev:convex` (or `pnpm run dev:convex:once`) in target app.
2. Re-run setup after Convex URL is available.

## Missing `VITE_CONVEX_URL` (Tauri)

Symptoms:

- App throws `Missing VITE_CONVEX_URL`.

Required action:

1. Create or update `apps/examples/tauri-app/.env.local`.
2. Set `VITE_CONVEX_URL=<your-convex-url>`.
3. Restart `pnpm run dev`.

## Host Shim Drift

Symptoms:

- `Host shim drift detected in convex/chat.ts`.

Required action:

1. Run `pnpm run sync:host-shim` in target app.
2. Re-run `pnpm run check:host-shim`.
3. Stop if drift remains and inspect app-owned extension exports.

## Typecheck Failure on `api.chat.*`

Symptoms:

- Type errors on generated `api.chat.*` functions.

Required action:

1. Ensure host exports are explicit `mutation/query` constants in `convex/chat.ts`.
2. Ensure host definitions come from `defineCodexHostDefinitions(...)`.
3. Re-run:
   - `npx convex dev --once`
   - `pnpm run check:host-shim`
   - `pnpm run typecheck`

## Invalid Architecture Request

Symptoms:

- Request to use wrapper/facade host builders.

Required action:

1. Reject wrapper/facade path.
2. Route back to canonical host wiring (`defineCodexHostDefinitions(...)` + explicit Convex exports).
