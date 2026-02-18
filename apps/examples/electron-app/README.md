# Codex Local — Electron Example

An Electron desktop app demonstrating the `@zakstam/codex-local-component` package with React and Convex. Mirrors the Tauri example app's functionality using Electron's native Node.js main process instead of a bridge-helper subprocess.

## Architecture

Unlike the Tauri app (which spawns a Node.js subprocess for the runtime), this Electron app runs the Codex host runtime **directly in the main process** — no subprocess or stdin/stdout protocol needed.

```
┌──────────────────────────────────────────┐
│  Renderer (Chromium)                     │
│  React + Convex + Vite                   │
│                                          │
│  window.electronCodex.invoke(channel)  ──┤──► ipcMain.handle(channel)
│  window.electronCodex.on(channel, cb)  ◄─┤──◄ webContents.send(channel)
└──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────┐
│  Main Process (Node.js)                  │
│  createCodexHostRuntime() runs in-proc   │
│  ConvexHttpClient + persistence          │
└──────────────────────────────────────────┘
```

## Prerequisites

- Node.js 18+
- A Convex deployment with the codex-local component installed

## Setup

1. Install dependencies from the monorepo root:

   ```bash
   pnpm install
   ```

2. Configure environment variables in `.env.local`:

   ```
   VITE_CONVEX_URL=https://your-deployment.convex.cloud
   VITE_CODEX_MODEL=gpt-4o
   VITE_CODEX_CWD=/path/to/working/directory
   ```

3. Deploy the Convex backend:

   ```bash
   pnpm run dev:convex
   ```

## Development

Run the renderer dev server and Electron main process concurrently:

```bash
pnpm run start
```

This starts:
- **Vite** dev server on `http://localhost:5173` (hot reload)
- **Electron** main process via `tsx` (loads the Vite URL)

## Build

```bash
pnpm run build
```

Builds the Vite renderer to `dist/` and compiles the Electron main process to `dist-electron/`.

## Scripts

| Script | Description |
|--------|-------------|
| `prepare:component` | Build the component package |
| `dev:convex` | Start Convex dev server |
| `dev:renderer` | Start Vite dev server |
| `dev:electron` | Start Electron main process |
| `start` | Run renderer + Electron concurrently |
| `build` | Production build |
| `typecheck` | TypeScript type checking |
