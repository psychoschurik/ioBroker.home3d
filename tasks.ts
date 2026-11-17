/*!
 * ioBroker build tasks of home3d (Vite).
 *
 * The adapter has no backend: everything runs in the browser and is served by the web adapter from www/, which is
 * generated completely:
 *   npm run build          builds everything
 *   npm run build-app      only our page from frontend/ (vite.config.ts)   -> www/index.html, www/bridge.js, www/chunks/
 *   npm run build-vendor   only the 3D frontend from src-www/src  -> www/vendor/home3d*.js
 */
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build, type Plugin } from 'vite';

// The package is CommonJS (tests, scripts): Vite bundles its config, the native config loader is not used.
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true';

const posix = (p: string): string => p.replaceAll('\\', '/');
const root = posix(__dirname);
const src = `${root}/src-www/src`;
const www = `${root}/www`;
const version: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
export const TARGET = ['safari15', 'chrome94'];

function replaceRequired(text: string, pattern: string | RegExp, replacement: string, name: string): string {
    const next = text.replace(pattern, replacement);
    if (next === text) {
        throw new Error(`Upstream patch no longer matches: ${name}`);
    }
    return next;
}

/** Links of the upstream project lead to the local help page. Relative, because web serves the page under /home3d/. */
const localLinks = (text: string): string =>
    text
        .replace(/https?:\/\/(?:[a-z0-9-]+\.)*mastershort\.de/gi, 'help.html#guide')
        .replace(/https?:\/\/github\.com\/mastershort\/home3d/gi, 'help.html#project')
        .replace(/https?:\/\/discord\.gg\/SSdVVFsev7/gi, 'help.html#help');

/**
 * A button of a Pro add-on is shown only when the add-on is unlocked: in ioBroker there is no pack that unlocks it,
 * and where the backend part behind it is missing (camera pictures) a locked button (🔒) would only lead nowhere.
 * The add-ons this page serves itself are unlocked (see unlockServed). `anchor` is a unique text inside the button, `lock` the lock part of
 * its label, `open` what stays of it.
 */
function gateButton(code: string, anchor: string, lock: string, open: string, condition: string): string {
    const at = code.indexOf(anchor);
    if (at < 0 || code.indexOf(anchor, at + 1) >= 0) {
        throw new Error(`Upstream patch no longer matches: pro button ${anchor}`);
    }
    const start = code.lastIndexOf('<button', at);
    const end = code.indexOf('</button>', at) + '</button>'.length;
    const button = code.slice(start, end);
    if (start < 0 || end < at || !button.includes(lock)) {
        throw new Error(`Upstream patch no longer matches: lock of ${anchor}`);
    }
    return `${code.slice(0, start)}\${${condition} ? html\`${button.replace(lock, open)}\` : nothing}${code.slice(end)}`;
}

/**
 * The undo history of the editor survives the switch to the 3D view and back: the panel creates a new editor element
 * each time, so the history is kept per plan in frontend/vendor-ext/undo.ts.
 */
