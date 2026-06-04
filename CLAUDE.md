# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hermes Desktop is a cross-platform Electron app that installs, configures, and provides a GUI for [Hermes Agent](https://github.com/NousResearch/hermes-agent) — a self-improving AI assistant. The app manages the full lifecycle: first-run install, provider/model setup, and daily usage (chat, sessions, skills, scheduling, SSH tunnels, messaging gateways).

Hermes Agent lives at `~/.hermes` on the user's machine. The desktop app calls the Hermes CLI via subprocess and polls its local HTTP API at `http://127.0.0.1:8642`.

## Commands

```bash
npm run dev          # Start Electron in development mode
npm run build        # Typecheck + full build (electron-vite)
npm run lint         # ESLint (flat config, cached)
npm run typecheck    # TypeScript check (node + web configs)
npm run test         # Vitest suite (run once)
npm run test:watch   # Vitest in watch mode
```

**Run a single test file:**
```bash
npm run test -- tests/path/to/file.test.ts
```

**E2E testing (opt-in, dev only):**
```bash
ENABLE_CDP=1 npm run dev   # Enables Chrome DevTools Protocol on port 9222
# Then run scripts from scripts/ using Playwright CDP
```

## Architecture

### Process Model

```
Main Process (Node.js)
  └── IPC handlers (~200 endpoints via ipcMain.handle)
Preload Bridge (Context Isolation)
  └── window.hermesAPI  ←  all renderer↔main communication
Renderer Process (React 19 + Tailwind CSS 4)
  └── Multi-screen SPA (20 screens, state machine: splash → welcome → install → setup → main)
```

### Key Source Files

| File | Role |
|------|------|
| `src/main/index.ts` | App entry, IPC dispatch, window management |
| `src/main/hermes.ts` (51 KB) | SSE streaming, tool progress, local/gateway routing |
| `src/main/ssh-remote.ts` + `ssh-tunnel.ts` | Remote Hermes API via SSH with port forwarding |
| `src/main/installer.ts` (49 KB) | First-run setup, dependency detection (Git, uv, Python 3.11+) |
| `src/main/config.ts` + `config-health.ts` | YAML config parsing, validation, health checks |
| `src/main/sessions.ts` | Session CRUD + full-text search (SQLite FTS5) |
| `src/main/profiles.ts` | Multi-instance support (isolated `HERMES_HOME` per profile) |
| `src/main/skills.ts` | Skill discovery and installation |
| `src/main/claw3d.ts` | Claw3d Office 3D visual interface |
| `src/preload/index.ts` | Secure IPC bridge — exposes `window.hermesAPI` |
| `src/preload/index.d.ts` | Full TypeScript surface of `window.hermesAPI` |
| `src/renderer/src/App.tsx` | Root component + screen state machine |
| `src/shared/` | Constants and i18n types shared across processes |

### IPC Pattern

All renderer↔main communication flows through the preload bridge. To add a new IPC endpoint:
1. Add an `ipcMain.handle('channel-name', ...)` handler in `src/main/index.ts` (or a relevant `src/main/*.ts` module)
2. Expose it via `contextBridge.exposeInMainWorld` in `src/preload/index.ts`
3. Add the TypeScript signature in `src/preload/index.d.ts`

### Data Storage

- **SQLite** (`better-sqlite3`) — session history with FTS5 full-text search
- **YAML files** in `~/.hermes/` — Hermes Agent configuration
- **Electron store** — app-level UI settings

### Internationalization

i18next + react-i18next. Translation files live in `src/shared/i18n/`. When adding user-visible strings, add them to all translation namespaces (at minimum the English source). The `useI18n` hook wraps `useTranslation` for the renderer.

### Build Configuration

- **Bundler:** electron-vite (Rollup for main/preload, Vite for renderer)
- `better-sqlite3` is listed as an external in the main build (native addon, not bundled)
- Two preload entry points: `src/preload/index.ts` (main window) and `src/preload/askpass.ts` (sudo credential prompt)
- TypeScript uses project references: `tsconfig.node.json` (main + preload), `tsconfig.web.json` (renderer)

### Testing

Tests live in `tests/` (73 files) using Vitest with jsdom. Test setup is at `src/renderer/src/test/setup.ts`. The test environment mocks Electron APIs — do not assume real IPC or filesystem access in unit tests.
