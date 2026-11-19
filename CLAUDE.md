# CLAUDE.md — ioBroker.home3d

3D floor plan editor and live visualization for ioBroker. **Web-only adapter** (`common.onlyWWW: true`): there is no
backend process. The web adapter serves `www/` under `/home3d/`, and the page talks to ioBroker over the socket of web
with `@iobroker/socket-client` (like vis-2). Login and ACL are those of web.

Setup on a new machine, the test system vitanova (boat) and what is configured there: see `HANDOVER.md`.

## Layout

| Path | Content |
| --- | --- |
| `frontend/` | Own browser code (TypeScript, React), built by Vite (`vite.config.ts`) into `www/` |
| `frontend/index.html`, `frontend/public/` | The page; static files (`help.html`, `style.css`, `assets/`, `licenses/`, `vendor/lang`, `vendor/fonts`) copied to `www/` |
| `frontend/bridge.ts` | Entry: connection, live states, provides the `hass`-like object the 3D frontend expects |
| `frontend/iobroker.ts` | `IoBroker`: socket-client wrapper, implements `IoAccess` (objects/states) and `FileAccess` (files of `home3d.0`) |
| `frontend/store.ts` | `Store`: plans, history, images, mappings; handles every `callWS` message of the 3D frontend |
| `frontend/entities.ts` | Mapping ioBroker datapoints ↔ devices of the 3D frontend, validation, actions (`execute`) |
| `frontend/health.ts` | Battery, low battery, reachability and adapter state of the mapped devices: found once per device below its datapoint (the type-detector first, then by name and role; a folder of devices such as `shelly.0.ble` puts the device one level deeper), subscribed, given to the entities as attributes; a battery device counts as unreachable only after 48 h without a message (it sleeps), or, with `health_stale_min`, after that many minutes without an update of any of its datapoints |
| `frontend/history.ts`, `sun.ts`, `more-info.ts`, `mdi-icon.ts` | `history/history_during_period`, `home3d/timetravel/history` and `recorder/statistics_during_period` (energy) from the history adapters (beside `Store.call()`); `sun.sun` from the system position; detail dialog with history curve; `<ha-icon>` drawn with `@mdi/js` (full set loaded on demand) |
| `frontend/device-dialog.ts`, `object-tree.ts`, `entity-picker.ts` | "Geräte verbinden" dialog with object tree |
| `frontend/media.ts` | Media players for "Geräte verbinden": a device whose states have media roles (media.state, button.play/pause/next/prev, level.volume, media.title/cover …, as the type-detector names them) becomes one `media_player` mapping with all its actions, shown as the entry `media_player` below its device |
| `frontend/datapoint.ts` | Datapoints chosen at the device in the editor (events `iobroker-datapoint`, `iobroker-add-devices` from the patched editor): object browser, change or add mappings |
| `frontend/project.ts` | Project files (one plan + its images + the mappings it uses): format, reading, naming |
| `frontend/react/` | React dialogs with MUI and `@iobroker/gui-components` ("Projekte", object browser `DialogSelectID`, file picker `DialogSelectFile`); loaded on demand into `www/chunks/` |
| `frontend/vendor-ext/` | Own code added to the 3D frontend at build time: `post.ts` (screen-space looks: comic outlines, gouache, the warm diorama "cozy"), `hygge.ts` (the style Hygge: wall faces marked in build.ts, vertical boards and skirting in the style shader), `undo.ts` (editor undo history kept across the switch to 3D), `sensor-look.ts` (sensor symbols and texts, also in the editor's floor plan), `mdi-paths.ts` (the symbols drawn at once, without the whole @mdi/js set), `solar-text.ts` (the power written on the solar modules), `sea.ts` (the sea with waves around a boat), `anchor.ts` (a boat's anchor with its chain as a catenary), `boat-gear.ts` + `boat-kinds.ts` (tanks, rudder, propeller, navigation lights, deck hatches), `porthole.ts` (rounded outlines and plates of the window style "porthole"), `editor-keep.ts` (the editor's view kept across the 3D view), `app-logo.ts` (a TV app's logo when it shows no picture), `weather-data.ts` (wind, fog, pressure trend), `sky-shade.ts` (cloud shadows and wet surfaces in every themed material and the sea), `wind-vane.ts` (windex, windsock, flag), `home-data.ts` (pure: health, mould, price, warnings, mower lanes, water flow), `home-view.ts` (the home looks and their alerts from plan and states, the "Technik" report), `home-fx.ts` (draws them: air, water, sprinklers, mower, sound rings, flood, price glow, cars), `cars.ts` (saloon, hatchback, van), `air-vent.ts` (a ventilation's vents: the air streaming out or drawn in by the fan's stage), `pool-module.ts` (the pool's module, built in instead of a pack: its datapoints, the water, the flow in the pipes, warnings; registered in `modules.ts` by `poolMore`), `device-cards.ts` (the module `home3d.devices`, built in beside the pool's: glass cards with controls for robot vacuums, robot mowers, coffee machines, wallboxes, radiators and air conditioners; their datapoints in `device_links` of the furniture, a robot vacuum's per-room buttons in `device_rooms`; with `boat-cards.ts`: the cards of a boat's anchor and tanks from the datapoints of that furniture) |
| `frontend/lang.ts` | Texts of the frame (header, dialogs, status and error messages) in de/en/ru: `t(key, vars)`, `translatePage()` for `data-i18n*` in `index.html`; the language from the system (`setLanguage`), kept in `<html lang>` and localStorage `home3d-lang` (the help opens `help-en.html`/`help-ru.html` by it) |
| `frontend/model.ts` | Types |
| `src-www/src/` | Upstream 3D frontend (MIT), unchanged except names; patched at build time in `tasks.ts` |
| `www/` | Served by web; completely generated and gitignored: `index.html`, `bridge.js`, `chunks/`, `vendor/home3d*.js`, the public files, `licenses/page-licenses.md` |
| `tasks.ts` | Build with the Vite API: `--app` (frontend/ via `vite.config.ts`), `--vendor` (3D frontend, 8 separate bundles, patches as a `load` plugin) |
| `scripts/demo.ts`, `scripts/dev.ts`, `scripts/demo-data.ts`, `scripts/demo-socket.ts` | Local demo (built `www/`) and Vite dev server, both with a simulated socket; not part of the package |
| `test/*.test.ts` | Unit tests (`node:test`, `node:assert`) against an in-memory file storage |
| `test/packageFiles.js` | `@iobroker/testing` package checks |