function keepUndoHistory(name: string, code: string): string {
    if (name !== 'components/editor.ts') {
        return code;
    }
    code = `import { keepUndo, takeUndo } from "${root}/frontend/vendor-ext/undo.ts";\n${code}`;
    code = replaceRequired(
        code,
        '  connectedCallback(): void {\n    super.connectedCallback();',
        '  connectedCallback(): void {\n    super.connectedCallback();\n    ({ past: this.past, future: this.future } = takeUndo(this.planId));\n    this._canUndo = this.past.length > 0;\n    this._canRedo = this.future.length > 0;',
        'take undo on entering',
    );
    code = replaceRequired(
        code,
        '  disconnectedCallback(): void {\n    super.disconnectedCallback();',
        '  disconnectedCallback(): void {\n    super.disconnectedCallback();\n    keepUndo(this.planId, { past: this.past, future: this.future });',
        'keep undo on leaving',
    );
    return replaceRequired(
        code,
        /( {4})\/\/ another floor plan: its own undo, its first floor, nothing selected\n {4}if \(changed\.has\("planId"\) && changed\.get\("planId"\) !== undefined\) \{\n {6}this\.past = \[\];\n {6}this\.future = \[\];\n {6}this\._canUndo = false;\n {6}this\._canRedo = false;\n/,
        `$1// another floor plan: its own undo (kept while the other plan or the 3D view is shown), its first floor, nothing selected
$1if (changed.has("planId")) {
$1  const before = changed.get("planId");
$1  if (before !== undefined) keepUndo(before, { past: this.past, future: this.future });
$1  ({ past: this.past, future: this.future } = takeUndo(this.planId));
$1  this._canUndo = this.past.length > 0;
$1  this._canRedo = this.future.length > 0;
$1}
$1if (changed.has("planId") && changed.get("planId") !== undefined) {
`,
        'undo per plan',
    );
}

/** Sensor markers with a symbol by what they report, the humidity next to the temperature (frontend/vendor-ext/sensor-look.ts). */
function sensorLook(name: string, code: string): string {
    if (name !== 'markers.ts') {
        return code;
    }
    code = `import { sensorIcon, sensorShow, sensorText } from "${root}/frontend/vendor-ext/sensor-look.ts";\n${code}`;
    code = replaceRequired(
        code,
        '        icon: pl.icon ? mdiIcon(pl.icon) : iconSvg(kind),',
        '        icon: pl.icon ? mdiIcon(pl.icon) : sensorIcon(st) ? mdiIcon(sensorIcon(st)!) : iconSvg(kind),',
        'sensor icon',
    );
    code = replaceRequired(
        code,
        '        text: stateText(hass, st),',
        '        text: sensorText(st, stateText(hass, st), hass.language),',
        'sensor text',
    );
    return replaceRequired(
        code,
        '        show: pl.marker ?? undefined,',
        '        show: pl.marker ?? sensorShow(st),',
        'sensor shown',
    );
}

/**
 * The editor's floor plan: devices get the symbols of the 3D view (a drop for water, flames for smoke …, see
 * sensor-look.ts), and a selected device hides the corners of its room as furniture does – on a deck that spans the
 * whole boat its corners lay over the sensors and took the next click.
 */
function editorDevices(name: string, code: string): string {
    if (name !== 'components/editor.ts') {
        return code;
    }
    code = `import { sensorPath } from "${root}/frontend/vendor-ext/sensor-look.ts";\n${code}`;
    code = replaceRequired(
        code,
        '        <path d=${iconPath(kind)} transform="translate(-7.2 -7.2) scale(0.6)" />',
        '        ${((p) => (p ? svg`<path class="fp3d-mdi" d=${p} transform="translate(-8.4 -8.4) scale(0.7)" />` : svg`<path d=${iconPath(kind)} transform="translate(-7.2 -7.2) scale(0.6)" />`))(sensorPath(pl.icon, this.hass?.states[pl.entity_id]))}',
        'editor device symbol',
    );
    code = replaceRequired(
        code,
        '      .fp3d-device-on path {\n        stroke: #2a1a00;\n      }',
        [
            '      .fp3d-device-on path {',
            '        stroke: #2a1a00;',
            '      }',
            '      .fp3d-device path.fp3d-mdi {',
            '        fill: var(--fp3d-text);',
            '        stroke: none;',
            '      }',
            '      .fp3d-device-on path.fp3d-mdi {',
            '        fill: #2a1a00;',
            '      }',
            '      .fp3d-sel-ring {',
            '        fill: rgba(55, 224, 255, 0.18);',
            '        stroke: var(--fp3d-accent);',
            '        stroke-width: 2;',
            '        pointer-events: none;',
            '        transform-box: fill-box;',
            '        transform-origin: center;',
            '        animation: fp3d-sel-pulse 1.4s ease-in-out infinite;',
            '      }',
            '      @keyframes fp3d-sel-pulse {',
            '        0%, 100% { opacity: 1; transform: scale(1); }',
            '        50% { opacity: 0.35; transform: scale(1.35); }',
            '      }',
        ].join('\n'),
        'editor device symbol style',
    );
    // the selected device: a pulsing ring, drawn above the devices next to it
    code = replaceRequired(
        code,
        'return svg`<g>${floor.placements.map((pl) => {',
        'return svg`<g>${[...floor.placements].sort((a, b) => Number(a.entity_id === this._deviceId) - Number(b.entity_id === this._deviceId)).map((pl) => {',
        'selected device on top',
    );
    code = replaceRequired(
        code,
        '<circle r="18" class="fp3d-hit" /><circle r="12" />',
        '${sel ? svg`<circle r="17" class="fp3d-sel-ring" />` : nothing}<circle r="18" class="fp3d-hit" /><circle r="12" />',
        'selected device ring',
    );
    return replaceRequired(
        code,
        '!this._openingId && !this._furnitureId && !this.isFixedItem("room", this.room.id) ? this.renderHandles(this.room)',
        '!this._openingId && !this._furnitureId && !this._deviceId && !this.isFixedItem("room", this.room.id) ? this.renderHandles(this.room)',
        'room corners under a device',
    );
}

/** The power of every solar field written on its modules (frontend/vendor-ext/solar-text.ts). */
function solarText(name: string, code: string): string {
    if (name === 'components/view3d.ts') {
        return replaceRequired(
            code,
            '    v.setSolarLevels(powers && !this.dimmed ? fieldLevels(b, powers) : new Map());',
            '    v.setSolarLevels(powers && !this.dimmed ? fieldLevels(b, powers) : new Map());\n    v.setSolarWatts(powers ?? new Map());',
            'solar watts',
        );
    }
    if (name !== 'viewer/viewer3d.ts') {
        return code;
    }
    code = `import { buildSolarText, writeSolarText } from "${root}/frontend/vendor-ext/solar-text.ts";\nimport { fieldModules as fp3dFieldModules } from "../solar.ts";\n${code}`;
    code = replaceRequired(
        code,
        '  private solarLevels = new Map<string, number>();',
        '  private solarLevels = new Map<string, number>();\n  private solarWatts = new Map<string, number>();\n  private solarTexts = new Set<Group>();',
        'solar text fields',
    );
    code = replaceRequired(
        code,
        '  setSolarLevels(levels: Map<string, number>): void {',
        [
            '  /** The power of every solar field (W), written on its modules. */',
            '  setSolarWatts(watts: Map<string, number>): void {',
            '    this.solarWatts = watts;',
            '    for (const g of [...this.solarTexts]) {',
            '      let p = g.parent;',
            '      while (p && p !== this.root) p = p.parent;',
            '      if (!p) this.solarTexts.delete(g);',
            '      else writeSolarText(g, watts);',
            '    }',
            '    this.invalidate();',
            '  }',
            '',
            '  setSolarLevels(levels: Map<string, number>): void {',
        ].join('\n'),
        'solar watts setter',
    );
    const fields =
        '.map(({ face, field }) => ({ id: field.id, corners: fp3dFieldModules(face, field).map((m) => m.corners), n: face.n }))';
    code = replaceRequired(
        code,
        '      const solarMesh = solarLive ? new Mesh(solarLive.geometry, materials.solarLive) : null;',
        `      const solarMesh = solarLive ? new Mesh(solarLive.geometry, materials.solarLive) : null;\n      const solarText = buildSolarText(garden${fields}, floor.elevation);\n      if (solarText) {\n        this.solarTexts.add(solarText);\n        writeSolarText(solarText, this.solarWatts);\n      }`,
        'solar text of the garden fields',
    );
    code = replaceRequired(
        code,
        '        ...(solarMesh ? [solarMesh] : []),',
        '        ...(solarMesh ? [solarMesh] : []),\n        ...(solarText ? [solarText] : []),',
        'solar text in the floor',
    );
    return replaceRequired(
        code,
        '        lives.push(overlay);\n        writeSolarLevels(overlay, this.solarLevels);\n      }',
        `        lives.push(overlay);\n        writeSolarLevels(overlay, this.solarLevels);\n      }\n      const roofText = buildSolarText(entries${fields}, geo.floor.elevation + geo.base);\n      if (roofText) {\n        this.solarTexts.add(roofText);\n        writeSolarText(roofText, this.solarWatts);\n        part.add(roofText);\n      }`,
        'solar text of the roof fields',
    );
}

/**
 * Add-ons whose backend this page brings: the weather (a `weather.*` device, e.g. a WMO code of open-meteo), the
 * time travel (`home3d/timetravel/history` from the history adapters, frontend/history.ts), the energy view
 * (`recorder/statistics_during_period` from the history adapters) and the household (appliances with their time left
 * and "finished", plants, fridge doors; the waste calendar needs `callApi`, which ioBroker has not, and stays empty).
 * Energy and household are called just "Energie" and "Haushalt", without "Pro".
 */
const SERVED = ['weather', 'time_travel', 'energy_pro', 'household'];

/** The served add-ons count as unlocked without a pack. */
function unlockServed(name: string, code: string): string {
    if (name !== 'features.ts') {
        return code;
    }
    return replaceRequired(
        code,
        '  const out = new Set<Feature>();',
        `  const out = new Set<Feature>(${JSON.stringify(SERVED)} as Feature[]);`,
        'served add-ons',
    );
}

/** Buttons of Pro add-ons that are not unlocked go (see gateButton). */
function proButtons(name: string, code: string): string {
    const camera = 'hasFeature("camera_cockpit")';
    if (name === 'panel.ts') {
        code = gateButton(code, 'aria-pressed=${this._trail}', `\${${camera} ? "" : "🔒 "}`, '', camera);
        code = gateButton(code, 'aria-pressed=${this._cameraWall}', `\${${camera} ? "" : "🔒 "}`, '', camera);
        code = gateButton(
            code,
            'aria-pressed=${this._weather}',
            '${hasFeature("weather") ? "" : "🔒 "}',
            '',
            'hasFeature("weather")',
        );
        code = gateButton(
            code,
            'class="fp3d-chip fp3d-tt-chip"',
            '${hasFeature("time_travel") ? "⏪" : "🔒"}',
            '⏪',
            'hasFeature("time_travel")',
        );
    }
    if (name === 'card.ts') {
        code = gateButton(
            code,
            'class="fp3d-chip fp3d-tt-chip"',
            '${hasFeature("time_travel") ? "⏪" : "🔒"}',
            '⏪',
            'hasFeature("time_travel")',
        );
    }
    if (name === 'components/room-panel.ts') {
        code = gateButton(code, 'class="fp3d-rp-look"', `\${${camera} ? "" : "🔒 "}`, '', camera);
    }
    if (name === 'components/quick-menu.ts') {
        code = gateButton(code, 'class="qm-details qm-look"', '${this.pro ? "" : "🔒 "}', '', 'this.pro');
    }
    return code;
}

/**
 * The position for the sun from a datapoint (GPS on a boat; frontend/datapoint.ts and bridge.ts): chosen in the
 * editor's house settings, shown from `hass.config.position_id`.
 */
function gpsPosition(name: string, code: string): string {
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '        <p class="fp3d-sub fp3d-wide">${this.t("north_entity_hint")}</p>\n',
            '        <p class="fp3d-sub fp3d-wide">${this.t("north_entity_hint")}</p>\n        <div class="fp3d-field fp3d-wide">\n          ${this.t("position_id")}\n          <p class="fp3d-sub fp3d-datapoint">\n            <code>${(this.hass?.config as { position_id?: string | null } | undefined)?.position_id || this.t("position_system")}</code>\n            <button class="fp3d-btn" ?disabled=${!this.isAdmin} @click=${() => window.dispatchEvent(new CustomEvent("iobroker-position", { detail: {} }))}>${this.t("datapoint_change")}</button>\n            ${(this.hass?.config as { position_id?: string | null } | undefined)?.position_id\n              ? html`<button class="fp3d-btn" ?disabled=${!this.isAdmin} @click=${() => window.dispatchEvent(new CustomEvent("iobroker-position", { detail: { clear: true } }))}>${this.t("position_use_system")}</button>`\n              : nothing}\n          </p>\n        </div>\n        <p class="fp3d-sub fp3d-wide">${this.t("position_id_hint")}</p>\n',
            'position datapoint',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  north_entity: "Kurs aus Kompass (Boot)",',
            '  north_entity: "Kurs aus Kompass (Boot)",\n  position_id: "Position (für den Sonnenstand)",\n  position_system: "aus den Systemeinstellungen",\n  position_use_system: "Systemposition nehmen",\n  position_id_hint: "Ein Datenpunkt mit der Position, z. B. das GPS eines Boots (\\"Länge;Breite\\" wie serial-gps, \\"Breite,Länge\\" oder {lat, lon}): Sonnenstand und Sonnenbogen folgen ihm. Gilt für alle Grundrisse.",',
            'position de',
        );
        code = replaceRequired(
            code,
            '  north_entity: "Heading from a compass (boat)",',
            '  north_entity: "Heading from a compass (boat)",\n  position_id: "Position (for the sun)",\n  position_system: "from the system settings",\n  position_use_system: "Use the system position",\n  position_id_hint: "A datapoint with the position, e.g. the GPS of a boat (\\"lon;lat\\" like serial-gps, \\"lat,lon\\" or {lat, lon}): the sun and its arc follow it. Counts for all floor plans.",',
            'position en',
        );
    }
    return code;
}

