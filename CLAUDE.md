# CLAUDE.md — ioBroker.home3d

3D floor plan editor and live visualization for ioBroker. **Web-only adapter** (`common.onlyWWW: true`): there is no
backend process. The web adapter serves `www/` under `/home3d/`, and the page talks to ioBroker over the socket of web
with `@iobroker/socket-client` (like vis-2). Login and ACL are those of web.

## Layout

| Path | Content |
| --- | --- |
| `frontend/` | Own browser code (TypeScript, React), built by Vite (`vite.config.ts`) into `www/` |
| `frontend/index.html`, `frontend/public/` | The page; static files (`help.html`, `style.css`, `assets/`, `licenses/`, `vendor/lang`, `vendor/fonts`) copied to `www/` |
| `frontend/bridge.ts` | Entry: connection, live states, provides the `hass`-like object the 3D frontend expects |
| `frontend/iobroker.ts` | `IoBroker`: socket-client wrapper, implements `IoAccess` (objects/states) and `FileAccess` (files of `home3d.0`) |
| `frontend/store.ts` | `Store`: plans, history, images, mappings; handles every `callWS` message of the 3D frontend |
| `frontend/entities.ts` | Mapping ioBroker datapoints ↔ devices of the 3D frontend, validation, actions (`execute`) |
| `frontend/history.ts`, `sun.ts`, `more-info.ts`, `mdi-icon.ts` | `history/history_during_period`, `home3d/timetravel/history` and `recorder/statistics_during_period` (energy) from the history adapters (beside `Store.call()`); `sun.sun` from the system position; detail dialog with history curve; `<ha-icon>` drawn with `@mdi/js` (full set loaded on demand) |
| `frontend/device-dialog.ts`, `object-tree.ts`, `entity-picker.ts` | "Geräte verbinden" dialog with object tree |
| `frontend/project.ts` | Project files (one plan + its images + the mappings it uses): format, reading, naming |
| `frontend/react/` | React dialogs with MUI and `@iobroker/gui-components` ("Projekte", object browser `DialogSelectID`, file picker `DialogSelectFile`); loaded on demand into `www/chunks/` |
| `frontend/vendor-ext/` | Own code added to the 3D frontend at build time: `post.ts` (screen-space looks: comic outlines, gouache), `undo.ts` (editor undo history kept across the switch to 3D), `sensor-look.ts` (sensor symbols and texts, also in the editor's floor plan), `mdi-paths.ts` (the symbols drawn at once, without the whole @mdi/js set) |
| `frontend/model.ts` | Types |
| `vendor-src/home3d/src/` | Upstream 3D frontend (MIT), unchanged except names; patched at build time in `tasks.ts` |
| `www/` | Served by web; completely generated and gitignored: `index.html`, `bridge.js`, `chunks/`, `vendor/home3d*.js`, the public files, `licenses/page-licenses.md` |
| `tasks.ts` | Build with the Vite API: `--app` (frontend/ via `vite.config.ts`), `--vendor` (3D frontend, 8 separate bundles, patches as a `load` plugin) |
| `scripts/demo.ts`, `scripts/dev.ts`, `scripts/demo-data.ts`, `scripts/demo-socket.ts` | Local demo (built `www/`) and Vite dev server, both with a simulated socket; not part of the package |
| `test/*.test.ts` | Unit tests (`node:test`, `node:assert`) against an in-memory file storage |
| `test/packageFiles.js` | `@iobroker/testing` package checks |

## Storage (files of `home3d.0`, meta object from `instanceObjects`)

- `data.json`: `{ version: 2, plans, images: {id → file}, mappings, locate_plan }` — written on every change
- `history/<plan>.json`: snapshots (max 30)
- `images/<id>.<ext>`: binary images
- IDs that are not `[A-Za-z0-9_-]{1,80}` become `x<hex>` file names (`fileKey`)
- Migration: if `data.json` is missing, the state `3d-home.0.storage` of 0.4.0 is imported once

## Rules

- Never load all states. Subscribe only `mappedIds(mappings)`; the object tree loads objects only when the dialog opens.
- Never reach external hosts from the page; links of the upstream frontend are rewritten to `help.html` in `tasks.ts`.
- Writes to datapoints only through `execute()` (type, min/max and `write` are checked before the first write).
- `Store.call()` serializes all requests, reloads `data.json` before changes (stale check against other browsers)
  and rolls back memory if a write fails. Events are sent only after success.
- `crypto.randomUUID`/`crypto.subtle` are not available on plain http; use `uuid()` / the FNV hash in `entities.ts`.
- All page links are relative (web serves the page under `/home3d/`, possibly behind a proxy).
- Pro add-ons: only those whose backend this page brings are unlocked (`SERVED` in `tasks.ts`: weather, time travel, energy — shown as "Energie", without "Pro");
  buttons of the others are removed (`proButtons`).
- Do not mention the former upstream project name anywhere; keep the MIT copyright in LICENSE/NOTICE.
- Own 3D styles: `looks()` in `tasks.ts` patches `looks.ts`, `theme.ts`, `fold.ts`, `viewer3d.ts`, `panel.ts` and `i18n.ts`;
  code that is new goes to `frontend/vendor-ext/` and is imported by the patch, not into `vendor-src/`.
- React/MUI only in `frontend/react/`, imported with `import()`: the 3D view starts without React. A native modal
  `<dialog>` is always above React dialogs: close it while one is open (see the object browser in `device-dialog.ts`).

## Commands

```bash
npm run build     # tsx tasks.ts (empties www/, then page + 3D frontend)
npm run dev       # Vite dev server with hot reload and simulated devices: http://127.0.0.1:8099/index.html
npm run check     # tsc for frontend/ and for tasks/scripts/tests
npm run lint      # eslint -c eslint.config.mjs (only `--fix` for formatting, no separate prettier)
npm test          # unit tests + package files
npm run demo      # http://127.0.0.1:8099/home3d/index.html
```

## Release

`common.nogit: true` — generated bundles are gitignored, the CI builds (`build: true`). Release with
`npm run release-minor` (release-script, plugins iobroker + license); add changelog lines under
`### **WORK IN PROGRESS**` in README.md. Do not edit `common.news` by hand.

## Name

Until 0.4.0 the adapter was called `3d-home` (invalid: adapter names must start with a letter). Only the migration
(`LEGACY_STATE` in `frontend/iobroker.ts`) and the device discovery still know the old name.