## Storage (files of `home3d.0`, meta object from `instanceObjects`)

- `data.json`: `{ version: 2, plans, images: {id → file}, mappings, locate_plan, position_id?, timetravel_instance?, health_stale_min? }` — written on every change;
  `position_id`: a datapoint with the position (GPS on a boat) for `sun.sun` instead of the system settings;
  `timetravel_instance`: the history instance (e.g. `recorder.0`) preferred for the datapoints it records
  (`getEnabledDPs`), missing: the first enabled recorder instance; else per datapoint the instance of its
  `common.custom`, else the default history (time travel, detail dialog, energy). From a recorder the time travel reads
  all its datapoints with one `getSnapshot` and paged `getEvents` (`recorderRows`), high-frequency ones by `getHistory`;
  `health_stale_min`: a device is "unreachable" after that many minutes without an update instead of as it reports
- `history/<plan>.json`: snapshots (max 30)
- `images/<id>.<ext>`: binary images
- IDs that are not `[A-Za-z0-9_-]{1,80}` become `x<hex>` file names (`fileKey`)
- Migration: if `data.json` is missing, the state `3d-home.0.storage` of 0.4.0 is imported once

## Rules

- Never load all states. Subscribe only `mappedIds(mappings)`; the object tree loads objects only when the dialog opens.
  Exception, bounded: the health datapoints of the mapped devices (`health.ts`: the state objects below each mapped
  device or channel are read once, at most 400; their battery/unreach/reachable states and the adapter's
  `info.connection`/`alive` are subscribed too).
- Never reach external hosts from the page (only exception: a picture whose URL a mapped datapoint gives, e.g. the
  `entity_picture` of a media player such as a YouTube thumbnail); links of the upstream frontend are rewritten to `help.html` in `tasks.ts`.
- A mapping may have a condition `when: { id, values, else }`: its state counts only while datapoint `id` has one of
  `values`, else the device shows `else` (default "off"); `id` is subscribed like the state.
- A mapping may have `reach` (`report`, `never` or minutes) and `reach_connected` (checked only while its adapter is
  connected): when its device counts as unreachable in "Technik"; set at one datapoint, it counts for the whole
  device (`withHealth` in `bridge.ts`); missing: `health_stale_min` of the house.
- A mapping may have `battery`: the datapoint of its device's battery (number: %, boolean: low) or `none`; it wins
  over the type-detector and the guess (`findHealth`) and counts for the whole device.
- Writes to datapoints only through `execute()` (type, min/max and `write` are checked before the first write);
  `set_value` needs no rule of its own: it writes the mapping's own datapoint (`iobroker_write` marks the writable ones;
  `iobroker_min`/`iobroker_max`/`iobroker_states` give their range and the texts of their values).
- `Store.call()` serializes all requests, reloads `data.json` before changes (stale check against other browsers)
  and rolls back memory if a write fails. Events are sent only after success.
- Read-only: if the user may not write `data.json` (`IoBroker.canWrite`: `readDir` of `home3d.0`, the server evaluates
  `acl.write`) or the URL has `?readonly`, the page runs as in the kiosk, `hass.user.is_admin` is false (no editor) and
  `Store.readOnly` refuses every change in `MUTATING` and writes nothing, not even on the first start.
- `crypto.randomUUID`/`crypto.subtle` are not available on plain http; use `uuid()` / the FNV hash in `entities.ts`.
- All page links are relative (web serves the page under `/home3d/`, possibly behind a proxy).
- Pro add-ons: only those whose backend this page brings are unlocked (`SERVED` in `tasks.ts`: weather, time travel, energy, household, pool, sound (now-playing cards, sound rings), screens (cover and app colour on TVs) — shown as "Energie" and "Haushalt", without "Pro"; the pool's module is built in, `frontend/vendor-ext/pool-module.ts`);
  buttons of the others are removed (`proButtons`).
- Do not mention the former upstream project name anywhere; keep the MIT copyright in LICENSE/NOTICE.
- Texts of the frame only through `t()` of `frontend/lang.ts` (de, en and ru for every key); texts of the 3D view as
  keys of its i18n (de/en patched in `tasks.ts`, other languages in `frontend/public/vendor/lang/<code>.json`, Russian included).
- Own 3D styles: `looks()` in `tasks.ts` patches `looks.ts`, `theme.ts`, `fold.ts`, `viewer3d.ts`, `panel.ts` and `i18n.ts`;
  code that is new goes to `frontend/vendor-ext/` and is imported by the patch, not into `src-www/`.
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