/**
 * `index.html?kiosk` for a wall tablet: without the header of the panel (plan, 3D/editor switch, ⚙), and the view
 * stays in 3D. The ioBroker header of the page goes by CSS (`.kiosk` in frontend/index.html and style.css).
 */
function kioskMode(name: string, code: string): string {
    if (name === 'panel.ts') {
        code = replaceRequired(
            code,
            '  private declare _clean: boolean;\n',
            '  private declare _clean: boolean;\n  /** `?kiosk` in the address: a wall tablet, without the header and without the editor. */\n  private readonly kiosk = new URLSearchParams(location.search).has("kiosk");\n',
            'kiosk flag',
        );
        code = replaceRequired(
            code,
            '${this._clean && this._mode === "view" ? nothing : html`<header class="fp3d-header">',
            '${(this._clean && this._mode === "view") || this.kiosk ? nothing : html`<header class="fp3d-header">',
            'kiosk header',
        );
        code = replaceRequired(
            code,
            '  private setMode(mode: Mode): void {\n',
            '  private setMode(mode: Mode): void {\n    // the switch is gone with the header; buttons of the view that lead to the editor do nothing\n    if (this.kiosk && mode !== "view") return;\n',
            'kiosk stays in 3D',
        );
    }
    if (name === 'components/editor.ts') {
        // the plan being edited, in a new tab as the wall tablet shows it
        code = replaceRequired(
            code,
            '        <button title=${this.t("fit_hint")} @click=${() => (close(), this.fit())}>${this.t("fit")}</button>\n      </div>\n',
            '        <button title=${this.t("fit_hint")} @click=${() => (close(), this.fit())}>${this.t("fit")}</button>\n      </div>\n      <div class="fp3d-seg fp3d-seg-menu">\n        <button title=${this.t("kiosk_open_hint")} @click=${() => (close(), window.open(`index.html?kiosk${this.planId ? `&plan=${encodeURIComponent(this.planId)}` : ""}`, "_blank", "noopener"))}>${this.t("kiosk_open")}</button>\n      </div>\n',
            'kiosk button',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  split_3d: "3D daneben",\n',
            '  split_3d: "3D daneben",\n  kiosk_open: "Kiosk ↗",\n  kiosk_open_hint: "Im Kiosk-Modus öffnen: dieser Plan in 3D ohne die oberen Leisten, in einem neuen Tab – für Wandtablets",\n',
            'kiosk de',
        );
        code = replaceRequired(
            code,
            '  split_3d: "3D beside",\n',
            '  split_3d: "3D beside",\n  kiosk_open: "Kiosk ↗",\n  kiosk_open_hint: "Open in kiosk mode: this plan in 3D without the bars at the top, in a new tab – for wall tablets",\n',
            'kiosk en',
        );
    }
    return code;
}

/**
 * A boat: the sea around it at the waterline, with the waves of a wave height and a wave length sensor
 * (frontend/vendor-ext/sea.ts). Set in the editor's house settings, below the heading and the position.
 */
function seaWaves(name: string, code: string): string {
    if (name === 'viewer/viewer3d.ts') {
        code = `import { buildSea as fp3dBuildSea, disposeSea as fp3dDisposeSea, seaKey as fp3dSeaKey, seaOutline as fp3dSeaOutline, type SeaParams as Fp3dSea } from "${root}/frontend/vendor-ext/sea.ts";\n${code}`;
        code = replaceRequired(
            code,
            "  /** Pool Pro: the pools' water colour, movement, heating shimmer and cover; an empty list clears them. */\n  setPools(",
            [
                '  /** A boat: the sea at its waterline (null: none). */',
                '  private fp3dSea: Fp3dSea | null = null;',
                '  private fp3dSeaMesh: Mesh | null = null;',
                '  private fp3dSeaBuilding: Building | null = null;',
                '  private fp3dSeaHull: [number, number][] = [];',
                '  /** The waves run: frames keep coming (the tablet level shows the sea at rest). */',
                '  private fp3dSeaMoving = false;',
                '',
                '  setSea(sea: Fp3dSea | null): void {',
                '    const sig = (s: Fp3dSea | null) => (s ? `${s.level.toFixed(2)}:${s.height.toFixed(2)}:${s.length.toFixed(1)}` : "");',
                '    if (sig(sea) === sig(this.fp3dSea)) return;',
                '    const had = !!this.fp3dSea;',
                '    this.fp3dSea = sea;',
                '    // the neon grid on the ground would show through the water',
                '    if (had !== !!sea) this.placeGround();',
                '    this.invalidate();',
                '  }',
                '',
                '  /** Builds the sea when the plan, the waves or the look changed, and keeps it at the waterline of its floor. */',
                '  private fp3dSeaFrame(): void {',
                '    const sea = this.fp3dSea;',
                '    const b = this.building;',
                '    const light = this.theme === "day" || this.style.natural;',
                '    if (sea && b && b !== this.fp3dSeaBuilding) {',
                '      this.fp3dSeaBuilding = b;',
                '      this.fp3dSeaHull = fp3dSeaOutline(b.floors.flatMap((f) => f.rooms.map((r) => r.points)), b.settings.wall_exterior);',
                '    }',
                '    const key = sea && b ? fp3dSeaKey(this.fp3dSeaHull, sea, light) : "";',
                '    if (this.fp3dSeaMesh && this.fp3dSeaMesh.userData.fp3dSea !== key) {',
                '      this.root.remove(this.fp3dSeaMesh);',
                '      fp3dDisposeSea(this.fp3dSeaMesh);',
                '      this.fp3dSeaMesh = null;',
                '    }',
                '    if (sea && b && !this.fp3dSeaMesh) {',
                '      this.fp3dSeaMesh = fp3dBuildSea(this.fp3dSeaHull, sea, this.flowTime, light);',
                '      if (this.fp3dSeaMesh) this.root.add(this.fp3dSeaMesh);',
                '    }',
                '    this.fp3dSeaMoving = !!this.fp3dSeaMesh && !!sea && sea.height > 0.005 && !this.lowQuality;',
                '    if (!this.fp3dSeaMesh || !sea) return;',
                '    // the water goes up and down with the floor it lies in (the floor below the waterline)',
                '    const ordered = [...this.floors].sort((p, q) => p.floor.elevation - q.floor.elevation);',
                '    const home = [...ordered].reverse().find((f) => f.floor.elevation <= sea.level) ?? ordered[0];',
                '    this.fp3dSeaMesh.position.y = sea.level + (home?.y ?? 0);',
                '  }',
                '',
                "  /** Pool Pro: the pools' water colour, movement, heating shimmer and cover; an empty list clears them. */",
                '  setPools(',
            ].join('\n'),
            'sea: setSea',
        );
        code = replaceRequired(
            code,
            '    this.placeFog();\n    if (this.firework) {',
            '    this.placeFog();\n    this.fp3dSeaFrame();\n    if (this.firework) {',
            'sea: every frame',
        );
        code = replaceRequired(
            code,
            '    const flowing = this.flowActive || this.solarActive || this.soundActive || this.poolActive;',
            '    const flowing = this.flowActive || this.solarActive || this.soundActive || this.poolActive || this.fp3dSeaMoving;',
            'sea: frames while the waves run',
        );
        code = replaceRequired(
            code,
            '    this.ground.visible = !box.isEmpty() && !this.lowQuality && this.theme !== "day" && !this.style.natural;',
            '    this.ground.visible = !box.isEmpty() && !this.lowQuality && this.theme !== "day" && !this.style.natural && !this.fp3dSea;',
            'sea: no grid under the water',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '    v.setHeading(Number.isFinite(fp3dCourse) ? fp3dCourse : null);\n',
            [
                '    v.setHeading(Number.isFinite(fp3dCourse) ? fp3dCourse : null);',
                '    // a boat: the sea at its waterline, with the waves of the sensors (a length in s is the period: deep water)',
                '    const fp3dNum = (id: string | null | undefined) => {',
                '      const st = id ? hass.states[id] : undefined;',
                '      const n = parseFloat(st?.state ?? "");',
                '      return Number.isFinite(n) ? { n, unit: String(st?.attributes.unit_of_measurement ?? "") } : null;',
                '    };',
                '    const fp3dWaveH = fp3dNum(b.settings.wave_height);',
                '    const fp3dWaveL = fp3dNum(b.settings.wave_length);',
                '    const fp3dLength = fp3dWaveL ? (fp3dWaveL.unit === "s" ? (9.81 * fp3dWaveL.n * fp3dWaveL.n) / (2 * Math.PI) : fp3dWaveL.n) : 0;',
                '    v.setSea(typeof b.settings.sea_level === "number" ? { level: b.settings.sea_level, height: Math.max(0, fp3dWaveH?.n ?? 0), length: Math.max(0, fp3dLength) } : null);',
                '',
            ].join('\n'),
            'sea from the sensors',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '        <p class="fp3d-sub fp3d-wide">${this.t("position_id_hint")}</p>\n',
            [
                '        <p class="fp3d-sub fp3d-wide">${this.t("position_id_hint")}</p>',
                '        <label class="fp3d-check fp3d-wide"',
                '          ><input type="checkbox" .checked=${typeof s.sea_level === "number"} ?disabled=${!this.isAdmin} @change=${(e: Event) => set({ sea_level: (e.target as HTMLInputElement).checked ? -1 : null })} />',
                '          ${this.t("sea_on")}</label',
                '        >',
                '        ${typeof s.sea_level === "number"',
                '          ? html`${this.num(this.t("sea_level"), s.sea_level, (v) => set({ sea_level: v }), 0.05)}',
                '              ${this.entitySelect(this.t("wave_height"), s.wave_height ?? null, undefined, this.entityOptions((id) => id.startsWith("sensor.")), (v) => set({ wave_height: v === "none" ? null : v }))}',
                '              ${this.entitySelect(this.t("wave_length"), s.wave_length ?? null, undefined, this.entityOptions((id) => id.startsWith("sensor.")), (v) => set({ wave_length: v === "none" ? null : v }))}',
                '              <p class="fp3d-sub fp3d-wide">${this.t("sea_hint")}</p>`',
                '          : nothing}',
                '',
            ].join('\n'),
            'sea settings',
        );
    }
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  north_entity?: string | null;',
            "  north_entity?: string | null;\n  /** A boat: the height of the water surface (m, like the floors' elevations); null: no sea. */\n  sea_level?: number | null;\n  /** The waves of the sea: sensors with the significant wave height (m) and the wave length (m; in s it is the period). */\n  wave_height?: string | null;\n  wave_length?: string | null;",
            'sea type',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  north_entity: "Kurs aus Kompass (Boot)",',
            '  north_entity: "Kurs aus Kompass (Boot)",\n  sea_on: "Meer um das Boot",\n  sea_level: "Wasserlinie (m)",\n  wave_height: "Wellenhöhe",\n  wave_length: "Wellenlänge",\n  sea_hint: "Die Wasserlinie ist die Höhe der Wasseroberfläche, gemessen wie die Höhe der Etagen (negativ = unter der Etage auf 0 m). Wellenhöhe: signifikante Höhe in m, vom Tal bis zum Kamm. Wellenlänge in m, oder die Periode in s. Die Wellen kommen von vorn: der Bug zeigt im Grundriss nach oben.",',
            'sea de',
        );
        code = replaceRequired(
            code,
            '  north_entity: "Heading from a compass (boat)",',
            '  north_entity: "Heading from a compass (boat)",\n  sea_on: "Sea around the boat",\n  sea_level: "Waterline (m)",\n  wave_height: "Wave height",\n  wave_length: "Wave length",\n  sea_hint: "The waterline is the height of the water surface, measured like the floors\' elevations (negative = below the floor at 0 m). Wave height: significant height in m, trough to crest. Wave length in m, or the period in s. The waves come from ahead: the bow points to the top of the plan.",',
            'sea en',
        );
    }
    return code;
}

/**
 * A boat turns: the heading of a compass sensor (`settings.north_entity`) turns the plan under the sky, so that sun,
 * shadow, sun patches and the compass ring follow it; `settings.north` stays a correction for the compass.
 */
function boatHeading(name: string, code: string): string {
    if (name === 'viewer/viewer3d.ts') {
        code = replaceRequired(
            code,
            '    const north = (this.building?.settings.north ?? 0) * DEG;\n    const az = (night ? sun.azimuth + 180 : sun.azimuth) * DEG;',
            '    const north = this.fp3dNorth() * DEG;\n    const az = (night ? sun.azimuth + 180 : sun.azimuth) * DEG;',
            'heading: sky disc',
        );
        code = replaceRequired(
            code,
            '    const north = (b?.settings.north ?? 0) * DEG;\n    const cloud = this.weather?.cloud ?? 0;\n    const shade',
            '    const north = this.fp3dNorth() * DEG;\n    const cloud = this.weather?.cloud ?? 0;\n    const shade',
            'heading: sun arc and shadow',
        );
        code = replaceRequired(
            code,
            '    const sun = this.building?.settings.sun_patches === false ? null : this.sun;\n    const north = (this.building?.settings.north ?? 0) * DEG;',
            '    const sun = this.building?.settings.sun_patches === false ? null : this.sun;\n    const north = this.fp3dNorth() * DEG;',
            'heading: sun patches',
        );
        code = replaceRequired(
            code,
            "  /** The sun's way across the sky today (null: no place known): drawn as an arc over the house. */\n  setSunPath(",
            "  /** The heading of a boat (° clockwise from north, from a compass sensor; null: none): the plan turns under the sky. */\n  private fp3dHeading: number | null = null;\n\n  /** Where north lies in the plan (° clockwise from up): the setting, turned back by the heading. */\n  private fp3dNorth(): number {\n    return (this.building?.settings.north ?? 0) - (this.fp3dHeading ?? 0);\n  }\n\n  setHeading(deg: number | null): void {\n    // whole degrees: the noise of the sensor rebuilds nothing\n    const next = deg === null || !Number.isFinite(deg) ? null : ((Math.round(deg) % 360) + 360) % 360;\n    if (next === this.fp3dHeading) return;\n    this.fp3dHeading = next;\n    for (const fv of this.floors) this.buildSun(fv);\n    this.placeSky();\n    this.buildSunFx();\n    this.invalidate();\n  }\n\n  /** The sun's way across the sky today (null: no place known): drawn as an arc over the house. */\n  setSunPath(",
            'heading: setHeading',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '    v.setSun(this.sunFx !== false && elevation !== null && typeof sun?.azimuth === "number" ? { elevation, azimuth: sun.azimuth } : null);\n',
            '    v.setSun(this.sunFx !== false && elevation !== null && typeof sun?.azimuth === "number" ? { elevation, azimuth: sun.azimuth } : null);\n    // a boat: north follows its compass\n    const fp3dCourse = b.settings.north_entity ? parseFloat(hass.states[b.settings.north_entity]?.state ?? "") : NaN;\n    v.setHeading(Number.isFinite(fp3dCourse) ? fp3dCourse : null);\n',
            'heading from the compass',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '        ${this.num(this.t("north"), s.north, (v) => set({ north: ((Math.round(v) % 360) + 360) % 360 }), 1)}\n',
            '        ${this.num(this.t("north"), s.north, (v) => set({ north: ((Math.round(v) % 360) + 360) % 360 }), 1)}\n        ${this.entitySelect(this.t("north_entity"), s.north_entity ?? null, undefined, this.entityOptions((id) => id.startsWith("sensor.")), (v) => set({ north_entity: v === "none" ? null : v }))}\n        <p class="fp3d-sub fp3d-wide">${this.t("north_entity_hint")}</p>\n',
            'heading sensor setting',
        );
    }
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  sun_arc?: "house" | "plot" | null;',
            '  sun_arc?: "house" | "plot" | null;\n  /** A compass (° clockwise from north): the plan turns under the sky with it, e.g. a boat (null: none). */\n  north_entity?: string | null;',
            'heading type',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  north_hint: "Die Nordrichtung braucht der Sonnenstand (Licht durch die Fenster).",',
            '  north_hint: "Die Nordrichtung braucht der Sonnenstand (Licht durch die Fenster).",\n  north_entity: "Kurs aus Kompass (Boot)",\n  north_entity_hint: "Ein Sensor mit dem Kurs in Grad (0 = Norden, im Uhrzeigersinn): Sonne, Schatten und Kompassring drehen sich mit. Die Nordrichtung oben gilt dann als Korrektur, wenn der Kompass nicht zum Bug zeigt (0 = Bug im Grundriss oben).",',
            'heading de',
        );
        code = replaceRequired(
            code,
            '  north_hint: "North is needed for the sun (light through the windows).",',
            '  north_hint: "North is needed for the sun (light through the windows).",\n  north_entity: "Heading from a compass (boat)",\n  north_entity_hint: "A sensor with the heading in degrees (0 = north, clockwise): the sun, the shadow and the compass ring turn with it. North above is then a correction for a compass that does not point to the bow (0 = bow at the top of the plan).",',
            'heading en',
        );
    }
    return code;
}

/**
 * The ioBroker datapoint is chosen at the device itself (frontend/datapoint.ts answers the events): the editor's device
 * form shows the datapoint with "Ändern …", the device list of a room has "+ Datenpunkt aus ioBroker" (new devices,
 * placed in the room).
 */
function deviceDatapoint(name: string, code: string): string {
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '    const auto = kind ? defaultHeight(kind, this.floor?.height ?? 2.5, light ? mount : null) : 1;\n    return html`<section>\n      <div class="fp3d-h3row"><h3>${this.t("device")}</h3>',
            [
                '    const auto = kind ? defaultHeight(kind, this.floor?.height ?? 2.5, light ? mount : null) : 1;',
                '    const fp3dDatapoint = this.hass?.states[pl.entity_id]?.attributes.iobroker_id as string | undefined;',
                '    return html`<section>',
                '      <div class="fp3d-h3row"><h3>${this.t("device")}</h3>',
            ].join('\n'),
            'datapoint of a device',
        );
        code = replaceRequired(
            code,
            '        ${entityName(this.hass, pl.entity_id)}\n      </p>\n      <div class="fp3d-form">',
            [
                '        ${entityName(this.hass, pl.entity_id)}',
                '      </p>',
                '      ${fp3dDatapoint',
                '        ? html`<p class="fp3d-sub fp3d-datapoint">',
                '            ${this.t("datapoint")}: <code>${fp3dDatapoint}</code>',
                '            ${admin',
                '              ? html`<button class="fp3d-btn" @click=${() => window.dispatchEvent(new CustomEvent("iobroker-datapoint", { detail: { entityId: pl.entity_id } }))}>${this.t("datapoint_change")}</button>`',
                '              : nothing}',
                '          </p>`',
                '        : nothing}',
                '      <div class="fp3d-form">',
            ].join('\n'),
            'change the datapoint of a device',
        );
        code = replaceRequired(
            code,
            '      <h3>${this.t("devices")}</h3>\n      <p class="fp3d-sub">${this.t("devices_panel_hint")}</p>\n',
            [
                '      <h3>${this.t("devices")}</h3>',
                '      <p class="fp3d-sub">${this.t("devices_panel_hint")}</p>',
                '      ${admin',
                '        ? html`<button class="fp3d-btn fp3d-wide-btn" @click=${() => window.dispatchEvent(new CustomEvent("iobroker-add-devices", { detail: { done: (ids: string[]) => this.placeDevices(ids, room) } }))}>${this.t("datapoint_add")}</button>`',
                '        : nothing}',
                '',
            ].join('\n'),
            'new devices from datapoints',
        );
        code = replaceRequired(
            code,
            '      .fp3d-dev-title {',
            '      .fp3d-datapoint {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 6px;\n      }\n      .fp3d-datapoint code {\n        overflow-wrap: anywhere;\n      }\n      .fp3d-dev-title {',
            'datapoint style',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  marker_height: "Höhe des Symbols (m)",',
            '  marker_height: "Höhe des Symbols (m)",\n  datapoint: "Datenpunkt",\n  datapoint_change: "Ändern …",\n  datapoint_add: "+ Datenpunkt aus ioBroker",',
            'datapoint de',
        );
        code = replaceRequired(
            code,
            '  marker_height: "Marker height (m)",',
            '  marker_height: "Marker height (m)",\n  datapoint: "Datapoint",\n  datapoint_change: "Change …",\n  datapoint_add: "+ Datapoint from ioBroker",',
            'datapoint en',
        );
    }
    return code;
}

/**
 * Editor and 3D view stay on the same floor: the floor being edited opens in 3D, and the editor opens on the floor shown
 * in 3D (in the house view on the floor edited last). Upstream each keeps its own, and the editor, made anew on every
 * switch, starts on the first floor of the list.
 */
function keepFloor(name: string, code: string): string {
    if (name === 'panel.ts') {
        code = replaceRequired(
            code,
            '  private pendingRoom: { plan: string; floorId: string | null; roomId: string | null } | null = null;',
            '  private pendingRoom: { plan: string; floorId: string | null; roomId: string | null } | null = null;\n  /** The floor last edited (the editor opens on it when the 3D view shows the whole house). */\n  private editorFloor: string | null = null;',
            'floor of the editor',
        );
        code = replaceRequired(
            code,
            '    if (mode === this._mode) return;\n    this.tt.stop();',
            [
                '    if (mode === this._mode) return;',
                '    const fp3dEditor = this.renderRoot.querySelector("fp3d-editor") as (HTMLElement & { _floorId?: string | null }) | null;',
                '    if (this._mode === "editor" && fp3dEditor?._floorId) {',
                '      this.editorFloor = fp3dEditor._floorId;',
                '      if (mode === "view" && (this.data.building?.floors.length ?? 0) > 1 && this._floorId !== this.editorFloor) {',
                '        this._floorId = this.editorFloor;',
                '        this._roomId = null;',
                '      }',
                '    }',
                '    if (mode === "editor" && this._floorId) this.editorFloor = this._floorId;',
                '    this.tt.stop();',
            ].join('\n'),
            'same floor in editor and 3D',
        );
        code = replaceRequired(
            code,
            '      .planId=${this.data.planId}\n',
            '      .planId=${this.data.planId}\n      .startFloor=${this.editorFloor}\n',
            'start floor of the editor',
        );
        // another floor plan: its own floors
        code = replaceRequired(
            code,
            '    prefs.set("plan", plan);\n    this._floorId = null;',
            '    prefs.set("plan", plan);\n    this._floorId = null;\n    this.editorFloor = null;',
            'floor of the editor on another plan',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '  private declare _floorId: string | null;',
            '  private declare _floorId: string | null;\n  /** The floor to open on (the one shown in 3D before), else the one of the house settings. */\n  startFloor: string | null = null;',
            'start floor field',
        );
        code = replaceRequired(
            code,
            '      const start = this._doc.settings.editor_floor;',
            '      const start = this.startFloor && this._doc.floors.some((f) => f.id === this.startFloor) ? this.startFloor : this._doc.settings.editor_floor;',
            'start floor',
        );
    }
    return code;
}

/**
 * The floor the sun's arc and its compass ring stand on (`settings.sun_arc_floor`, default the ground floor): on a boat
 * the deck is the ground floor, the ring may lie lower, e.g. at the waterline of the lower deck.
 */
function sunArcFloor(name: string, code: string): string {
    const select = (t: string, s: string, floors: string, set: string): string =>
        [
            `<label class="${s === 's' ? 'fp3d-field fp3d-wide' : 'fp3d-set-field'}" title=\${${t}("sun_arc_floor_hint")}`,
            `              >\${${t}("sun_arc_floor")}`,
            `              <select ${s === 'st' ? '?disabled=${!admin} ' : ''}@change=\${(e: Event) => ${set}({ sun_arc_floor: (e.target as HTMLSelectElement).value || null })}>`,
            `                <option value="" ?selected=\${!${s}.sun_arc_floor}>\${${t}("sun_arc_floor_ground")}</option>`,
            `                \${${floors}.map((f) => html\`<option value=\${f.id} ?selected=\${${s}.sun_arc_floor === f.id}>\${f.name}</option>\`)}`,
            '              </select></label',
            '            >',
        ].join('\n');
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  sun_arc?: "house" | "plot" | null;',
            '  sun_arc?: "house" | "plot" | null;\n  /** The floor the sun\'s arc and its compass ring stand on (null: the ground floor). */\n  sun_arc_floor?: string | null;',
            'sun arc floor type',
        );
    }
    if (name === 'viewer/sun-arc.ts') {
        code = replaceRequired(
            code,
            '  const gf = b ? groundFloor(b) : null;',
            '  const gf = b ? arcFloor(b) : null;',
            'sun arc floor',
        );
        code +=
            '\n/** The floor the arc stands on: the one chosen in the settings, else the ground floor. */\nexport function arcFloor(b: Building) {\n  const id = b.settings.sun_arc_floor;\n  return (id ? b.floors.find((f) => f.id === id) : undefined) ?? groundFloor(b);\n}\n';
    }
    if (name === 'viewer/viewer3d.ts') {
        code = replaceRequired(
            code,
            'import { sunArcFrame, type SunArcFrame } from "./sun-arc.ts";',
            'import { arcFloor, sunArcFrame, type SunArcFrame } from "./sun-arc.ts";',
            'sun arc floor import',
        );
        code = replaceRequired(
            code,
            '    const gf = groundFloor(this.building);\n    const fv = gf ? this.floorMap.get(gf.id) : undefined;\n    return fv?.y',
            '    const gf = arcFloor(this.building);\n    const fv = gf ? this.floorMap.get(gf.id) : undefined;\n    return fv?.y',
            'sun arc floor pulled apart',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '                <option value="plot" ?selected=${st.sun_arc === "plot"}>${t("sun_arc_plot")}</option>\n              </select></label\n            >`',
            `                <option value="plot" ?selected=\${st.sun_arc === "plot"}>\${t("sun_arc_plot")}</option>\n              </select></label\n            >${select(
                't',
                'st',
                'b.floors',
                'this.setPlanSettings',
            )}\``,
            'sun arc floor in the 3D settings',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '                <option value="plot" ?selected=${s.sun_arc === "plot"}>${this.t("sun_arc_plot")}</option>\n              </select></label\n            >`',
            `                <option value="plot" ?selected=\${s.sun_arc === "plot"}>\${this.t("sun_arc_plot")}</option>\n              </select></label\n            >${select(
                'this.t',
                's',
                'this._doc.floors',
                'set',
            )}\``,
            'sun arc floor in the editor',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  sun_arc_plot: "das ganze Grundstück",',
            '  sun_arc_plot: "das ganze Grundstück",\n  sun_arc_floor: "Sonnenbogen auf Höhe von",\n  sun_arc_floor_ground: "Erdgeschoss (Standard)",\n  sun_arc_floor_hint: "Auf welcher Etage Sonnenbogen und Kompassring stehen, z. B. auf einem Boot die Wasserlinie des Unterdecks statt des Decks.",',
            'sun arc floor de',
        );
        code = replaceRequired(
            code,
            '  sun_arc_plot: "the whole plot",',
            '  sun_arc_plot: "the whole plot",\n  sun_arc_floor: "Sun arc at the level of",\n  sun_arc_floor_ground: "Ground floor (default)",\n  sun_arc_floor_hint: "Which floor the sun arc and the compass ring stand on, e.g. on a boat the waterline of the lower deck instead of the deck.",',
            'sun arc floor en',
        );
    }
    return code;
}

/**
 * Own styles of the 3D view: "Puppenhaus" (see-through walls in their own colour), "Comic" (hard light steps, inked
 * outlines) and "Gouache" (painted). The screen-space part is frontend/vendor-ext/post.ts.
 */
function looks(name: string, code: string): string {
    if (name === 'looks.ts') {
        code = replaceRequired(
            code,
            '  /** The menu group. */',
            `  /** All walls see-through in their own colour, this opaque (0–1): a dollhouse. */
  glassWalls?: number;
  /** The light in this many hard steps instead of a soft fall-off (comic, natural materials). */
  toon?: number;
  /** More colour (negative: less), natural materials. */
  saturate?: number;
  /** The colour of the edges, natural materials. */
  line?: string;
  /** A look over the whole picture: inked outlines or painted. */
  post?: "toon" | "gouache";
  /** The menu group. */`,
            'style fields',
        );
        code = replaceRequired(
            code,
            '    aliases: ["warm", "holz", "papier", "holz und papier", "wood", "paper"],\n  },\n];',
            `    aliases: ["warm", "holz", "papier", "holz und papier", "wood", "paper"],
  },
  { id: "dollhouse", base: "day", group: "homely", natural: true, signal: true, shadows: true, floors: 1, sun: 0.5, ao: 0.5, glassWalls: 0.38, saturate: 0.12, bg: ["#f6efe6", "#ddd0bf"], aliases: ["puppenhaus", "puppenstube", "dollhouse", "glaswände", "durchsichtig"] },
  { id: "comic", base: "day", group: "designed", natural: true, signal: true, shadows: true, floors: 0.35, cutDark: true, sun: 0.6, ao: 0.25, toon: 3, saturate: 0.45, line: "#2a2420", post: "toon", bg: ["#fff8e6", "#ffe1b8"], aliases: ["comic", "zeichentrick", "trickfilm", "cartoon", "toon"] },
  { id: "gouache", base: "day", group: "designed", natural: true, signal: true, shadows: true, floors: 0.5, sun: 0.45, ao: 0.35, saturate: 0.3, line: "#8a6f58", post: "gouache", bg: ["#bfe3f2", "#f6e7cf"], aliases: ["gouache", "gemalt", "malerei", "aquarell", "painted", "watercolor"] },
];`,
            'own styles',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  style_warm: "Warm / Holz & Papier",',
            '  style_warm: "Warm / Holz & Papier",\n  style_dollhouse: "Puppenhaus",\n  style_comic: "Comic",\n  style_gouache: "Gouache",',
            'style names de',
        );
        code = replaceRequired(
            code,
            '  style_warm: "Warm / Wood & paper",',
            '  style_warm: "Warm / Wood & paper",\n  style_dollhouse: "Dollhouse",\n  style_comic: "Comic",\n  style_gouache: "Gouache",',
            'style names en',
        );
        // the energy view and the household are part of the adapter, not Pro add-ons
        code = code
            .replace('Was Energie und Energie Pro brauchen.', 'Was die Energie-Ansicht braucht.')
            .replace('What energy and Energy Pro need.', 'What the energy view needs.')
            .replaceAll(/ \((Energie|Energy|Haushalt|Household) Pro\)/g, '')
            .replaceAll(
                /"(Energie|Energy|Haushalt|Household) Pro: (\w)/g,
                (_, _name: string, c: string) => `"${c.toUpperCase()}`,
            )
            .replaceAll(/(Energie|Energy|Haushalt|Household) Pro\b/g, '$1');
    }
    if (name === 'viewer/theme.ts') {
        code = replaceRequired(
            code,
            '    uStFloors: { value: 0 },',
            '    uStFloors: { value: 0 },\n    uStToon: { value: 0 },\n    uStSat: { value: 0 },',
            'style uniforms',
        );
        code = replaceRequired(
            code,
            'u.uStLine.value.set(...hex3(s.base === "neon" ? "#4a4e56" : "#a3a7ad"));',
            'u.uStLine.value.set(...hex3(s.line ?? (s.base === "neon" ? "#4a4e56" : "#a3a7ad")));',
            'style line colour',
        );
        code = replaceRequired(
            code,
            '  u.uStFloors.value = s.natural ? (s.floors ?? 0) : 0;',
            '  u.uStFloors.value = s.natural ? (s.floors ?? 0) : 0;\n  u.uStToon.value = s.natural ? (s.toon ?? 0) : 0;\n  u.uStSat.value = s.natural ? (s.saturate ?? 0) : 0;',
            'style toon values',
        );
        code = replaceRequired(
            code,
            'uniform float uStFloors;',
            'uniform float uStFloors;\nuniform float uStToon;\nuniform float uStSat;',
            'style toon uniforms',
        );
        code = replaceRequired(
            code,
            '      cc *= fp3dStyleLight(n) * fp3dStyleFloor(cc, n);',
            `      if (uStSat != 0.0) cc = max(mix(vec3(dot(cc, vec3(0.299, 0.587, 0.114))), cc, 1.0 + uStSat), 0.0);
      float fp3dK = fp3dStyleLight(n);
      // comic: the light in a few hard steps
      if (uStToon > 0.5) fp3dK = 0.55 + 0.45 * floor(clamp((fp3dK - 0.55) / 0.45, 0.0, 1.0) * uStToon + 0.5) / uStToon;
      cc *= fp3dK * fp3dStyleFloor(cc, n);`,
            'style toon light',
        );
    }
    if (name === 'viewer/fold.ts') {
        code = replaceRequired(
            code,
            'export interface FoldMasks {\n  standing: FoldMask;\n  glass: FoldMask;\n}',
            `/** How glass walls look: tinted glass (own 0) or the wall's own colour, this opaque (own 1). */
export interface GlassLook {
  alpha: { value: number };
  own: { value: number };
}
const GLASS: GlassLook = { alpha: { value: 0.2 }, own: { value: 0 } };

export interface FoldMasks {
  standing: FoldMask;
  glass: FoldMask;
  look?: GlassLook;
}`,
            'glass look',
        );
        code = replaceRequired(
            code,
            '    shader.uniforms.uGlass = masks.glass;',
            '    shader.uniforms.uGlass = masks.glass;\n    shader.uniforms.uGlassAlpha = (masks.look ?? GLASS).alpha;\n    shader.uniforms.uGlassOwn = (masks.look ?? GLASS).own;',
            'glass uniforms',
        );
        code = replaceRequired(
            code,
            /shader\.fragmentShader = shader\.fragmentShader\.replace\(\s*"#include <color_fragment>",\s*`#include <color_fragment>\s*diffuseColor\.rgb = diffuseColor\.rgb \* 1\.7 \+ vec3\(0\.015, 0\.05, 0\.075\);\s*diffuseColor\.a \*= 0\.2;`,\s*\);/,
            `shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\\nuniform float uGlassAlpha;\\nuniform int uGlassOwn;")
        .replace(
          "#include <color_fragment>",
          \`#include <color_fragment>
        if (uGlassOwn == 1) {
          diffuseColor.rgb *= 0.94;
          diffuseColor.a *= uGlassAlpha;
        } else {
          diffuseColor.rgb = diffuseColor.rgb * 1.7 + vec3(0.015, 0.05, 0.075);
          diffuseColor.a *= 0.2;
        }\`,
        );`,
            'glass colour',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { PostFx } from "${root}/frontend/vendor-ext/post.ts";\n${code}`;
        code = replaceRequired(
            code,
            '  private style: StyleDef = styleById("neon")!;',
            '  private style: StyleDef = styleById("neon")!;\n  /** Inked outlines or the painted look over the whole picture (styles with `post`). */\n  private postFx = new PostFx();\n  /** Glass walls of this view: tinted, or see-through in their own colour (a dollhouse). */\n  private glassLook = { alpha: { value: 0.2 }, own: { value: 0 } };',
            'post and glass fields',
        );
        code = replaceRequired(
            code,
            'const mask: FoldMasks = { standing: { value: 0xffff }, glass: { value: 0 } };',
            'const mask: FoldMasks = { standing: { value: 0xffff }, glass: { value: 0 }, look: this.glassLook };',
            'glass look per view',
        );
        code = replaceRequired(
            code,
            '    applyStyleUniforms(style, this.themeUniform.style);',
            '    applyStyleUniforms(style, this.themeUniform.style);\n    this.glassLook.own.value = style.glassWalls ? 1 : 0;\n    this.glassLook.alpha.value = style.glassWalls ?? 0.2;',
            'glass look of the style',
        );
        code = replaceRequired(
            code,
            '        if (!cut && facing) glass |= 1 << b;',
            '        if ((!cut && facing) || this.style.glassWalls) glass |= 1 << b;',
            'glass walls of the style',
        );
        code = replaceRequired(
            code,
            '    this.renderer.render(this.scene, this.camera);\n    this.disposeRetired();',
            '    if (!this.postFx.render(this.renderer, this.scene, this.camera, this.style.post, this.lowQuality)) this.renderer.render(this.scene, this.camera);\n    this.disposeRetired();',
            'post render',
        );
        code = replaceRequired(
            code,
            '  dispose(): void {\n    this.projections.dispose();',
            '  dispose(): void {\n    this.projections.dispose();\n    this.postFx.dispose();',
            'post dispose',
        );
    }
    if (name === 'panel.ts') {
        // the looks right in the menu "Anzeige", not only behind ⚙
        code = replaceRequired(
            code,
            '          <div class="fp3d-seg" title=${this.t("plain_hint")}>',
            `          <div class="fp3d-seg" role="group" aria-label=\${this.t("style")}>
            \${["neon", "cozy", "dollhouse", "comic", "gouache"].map(
              (id) => html\`<button aria-pressed=\${this._theme === id} @click=\${() => {
                this._theme = id;
                prefs.set("theme", id);
              }}>\${this.t(\`style_\${id}\` as I18nKey)}</button>\`,
            )}
          </div>
          <div class="fp3d-seg" title=\${this.t("plain_hint")}>`,
            'looks in the menu',
        );
    }
    return code;
}

/** Applies the ioBroker theme and removes the shop, help and community parts of the upstream frontend. */
const patches: Plugin = {
    name: 'iobroker-ui',
    enforce: 'pre',
    async load(id) {
        const file = posix(id.split('?')[0]);
        if (!file.startsWith(`${src}/`) || !file.endsWith('.ts')) {
            return null;
        }
        let code = await readFile(file, 'utf8');
        const name = file.slice(src.length + 1);
        if (name === 'components/entity-picker.ts') {
            code = (await readFile(join(root, 'frontend/entity-picker.ts'), 'utf8')).replace(
                './picker-styles.js',
                '../styles.ts',
            );
        }
        if (name === 'styles.ts') {
            const colors: Record<string, string> = {
                '#070b14': '#18212b',
                '#0d1424': '#202c38',
                '#0f1729': '#263544',
                '#37e0ff': '#4aa4df',
                '#041018': '#ffffff',
                '#5b7cff': '#58a6d3',
                '#e6eefc': '#edf2f6',
                '#8a9bb8': '#a4b4c2',
                '#ffb547': '#f5a623',
                'rgba(14, 21, 38, 0.86)': 'rgba(38, 53, 68, 0.96)',
                'rgba(120, 170, 255, 0.16)': 'rgba(180, 200, 220, 0.20)',
                'rgba(55, 224, 255, 0.06)': 'rgba(74, 164, 223, 0.08)',
            };
            for (const [a, b] of Object.entries(colors)) {
                code = code.replaceAll(a, b);
            }
            code = code
                .replaceAll('border-radius: 999px;', 'border-radius: 5px;')
                .replaceAll(
                    '"Bricolage Grotesque", "Figtree", system-ui, sans-serif',
                    '"Segoe UI", Roboto, system-ui, sans-serif',
                )
                .replaceAll('0 8px 30px rgba(0, 0, 0, 0.5)', '0 3px 12px rgba(0, 0, 0, 0.22)');
        }
        if (name === 'panel.ts') {
            code = replaceRequired(
                code,
                /<button role="tab" class="fp3d-tab-ext"[\s\S]*?<\/button>/,
                '',
                'extensions tab',
            );
            code = replaceRequired(
                code,
                'private renderGift() {',
                'private renderGift() { return nothing; }\n  private unusedGift() {',
                'gift',
            );
            code = replaceRequired(
                code,
                'private renderExtensions() {',
                'private renderExtensions() { return html`<div class="fp3d-empty"><h2>ioBroker 3D Home</h2><p>Geräte werden über den Objektbaum verbunden.</p><a class="fp3d-btn" href="help.html" target="_blank">Lokale Hilfe öffnen</a></div>`; }\n  private unusedExtensions() {',
                'extensions page',
            );
        }
        if (name === 'components/editor.ts') {
            code = replaceRequired(
                code,
                /private renderHelpLinks\(\) \{[\s\S]*?\n {2}\}/,
                'private renderHelpLinks() { return html`<section class="fp3d-help"><h3>ioBroker</h3><p class="fp3d-sub">Geräte über den Objektbaum auswählen. Die Zuordnung verwendet deine ioBroker-Datenpunkt-IDs.</p><a class="fp3d-btn" href="help.html" target="_blank">Hilfe & Bedienung</a></section>`; }',
                'help',
            );
            code = replaceRequired(
                code,
                'private renderProCard() {',
                'private renderProCard() { return nothing; }\n  private unusedProCard() {',
                'pro teaser',
            );
            code = replaceRequired(
                code,
                'new URL("./images/solar-pro.jpg", import.meta.url)',
                'new URL(/* @vite-ignore */ "../assets/connected-home.svg", import.meta.url)',
                'shop picture',
            );
        }
        code = looks(name, code);
        code = unlockServed(name, code);
        code = proButtons(name, code);
        code = keepUndoHistory(name, code);
        code = sensorLook(name, code);
        code = editorDevices(name, code);
        code = solarText(name, code);
        code = sunArcFloor(name, code);
        code = keepFloor(name, code);
        code = deviceDatapoint(name, code);
        code = boatHeading(name, code);
        code = gpsPosition(name, code);
        code = kioskMode(name, code);
        code = seaWaves(name, code);
        if (name === 'viewer/viewer3d.ts') {
            // a pin made after the selection (e.g. when the 3D view beside the editor opens) is marked too
            code = replaceRequired(
                code,
                '        this.devicePins.set(key, pin);\n        this.labels.append(pin.el);',
                '        this.devicePins.set(key, pin);\n        this.labels.append(pin.el);\n        pin.el.classList.toggle("fp3d-dev-sel", d.id === this.selectedDevice);',
                'selected device of a new pin',
            );
        }
        if (name === 'components/view3d.ts') {
            // a TV shows the picture of its media player (e.g. the thumbnail of a YouTube video) and the app's colour:
            // only this part of the add-on "screens" (the rest needs its backend)
            code = replaceRequired(
                code,
                '          const live = hasFeature("screens");',
                '          const live = true;',
                'TV picture',
            );
            // the selected device in 3D: its frame pulses and it lies above the other symbols
            code = replaceRequired(
                code,
                '      .fp3d-dev-sel {\n        outline: 2px solid var(--fp3d-accent);\n        outline-offset: 2px;\n      }',
                [
                    '      .fp3d-dev-sel {',
                    '        outline: 3px solid var(--fp3d-accent);',
                    '        outline-offset: 2px;',
                    '        z-index: 10 !important;',
                    '        animation: fp3d-pin-pulse 1.4s ease-in-out infinite;',
                    '      }',
                    '      @keyframes fp3d-pin-pulse {',
                    '        0%, 100% { outline-offset: 2px; outline-color: var(--fp3d-accent); }',
                    '        50% { outline-offset: 7px; outline-color: rgba(55, 224, 255, 0.35); }',
                    '      }',
                ].join('\n'),
                'selected device in 3D',
            );
        }
        // Only human-readable names are changed, never protocol IDs.
        code = localLinks(code).replaceAll('Home Assistant', 'ioBroker');
        if (name === 'i18n.ts') {
            // the language files lie next to the bundle at runtime, not in the sources
            code = replaceRequired(code, 'new URL(`./lang/', 'new URL(/* @vite-ignore */ `./lang/', 'language files');
        }
        if (name === 'api.ts') {
            // a full backup restores the device mappings too (not part of the backup of the 3D frontend)
            code = replaceRequired(
                code,
                'return hass.callWS({ type: "home3d/backup/import", building, packs,',
                'return hass.callWS({ type: "home3d/backup/import", building, packs, mappings: (backup as { mappings?: unknown }).mappings,',
                'backup mappings',
            );
        }
        return code;
    },
};

/**
 * The 3D frontend: 8 bundles that load each other at runtime relative to import.meta.url. Each is built on its own
 * (dynamic imports inlined), so no bundle shares a chunk with another one, like the upstream build.
 */
async function buildVendor(): Promise<void> {
    const define: Record<string, string> = Object.fromEntries(
        ['VIEWER', 'EDITOR', 'CARD_EDITOR', 'TIMETRAVEL', 'FUN', 'VOICE', 'LOCATE', 'LANG'].map(k => [
            `__FP3D_${k}_HASH__`,
            JSON.stringify(`iobroker-${version}`),
        ]),
    );
    define.__FP3D_VERSION__ = JSON.stringify(version);
    const entries: Record<string, string> = {
        home3d: 'main.ts',
        'home3d-3d': 'viewer/viewer3d.ts',
        'home3d-editor': 'components/editor.ts',
        'home3d-card-editor': 'card-editor.ts',
        'home3d-timetravel': 'timetravel/entry.ts',
        'home3d-fun': 'fun/entry.ts',
        'home3d-voice': 'voice/entry.ts',
        'home3d-locate': 'locate/entry.ts',
    };
    await mkdir(`${www}/vendor`, { recursive: true });
    for (const [out, entry] of Object.entries(entries)) {
        await build({
            configFile: false,
            root,
            logLevel: 'warn',
            publicDir: false,
            define,
            plugins: [patches],
            build: {
                outDir: `${www}/vendor`,
                emptyOutDir: false,
                target: TARGET,
                minify: true,
                modulePreload: false,
                reportCompressedSize: false,
                chunkSizeWarningLimit: 5000,
                rolldownOptions: {
                    input: `${src}/${entry}`,
                    // the bundles are loaded by each other with import(): their exports must stay
                    preserveEntrySignatures: 'strict',
                    output: { format: 'es', entryFileNames: `${out}.js`, codeSplitting: false },
                },
            },
        });
    }
    // the language files are copied from frontend/public/vendor/lang by the app build
    const lang = `${www}/vendor/lang`;
    for (const file of await readdir(lang).catch(() => [] as string[])) {
        const target = `${lang}/${file}`;
        await writeFile(target, localLinks(await readFile(target, 'utf8')).replaceAll('Home Assistant', 'ioBroker'));
    }
    console.log(`3D frontend ${version}: ${Object.keys(entries).length} bundles built.`);
}

/** Our page (frontend/, vite.config.ts): the connection to ioBroker, the dialogs (React) and the static files. */
async function buildApp(): Promise<void> {
    // only the files of the app: the bundles of the 3D frontend in www/vendor stay
    for (const name of ['index.html', 'bridge.js', 'bridge.js.map', 'chunks']) {
        await rm(`${www}/${name}`, { recursive: true, force: true });
    }
    await build({ configFile: `${root}/vite.config.ts`, logLevel: 'warn' });
    console.log(`ioBroker page ${version}: www/index.html, www/bridge.js built.`);
}

async function main(): Promise<void> {
    if (process.argv.includes('--vendor')) {
        await buildVendor();
    } else if (process.argv.includes('--app')) {
        await buildApp();
    } else {
        // empty www/ (not the folder itself: on Windows an open window or shell in it would block that)
        for (const name of await readdir(www).catch(() => [] as string[])) {
            await rm(`${www}/${name}`, { recursive: true, force: true });
        }
        await buildApp();
        await buildVendor();
    }
}

main().catch((e: unknown) => {
    console.error(`Cannot build: ${(e as Error).message}`);
    process.exit(1);
});
