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

/**
 * Back from the 3D view, the editor shows what it showed before: the floor, the selection, the tool, zoom and pan,
 * the side bar with its scroll position, and the library's search and sections (frontend/vendor-ext/editor-keep.ts).
 */
function keepEditorView(name: string, code: string): string {
    const keep = `${root}/frontend/vendor-ext/editor-keep.ts`;
    if (name === 'components/editor.ts') {
        code = `import { keepEditor as fp3dKeepEditor, restoreScroll as fp3dRestoreScroll, takeEditor as fp3dTakeEditor } from "${keep}";\n${code}`;
        code = replaceRequired(
            code,
            '    window.addEventListener("keydown", this.onKey);\n    window.addEventListener("keyup", this.onShift);\n  }\n',
            [
                '    window.addEventListener("keydown", this.onKey);',
                '    window.addEventListener("keyup", this.onShift);',
                '    // what the last editor of this plan showed (left for the 3D view): floor, selection, tool, zoom, side bar',
                '    const fp3dKept = fp3dTakeEditor(this, this.planId);',
                '    if (fp3dKept) {',
                '      // a zoom or pan of its own stays: the plan is not fitted again',
                '      if (fp3dKept.view) this.fitted = true;',
                '      this.fp3dScroll = fp3dKept.scroll;',
                '      void this.updateComplete.then(() => fp3dRestoreScroll(this.renderRoot, "aside.fp3d-side", fp3dKept.scroll));',
                '    }',
                '    // a detached side bar reads 0: its position is noted while it scrolls',
                '    this.renderRoot.addEventListener("scroll", this.fp3dOnScroll, true);',
                '  }',
                '',
                '  /** The scroll positions of the side bars, kept for the next editor. */',
                '  private fp3dScroll: number[] = [];',
                '  private readonly fp3dOnScroll = (): void => {',
                '    this.fp3dScroll = [...this.renderRoot.querySelectorAll<HTMLElement>("aside.fp3d-side")].map((a) => a.scrollTop);',
                '  };',
                '',
            ].join('\n'),
            'editor view: take',
        );
        code = replaceRequired(
            code,
            '    this.resizeObserver?.disconnect();\n',
            [
                '    this.resizeObserver?.disconnect();',
                '    this.renderRoot.removeEventListener("scroll", this.fp3dOnScroll, true);',
                '    fp3dKeepEditor(this, this.planId, this.fp3dScroll, this.fitted && this._view !== this.fittedView);',
                '',
            ].join('\n'),
            'editor view: keep',
        );
    }
    if (name === 'components/library.ts') {
        code = `import { keepLibrary as fp3dKeepLibrary, takeLibrary as fp3dTakeLibrary } from "${keep}";\n${code}`;
        code = replaceRequired(
            code,
            '  disconnectedCallback(): void {\n    super.disconnectedCallback();\n    this.observer?.disconnect();\n',
            [
                '  connectedCallback(): void {',
                '    super.connectedCallback();',
                '    // the search, filters and open sections of the last library (the editor is created anew after the 3D view)',
                '    fp3dTakeLibrary(this);',
                '  }',
                '',
                '  disconnectedCallback(): void {',
                '    super.disconnectedCallback();',
                '    fp3dKeepLibrary(this);',
                '    this.observer?.disconnect();',
                '',
            ].join('\n'),
            'library view: keep',
        );
    }
    return code;
}

/**
 * A TV that plays nothing (YouTube while one looks for a video, when the cover of the last video may still be set)
 * shows the logo or the name of its app on the screen, so one sees which app it is in; while something plays or is
 * paused, its picture as before (frontend/vendor-ext/app-logo.ts).
 */
function tvAppLogo(name: string, code: string): string {
    if (name !== 'components/view3d.ts') {
        return code;
    }
    code = `import { screenPicture as fp3dScreenPicture } from "${root}/frontend/vendor-ext/app-logo.ts";\n${code}`;
    return replaceRequired(
        code,
        'const picture = live && kindOf(st.entity_id) === "media" ? ((st.attributes.entity_picture as string | undefined) ?? null) : null;',
        'const picture = live && kindOf(st.entity_id) === "media" && color ? fp3dScreenPicture(st, color) : null;',
        'TV: the app logo without a picture',
    );
}

/** The mouse wheel over a sensor, device or room label zooms the view like anywhere else on the stage. */
function wheelOverLabels(name: string, code: string): string {
    if (name !== 'components/view3d.ts') {
        return code;
    }
    return replaceRequired(
        code,
        'if (!(ev.target as Element | null)?.closest?.(".fp3d-holo")) return;',
        'if (!(ev.target as Element | null)?.closest?.(".fp3d-holo, .fp3d-labels")) return;',
        'wheel over the labels',
    );
}

/**
 * The editor's hint line says how to move the view: on a full plan every press hits something that would be dragged,
 * but the right (or middle) mouse button and two fingers always move the view.
 */
function panHint(name: string, code: string): string {
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            'this.t(`hint_${this._tool}` as I18nKey)}</p>',
            'this.t(`hint_${this._tool}` as I18nKey)}${floor && !this._fixedHint ? ` · ${this.t("hint_pan")}` : ""}</p>',
            'pan hint',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  hint_empty: "Lege zuerst eine Etage an.",',
            '  hint_empty: "Lege zuerst eine Etage an.",\n  hint_pan: "rechte Maustaste oder zwei Finger: Ansicht verschieben",',
            'pan hint de',
        );
        code = replaceRequired(
            code,
            '  hint_empty: "Add a floor first.",',
            '  hint_empty: "Add a floor first.",\n  hint_pan: "right mouse button or two fingers: move the view",',
            'pan hint en',
        );
    }
    return code;
}

/**
 * Per device: the colour of its marker while active (3D pin and the editor's floor plan) and a row of symbols to pick
 * from under "Eigenes Symbol" (sensor-look.ts: ICON_PICKS, markerInk).
 */
function markerLooks(name: string, code: string): string {
    const look = `${root}/frontend/vendor-ext/sensor-look.ts`;
    if (name === 'model.ts') {
        return replaceRequired(
            code,
            '  icon?: string | null;\n  /** An own name in the plan (null = the entity',
            '  icon?: string | null;\n  /** The colour of its marker while it is active ("#rrggbb"; null = the warm default). */\n  active_color?: string | null;\n  /** An own name in the plan (null = the entity',
            'active colour: model',
        );
    }
    if (name === 'markers.ts') {
        return replaceRequired(
            code,
            '        show: pl.marker ?? sensorShow(st),',
            '        show: pl.marker ?? sensorShow(st),\n        activeColor: pl.active_color || undefined,',
            'active colour: marker',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { markerInk as fp3dMarkerInk } from "${look}";\n${code}`;
        code = replaceRequired(
            code,
            '  glow: { color: [number, number, number]; level: number } | null;',
            '  glow: { color: [number, number, number]; level: number } | null;\n  /** The colour of the pin while active, chosen at the device (the glow of a light wins). */\n  activeColor?: string;',
            'active colour: marker type',
        );
        return replaceRequired(
            code,
            [
                '      const glow = d.glow ? `rgb(${d.glow.color.map((c) => Math.round(c * 255)).join(", ")})` : "";',
                '      if (pin.glow !== glow) {',
                '        pin.glow = glow;',
                '        if (glow) el.style.setProperty("--fp3d-glow", glow);',
                '        else el.style.removeProperty("--fp3d-glow");',
            ].join('\n'),
            [
                '      const own = d.glow ? null : fp3dMarkerInk(d.activeColor);',
                '      const glow = d.glow ? `rgb(${d.glow.color.map((c) => Math.round(c * 255)).join(", ")})` : own ? (d.activeColor as string) : "";',
                '      if (pin.glow !== glow) {',
                '        pin.glow = glow;',
                '        if (glow) el.style.setProperty("--fp3d-glow", glow);',
                '        else el.style.removeProperty("--fp3d-glow");',
                '        // the writing on an own colour: white on a dark one',
                '        if (own) el.style.setProperty("--fp3d-on-text", own);',
                '        else el.style.removeProperty("--fp3d-on-text");',
            ].join('\n'),
            'active colour: pin',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '      .fp3d-dev-on {\n        color: #2a1a00;',
            '      .fp3d-dev-on {\n        color: var(--fp3d-on-text, #2a1a00);',
            'active colour: pin ink',
        );
        return replaceRequired(
            code,
            '      .fp3d-dev-on .fp3d-dev-text {\n        color: #2a1a00;',
            '      .fp3d-dev-on .fp3d-dev-text {\n        color: var(--fp3d-on-text, #2a1a00);',
            'active colour: pin text',
        );
    }
    if (name !== 'components/editor.ts') {
        return code;
    }
    code = `import { ICON_PICKS as FP3D_ICON_PICKS, markerInk as fp3dMarkerInk } from "${look}";\n${code}`;
    // the floor plan: an active device in its own colour
    code = replaceRequired(
        code,
        '<g data-device=${pl.entity_id} class=${cls} transform="translate(${x} ${y})">',
        '<g data-device=${pl.entity_id} class=${cls} style=${fp3dMarkerInk(pl.active_color) ? `--fp3d-warm:${pl.active_color};--fp3d-on-text:${fp3dMarkerInk(pl.active_color)}` : ""} transform="translate(${x} ${y})">',
        'active colour: floor plan',
    );
    code = replaceRequired(
        code,
        '      .fp3d-device-on path {\n        stroke: #2a1a00;\n      }',
        '      .fp3d-device-on path {\n        stroke: var(--fp3d-on-text, #2a1a00);\n      }',
        'active colour: floor plan ink',
    );
    code = replaceRequired(
        code,
        '      .fp3d-device-on path.fp3d-mdi {\n        fill: #2a1a00;\n      }',
        [
            '      .fp3d-device-on path.fp3d-mdi {',
            '        fill: var(--fp3d-on-text, #2a1a00);',
            '      }',
            '      .fp3d-icon-picks {',
            '        display: flex;',
            '        flex-wrap: wrap;',
            '        gap: 4px;',
            '      }',
            '      .fp3d-icon-pick {',
            '        width: 30px;',
            '        height: 30px;',
            '        padding: 0;',
            '        display: grid;',
            '        place-items: center;',
            '        border-radius: 7px;',
            '        border: 1px solid rgba(127, 127, 127, 0.35);',
            '        background: transparent;',
            '        color: var(--fp3d-text);',
            '        cursor: pointer;',
            '        --mdc-icon-size: 18px;',
            '      }',
            '      .fp3d-icon-pick:hover:not(:disabled) {',
            '        border-color: var(--fp3d-accent);',
            '      }',
            '      .fp3d-icon-pick-on {',
            '        border-color: var(--fp3d-accent);',
            '        background: rgba(55, 224, 255, 0.18);',
            '      }',
            '      .fp3d-color-row input[type="color"] {',
            '        width: 52px;',
            '        height: 34px;',
            '        padding: 2px;',
            '        flex: none;',
            '      }',
        ].join('\n'),
        'active colour: editor styles',
    );
    code = replaceRequired(
        code,
        '        ${this.iconInput(pl.icon, (v) => this.updateDevice({ icon: v }))}',
        '        ${this.iconInput(pl.icon, (v) => this.updateDevice({ icon: v }))}\n        ${this.fp3dActiveColor(pl.active_color, (v) => this.updateDevice({ active_color: v }))}',
        'active colour: field',
    );
    return replaceRequired(
        code,
        '      </span></label\n    >`;\n  }\n\n  /** How the marker of a device or furniture item shows in 3D. */',
        [
            '      </span></label',
            '    >',
            '      <div class="fp3d-icon-picks fp3d-wide">',
            '        ${FP3D_ICON_PICKS.map((n) => html`<button type="button" class=${n === value?.replace(/^mdi:/, "") ? "fp3d-icon-pick fp3d-icon-pick-on" : "fp3d-icon-pick"} title=${n} ?disabled=${!this.isAdmin} @click=${() => onChange(n === value?.replace(/^mdi:/, "") ? null : n)}>${unsafeHTML(`<ha-icon icon="mdi:${n}"></ha-icon>`)}</button>`)}',
            '      </div>`;',
            '  }',
            '',
            '  /** The colour of a device marker while it is active (null: the warm default). */',
            '  private fp3dActiveColor(value: string | null | undefined, onChange: (v: string | null) => void) {',
            '    return html`<div class="fp3d-field fp3d-wide">',
            '      ${this.t("active_color" as I18nKey)}',
            '      <span class="fp3d-icon-row fp3d-color-row">',
            '        <input type="color" .value=${value ?? "#ffb547"} ?disabled=${!this.isAdmin} @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)} />',
            '        ${value ? html`<button type="button" class="fp3d-btn" ?disabled=${!this.isAdmin} @click=${() => onChange(null)}>${this.t("active_color_reset" as I18nKey)}</button>` : nothing}',
            '      </span>',
            '    </div>`;',
            '  }',
            '',
            '  /** How the marker of a device or furniture item shows in 3D. */',
        ].join('\n'),
        'icon picks',
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
            '      while (p && p !== this.root && p !== this.scene) p = p.parent;',
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
        code = `import { buildSea as fp3dBuildSea, disposeSea as fp3dDisposeSea, setSeaMotion as fp3dSetSeaMotion, seaKey as fp3dSeaKey, seaOutline as fp3dSeaOutline, type SeaParams as Fp3dSea } from "${root}/frontend/vendor-ext/sea.ts";\n${code}`;
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
                '  /** How far the water has streamed aft past a moving boat (m), and the clock at the last frame. */',
                '  private fp3dSeaDrift = 0;',
                '  private fp3dSeaClock = 0;',
                '',
                '  setSea(sea: Fp3dSea | null): void {',
                '    const sig = (s: Fp3dSea | null) => (s ? `${s.level.toFixed(2)}:${s.height.toFixed(2)}:${s.length.toFixed(1)}:${(s.speed ?? 0).toFixed(2)}` : "");',
                '    if (sig(sea) === sig(this.fp3dSea)) return;',
                '    const had = !!this.fp3dSea;',
                '    this.fp3dSea = sea;',
                '    // the neon grid on the ground would show through the water',
                '    if (had !== !!sea) this.placeGround();',
                '    // the arc of the sun stands on the water',
                '    if (this.sunFx) this.buildSunFx();',
                '    this.invalidate();',
                '  }',
                '',
                '  /** The height of the water surface in the scene: the waterline, moving with the floor it lies in (the one below it). */',
                '  private fp3dSeaY(): number | null {',
                '    const sea = this.fp3dSea;',
                '    if (!sea || !this.floors.length) return null;',
                '    const ordered = [...this.floors].sort((p, q) => p.floor.elevation - q.floor.elevation);',
                '    const home = [...ordered].reverse().find((f) => f.floor.elevation <= sea.level) ?? ordered[0];',
                '    return sea.level + home.y;',
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
                '    const fp3dSpeed = sea?.speed ?? 0;',
                '    this.fp3dSeaMoving = !!this.fp3dSeaMesh && !!sea && (sea.height > 0.005 || fp3dSpeed > 0.1) && !this.lowQuality;',
                '    // the water streams past at the speed (a jump of the clock, e.g. after a pause, moves it at most a second)',
                '    const fp3dNow = this.flowTime.value;',
                '    this.fp3dSeaDrift = (this.fp3dSeaDrift + fp3dSpeed * Math.min(1, Math.max(0, fp3dNow - this.fp3dSeaClock))) % 10000;',
                '    this.fp3dSeaClock = fp3dNow;',
                '    if (this.fp3dSeaMesh) {',
                '      this.fp3dSeaMesh.position.y = this.fp3dSeaY() ?? 0;',
                '      fp3dSetSeaMotion(this.fp3dSeaMesh, fp3dSpeed, this.fp3dSeaDrift);',
                '    }',
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
        code = replaceRequired(
            code,
            '    if (!frame || !this.building) return frame;\n',
            [
                '    if (!frame || !this.building) return frame;',
                '    // a boat on the sea: the arc and its compass ring stand on the water, not on a floor under it',
                '    const fp3dWater = this.fp3dSeaY();',
                '    if (fp3dWater !== null) return { ...frame, y: fp3dWater + 0.02 };',
                '',
            ].join('\n'),
            'sea: the sun arc on the water',
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
                '    // the speed through the water: knots unless the sensor says km/h or m/s',
                '    const fp3dSog = fp3dNum(b.settings.sea_speed);',
                '    const fp3dSpeed = !fp3dSog ? 0 : /^m\\/s$/i.test(fp3dSog.unit) ? fp3dSog.n : /km\\/h/i.test(fp3dSog.unit) ? fp3dSog.n / 3.6 : fp3dSog.n * 0.5144;',
                '    v.setSea(typeof b.settings.sea_level === "number" ? { level: b.settings.sea_level, height: Math.max(0, fp3dWaveH?.n ?? 0), length: Math.max(0, fp3dLength), speed: Math.min(30, Math.max(0, fp3dSpeed)) } : null);',
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
                '              ${this.entitySelect(this.t("sea_speed"), s.sea_speed ?? null, undefined, this.entityOptions((id) => id.startsWith("sensor.")), (v) => set({ sea_speed: v === "none" ? null : v }))}',
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
            "  north_entity?: string | null;\n  /** A boat: the height of the water surface (m, like the floors' elevations); null: no sea. */\n  sea_level?: number | null;\n  /** The waves of the sea: sensors with the significant wave height (m) and the wave length (m; in s it is the period). */\n  wave_height?: string | null;\n  wave_length?: string | null;\n  /** The speed through the water (kn, or km/h or m/s by the unit): the water streams past, with a bow wave and a wake. */\n  sea_speed?: string | null;",
            'sea type',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  north_entity: "Kurs aus Kompass (Boot)",',
            '  north_entity: "Kurs aus Kompass (Boot)",\n  sea_on: "Meer um das Boot",\n  sea_level: "Wasserlinie (m)",\n  wave_height: "Wellenhöhe",\n  wave_length: "Wellenlänge",\n  sea_speed: "Fahrt (Log oder SOG)",\n  sea_hint: "Die Wasserlinie ist die Höhe der Wasseroberfläche, gemessen wie die Höhe der Etagen (negativ = unter der Etage auf 0 m). Wellenhöhe: signifikante Höhe in m, vom Tal bis zum Kamm. Wellenlänge in m, oder die Periode in s. Die Wellen kommen von vorn: der Bug zeigt im Grundriss nach oben. Mit der Fahrt (kn, km/h oder m/s) strömt das Wasser am Rumpf vorbei, mit Bugwelle und Kielwasser. Sonnenbogen und Kompassring stehen dann auf dem Wasser.",',
            'sea de',
        );
        code = replaceRequired(
            code,
            '  north_entity: "Heading from a compass (boat)",',
            '  north_entity: "Heading from a compass (boat)",\n  sea_on: "Sea around the boat",\n  sea_level: "Waterline (m)",\n  wave_height: "Wave height",\n  wave_length: "Wave length",\n  sea_speed: "Speed (log or SOG)",\n  sea_hint: "The waterline is the height of the water surface, measured like the floors\' elevations (negative = below the floor at 0 m). Wave height: significant height in m, trough to crest. Wave length in m, or the period in s. The waves come from ahead: the bow points to the top of the plan. With the speed (kn, km/h or m/s) the water streams past the hull, with a bow wave and a wake. The sun arc and the compass ring then stand on the water.",',
            'sea en',
        );
    }
    return code;
}

/**
 * Where the time travel reads the past (editor's house settings, for all plans): automatically the history instance
 * that logs each datapoint, or one chosen instance (e.g. the recorder, which selects its datapoints itself) for the
 * datapoints it records. The list and the choice come from `hass.config`; the page saves it (`iobroker-timetravel`).
 */
function timeTravelSource(name: string, code: string): string {
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '              <p class="fp3d-sub fp3d-wide">${this.t("sea_hint")}</p>`\n          : nothing}\n',
            [
                '              <p class="fp3d-sub fp3d-wide">${this.t("sea_hint")}</p>`',
                '          : nothing}',
                '        ${((c: { history_instances?: string[]; timetravel_instance?: string | null }) => {',
                '          const list = [...new Set([...(c.history_instances ?? []), ...(c.timetravel_instance ? [c.timetravel_instance] : [])])];',
                '          return html`<label class="fp3d-field fp3d-wide"',
                '              >${this.t("timetravel_source")}',
                '              <select',
                '                ?disabled=${!this.isAdmin}',
                '                @change=${(e: Event) => window.dispatchEvent(new CustomEvent("iobroker-timetravel", { detail: { instance: (e.target as HTMLSelectElement).value || null } }))}',
                '              >',
                '                <option value="" ?selected=${!c.timetravel_instance}>${this.t("timetravel_auto")}</option>',
                '                ${list.map((i) => html`<option value=${i} ?selected=${c.timetravel_instance === i}>${i}</option>`)}',
                '              </select></label',
                '            >',
                '            <p class="fp3d-sub fp3d-wide">${this.t("timetravel_source_hint")}</p>`;',
                '        })((this.hass?.config ?? {}) as { history_instances?: string[]; timetravel_instance?: string | null })}',
                '',
            ].join('\n'),
            'time travel source',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  sea_on: "Meer um das Boot",',
            '  sea_on: "Meer um das Boot",\n  timetravel_source: "Verlauf liest aus",\n  timetravel_auto: "Automatisch (der Recorder, falls installiert, sonst der Verlauf, der den Datenpunkt aufzeichnet)",\n  timetravel_source_hint: "Z. B. recorder.0: Er zeichnet alle wichtigen Datenpunkte auf, ohne Einstellung je Datenpunkt, und liefert der Zeitreise alle auf einmal. Automatisch wird ein laufender Recorder genommen. Datenpunkte, die die gewählte Instanz nicht aufzeichnet, kommen weiter aus dem Verlauf, der sie aufzeichnet. Gilt für die Zeitreise, die Verlaufskurve der Geräte und die Energie-Ansicht aller Grundrisse.",',
            'time travel source de',
        );
        code = replaceRequired(
            code,
            '  sea_on: "Sea around the boat",',
            '  sea_on: "Sea around the boat",\n  timetravel_source: "History reads from",\n  timetravel_auto: "Automatic (the recorder if installed, else the history that logs the datapoint)",\n  timetravel_source_hint: "E.g. recorder.0: it records all relevant datapoints without a setting per datapoint and gives them to the time travel all at once. Automatically a running recorder is taken. Datapoints the chosen instance does not record still come from the history that logs them. Counts for the time travel, the history curve of the devices and the energy view of all floor plans.",',
            'time travel source en',
        );
    }
    return code;
}

/**
 * A boat's anchor: the furniture type "anchor", placed at the bow roller. With its sensors (chain counter, depth,
 * distance to the anchor, alarm radius, alarm) the viewer draws it stowed, hanging on the chain or on the seabed with
 * the chain as a catenary (`frontend/vendor-ext/anchor.ts`), a label with chain and depth and the alarm circle.
 */
function boatAnchor(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "water_heater",\n] as const;',
            '  "water_heater",\n  "anchor",\n] as const;',
            'anchor type',
        );
        code = replaceRequired(
            code,
            '  outdoor: ["awning"],',
            '  outdoor: ["awning", "anchor"],',
            'anchor in the library',
        );
        code = replaceRequired(
            code,
            '  mailbox: [0.38, 0.14, 0.34],',
            "  mailbox: [0.38, 0.14, 0.34],\n  // a boat's anchor at the bow roller (its length along the boat)\n  anchor: [0.36, 0.8, 0.3],",
            'anchor size',
        );
        code = replaceRequired(
            code,
            '  mailbox_door?: EntityRef;',
            [
                '  mailbox_door?: EntityRef;',
                "  /** A boat's anchor: the chain out (m, the chain counter), the depth below the waterline, the distance to the anchor, the alarm radius and the alarm. */",
                '  anchor_chain?: EntityRef;',
                '  anchor_depth?: EntityRef;',
                '  anchor_distance?: EntityRef;',
                '  anchor_radius?: EntityRef;',
                '  anchor_alarm?: EntityRef;',
            ].join('\n'),
            'anchor sensors',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  mailbox: ["household", ["garden", "hall"]],',
            '  mailbox: ["household", ["garden", "hall"]],\n  anchor: ["outdoor", []],',
            'anchor in the library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    default: {\n      const item = packItem(type);\n      return item ? packSymbol(item, w, d) : nothing;',
            [
                '    case "anchor": {',
                '      // an anchor seen from above: the ring at the front, the stock across it, the arms at the bow end (−z)',
                '      const r = Math.min(w / 2 - 0.03, 0.14);',
                '      const crown = -d / 2 + 0.06;',
                '      return [',
                '        line(0, crown, 0, d / 2 - 0.1, "fp3d-sym-strong"),',
                '        circle(0, d / 2 - 0.06, 0.04),',
                '        line(-r, d / 2 - 0.18, r, d / 2 - 0.18),',
                '        svg`<path class="fp3d-sym-strong" d=${`M ${-r} ${crown + r} A ${r} ${r} 0 0 1 ${r} ${crown + r}`} />`,',
                '      ];',
                '    }',
                '    default: {',
                '      const item = packItem(type);',
                '      return item ? packSymbol(item, w, d) : nothing;',
            ].join('\n'),
            'anchor symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "mailbox": {',
            '    case "anchor":\n      // a boat\'s anchor: the viewer draws it with its chain (at the roller, hanging or on the seabed)\n      return;\n    case "mailbox": {',
            'anchor not as furniture',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '"wifi_ap", "water_heater"]);',
            '"wifi_ap", "water_heater", "anchor"]);\n/** The anchor\'s sensors: measured values; its alarm: an on/off entity. */\nconst FP3D_SENSORS = (id: string) => id.startsWith("sensor.");\nconst FP3D_FLAGS = (id: string) => ["binary_sensor.", "input_boolean.", "switch."].some((d) => id.startsWith(d));',
            'anchor: no state links',
        );
        code = replaceRequired(
            code,
            '${f.type === "parking" ? this.renderParkingForm(f) : nothing}',
            '${f.type === "parking" ? this.renderParkingForm(f) : nothing} ${f.type === "anchor" ? this.fp3dRenderAnchorForm(f) : nothing}',
            'anchor form',
        );
        code = replaceRequired(
            code,
            '  /**\n   * Waste bin and mailbox: shape and colours for everyone;',
            [
                "  /** A boat's anchor: the sensors of the chain counter, the depth, the distance to the anchor and the alarm. */",
                '  private fp3dRenderAnchorForm(f: Furniture) {',
                '    const sensors = this.entityOptions(FP3D_SENSORS);',
                '    const pick = (key: "anchor_chain" | "anchor_depth" | "anchor_distance" | "anchor_radius") =>',
                '      this.entitySelect(this.t(key), f[key] ?? null, undefined, sensors, (v) => this.updateFurniture({ [key]: v === "none" ? null : v }));',
                '    return html`<div class="fp3d-form fp3d-links">',
                '      ${pick("anchor_chain")} ${pick("anchor_depth")} ${pick("anchor_distance")} ${pick("anchor_radius")}',
                '      ${this.entitySelect(this.t("anchor_alarm"), f.anchor_alarm ?? null, undefined, this.entityOptions(FP3D_FLAGS), (v) => this.updateFurniture({ anchor_alarm: v === "none" ? null : v }))}',
                '      <p class="fp3d-sub fp3d-wide">${this.t("anchor_hint")}</p>',
                '    </div>`;',
                '  }',
                '',
                '  /**',
                '   * Waste bin and mailbox: shape and colours for everyone;',
            ].join('\n'),
            'anchor form method',
        );
    }
    if (name === 'components/view3d.ts') {
        const sea =
            '    v.setSea(typeof b.settings.sea_level === "number" ? { level: b.settings.sea_level, height: Math.max(0, fp3dWaveH?.n ?? 0), length: Math.max(0, fp3dLength), speed: Math.min(30, Math.max(0, fp3dSpeed)) } : null);\n';
        code = replaceRequired(
            code,
            sea,
            [
                sea.trimEnd(),
                "    // a boat's anchors: stowed, hanging or on the seabed with their chain, from their sensors",
                '    const fp3dVal = (id: string | null | undefined) => (id && id !== "none" ? (fp3dNum(id)?.n ?? null) : null);',
                '    const fp3dM = (n: number) => `${formatNumber(hass, n, 1)} m`;',
                '    v.fp3dSetAnchors(',
                '      b.floors.flatMap((fl) =>',
                '        fl.furniture',
                '          .filter((f) => f.type === "anchor")',
                '          .map((f) => {',
                '            const chain = fp3dVal(f.anchor_chain);',
                '            const depth = fp3dVal(f.anchor_depth);',
                '            const alarm = !!f.anchor_alarm && f.anchor_alarm !== "none" && hass.states[f.anchor_alarm]?.state === "on";',
                '            const label =',
                '              chain === null',
                '                ? ""',
                '                : chain < 0.3',
                '                  ? `⚓ ${translate(hass, "anchor_stowed")}`',
                '                  : `⚓ ${translate(hass, "anchor_chain_short")} ${fp3dM(chain)}${depth !== null ? ` · ${translate(hass, "anchor_depth_short")} ${fp3dM(depth)}` : ""}`;',
                '            return { id: f.id, floor: fl.id, x: f.x, z: f.z, rotation: f.rotation, length: f.d, chain, depth, distance: fp3dVal(f.anchor_distance), radius: fp3dVal(f.anchor_radius), alarm, label };',
                '          }),',
                '      ),',
                '    );',
                '',
            ].join('\n'),
            'anchors from the sensors',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { anchorKey as fp3dAnchorKey, buildAnchor as fp3dBuildAnchor, disposeAnchor as fp3dDisposeAnchor, type AnchorState as Fp3dAnchor } from "${root}/frontend/vendor-ext/anchor.ts";\n${code}`;
        code = replaceRequired(
            code,
            "  /** Pool Pro: the pools' water colour, movement, heating shimmer and cover; an empty list clears them. */\n  setPools(",
            [
                "  /** A boat's anchors with their chains (see anchor.ts). */",
                '  private fp3dAnchors: Fp3dAnchor[] = [];',
                '  private fp3dAnchorGroup: Group | null = null;',
                '  private fp3dAnchorSig = "";',
                '',
                '  fp3dSetAnchors(list: Fp3dAnchor[]): void {',
                '    if (JSON.stringify(list) === JSON.stringify(this.fp3dAnchors)) return;',
                '    this.fp3dAnchors = list;',
                '    this.invalidate();',
                '  }',
                '',
                '  /** Builds the anchors anew when they or the height of their deck or of the water changed; hidden with their floor. */',
                '  private fp3dAnchorFrame(): void {',
                '    const light = this.theme === "day" || this.style.natural;',
                '    const parts: { a: Fp3dAnchor; scene: { deckY: number; waterY: number; light: boolean } }[] = [];',
                '    for (const a of this.fp3dAnchors) {',
                '      const fv = this.floorMap.get(a.floor);',
                '      if (!fv || !fv.group.visible || fv.o < 0.3) continue;',
                '      const deckY = fv.group.position.y;',
                '      // without the sea: the water a metre below the deck',
                '      parts.push({ a, scene: { deckY, waterY: this.fp3dSeaY() ?? deckY - 1, light } });',
                '    }',
                '    const sig = parts.map((p) => fp3dAnchorKey(p.a, p.scene)).join("|");',
                '    if (sig === this.fp3dAnchorSig) return;',
                '    this.fp3dAnchorSig = sig;',
                '    if (this.fp3dAnchorGroup) {',
                '      this.root.remove(this.fp3dAnchorGroup);',
                '      fp3dDisposeAnchor(this.fp3dAnchorGroup);',
                '      this.fp3dAnchorGroup = null;',
                '    }',
                '    if (!parts.length) return;',
                '    const g = new Group();',
                '    for (const p of parts) g.add(fp3dBuildAnchor(p.a, p.scene));',
                '    this.root.add(g);',
                '    this.fp3dAnchorGroup = g;',
                '  }',
                '',
                "  /** Pool Pro: the pools' water colour, movement, heating shimmer and cover; an empty list clears them. */",
                '  setPools(',
            ].join('\n'),
            'anchor: setAnchors',
        );
        code = replaceRequired(
            code,
            '    this.fp3dSeaFrame();\n',
            '    this.fp3dSeaFrame();\n    this.fp3dAnchorFrame();\n',
            'anchor: every frame',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  furn_mailbox: "Briefkasten",',
            [
                '  furn_mailbox: "Briefkasten",',
                '  furn_anchor: "Anker",',
                '  anchor_chain: "Kettenlänge (Kettenzähler, m)",',
                '  anchor_depth: "Wassertiefe (m)",',
                '  anchor_distance: "Abstand zum Anker (m, optional)",',
                '  anchor_radius: "Alarmradius (m, optional)",',
                '  anchor_alarm: "Ankeralarm (optional)",',
                '  anchor_hint: "Den Anker vorn auf den Bugbeschlag stellen: Ungedreht läuft die Kette im Grundriss nach oben, zum Bug. Unter 0,3 m Kette liegt er im Beschlag, sonst hängt er an der Kette oder liegt mit ihr auf dem Grund (Wassertiefe ab der Wasserlinie aus ⚙ → Haus → „Meer um das Boot“). Mit dem Abstand zum Anker (GPS) spannt sich die Kette entsprechend, sonst hängt sie etwas durch. Der Alarmradius erscheint als Kreis auf dem Wasser, rot bei Alarm.",',
                '  anchor_stowed: "Anker oben",',
                '  anchor_chain_short: "Kette",',
                '  anchor_depth_short: "Tiefe",',
            ].join('\n'),
            'anchor de',
        );
        code = replaceRequired(
            code,
            '  furn_mailbox: "Mailbox",',
            [
                '  furn_mailbox: "Mailbox",',
                '  furn_anchor: "Anchor",',
                '  anchor_chain: "Chain length (chain counter, m)",',
                '  anchor_depth: "Water depth (m)",',
                '  anchor_distance: "Distance to the anchor (m, optional)",',
                '  anchor_radius: "Alarm radius (m, optional)",',
                '  anchor_alarm: "Anchor alarm (optional)",',
                '  anchor_hint: "Put the anchor on the bow roller: unturned, the chain runs to the top of the plan, to the bow. Below 0.3 m of chain it sits in the roller, else it hangs on the chain or lies with it on the seabed (water depth from the waterline of ⚙ → House → \\"Sea around the boat\\"). With the distance to the anchor (GPS) the chain tightens accordingly, else it sags a little. The alarm radius shows as a circle on the water, red on alarm.",',
                '  anchor_stowed: "Anchor up",',
                '  anchor_chain_short: "Chain",',
                '  anchor_depth_short: "Depth",',
            ].join('\n'),
            'anchor en',
        );
    }
    return code;
}

/**
 * A boat's gear as furniture of the new library section "Boot" (with the anchor): a tank with the liquid at its level,
 * the rudder turned by the rudder angle, a sail drive whose propeller spins with the engine, navigation lights that
 * glow while their switch is on (at night with their reflection on the sea). Drawn by the viewer from the sensors
 * (`frontend/vendor-ext/boat-gear.ts`); the kinds and defaults are shared in `boat-kinds.ts`.
 */
function boatGear(name: string, code: string): string {
    const kinds = `${root}/frontend/vendor-ext/boat-kinds.ts`;
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "anchor",\n] as const;',
            '  "anchor",\n  "tank",\n  "hatch",\n  "rudder",\n  "propeller",\n  "nav_light",\n] as const;',
            'gear types',
        );
        code = replaceRequired(
            code,
            '  outdoor: ["awning", "anchor"],',
            '  outdoor: ["awning", "anchor", "tank", "hatch", "rudder", "propeller", "nav_light"],',
            'gear in the library',
        );
        code = replaceRequired(
            code,
            '  anchor: [0.36, 0.8, 0.3],',
            [
                '  anchor: [0.36, 0.8, 0.3],',
                '  // a boat: a tank, a rudder blade (thickness, chord, height), a sail drive (propeller, leg length, leg depth), a lantern',
                '  tank: [0.8, 0.5, 0.45],',
                '  rudder: [0.12, 0.55, 1],',
                '  propeller: [0.42, 0.35, 0.55],',
                '  nav_light: [0.14, 0.14, 0.1],',
                '  // a deck hatch: width, length, height of its frame',
                '  hatch: [0.6, 0.6, 0.06],',
            ].join('\n'),
            'gear sizes',
        );
        code = replaceRequired(
            code,
            '  anchor_alarm?: EntityRef;',
            [
                '  anchor_alarm?: EntityRef;',
                "  /** A boat's gear: its sensor (a tank's fill, the rudder angle, the engine speed, a light's switch), a tank's litres, what a tank holds or which light it is, a light's height above the floor, whether a mast carries it. */",
                '  gear_entity?: EntityRef;',
                '  gear_liters?: EntityRef;',
                '  gear_kind?: string | null;',
                '  gear_y?: number | null;',
                '  gear_mast?: boolean;',
                '  /** A hatch: how far it opens (°, default 70). */',
                '  gear_angle?: number | null;',
            ].join('\n'),
            'gear fields',
        );
    }
    if (name === 'alerts.ts') {
        // an open deck hatch in the rain: the warning of an open window, with the hatch's contact
        code = `import { hatchOpen as fp3dHatchOpen } from "${kinds}";\n${code}`;
        // a plan without areas (ioBroker): a smoke, gas or water sensor placed in a room warns for that room; the
        // house's rain sensor is no leak, even when it reports as a water sensor
        code = replaceRequired(
            code,
            '  const ids = Object.keys(hass.states);',
            [
                '  const known = new Set(rooms.flatMap((r) => r.sensors));',
                '  for (const floor of building.floors) {',
                '    for (const pl of floor.placements) {',
                '      const id = pl.entity_id;',
                '      if (known.has(id) || id === building.settings.rain_entity || !id.startsWith("binary_sensor.") || !CLASS_KIND[String(hass.states[id]?.attributes.device_class)]) continue;',
                '      const room = floor.rooms.find((r) => r.points.length >= 3 && pointInPolygon([pl.x, pl.z], r.points));',
                '      if (!room) continue;',
                '      known.add(id);',
                '      const at = rooms.find((r) => r.floorId === floor.id && r.roomId === room.id);',
                '      if (at) at.sensors.push(id);',
                '      else rooms.push({ floorId: floor.id, roomId: room.id, sensors: [id] });',
                '    }',
                '  }',
                '  const ids = Object.keys(hass.states);',
            ].join('\n'),
            'alerts: placed sensors',
        );
        code = replaceRequired(
            code,
            '  /** Haushalt Pro: the fridges with door sensors (their doors may not stand open too long). */',
            '  /** The contacts of the deck hatches (open in the rain: a warning). */\n  hatches?: string[];\n  /** Haushalt Pro: the fridges with door sensors (their doors may not stand open too long). */',
            'hatches: sources type',
        );
        code = replaceRequired(
            code,
            '  return { rooms, alarms: ids.filter((id) => id.startsWith("alarm_control_panel.")), weather, outage, rain, fridges };',
            [
                '  const hatches = building.floors.flatMap((fl) => fl.furniture.filter((f) => f.type === "hatch" && !!f.gear_entity && f.gear_entity !== "none").map((f) => f.gear_entity as string));',
                '  return { rooms, alarms: ids.filter((id) => id.startsWith("alarm_control_panel.")), weather, outage, rain, fridges, hatches };',
            ].join('\n'),
            'hatches: sources',
        );
        code = replaceRequired(
            code,
            '...(sources.fridges ?? []).flatMap((f) => f.ids)];',
            '...(sources.fridges ?? []).flatMap((f) => f.ids), ...(sources.hatches ?? [])];',
            'hatches: watched',
        );
        code = replaceRequired(
            code,
            [
                '        out.push({ kind: "window_rain", entity: link.contact ?? link.tilt ?? link.contact2 ?? o.id, roomId: o.room_id, floorId: floor.id });',
                '      }',
            ].join('\n'),
            [
                '        out.push({ kind: "window_rain", entity: link.contact ?? link.tilt ?? link.contact2 ?? o.id, roomId: o.room_id, floorId: floor.id });',
                '      }',
                '      for (const f of floor.furniture) {',
                '        if (f.type !== "hatch" || !f.gear_entity || f.gear_entity === "none" || !fp3dHatchOpen(hass.states[f.gear_entity]?.state)) continue;',
                '        const room = floor.rooms.find((r) => r.points.length >= 3 && pointInPolygon([f.x, f.z], r.points));',
                '        out.push({ kind: "window_rain", entity: f.gear_entity, roomId: room?.id ?? null, floorId: floor.id });',
                '      }',
            ].join('\n'),
            'hatches: open in the rain',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(code, '  "vehicle",\n  "stairs",', '  "vehicle",\n  "boat",\n  "stairs",', 'boat kind');
        code = replaceRequired(
            code,
            '  vehicle: "auto fahrzeug car vehicle",',
            '  vehicle: "auto fahrzeug car vehicle",\n  boat: "boot yacht schiff segeln boat ship sailing marine",',
            'boat words',
        );
        code = replaceRequired(
            code,
            '  anchor: ["outdoor", []],',
            '  anchor: ["boat", []],\n  tank: ["boat", []],\n  rudder: ["boat", []],\n  propeller: ["boat", []],\n  nav_light: ["boat", []],\n  hatch: ["boat", []],',
            'gear in the library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "anchor": {\n',
            [
                '    case "tank":',
                '      // a tank: its outline and the filler cap',
                '      return [rect(-w / 2 + 0.02, -d / 2 + 0.02, w / 2 - 0.02, d / 2 - 0.02, "fp3d-sym-strong"), circle(w / 2 - 0.1, -d / 2 + 0.1, 0.04)];',
                '    case "rudder":',
                '      // the blade from above: a slim profile, the stock near its front',
                '      return [ellipse(0, 0, Math.max(0.02, w / 3), d / 2 - 0.02, "fp3d-sym-strong"), circle(0, -d * 0.3, 0.025)];',
                '    case "propeller":',
                '      // the leg along the boat, the propeller across it at the back',
                '      return [',
                '        line(0, -d / 2 + 0.03, 0, d / 2 - 0.05, "fp3d-sym-strong"),',
                '        line(-w / 2 + 0.02, d / 2 - 0.05, w / 2 - 0.02, d / 2 - 0.05, "fp3d-sym-strong"),',
                '        circle(0, d / 2 - 0.05, 0.04),',
                '      ];',
                '    case "nav_light":',
                '      return [circle(0, 0, Math.max(0.02, Math.min(w, d) / 2 - 0.01), "fp3d-sym-strong"), circle(0, 0, 0.015)];',
                '    case "hatch":',
                '      // a deck hatch: its frame, the lid and the hinge along the front edge',
                '      return [',
                '        rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"),',
                '        rect(-w / 2 + 0.05, -d / 2 + 0.05, w / 2 - 0.05, d / 2 - 0.05),',
                '        line(-w / 2 + 0.06, -d / 2 + 0.025, w / 2 - 0.06, -d / 2 + 0.025, "fp3d-sym-strong"),',
                '      ];',
                '    case "anchor": {',
                '',
            ].join('\n'),
            'gear symbols',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "anchor":\n',
            '    case "tank":\n    case "rudder":\n    case "propeller":\n    case "nav_light":\n    case "hatch":\n    case "anchor":\n',
            'gear not as furniture',
        );
    }
    if (name === 'components/editor.ts') {
        code = `import { defaultLightY as fp3dLightY, HATCH_ANGLE as FP3D_HATCH_ANGLE, HATCH_KINDS as FP3D_HATCH_KINDS, isGear as fp3dIsGear, LIGHT_KINDS as FP3D_LIGHT_KINDS, TANK_KINDS as FP3D_TANK_KINDS } from "${kinds}";\n${code}`;
        code = replaceRequired(
            code,
            '"wifi_ap", "water_heater", "anchor"]);',
            '"wifi_ap", "water_heater", "anchor", "tank", "hatch", "rudder", "propeller", "nav_light"]);\n/** What switches a light of a boat. */\nconst FP3D_SWITCHES = (id: string) => ["switch.", "light.", "binary_sensor.", "input_boolean."].some((d) => id.startsWith(d));',
            'gear: no state links',
        );
        code = replaceRequired(
            code,
            '${f.type === "anchor" ? this.fp3dRenderAnchorForm(f) : nothing}',
            '${f.type === "anchor" ? this.fp3dRenderAnchorForm(f) : nothing} ${fp3dIsGear(f.type) ? this.fp3dRenderGearForm(f) : nothing}',
            'gear form',
        );
        code = replaceRequired(
            code,
            "  /** A boat's anchor: the sensors of the chain counter, the depth, the distance to the anchor and the alarm. */\n",
            [
                "  /** A boat's gear: what a tank holds and its sensors, the rudder angle, the engine speed, a navigation light. */",
                '  private fp3dRenderGearForm(f: Furniture) {',
                '    const tank = f.type === "tank";',
                '    const lamp = f.type === "nav_light";',
                '    const hatch = f.type === "hatch";',
                '    const kinds: readonly string[] | null = tank ? FP3D_TANK_KINDS : lamp ? FP3D_LIGHT_KINDS : hatch ? FP3D_HATCH_KINDS : null;',
                '    const kindKey = tank ? "tank" : lamp ? "light" : "hatch";',
                '    const kind = f.gear_kind ?? kinds?.[0] ?? null;',
                '    const pick = (key: "gear_entity" | "gear_liters", label: string, filter: (id: string) => boolean) =>',
                '      this.entitySelect(label, f[key] ?? null, undefined, this.entityOptions(filter), (v) => this.updateFurniture({ [key]: v === "none" ? null : v }));',
                '    return html`<div class="fp3d-form fp3d-links">',
                '      ${kinds',
                '        ? html`<label class="fp3d-field fp3d-wide"',
                '            >${this.t(`gear_${kindKey}_kind` as I18nKey)}',
                '            <select ?disabled=${!this.isAdmin} @change=${(e: Event) => this.updateFurniture({ gear_kind: (e.target as HTMLSelectElement).value })}>',
                '              ${kinds.map((k) => html`<option value=${k} ?selected=${k === kind}>${this.t(`gear_${kindKey}_${k}` as I18nKey)}</option>`)}',
                '            </select></label',
                '          >`',
                '        : nothing}',
                '      ${pick("gear_entity", this.t(`gear_entity_${f.type}` as I18nKey), lamp || hatch ? FP3D_SWITCHES : FP3D_SENSORS)}',
                '      ${hatch ? this.num(this.t("gear_angle" as I18nKey), f.gear_angle ?? FP3D_HATCH_ANGLE, (v) => this.updateFurniture({ gear_angle: Math.round(Math.min(110, Math.max(5, v))) }), 5, 5) : nothing}',
                '      ${tank ? pick("gear_liters", this.t("gear_liters"), FP3D_SENSORS) : nothing}',
                '      ${lamp',
                '        ? html`${this.num(this.t("gear_y"), f.gear_y ?? fp3dLightY(kind), (v) => this.updateFurniture({ gear_y: Math.round(Math.min(40, Math.max(0, v)) * 100) / 100 }), 0.1, 0)}',
                '            <label class="fp3d-check fp3d-wide"',
                '              ><input type="checkbox" ?disabled=${!this.isAdmin} .checked=${!!f.gear_mast} @change=${(e: Event) => this.updateFurniture({ gear_mast: (e.target as HTMLInputElement).checked || undefined })} />',
                '              ${this.t("gear_mast")}</label',
                '            >`',
                '        : nothing}',
                '      <p class="fp3d-sub fp3d-wide">${this.t(`gear_hint_${f.type}` as I18nKey)}</p>',
                '    </div>`;',
                '  }',
                '',
                "  /** A boat's anchor: the sensors of the chain counter, the depth, the distance to the anchor and the alarm. */",
                '',
            ].join('\n'),
            'gear form method',
        );
    }
    if (name === 'components/view3d.ts') {
        code = `import { HATCH_ANGLE as FP3D_HATCH_ANGLE, hatchOpen as fp3dHatchOpen, defaultLightY as fp3dLightY, isGear as fp3dIsGear, lightOn as fp3dLightOn, tankFill as fp3dTankFill, tankWarn as fp3dTankWarn, type GearType as Fp3dGearType } from "${kinds}";\n${code}`;
        code = replaceRequired(
            code,
            '    v.fp3dSetAnchors(\n',
            [
                '    // the gear of a boat: tanks, rudder, propeller and navigation lights from their sensors',
                '    const fp3dTr = (k: string) => translate(hass, k as I18nKey);',
                '    v.fp3dSetGear(',
                '      b.floors.flatMap((fl) =>',
                '        fl.furniture',
                '          .filter((f) => fp3dIsGear(f.type))',
                '          .map((f) => {',
                '            const ent = f.gear_entity && f.gear_entity !== "none" ? f.gear_entity : null;',
                '            const n = fp3dNum(ent);',
                '            const kind = f.gear_kind ?? (f.type === "tank" ? "water" : f.type === "nav_light" ? "anchor" : f.type === "hatch" ? "square" : null);',
                '            let value: number | null = null;',
                '            let label = "";',
                '            let warn = false;',
                '            if (f.type === "tank" && n) {',
                '              value = fp3dTankFill(n.n, n.unit);',
                '              const liters = fp3dVal(f.gear_liters);',
                '              label = `${fp3dTr(`gear_tank_${kind}`)} ${Math.round(value * 100)} %${liters !== null ? ` · ${formatNumber(hass, liters, 0)} l` : ""}`;',
                '              warn = fp3dTankWarn(kind, value);',
                '            } else if (f.type === "rudder" && n) {',
                '              value = n.n;',
                '              label = `${fp3dTr("gear_rudder_short")} ${formatNumber(hass, Math.abs(n.n), 0)}°${n.n > 0.5 ? ` ${fp3dTr("gear_stb")}` : n.n < -0.5 ? ` ${fp3dTr("gear_port")}` : ""}`;',
                '            } else if (f.type === "propeller" && n) {',
                '              value = Math.max(0, n.n);',
                '              label = value > 1 ? `${formatNumber(hass, value, 0)} ${fp3dTr("gear_rpm")}` : "";',
                '            } else if (f.type === "nav_light" && ent && hass.states[ent]) {',
                '              value = fp3dLightOn(hass.states[ent].state);',
                '            } else if (f.type === "hatch" && ent && hass.states[ent]) {',
                '              value = fp3dHatchOpen(hass.states[ent].state);',
                '              label = value ? fp3dTr("gear_hatch_open") : "";',
                '            }',
                '            const base = f.type === "nav_light" ? (f.gear_y ?? fp3dLightY(kind)) : f.type === "tank" ? (f.mount_y ?? 0) : 0;',
                '            return { id: f.id, floor: fl.id, type: f.type as Fp3dGearType, x: f.x, z: f.z, rotation: f.rotation, w: f.w, d: f.d, h: f.h, base, variant: kind, value, label, warn, mast: !!f.gear_mast, angle: f.gear_angle ?? FP3D_HATCH_ANGLE, entity: ent };',
                '          }),',
                '      ),',
                '    );',
                '    v.fp3dSetAnchors(',
                '',
            ].join('\n'),
            'gear from the sensors',
        );
        code = replaceRequired(
            code,
            '  private onDeviceHold(entityId: string, x: number, y: number): void {\n',
            [
                '  private onDeviceHold(entityId: string, x: number, y: number): void {',
                "    // a sensor's details (the gear of a boat): a long press opens them as a tap does",
                '    if (entityId.startsWith("detect:")) return this.onDeviceTap(entityId, x, y);',
                '',
            ].join('\n'),
            'hold on the gear of a boat',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { buildGear as fp3dBuildGear, disposeGear as fp3dDisposeGear, gearKey as fp3dGearKey, spinners as fp3dSpinners, type GearScene as Fp3dGearScene, type GearState as Fp3dGear } from "${root}/frontend/vendor-ext/boat-gear.ts";\n${code}`;
        code = replaceRequired(
            code,
            '  private pick(x: number, y: number, devices = true): { entity: string } | { floorId: string; roomId: string | null } | null {\n    const ray = this.rayAt(x, y);\n',
            [
                '  private pick(x: number, y: number, devices = true): { entity: string } | { floorId: string; roomId: string | null } | null {',
                '    const ray = this.rayAt(x, y);',
                '    // the gear of a boat lies apart (a tank is seen through berths and floors): a tap on it opens its sensor',
                '    // with its history ("detect:": the details, never switched)',
                '    if (devices && !this.furnish && this.fp3dGearGroup) {',
                '      for (const hit of ray.intersectObject(this.fp3dGearGroup, true)) {',
                '        let o: typeof hit.object | null = hit.object;',
                '        while (o && o.userData.fp3dGear === undefined) o = o.parent;',
                '        const id: unknown = o?.userData.fp3dGear;',
                '        const ent = this.fp3dGear.find((g) => g.id === id)?.entity;',
                '        if (ent) return { entity: `detect:${ent}` };',
                '      }',
                '    }',
                '',
            ].join('\n'),
            'tap on the gear of a boat',
        );
        code = replaceRequired(
            code,
            "  /** Pool Pro: the pools' water colour, movement, heating shimmer and cover; an empty list clears them. */\n  setPools(",
            [
                '  /** The gear of a boat: tanks, rudder, propeller, navigation lights (see boat-gear.ts). */',
                '  private fp3dGear: Fp3dGear[] = [];',
                '  private fp3dGearGroup: Group | null = null;',
                '  private fp3dGearSig = "";',
                '  private fp3dGearSpin: { part: { rotation: { z: number } }; rate: number }[] = [];',
                '  /** A propeller turns: frames keep coming. */',
                '  private fp3dGearMoving = false;',
                '',
                '  fp3dSetGear(list: Fp3dGear[]): void {',
                '    if (JSON.stringify(list) === JSON.stringify(this.fp3dGear)) return;',
                '    this.fp3dGear = list;',
                '    this.invalidate();',
                '  }',
                '',
                '  /** How dark it is for the lights: 0 by day, 1 at night (by the sun, else by the look). */',
                '  private fp3dNight(): number {',
                '    const e = this.sun?.elevation;',
                '    if (typeof e !== "number") return this.theme === "day" || this.style.natural ? 0.2 : 0.7;',
                '    return Math.min(1, Math.max(0, (4 - e) / 10));',
                '  }',
                '',
                '  /** Builds the gear anew when it, its floor, the water or the darkness changed; turns the propellers. */',
                '  private fp3dGearFrame(): void {',
                '    const light = this.theme === "day" || this.style.natural;',
                '    const night = this.fp3dNight();',
                '    const waterY = this.fp3dSeaY();',
                '    const parts: { g: Fp3dGear; scene: Fp3dGearScene }[] = [];',
                '    for (const g of this.fp3dGear) {',
                '      const fv = this.floorMap.get(g.floor);',
                '      if (!fv || !fv.group.visible || fv.o < 0.3) continue;',
                '      parts.push({ g, scene: { floorY: fv.group.position.y, waterY, light, night } });',
                '    }',
                '    const sig = parts.map((p) => fp3dGearKey(p.g, p.scene)).join("|");',
                '    if (sig !== this.fp3dGearSig) {',
                '      this.fp3dGearSig = sig;',
                '      if (this.fp3dGearGroup) {',
                '        this.root.remove(this.fp3dGearGroup);',
                '        fp3dDisposeGear(this.fp3dGearGroup);',
                '        this.fp3dGearGroup = null;',
                '      }',
                '      this.fp3dGearSpin = [];',
                '      if (parts.length) {',
                '        const g = new Group();',
                '        for (const p of parts) g.add(fp3dBuildGear(p.g, p.scene));',
                '        this.root.add(g);',
                '        this.fp3dGearGroup = g;',
                '        this.fp3dGearSpin = fp3dSpinners(g, parts.map((p) => p.g));',
                '      }',
                '    }',
                '    this.fp3dGearMoving = this.fp3dGearSpin.length > 0 && !this.lowQuality;',
                '    const t = this.flowTime.value;',
                '    for (const s of this.fp3dGearSpin) s.part.rotation.z = (t * s.rate * Math.PI * 2) % (Math.PI * 2);',
                '  }',
                '',
                "  /** Pool Pro: the pools' water colour, movement, heating shimmer and cover; an empty list clears them. */",
                '  setPools(',
            ].join('\n'),
            'gear: setGear',
        );
        code = replaceRequired(
            code,
            '    this.fp3dAnchorFrame();\n',
            '    this.fp3dAnchorFrame();\n    this.fp3dGearFrame();\n',
            'gear: every frame',
        );
        code = replaceRequired(
            code,
            '|| this.poolActive || this.fp3dSeaMoving;',
            '|| this.poolActive || this.fp3dSeaMoving || this.fp3dGearMoving;',
            'gear: frames while a propeller turns',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  furn_anchor: "Anker",',
            [
                '  furn_anchor: "Anker",',
                '  furn_tank: "Tank",',
                '  furn_rudder: "Ruder",',
                '  furn_propeller: "Antrieb mit Propeller",',
                '  furn_nav_light: "Positionslicht",',
                '  gear_tank_kind: "Inhalt",',
                '  gear_tank_water: "Frischwasser",',
                '  gear_tank_fuel: "Diesel",',
                '  gear_tank_gas: "Gas",',
                '  gear_tank_grey: "Grauwasser",',
                '  gear_tank_black: "Schwarzwasser",',
                '  gear_light_kind: "Licht",',
                '  gear_light_anchor: "Ankerlicht (Masttopp, weiß rundum)",',
                '  gear_light_steaming: "Dampferlicht (weiß, voraus)",',
                '  gear_light_port: "Backbord (rot)",',
                '  gear_light_starboard: "Steuerbord (grün)",',
                '  gear_light_bicolor: "Zweifarbenlaterne (Bug)",',
                '  gear_light_stern: "Hecklicht (weiß)",',
                '  gear_entity_tank: "Füllstand (% oder 0–1)",',
                '  gear_entity_rudder: "Ruderlage (°)",',
                '  gear_entity_propeller: "Motordrehzahl (U/min)",',
                '  gear_entity_nav_light: "Schalter",',
                '  gear_liters: "Inhalt in Litern (optional)",',
                '  gear_y: "Höhe über der Etage (m)",',
                '  gear_mast: "Mast bis zur Etage zeichnen",',
                '  gear_hint_tank: "Ein Glaskasten mit der Flüssigkeit bis zum Füllstand, in der Farbe des Inhalts (Gas als Flasche). Darüber stehen Inhalt, Füllstand und Liter, gelb, wenn ein Vorrat unter 15 % fällt oder Grau- oder Schwarzwasser über 85 % steigt.",',
                '  gear_hint_rudder: "Auf den Ruderschaft stellen (der Punkt im Symbol): Das Blatt hängt unter der Etage und dreht sich mit der Ruderlage, positiv = Steuerbord. Höhe = Höhe des Blatts, Tiefe = seine Breite.",',
                '  gear_hint_propeller: "Unter den Motor stellen: Saildrive-Bein mit Propeller unter der Etage, der sich bei laufendem Motor dreht. Breite = Durchmesser des Propellers, Höhe = Länge des Beins.",',
                '  gear_hint_nav_light: "Leuchtet, solange der Schalter an ist, nachts mit Lichthof und Spiegelung auf dem Meer. Die Zweifarbenlaterne ist rot nach Backbord und grün nach Steuerbord (ungedreht: Bug im Grundriss oben). Das Ankerlicht sitzt im Masttopp: Höhe angeben und den Mast zeichnen lassen, wenn der Grundriss keinen hat.",',
                '  gear_rudder_short: "Ruder",',
                '  gear_stb: "Stb",',
                '  gear_port: "Bb",',
                '  gear_rpm: "U/min",',
                '  furn_hatch: "Luke",',
                '  gear_hatch_kind: "Form",',
                '  gear_hatch_square: "Eckig (abgerundete Ecken)",',
                '  gear_hatch_round: "Rund",',
                '  gear_entity_hatch: "Kontakt (offen/zu)",',
                '  gear_angle: "Öffnungswinkel (°)",',
                '  gear_hatch_open: "Luke offen",',
                '  gear_hint_hatch: "Eine Decksluke mit getöntem Deckel, das Scharnier an der vorderen Kante (ungedreht: im Grundriss oben). Meldet der Kontakt offen, steht der Deckel im Öffnungswinkel auf zwei Gasfedern; regnet es dabei, kommt die Warnung „offen bei Regen“. Breite und Tiefe = Größe der Luke, Höhe = Höhe des Rahmens.",',
            ].join('\n'),
            'gear de',
        );
        code = replaceRequired(
            code,
            '  lib_kind_vehicle: "Fahrzeuge",',
            '  lib_kind_vehicle: "Fahrzeuge",\n  lib_kind_boat: "Boot",',
            'boat kind de',
        );
        code = replaceRequired(
            code,
            '  furn_anchor: "Anchor",',
            [
                '  furn_anchor: "Anchor",',
                '  furn_tank: "Tank",',
                '  furn_rudder: "Rudder",',
                '  furn_propeller: "Drive with propeller",',
                '  furn_nav_light: "Navigation light",',
                '  gear_tank_kind: "Contents",',
                '  gear_tank_water: "Fresh water",',
                '  gear_tank_fuel: "Diesel",',
                '  gear_tank_gas: "Gas",',
                '  gear_tank_grey: "Grey water",',
                '  gear_tank_black: "Black water",',
                '  gear_light_kind: "Light",',
                '  gear_light_anchor: "Anchor light (masthead, white all round)",',
                '  gear_light_steaming: "Steaming light (white, ahead)",',
                '  gear_light_port: "Port (red)",',
                '  gear_light_starboard: "Starboard (green)",',
                '  gear_light_bicolor: "Bicolour light (bow)",',
                '  gear_light_stern: "Stern light (white)",',
                '  gear_entity_tank: "Fill level (% or 0–1)",',
                '  gear_entity_rudder: "Rudder angle (°)",',
                '  gear_entity_propeller: "Engine speed (rpm)",',
                '  gear_entity_nav_light: "Switch",',
                '  gear_liters: "Contents in litres (optional)",',
                '  gear_y: "Height above the floor (m)",',
                '  gear_mast: "Draw a mast down to the floor",',
                '  gear_hint_tank: "A glass box with the liquid up to the fill level, in the colour of its contents (gas as a bottle). Above it: contents, fill level and litres, in yellow when a supply falls below 15 % or grey or black water rises above 85 %.",',
                '  gear_hint_rudder: "Put it on the rudder stock (the dot in the symbol): the blade hangs below the floor and turns with the rudder angle, positive = starboard. Height = height of the blade, depth = its chord.",',
                '  gear_hint_propeller: "Put it below the engine: a sail drive leg with its propeller below the floor, spinning while the engine runs. Width = diameter of the propeller, height = length of the leg.",',
                '  gear_hint_nav_light: "Glows while the switch is on, at night with a halo and its reflection on the sea. The bicolour light is red to port and green to starboard (unturned: bow at the top of the plan). The anchor light sits at the masthead: give its height and let the mast be drawn if the plan has none.",',
                '  gear_rudder_short: "Rudder",',
                '  gear_stb: "stbd",',
                '  gear_port: "port",',
                '  gear_rpm: "rpm",',
                '  furn_hatch: "Hatch",',
                '  gear_hatch_kind: "Shape",',
                '  gear_hatch_square: "Square (rounded corners)",',
                '  gear_hatch_round: "Round",',
                '  gear_entity_hatch: "Contact (open/shut)",',
                '  gear_angle: "Opening angle (°)",',
                '  gear_hatch_open: "Hatch open",',
                '  gear_hint_hatch: "A deck hatch with a smoked lid, hinged at its front edge (unturned: at the top of the plan). While the contact reports open the lid stands at its opening angle on two gas struts; if it rains meanwhile, the warning \\u201copen in the rain\\u201d comes. Width and depth = size of the hatch, height = height of its frame.",',
            ].join('\n'),
            'gear en',
        );
        code = replaceRequired(
            code,
            '  lib_kind_vehicle: "Vehicles",',
            '  lib_kind_vehicle: "Vehicles",\n  lib_kind_boat: "Boat",',
            'boat kind en',
        );
    }
    return code;
}

/**
 * Windows that open upwards: a top-hung window (and the new style "porthole", a rounded window or porthole) opens as
 * a flap as far as its own angle, outwards or into the room (`flap_angle`, `flap_in`); a porthole is drawn with a
 * rounded frame and sash (frontend/vendor-ext/porthole.ts).
 */
function upwardWindows(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            'export const WINDOW_STYLES = ["standard", "bars", "glass_wall", "slide"] as const;',
            'export const WINDOW_STYLES = ["standard", "bars", "glass_wall", "slide", "porthole"] as const;',
            'windows: porthole style',
        );
        code = replaceRequired(
            code,
            '  top_hung?: boolean;\n',
            [
                '  top_hung?: boolean;',
                '  /** A top-hung window or a porthole: how far its flap opens (°; default about 26°, a porthole 60°), and whether into the room. */',
                '  flap_angle?: number | null;',
                '  flap_in?: boolean;',
                '',
            ].join('\n'),
            'windows: flap fields',
        );
    }
    if (name === 'viewer/openings.ts') {
        code = `import { insetOutline as fp3dInset, pane as fp3dPane, plate as fp3dPlate, roundedOutline as fp3dRounded, type Pt as Fp3dPt } from "${root}/frontend/vendor-ext/porthole.ts";\n${code}`;
        code = replaceRequired(
            code,
            [
                '        const psi = topHung ? Math.max(sash.open, sash.tilt) * TOP_HUNG_ANGLE : 0;',
                '        // sash coordinates: u from the hinge across the sash, n, y',
                '        const sashTf: Tf = (u, n, y) => {',
                '          if (psi) {',
                '            const dn = n - n0;',
                '            const dt = y - sy1;',
                '            const x = sash.atStart ? sx0 + u : sx1 - u;',
                '            return tf(x, n0 + dn * Math.cos(psi) + dt * Math.sin(psi), sy1 - dn * Math.sin(psi) + dt * Math.cos(psi));',
                '          }',
            ].join('\n'),
            [
                '        // its own angle opens the flap that far (tilted at most the usual 26°), outwards or into the room',
                '        const flapMax = info.opening.flap_angle ? (Math.min(110, Math.max(5, info.opening.flap_angle)) * Math.PI) / 180 : TOP_HUNG_ANGLE;',
                '        const psi = topHung ? Math.max(sash.open * flapMax, sash.tilt * Math.min(flapMax, TOP_HUNG_ANGLE)) : 0;',
                '        // sash coordinates: u from the hinge across the sash, n, y',
                '        const sashTf: Tf = (u, n, y) => {',
                '          if (psi) {',
                '            const inward = !!info.opening.flap_in;',
                '            const pn = inward ? n1 : n0;',
                '            const g = inward ? 1 : -1;',
                '            const dn = n - pn;',
                '            const dt = y - sy1;',
                '            const x = sash.atStart ? sx0 + u : sx1 - u;',
                '            return tf(x, pn + dn * Math.cos(psi) - g * dt * Math.sin(psi), sy1 + dt * Math.cos(psi) + g * dn * Math.sin(psi));',
                '          }',
            ].join('\n'),
            'windows: flap angle and direction',
        );
        code = replaceRequired(
            code,
            [
                '    } else {',
                '      const fw = 0.06;',
                '      const fd = 0.035;',
                '      // fixed frame in the middle of the wall',
            ].join('\n'),
            [
                '    } else if (openingStyle(info.opening, info.exterior) === "porthole") {',
                '      // a porthole or rounded window: a plate with a rounded opening fills the frame; the sash, a rounded ring with',
                '      // its pane, sits in the opening and opens as a flap hinged at the top, outwards or into the room',
                '      const fd = 0.035;',
                '      const inset = Math.min(0.06, Math.min(W, T - S) * 0.12);',
                '      const hx0 = inset;',
                '      const hx1 = W - inset;',
                '      const hy0 = S + inset;',
                '      const hy1 = T - inset;',
                '      const put = (buf: GeoBuffer, col: Color, t: Tf, b: number) => (p: number[], q: number[], r: number[]) => {',
                '        const fold = Math.max(p[2], q[2], r[2]) <= cut + 1e-6 ? ALWAYS : b;',
                '        buf.tri(t(p[0], p[1], p[2]), t(q[0], q[1], q[2]), t(r[0], r[1], r[2]), col, col, col, undefined, fold);',
                '      };',
                '      const rect: Fp3dPt[] = [[0, S], [W, S], [W, T], [0, T]];',
                '      fp3dPlate(rect, fp3dRounded(hx0, hx1, hy0, hy1), mid - fd, mid + fd, put(frames, frameTop, tf, bucket), put(frames, frameC, tf, bucket), false);',
                '      const mode = info.opening.sill_board;',
                '      if (mode === "inside" || mode === "outside") boardsOf(info, infos, frames, tf, mid, fd, frameTop, cut, bucket);',
                '      const ajar = st.open > 0.02 || st.tilt > 0.02;',
                '      const alert = markClosed ? !!st.sensed && !ajar : ajar;',
                '      const sashC = alert ? shade(OPEN_WARM, 0.75) : new Color(OP.SASH);',
                '      const sashTop = alert ? shade(OPEN_WARM, 0.95) : frameTop;',
                '      const flap = (Math.min(110, Math.max(5, info.opening.flap_angle ?? 60)) * Math.PI) / 180;',
                '      const psi = Math.max(st.open * flap, st.tilt * Math.min(flap, TOP_HUNG_ANGLE));',
                '      const inward = !!info.opening.flap_in;',
                '      const pn = inward ? mid + fd : mid - fd;',
                '      const g = inward ? 1 : -1;',
                '      const c = Math.cos(psi);',
                '      const s = Math.sin(psi);',
                '      const stf: Tf = (x, n, y) => tf(x, pn + (n - pn) * c - g * (y - hy1) * s, hy1 + (y - hy1) * c + g * (n - pn) * s);',
                '      const sb = psi > 0.05 ? ALWAYS : bucket;',
                '      const gap = 0.004;',
                '      const rim = Math.min(0.04, Math.min(hx1 - hx0, hy1 - hy0) * 0.12);',
                '      const glassLine = fp3dInset(hx0, hx1, hy0, hy1, gap + rim);',
                '      fp3dPlate(fp3dInset(hx0, hx1, hy0, hy1, gap), glassLine, mid - fd + 0.005, mid + fd - 0.005, put(frames, sashTop, stf, sb), put(frames, sashC, stf, sb), true);',
                '      fp3dPane(glassLine, mid, put(glass, alert ? shade(OPEN_WARM, 0.16) : OP.GLASS, stf, sb));',
                '    } else {',
                '      const fw = 0.06;',
                '      const fd = 0.035;',
                '      // fixed frame in the middle of the wall',
            ].join('\n'),
            'windows: porthole',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            ['              ${this.t("top_hung")}</label', '            >`', '          : nothing}', ''].join('\n'),
            [
                '              ${this.t("top_hung")}</label',
                '            >`',
                '          : nothing}',
                '        ${window && (o.top_hung || o.style === "porthole")',
                '          ? html`${this.num(this.t("flap_angle" as I18nKey), o.flap_angle ?? (o.style === "porthole" ? 60 : 26), (v) => this.updateOpening({ flap_angle: Math.round(Math.min(110, Math.max(5, v))) }), 5, 5)}',
                '              <label class="fp3d-check fp3d-wide"',
                '                ><input type="checkbox" .checked=${!!o.flap_in} ?disabled=${!admin} @change=${(ev: Event) => this.updateOpening({ flap_in: (ev.target as HTMLInputElement).checked || undefined })} />',
                '                ${this.t("flap_in" as I18nKey)}</label',
                '              >`',
                '          : nothing}',
                '',
            ].join('\n'),
            'windows: flap fields',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  top_hung: "Klappfenster (oben angeschlagen, öffnet nach außen)",\n  top_hung_hint: "Das Fenster hängt oben und öffnet unten nach außen – offen und gekippt sehen gleich aus.",',
            '  top_hung: "Klappfenster (oben angeschlagen, öffnet nach oben)",\n  top_hung_hint: "Das Fenster hängt oben und klappt unten auf – nach außen oder nach innen, so weit wie sein Öffnungswinkel; gekippt höchstens etwa 26°.",\n  flap_angle: "Öffnungswinkel der Klappe (°)",\n  flap_in: "Klappe öffnet nach innen (sonst nach außen)",',
            'windows: flap de',
        );
        code = replaceRequired(
            code,
            '  top_hung: "Top-hung (opens outwards at the bottom)",\n  top_hung_hint: "The window hangs at the top and its bottom opens outwards – open and tilted look alike.",',
            '  top_hung: "Top-hung (opens upwards)",\n  top_hung_hint: "The window hangs at the top and its bottom swings open – outwards or into the room, as far as its opening angle; tilted at most about 26°.",\n  flap_angle: "Opening angle of the flap (°)",\n  flap_in: "Flap opens into the room (else outwards)",',
            'windows: flap en',
        );
        code = replaceRequired(
            code,
            '  style_slide: "Schiebe (eine Scheibe fährt vor die feste)",',
            '  style_slide: "Schiebe (eine Scheibe fährt vor die feste)",\n  style_porthole: "Bullauge / rund (Klappe nach oben)",',
            'windows: porthole de',
        );
        code = replaceRequired(
            code,
            '  style_slide: "Sliding (one pane slides in front of the fixed one)",',
            '  style_slide: "Sliding (one pane slides in front of the fixed one)",\n  style_porthole: "Porthole / rounded (flap opening upwards)",',
            'windows: porthole en',
        );
    }
    return code;
}

/**
 * The home beyond its devices (home-view.ts, home-fx.ts): air at open windows, mould in cold corners, a window open
 * while the room heats, the garden (mower, sprinklers, dry lawn), the price glow, weather warnings, the "Technik" and
 * "Bewegung" views, sound rings and running water.
 */
function homeMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            ['  "nav_light",', '  "wind_vane",', '] as const;'].join('\n'),
            [
                '  "nav_light",',
                '  "wind_vane",',
                '  "robot_mower",',
                '  "sprinkler",',
                '  "car_sedan",',
                '  "car_hatchback",',
                '  "car_van",',
                '] as const;',
            ].join('\n'),
            'home: furniture types',
        );
        code = replaceRequired(
            code,
            '"propeller", "nav_light", "wind_vane"],',
            '"propeller", "nav_light", "wind_vane", "robot_mower", "sprinkler"],',
            'home: library group',
        );
        code = replaceRequired(
            code,
            '  vehicles: ["parking"],',
            '  vehicles: ["parking", "car_sedan", "car_hatchback", "car_van"],',
            'home: cars in the library',
        );
        code = replaceRequired(
            code,
            '  wind_vane: [0.8, 0.8, 0.3],',
            [
                '  wind_vane: [0.8, 0.8, 0.3],',
                '  // a robot mower (its charging station stands where it is placed); a sprinkler: the circle it waters',
                '  robot_mower: [0.55, 0.65, 0.25],',
                '  sprinkler: [6, 6, 0.08],',
                '  // cars: width, length, height',
                '  car_sedan: [1.85, 4.75, 1.45],',
                '  car_hatchback: [1.8, 4.1, 1.5],',
                '  car_van: [2.05, 5.3, 2.3],',
            ].join('\n'),
            'home: sizes',
        );
        code = replaceRequired(
            code,
            '  moisture_min?: number | null;',
            [
                '  moisture_min?: number | null;',
                '  /** Shower, bathtub, basin: a sensor or valve that is on while water runs here (a flow above 0 counts). */',
                '  water?: string | null;',
                "  /** … or the house's water meter: water runs here while the meter counts. */",
                '  water_house?: boolean;',
                "  /** A car's colour (#rrggbb); its presence datapoint is `entity` (without one it is always there). */",
                '  car_color?: string | null;',
                "  /** A car's number plate (shown front and back). */",
                '  car_plate?: string | null;',
            ].join('\n'),
            'home: water link',
        );
        code = replaceRequired(
            code,
            '  pressure_entity?: string | null;',
            [
                '  pressure_entity?: string | null;',
                '  /** An official weather warning: its level (0 … 4, a severity or a colour) and headline (attributes). */',
                '  warning_entity?: string | null;',
                "  /** The electricity price (else the energy settings' tariff) and a forecast of the prices ahead (a JSON list). */",
                '  price_entity?: string | null;',
                '  price_forecast?: string | null;',
                "  /** The flow at the house's water meter (l/min); without one, how fast the water meter counts. */",
                '  water_flow?: string | null;',
                '  /** false: no air at open windows (and no mould, unless `mould` says otherwise). */',
                '  home_air?: boolean;',
                '  /** false: no mould in cold corners; missing: as `home_air`. */',
                '  mould?: boolean;',
                '  /** false: no price glow round the house. */',
                '  price_glow?: boolean;',
                '  /** false: in the "Technik" view rooms without a problem keep their colour (else green). */',
                '  health_green?: boolean;',
                '  /** true: the badges of devices with a low battery or out of reach show always, not only in the "Technik" view. */',
                '  health_badges?: boolean;',
            ].join('\n'),
            'home: settings',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  wind_vane: ["outdoor", []],',
            [
                '  wind_vane: ["outdoor", []],',
                '  robot_mower: ["outdoor", ["garden"]],',
                '  sprinkler: ["outdoor", ["garden"]],',
                '  car_sedan: ["vehicle", ["garage", "garden"]],',
                '  car_hatchback: ["vehicle", ["garage", "garden"]],',
                '  car_van: ["vehicle", ["garage", "garden"]],',
            ].join('\n'),
            'home: library index',
        );
    }
    if (name === 'heatmap.ts') {
        code = replaceRequired(
            code,
            'export type HeatMode = "none" | "temperature" | "humidity" | "co2" | "values";',
            'export type HeatMode = "none" | "temperature" | "humidity" | "co2" | "values" | "health" | "motion";',
            'home: views',
        );
        code = replaceRequired(
            code,
            'export type HeatColorMode = Exclude<HeatMode, "none" | "values">;',
            'export type HeatColorMode = Exclude<HeatMode, "none" | "values" | "health" | "motion">;',
            'home: views without colour scale',
        );
    }
    if (name === 'panel.ts') {
        code = replaceRequired(
            code,
            '    this._heat = heat === "temperature" || heat === "humidity" || heat === "co2" || heat === "values" ? heat : "none";',
            '    this._heat = heat === "temperature" || heat === "humidity" || heat === "co2" || heat === "values" || heat === "health" || heat === "motion" ? heat : "none";',
            'home: views kept',
        );
        code = replaceRequired(
            code,
            '            ${(["none", "temperature", "humidity", "co2", "values"] as HeatMode[]).map(',
            '            ${(["none", "temperature", "humidity", "co2", "values", "health", "motion"] as HeatMode[]).map(',
            'home: view buttons',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            ['    case "wind_vane":', '      // a wind indicator: its post and an arrow'].join('\n'),
            [
                '    case "car_sedan":',
                '    case "car_hatchback":',
                '    case "car_van": {',
                '      // a car from above: its body, the cabin (the van: the whole box behind the bonnet) and the wheels',
                '      const cab = type === "car_van" ? [-d / 2 + d * 0.2, d / 2 - 0.05] : type === "car_sedan" ? [-d * 0.12, d * 0.25] : [-d * 0.08, d / 2 - 0.12];',
                '      const wz = d / 2 - Math.max(0.55, d * 0.17);',
                '      return [',
                '        rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"),',
                '        rect(-w * 0.4, cab[0], w * 0.4, cab[1]),',
                '        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => rect(sx * w * 0.5 - 0.06, sz * wz - 0.3, sx * w * 0.5 + 0.06, sz * wz + 0.3, "fp3d-sym-fill"))),',
                '      ];',
                '    }',
                '    case "robot_mower":',
                "      // a robot mower in its station: the body, the wheels' axle and the cutter",
                '      return [rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"), line(-w / 2, d / 4, w / 2, d / 4), circle(0, -d / 8, Math.min(w, d) / 5)];',
                '    case "sprinkler":',
                '      // a sprinkler: its head and the circle it waters',
                '      return [circle(0, 0, Math.min(w, d) / 2), circle(0, 0, 0.06, "fp3d-sym-strong"), line(0, 0, w / 2.9, -d / 2.9)];',
                '    case "wind_vane":',
                '      // a wind indicator: its post and an arrow',
            ].join('\n'),
            'home: symbols',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            ['    case "wind_vane":', '    case "tank":'].join('\n'),
            [
                '    case "car_sedan":',
                '    case "car_hatchback":',
                '    case "car_van":',
                '    case "robot_mower":',
                '    case "sprinkler":',
                '    case "wind_vane":',
                '    case "tank":',
            ].join('\n'),
            'home: drawn by the home looks',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { HomeFx as Fp3dHomeFx, type FloorPlace as Fp3dFloorPlace, type HomeScene as Fp3dHomeScene } from "${root}/frontend/vendor-ext/home-fx.ts";\n${code}`;
        code = replaceRequired(
            code,
            [
                "  /** Pool Pro: the pools' water colour, movement, heating shimmer and cover; an empty list clears them. */",
                '  setPools(',
            ].join('\n'),
            [
                '  /** The home looks (home-fx.ts): air at windows, mould, water, sound, the lawn, the price glow, device badges. */',
                '  private fp3dHome = new Fp3dHomeFx();',
                '  /** Tooltips of the room pins ("Technik": the devices of the room). */',
                '  private fp3dRoomTips = new Map<string, string>();',
                '  fp3dSetRoomTips(tips: Map<string, string>): void {',
                '    this.fp3dRoomTips = tips;',
                '    for (const fv of this.floors) for (const rp of fv.roomPins) this.fp3dRoomTip(rp.pin);',
                '  }',
                '  private fp3dRoomTip(pin: HTMLElement): void {',
                '    const tip = this.fp3dRoomTips.get(pin.dataset.room ?? "");',
                '    if (tip) pin.title = tip;',
                '    else pin.removeAttribute("title");',
                '  }',
                '  private fp3dHomeMoving = false;',
                '  private fp3dHomeClock = 0;',
                '',
                '  fp3dSetHome(scene: Fp3dHomeScene): void {',
                '    this.fp3dHome.set(scene, this.theme === "day" || !!this.style.natural);',
                '    this.invalidate();',
                '  }',
                '',
                '  /** The wind in the plan for the air at the windows: where it blows to (unit) and its speed (m/s); null: none known. */',
                '  fp3dWindPlan(): { to: [number, number] | null; speed: number } | null {',
                '    const w = this.fp3dWind;',
                '    if (!w) return null;',
                '    const to = this.fp3dWindTo();',
                '    return { to: to === null ? null : [Math.sin(to), -Math.cos(to)], speed: w.speed };',
                '  }',
                '',
                '  /** The tip of a "Technik" badge under the pointer (mouse: while on it; touch: on a tap). */',
                '  private fp3dTipEl: HTMLDivElement | null = null;',
                '  private fp3dTipBound = false;',
                '',
                '  private fp3dTipAt(e: PointerEvent | null): void {',
                '    let tip: string | null = null;',
                '    const r = this.renderer.domElement.getBoundingClientRect();',
                '    if (e && r.width > 0 && r.height > 0) {',
                '      tip = this.fp3dHome.tipAt(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, this.camera);',
                '    }',
                '    if (!tip || !e) {',
                '      if (this.fp3dTipEl) this.fp3dTipEl.hidden = true;',
                '      return;',
                '    }',
                '    if (!this.fp3dTipEl) {',
                '      this.fp3dTipEl = document.createElement("div");',
                '      this.fp3dTipEl.className = "fp3d-home-tip";',
                '      this.labels.append(this.fp3dTipEl);',
                '    }',
                '    const box = this.labels.getBoundingClientRect();',
                '    const el = this.fp3dTipEl;',
                '    el.hidden = false;',
                '    el.textContent = tip;',
                '    el.style.left = `${Math.min(e.clientX - box.left + 14, Math.max(0, box.width - 260))}px`;',
                '    el.style.top = `${e.clientY - box.top + 16}px`;',
                '  }',
                '',
                '  private fp3dHomeFrame(): void {',
                '    const t = this.flowTime.value;',
                '    const dt = Math.min(1, Math.max(0, t - this.fp3dHomeClock));',
                '    this.fp3dHomeClock = t;',
                '    if (!this.fp3dHome.group.parent) this.root.add(this.fp3dHome.group);',
                '    if (!this.fp3dTipBound) {',
                '      this.fp3dTipBound = true;',
                '      // on the whole stage: a device symbol over its badge shows the tip too',
                '      const c = this.renderer.domElement.parentElement ?? this.renderer.domElement;',
                '      c.addEventListener("pointermove", (e) => {',
                '        if (e.pointerType === "mouse" && !e.buttons) this.fp3dTipAt(e);',
                '        else if (e.buttons) this.fp3dTipAt(null);',
                '      });',
                '      c.addEventListener("pointerleave", () => this.fp3dTipAt(null));',
                '      c.addEventListener("pointerup", (e) => {',
                '        if (e.pointerType !== "mouse") this.fp3dTipAt(e);',
                '      });',
                '    }',
                '    const places = new Map<string, Fp3dFloorPlace>();',
                '    for (const fv of this.floors) places.set(fv.floor.id, { y: fv.group.position.y, visible: fv.group.visible && fv.o >= 0.3 });',
                '    this.fp3dHomeMoving = this.fp3dHome.frame(t, dt, places, this.lowQuality || !!this.options.safeFx);',
                '  }',
                '',
                "  /** Pool Pro: the pools' water colour, movement, heating shimmer and cover; an empty list clears them. */",
                '  setPools(',
            ].join('\n'),
            'home: setHome',
        );
        code = replaceRequired(
            code,
            '    } else pin.classList.remove("fp3d-pin-info");\n  }',
            '    } else pin.classList.remove("fp3d-pin-info");\n    this.fp3dRoomTip(pin);\n  }',
            'home: room pin tooltips',
        );
        code = replaceRequired(
            code,
            '    this.fp3dSkyFrame();',
            ['    this.fp3dSkyFrame();', '    this.fp3dHomeFrame();'].join('\n'),
            'home: every frame',
        );
        code = replaceRequired(
            code,
            '|| this.fp3dSeaMoving || this.fp3dGearMoving || this.fp3dSkyMoving;',
            '|| this.fp3dSeaMoving || this.fp3dGearMoving || this.fp3dSkyMoving || this.fp3dHomeMoving;',
            'home: frames while it moves',
        );
    }
    if (name === 'components/view3d.ts') {
        code = `import { healthColor as fp3dHealthColor, healthReport as fp3dHealthReport, homeScene as fp3dHomeScene, gearMarkers as fp3dGearMarkers, homeWatched as fp3dHomeWatched, type HealthReport as Fp3dHealthReport } from "${root}/frontend/vendor-ext/home-view.ts";
import { activityColor as fp3dActivityColor, MeterFlow as Fp3dMeterFlow, priceTone as fp3dPriceTone, roomActivity as fp3dRoomActivity, slotsFromHistory as fp3dSlotsFromHistory, startOfDay as fp3dStartOfDay, type PriceSlot as Fp3dPriceSlot } from "${root}/frontend/vendor-ext/home-data.ts";\n${code}`;
        code = replaceRequired(
            code,
            ['      force = true;', '    }', '    let changed = force || timed;'].join('\n'),
            [
                '      // the home looks: mowers, sprinklers, taps, thermostats, speakers, warnings, the price; in the "Technik" view all',
                '      this.watched = [...new Set([...this.watched, ...fp3dHomeWatched(hass, b, (a) => areaEntities(hass, a), this.heatMode === "health")])];',
                '      force = true;',
                '    }',
                '    let changed = force || timed;',
            ].join('\n'),
            'home: watched',
        );
        code = replaceRequired(
            code,
            '    this.setAlerts([...own, ...fromModules]);',
            [
                '    // the home looks and their warnings (an open window while the room heats, water running long, a weather warning)',
                '    const fp3dHomeAlerts = this.fp3dHomeSync(hass, b, openingStates, [...deviceMarkers, ...furniture.markers], own);',
                '    this.setAlerts([...own, ...fromModules, ...fp3dHomeAlerts]);',
            ].join('\n'),
            'home: sync',
        );
        code = replaceRequired(
            code,
            '  /** The air pressure seen while the page is open, and from the history of its sensor (read every ten minutes). */',
            [
                "  /** The home looks: the water meter's flow, the price's history, the price note, the weather warning's level. */",
                '  private fp3dMeter = new Fp3dMeterFlow();',
                '  private fp3dPriceRows: { id: string; at: number; slots: Fp3dPriceSlot[] } | null = null;',
                '  private fp3dPriceNote = "";',
                '  private fp3dPriceTone = "";',
                '  private fp3dWx = 0;',
                '  /** The "Technik" view: the devices\' health; the "Bewegung" view: today\'s motion per room. */',
                '  private fp3dHealthRep: Fp3dHealthReport | null = null;',
                '  private fp3dMotionRep: { at: number; day: number; rooms: Map<string, { count: number; last: number }>; total: number; sensors: number } | null = null;',
                '  private fp3dMotionBusy = false;',
                '',
                '  /** Works out the home looks, hands them to the viewer and returns their warnings. */',
                '  private fp3dHomeSync(hass: HomeAssistant, b: Building, openings: Map<string, { open: number; tilt: number; open2: number; tilt2: number; sensed?: boolean }>, markers: { id: string; floorId: string; roomId: string | null; x: number; y: number; z: number }[], own: Alert[]): Alert[] {',
                '    const v = this.viewer;',
                '    if (!v) return [];',
                '    // furniture with a sensor of its own (the contact of a hatch, a tank): its badges, and it counts in "Technik"',
                '    markers = [...markers, ...fp3dGearMarkers(b, new Set(markers.map((m) => m.id)))];',
                '    const now = this.now();',
                '    const t = (k: string, vars?: Record<string, string>) => translate(hass, k as I18nKey, vars);',
                '    const time = (ms: number) => new Date(ms).toLocaleTimeString(hass.language, { hour: "2-digit", minute: "2-digit" });',
                '    const contacts = new Map([...(this.openingLinks ?? new Map())].map(([id, e]) => [id as string, (e.contact ?? e.tilt ?? e.contact2 ?? null) as string | null]));',
                '    const weatherId = weatherEntity(hass, this.weatherEntityId ?? b.settings.weather_entity);',
                '    const wa = weatherId ? hass.states[weatherId]?.attributes : undefined;',
                '    let tOut: number | null = parseFloat(String(wa?.temperature ?? ""));',
                '    if (!Number.isFinite(tOut)) tOut = null;',
                '    else if (String(wa?.temperature_unit ?? "").includes("F")) tOut = ((tOut as number) - 32) * (5 / 9);',
                '    if (!this.replay) this.fp3dPriceHistory(hass, b, now);',
                '    const out = fp3dHomeScene({',
                '      hass,',
                '      building: b,',
                '      now,',
                '      t,',
                '      areaEntities: (a) => areaEntities(hass, a),',
                '      climate: (f, r) => ({ t: roomClimateValue(hass, f as Floor, r as never, "temperature"), rh: roomClimateValue(hass, f as Floor, r as never, "humidity"), co2: roomClimateValue(hass, f as Floor, r as never, "co2") }),',
                '      ground: (f, x, z) => outdoorGround(f as Floor, x, z),',
                '      openings,',
                '      contacts,',
                '      markers,',
                '      wind: v.fp3dWindPlan(),',
                '      tOut,',
                '      leaks: own.filter((a) => a.kind === "water" && !!a.roomId && !!a.floorId).map((a) => ({ entity: a.entity, roomId: a.roomId as string, floorId: a.floorId as string })),',
                '      priceHistory: this.fp3dPriceRows?.slots ?? [],',
                '      health: this.heatMode === "health" || b.settings.health_badges === true,',
                '      meter: this.fp3dMeter,',
                '      fmt: (n, d) => formatNumber(hass, n, d),',
                '      time,',
                '    });',
                '    v.fp3dSetHome(out.scene);',
                '    // the price in the energy bar: cheap or dear today, the cheapest hour ahead',
                '    const p = out.price;',
                '    const tone = p && p.level !== null ? fp3dPriceTone(p.level) : "";',
                '    const note = p ? [tone ? t(`home_price_${tone}`) : "", p.cheapest ? `${t("home_cheapest")} ${time(p.cheapest.start)}–${time(p.cheapest.end)}` : ""].filter(Boolean).join(" · ") : "";',
                '    if (note !== this.fp3dPriceNote || tone !== this.fp3dPriceTone || out.warning !== this.fp3dWx) {',
                '      this.fp3dPriceNote = note;',
                '      this.fp3dPriceTone = tone;',
                '      this.fp3dWx = out.warning;',
                '      this.requestUpdate();',
                '    }',
                '    if (this.heatMode === "health") {',
                '      this.fp3dHealthRep = fp3dHealthReport(hass, b, markers, (id) => entityName(hass, id));',
                '      this.applyTint();',
                '      this.requestUpdate();',
                '    }',
                '    if (this.heatMode === "motion") this.fp3dMotionLoad(hass, b, now);',
                '    return out.alerts as Alert[];',
                '  }',
                '',
                "  /** The price's history of the last day (for cheap or dear) when no forecast is chosen; read again every half hour. */",
                '  private fp3dPriceHistory(hass: HomeAssistant, b: Building, now: number): void {',
                '    const id = b.settings.price_entity || b.energy?.tariff;',
                '    const forecast = b.settings.price_forecast;',
                '    if (!id || !hass.states[id] || (forecast && hass.states[forecast])) return;',
                '    if (this.fp3dPriceRows && this.fp3dPriceRows.id === id && now - this.fp3dPriceRows.at < 30 * 60 * 1000) return;',
                '    this.fp3dPriceRows = { id, at: now, slots: this.fp3dPriceRows?.id === id ? this.fp3dPriceRows.slots : [] };',
                '    void (hass.callWS({ type: "history/history_during_period", start_time: new Date(now - 24 * 3600 * 1000).toISOString(), end_time: new Date(now).toISOString(), entity_ids: [id], minimal_response: true, no_attributes: true }) as Promise<Record<string, { s: string; lu: number }[]> | null>)',
                '      .then((res) => {',
                '        if (this.fp3dPriceRows?.id !== id) return;',
                '        this.fp3dPriceRows.slots = fp3dSlotsFromHistory(res?.[id] ?? [], Date.now());',
                '        this.syncDevices(true);',
                '      })',
                '      .catch(() => {});',
                '  }',
                '',
                '  /** The "Bewegung" view: the motion sensors\' history since midnight, per room; read again every five minutes. */',
                '  private fp3dMotionLoad(hass: HomeAssistant, b: Building, now: number): void {',
                '    const day = fp3dStartOfDay(now);',
                '    const old = this.fp3dMotionRep;',
                '    if (this.fp3dMotionBusy || (old && old.day === day && now - old.at < 5 * 60 * 1000)) return;',
                '    const sources = trailSources(hass, b);',
                '    const done = (rows: Record<string, HistoryRow[]>) => {',
                '      const live = sources.map((s) => {',
                '        const st = hass.states[s.entity];',
                '        return { entity: s.entity, state: st?.state, lastChanged: st?.last_changed ? Date.parse(st.last_changed) : undefined };',
                '      });',
                '      const events = trailEvents(rows, live, now, Math.max(60 * 1000, now - day));',
                '      const roomOf = new Map<string, string>();',
                '      for (const s of sources) {',
                '        const room = b.floors.find((f) => f.id === s.floorId)?.rooms.find((r) => r.points.length >= 3 && pointInPolygon([s.x, s.z], r.points));',
                '        if (room) roomOf.set(s.entity, room.id);',
                '      }',
                '      this.fp3dMotionRep = { at: now, day, rooms: fp3dRoomActivity(events, roomOf), total: events.length, sensors: sources.length };',
                '      this.fp3dMotionBusy = false;',
                '      this.applyTint();',
                '      this.requestUpdate();',
                '    };',
                '    if (!sources.length || this.replay) {',
                '      done({});',
                '      return;',
                '    }',
                '    this.fp3dMotionBusy = true;',
                '    void hass',
                '      .callWS<Record<string, HistoryRow[]> | null>({ type: "history/history_during_period", start_time: new Date(day).toISOString(), entity_ids: sources.map((s) => s.entity), minimal_response: true, no_attributes: true, significant_changes_only: false })',
                '      .then((rows) => done(rows ?? {}))',
                '      .catch(() => done({}));',
                '  }',
                '',
                '  /** The legend of the "Technik" and "Bewegung" views. */',
                '  private fp3dRenderLegend() {',
                '    const t = (k: string, vars?: Record<string, string>) => translate(this.hass, k as I18nKey, vars);',
                '    if (this.heatMode === "health") {',
                '      const r = this.fp3dHealthRep;',
                '      const items = r?.items ?? [];',
                '      const unreach = items.filter((i) => i.problem === "unreach").length;',
                '      const low = items.length - unreach;',
                '      return html`<div class="fp3d-legend fp3d-legend-health">',
                '        <b>${t("heat_health")}</b>',
                '        ${!r || !r.known',
                '          ? html`<span class="fp3d-legend-none">${t("home_health_none")}</span>`',
                '          : !items.length',
                '            ? html`<span>✓ ${t("home_health_ok", { n: String(r.known) })}</span>`',
                '            : html`<span>${[unreach ? `⚠ ${t("home_health_unreach", { n: String(unreach) })}` : "", low ? `🔋 ${t(low === 1 ? "home_health_low_one" : "home_health_low", { n: String(low) })}` : ""].filter(Boolean).join(" · ")}</span>',
                '                <ul class="fp3d-health-list">',
                '                  ${items.slice(0, 8).map(',
                '                    (i) => html`<li class=${i.problem}>${i.problem === "unreach" ? "⚠" : "🔋"} ${i.name}${i.room ? html` <small>${i.room}</small>` : nothing}${i.problem === "battery" && i.health.battery !== null ? html` <b>${Math.round(i.health.battery)} %</b>` : nothing}</li>`,',
                '                  )}',
                '                  ${items.length > 8 ? html`<li>+${items.length - 8}</li>` : nothing}',
                '                </ul>`}',
                '      </div>`;',
                '    }',
                '    const m = this.fp3dMotionRep;',
                '    return html`<div class="fp3d-legend">',
                '      <b>${t("heat_motion")}</b>',
                '      <span class="fp3d-legend-bar" style="background:linear-gradient(90deg, rgb(255,235,128), rgb(255,150,60), rgb(235,55,45))"></span>',
                '      <span class="fp3d-legend-range"><span>${t("home_motion_little")}</span><span>${t("home_motion_much")}</span></span>',
                '      ${!m ? html`<span class="fp3d-legend-none">…</span>` : !m.total ? html`<span class="fp3d-legend-none">${t(m.sensors ? "home_motion_none" : "home_motion_nosensor")}</span>` : html`<span>${t("home_motion_total", { n: String(m.total) })}</span>`}',
                '    </div>`;',
                '  }',
                '',
                '  /** The air pressure seen while the page is open, and from the history of its sensor (read every ten minutes). */',
            ].join('\n'),
            'home: methods',
        );
        code = replaceRequired(
            code,
            [
                '    if (this.heatMode !== "none" && this.heatMode !== "values") {',
                '      const mode = this.heatMode;',
            ].join('\n'),
            [
                '    if (this.heatMode !== "none" && this.heatMode !== "values" && this.heatMode !== "health" && this.heatMode !== "motion") {',
                '      const mode = this.heatMode;',
            ].join('\n'),
            'home: views without scale',
        );
        code = replaceRequired(
            code,
            '    v.setRoomInfo(info);',
            [
                '    // the "Technik" view: rooms by the health of their devices (the room pins list them); "Bewegung": by today\'s motion',
                '    const tips = new Map<string, string>();',
                '    if (this.heatMode === "health" || this.heatMode === "motion") {',
                '      tint = new Map();',
                '      if (this.heatMode === "health" && this.fp3dHealthRep) {',
                '        for (const [id, r] of this.fp3dHealthRep.rooms) {',
                '          // rooms without a problem: green with "✓ n OK", or (only problems) as they are, without a word',
                '          const all = this.building?.settings.health_green !== false;',
                '          if (r.unreach || r.low || all) tint.set(id, fp3dHealthColor(r));',
                '          const parts = [r.unreach ? `⚠ ${r.unreach}` : "", r.low ? `🔋 ${r.low}` : ""].filter(Boolean);',
                '          if (parts.length || all) info.set(id, parts.length ? parts.join(" · ") : `✓ ${r.ok} OK`);',
                '          tips.set(id, r.devices.map((d) => `${d.problem === "unreach" ? "⚠" : d.problem === "battery" ? "🔋" : "✓"} ${d.name}${d.battery !== null ? ` · ${Math.round(d.battery)} %` : ""}`).join("\\n"));',
                '        }',
                '      }',
                '      if (this.heatMode === "motion" && this.fp3dMotionRep) {',
                '        const rooms = this.fp3dMotionRep.rooms;',
                '        const max = Math.max(0, ...[...rooms.values()].map((r) => r.count));',
                '        for (const [id, r] of rooms) {',
                '          tint.set(id, fp3dActivityColor(r.count, max));',
                '          info.set(id, `${r.count}× · ${new Date(r.last).toLocaleTimeString(hass.language, { hour: "2-digit", minute: "2-digit" })}`);',
                '        }',
                '      }',
                '    }',
                '    v.setRoomInfo(info);',
                '    v.fp3dSetRoomTips(tips);',
            ].join('\n'),
            'home: view tints',
        );
        code = replaceRequired(
            code,
            [
                '    if (this.heatMode === "none" || this.heatMode === "values") return nothing;',
                '    const scale = HEAT_SCALES[this.heatMode];',
            ].join('\n'),
            [
                '    if (this.heatMode === "health" || this.heatMode === "motion") return this.fp3dRenderLegend();',
                '    if (this.heatMode === "none" || this.heatMode === "values") return nothing;',
                '    const scale = HEAT_SCALES[this.heatMode];',
            ].join('\n'),
            'home: legend',
        );
        code = replaceRequired(
            code,
            '${this._alerts.length || this.fp3dStorm ? "fp3d-has-alerts" : ""}',
            '${this._alerts.length || this.fp3dStorm ? "fp3d-has-alerts" : ""} ${this.fp3dWx ? `fp3d-wx fp3d-wx${this.fp3dWx}` : ""}',
            'home: warning frame',
        );
        code = replaceRequired(
            code,
            '    if (e.tariff) items.push({ cls: "tariff", label: t("energy_tariff"), value: `${formatNumber(this.hass, e.tariff.value, 3)} ${e.tariff.unit}`.trim() });',
            '    if (e.tariff) items.push({ cls: `tariff ${this.fp3dPriceTone ? `fp3d-price-${this.fp3dPriceTone}` : ""}`, label: this.fp3dPriceNote ? `${t("energy_tariff")} · ${this.fp3dPriceNote}` : t("energy_tariff"), value: `${formatNumber(this.hass, e.tariff.value, 3)} ${e.tariff.unit}`.trim() });',
            'home: price note',
        );
        code = replaceRequired(
            code,
            ['      .fp3d-alert-water,', '      .fp3d-alert-window_rain {'].join('\n'),
            [
                '      .fp3d-alert-fp3d_window_heat {',
                '        border-left-color: #ff8a2a;',
                '        box-shadow: 0 0 18px rgba(255, 138, 42, 0.35);',
                '      }',
                '      .fp3d-alert-fp3d_water_run {',
                '        border-left-color: #4fb3ff;',
                '        box-shadow: 0 0 18px rgba(79, 179, 255, 0.35);',
                '      }',
                '      .fp3d-alert-fp3d_wx1 {',
                '        border-left-color: #ffd633;',
                '        box-shadow: 0 0 18px rgba(255, 214, 51, 0.35);',
                '        animation: none;',
                '      }',
                '      .fp3d-alert-fp3d_wx2 {',
                '        border-left-color: #ff8c1a;',
                '        box-shadow: 0 0 18px rgba(255, 140, 26, 0.4);',
                '        animation: none;',
                '      }',
                '      .fp3d-alert-fp3d_wx3 {',
                '        border-left-color: #eb2626;',
                '        box-shadow: 0 0 18px rgba(235, 38, 38, 0.45);',
                '      }',
                '      .fp3d-alert-fp3d_wx4 {',
                '        border-left-color: #9e38d9;',
                '        box-shadow: 0 0 18px rgba(158, 56, 217, 0.5);',
                '      }',
                '      .fp3d-stage.fp3d-wx::after {',
                '        content: "";',
                '        position: absolute;',
                '        inset: 0;',
                '        pointer-events: none;',
                '        z-index: 3;',
                '        box-shadow:',
                '          inset 0 0 0 3px var(--fp3d-wx),',
                '          inset 0 0 56px var(--fp3d-wx-soft);',
                '      }',
                '      .fp3d-wx1 {',
                '        --fp3d-wx: rgba(255, 214, 51, 0.85);',
                '        --fp3d-wx-soft: rgba(255, 214, 51, 0.22);',
                '      }',
                '      .fp3d-wx2 {',
                '        --fp3d-wx: rgba(255, 140, 26, 0.9);',
                '        --fp3d-wx-soft: rgba(255, 140, 26, 0.28);',
                '      }',
                '      .fp3d-wx3 {',
                '        --fp3d-wx: rgba(235, 38, 38, 0.9);',
                '        --fp3d-wx-soft: rgba(235, 38, 38, 0.3);',
                '      }',
                '      .fp3d-wx4 {',
                '        --fp3d-wx: rgba(158, 56, 217, 0.95);',
                '        --fp3d-wx-soft: rgba(158, 56, 217, 0.34);',
                '      }',
                '      .fp3d-energy-tariff.fp3d-price-cheap b {',
                '        color: #4fd772;',
                '      }',
                '      .fp3d-energy-tariff.fp3d-price-dear b {',
                '        color: #ff6a5a;',
                '      }',
                '      .fp3d-health-list {',
                '        list-style: none;',
                '        margin: 4px 0 0;',
                '        padding: 0;',
                '        font-size: 12px;',
                '        max-height: 34vh;',
                '        overflow: auto;',
                '      }',
                '      .fp3d-health-list li {',
                '        white-space: nowrap;',
                '        overflow: hidden;',
                '        text-overflow: ellipsis;',
                '        max-width: 300px;',
                '        line-height: 1.5;',
                '      }',
                '      .fp3d-health-list small {',
                '        opacity: 0.65;',
                '      }',
                '      .fp3d-health-list li.unreach {',
                '        color: #ff7a7a;',
                '      }',
                '      /* the tip of a badge: which device, why, since when */',
                '      .fp3d-home-tip {',
                '        position: absolute;',
                '        z-index: 5;',
                '        max-width: 260px;',
                '        padding: 6px 10px;',
                '        border-radius: 8px;',
                '        background: var(--fp3d-chrome);',
                '        box-shadow: var(--fp3d-shadow);',
                '        color: var(--fp3d-text);',
                '        font-size: 12px;',
                '        line-height: 1.45;',
                '        white-space: pre-line;',
                '        overflow-wrap: anywhere;',
                '        pointer-events: none;',
                '      }',
                '      .fp3d-home-tip::first-line {',
                '        font-weight: 600;',
                '      }',
                '      /* the list is taller than a scale: on the other side than the floor pictures */',
                '      .fp3d-legend.fp3d-legend-health {',
                '        left: auto;',
                '        right: 12px;',
                '      }',
                '      .fp3d-side-right .fp3d-legend.fp3d-legend-health {',
                '        left: 12px;',
                '        right: auto;',
                '      }',
                '      .fp3d-alert-water,',
                '      .fp3d-alert-window_rain {',
            ].join('\n'),
            'home: styles',
        );
    }
    if (name === 'components/editor.ts') {
        code = `import { WATER_TYPES as FP3D_WATER_TYPES } from "${root}/frontend/vendor-ext/home-view.ts";\nimport { CAR_COLORS as FP3D_CAR_COLORS, isCarKind as fp3dIsCar, plateText as fp3dPlateText } from "${root}/frontend/vendor-ext/cars.ts";\n${code}`;
        code = replaceRequired(
            code,
            '"propeller", "nav_light", "wind_vane"]);',
            '"propeller", "nav_light", "wind_vane", "robot_mower", "sprinkler", "car_sedan", "car_hatchback", "car_van"]);',
            'home: no state links',
        );
        code = replaceRequired(
            code,
            '${f.type === "wind_vane" ? this.fp3dRenderVaneForm(f) : nothing}',
            '${f.type === "wind_vane" ? this.fp3dRenderVaneForm(f) : nothing} ${this.fp3dRenderHomeForm(f)}',
            'home: forms',
        );
        code = replaceRequired(
            code,
            '  /** A wind indicator: which one, its height, whether a mast or pole is drawn; the wind comes from the house settings. */',
            [
                "  /** A robot mower's status, a sprinkler's valve and soil sensor, the water at a shower, bathtub or basin. */",
                '  private fp3dRenderHomeForm(f: Furniture) {',
                '    if (!this.hass) return nothing;',
                '    const set = (patch: Partial<Furniture>) => this.updateFurniture(patch);',
                '    const pick = (v: string | null) => (v && v !== "none" ? v : null);',
                '    if (f.type === "robot_mower")',
                '      return html`<div class="fp3d-form fp3d-links">',
                '        ${this.entitySelect(this.t("mower_entity" as I18nKey), f.entity ?? null, undefined, this.entityOptions((id) => /^(sensor|select|vacuum|lawn_mower|binary_sensor|switch|input_select)\\./.test(id)), (v) => set({ entity: pick(v) }))}',
                '        <p class="fp3d-sub fp3d-wide">${this.t("mower_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    if (f.type === "sprinkler")',
                '      return html`<div class="fp3d-form fp3d-links">',
                '        ${this.entitySelect(this.t("sprinkler_entity" as I18nKey), f.entity ?? null, undefined, this.entityOptions((id) => /^(switch|valve|binary_sensor|sensor|input_boolean|light)\\./.test(id)), (v) => set({ entity: pick(v) }))}',
                '        ${this.entitySelect(this.t("sprinkler_moisture" as I18nKey), f.moisture ?? null, undefined, this.entityOptions((id) => id.startsWith("sensor.")), (v) => set({ moisture: pick(v) }))}',
                '        ${this.num(this.t("sprinkler_min" as I18nKey), f.moisture_min ?? 30, (v) => set({ moisture_min: Math.round(Math.min(90, Math.max(5, v))) }), 1, 5)}',
                '        <p class="fp3d-sub fp3d-wide">${this.t("sprinkler_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    if (fp3dIsCar(f.type))',
                '      return html`<div class="fp3d-form fp3d-links">',
                '        ${this.entitySelect(this.t("fp3d_car_presence" as I18nKey), f.entity ?? null, undefined, this.entityOptions((id) => /^(binary_sensor|device_tracker|person|sensor|switch|input_boolean)\\./.test(id)), (v) => set({ entity: pick(v) }))}',
                '        <label class="fp3d-field"',
                '          >${this.t("fp3d_car_color" as I18nKey)}',
                '          <input type="color" .value=${f.car_color ?? FP3D_CAR_COLORS[f.type]} ?disabled=${!this.isAdmin} @change=${(e: Event) => set({ car_color: (e.target as HTMLInputElement).value })}',
                '        /></label>',
                '        <label class="fp3d-field"',
                '          >${this.t("fp3d_car_plate" as I18nKey)}',
                '          <input type="text" maxlength="12" placeholder="M-AB 1234" .value=${f.car_plate ?? ""} ?disabled=${!this.isAdmin} @change=${(e: Event) => set({ car_plate: fp3dPlateText((e.target as HTMLInputElement).value) || null })}',
                '        /></label>',
                '        <p class="fp3d-sub fp3d-wide">${this.t("fp3d_car_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    if (FP3D_WATER_TYPES.has(f.type))',
                '      return html`<div class="fp3d-form fp3d-links">',
                '        ${this.entitySelect(this.t("water_entity" as I18nKey), f.water ?? null, undefined, this.entityOptions((id) => /^(switch|valve|binary_sensor|sensor|input_boolean)\\./.test(id)), (v) => set({ water: pick(v) }))}',
                '        <label class="fp3d-check fp3d-wide"',
                '          ><input type="checkbox" ?disabled=${!this.isAdmin} .checked=${!!f.water_house} @change=${(e: Event) => set({ water_house: (e.target as HTMLInputElement).checked || undefined })} />',
                '          ${this.t("water_house" as I18nKey)}</label',
                '        >',
                '        <p class="fp3d-sub fp3d-wide">${this.t("water_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    return nothing;',
                '  }',
                '',
                '  /** A wind indicator: which one, its height, whether a mast or pole is drawn; the wind comes from the house settings. */',
            ].join('\n'),
            'home: form method',
        );
        code = replaceRequired(
            code,
            [
                '              <p class="fp3d-sub fp3d-wide">${this.t("wind_hint" as I18nKey)}</p>`',
                '          : nothing}',
            ].join('\n'),
            [
                '              <p class="fp3d-sub fp3d-wide">${this.t("wind_hint" as I18nKey)}</p>`',
                '          : nothing}',
                '        ${this.hass',
                '          ? html`${(["warning_entity", "price_entity", "price_forecast", "water_flow"] as const).map((key) =>',
                '                this.entitySelect(this.t(key as I18nKey), s[key] ?? null, undefined, this.entityOptions((id) => /^(sensor|binary_sensor|input_text|input_number)\\./.test(id)), (v) => set({ [key]: v === "none" ? null : v })),',
                '              )}',
                '              <label class="fp3d-check fp3d-wide"',
                '                ><input type="checkbox" ?disabled=${!this.isAdmin} .checked=${s.home_air !== false} @change=${(e: Event) => set({ home_air: (e.target as HTMLInputElement).checked ? undefined : false })} />',
                '                ${this.t("home_air_show" as I18nKey)}</label',
                '              >',
                '              <label class="fp3d-check fp3d-wide"',
                '                ><input type="checkbox" ?disabled=${!this.isAdmin} .checked=${(s.mould ?? s.home_air) !== false} @change=${(e: Event) => set({ mould: (e.target as HTMLInputElement).checked })} />',
                '                ${this.t("mould_show" as I18nKey)}</label',
                '              >',
                '              <label class="fp3d-check fp3d-wide"',
                '                ><input type="checkbox" ?disabled=${!this.isAdmin} .checked=${s.price_glow !== false} @change=${(e: Event) => set({ price_glow: (e.target as HTMLInputElement).checked ? undefined : false })} />',
                '                ${this.t("price_glow" as I18nKey)}</label',
                '              >',
                '              <label class="fp3d-check fp3d-wide"',
                '                ><input type="checkbox" ?disabled=${!this.isAdmin} .checked=${s.health_green !== false} @change=${(e: Event) => set({ health_green: (e.target as HTMLInputElement).checked ? undefined : false })} />',
                '                ${this.t("health_green" as I18nKey)}</label',
                '              >',
                '              <label class="fp3d-check fp3d-wide"',
                '                ><input type="checkbox" ?disabled=${!this.isAdmin} .checked=${s.health_badges === true} @change=${(e: Event) => set({ health_badges: (e.target as HTMLInputElement).checked || undefined })} />',
                '                ${this.t("health_badges" as I18nKey)}</label',
                '              >',
                '              ${((c: { health_stale_min?: number | null }) => html`<label class="fp3d-field fp3d-wide"',
                '                  >${this.t("health_stale" as I18nKey)}',
                '                  <input',
                '                    type="number"',
                '                    min="1"',
                '                    max="10080"',
                '                    step="1"',
                '                    placeholder=${this.t("health_stale_auto" as I18nKey)}',
                '                    .value=${c.health_stale_min ? String(c.health_stale_min) : ""}',
                '                    ?disabled=${!this.isAdmin}',
                '                    @change=${(e: Event) => {',
                '                      const v = (e.target as HTMLInputElement).value.trim();',
                '                      const n = v ? Math.round(Number(v)) : null;',
                '                      window.dispatchEvent(new CustomEvent("iobroker-health", { detail: { minutes: n && n >= 1 && n <= 10080 ? n : null } }));',
                '                    }}',
                '                /></label>',
                '                <p class="fp3d-sub fp3d-wide">${this.t("health_stale_hint" as I18nKey)}</p>`)((this.hass?.config ?? {}) as { health_stale_min?: number | null })}',
                '              <p class="fp3d-sub fp3d-wide">${this.t("home_hint" as I18nKey)}</p>`',
                '          : nothing}',
            ].join('\n'),
            'home: settings',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            heat_short_health: 'Technik',
            heat_short_motion: 'Bewegung',
            heat_health: 'Technik: Batterien und Erreichbarkeit',
            heat_motion: 'Bewegung heute',
            furn_robot_mower: 'Mähroboter',
            furn_sprinkler: 'Regner',
            furn_car_sedan: 'Limousine',
            furn_car_hatchback: 'Kompaktwagen',
            furn_car_van: 'Transporter',
            fp3d_car_presence: 'Zuhause (Datenpunkt)',
            fp3d_car_color: 'Farbe',
            fp3d_car_plate: 'Kennzeichen',
            fp3d_car_hint:
                'Das Auto steht hier, solange der Datenpunkt „da“ meldet (an, home, anwesend, geparkt oder eine Zahl über 0, z. B. ein Tracker oder ein Sensor in der Garage); dann parkt es rückwärts ein, sonst fährt es weg und nur die Markierung bleibt. Ohne Datenpunkt steht es immer da. Breite, Länge und Höhe wie beim Möbel.',
            home_health_low_one: '1 Batterie schwach',
            home_last_update: 'Letztes Update {time}',
            health_green: 'Technik-Ansicht: auch Räume ohne Problem zeigen (grün, „✓ n OK“) – sonst nur Probleme',
            health_badges: 'Batterie- und Funkprobleme immer am Gerät zeigen (🔋, ⚠), nicht nur in der Technik-Ansicht',
            active_color: 'Farbe, wenn aktiv',
            active_color_reset: 'Standard',
            health_stale: 'Nicht erreichbar nach … Minuten ohne Update',
            health_stale_auto: 'wie das Gerät es meldet',
            health_stale_hint:
                'Leer: wie das Gerät es meldet (UNREACH, online, available; Batteriegeräte, die zwischen zwei Meldungen schlafen, erst nach 48 Stunden). Mit einer Zahl zählt nur, wann das Gerät zuletzt einen Wert geschickt hat, z. B. 15 für Sensoren, die alle 5 Minuten senden. Geräte, die nur bei einer Änderung senden (Tür- und Fensterkontakte), brauchen einen größeren Wert. Gilt für alle Grundrisse.',
            mower_entity: 'Status (Datenpunkt)',
            mower_hint:
                'Steht an der Ladestation. Mäht er (Worx, Husqvarna, Gardena …), fährt er Bahnen über die Rasenfläche, auf der er steht (oder die nächste), und hinterlässt gemähte Streifen; „zurück“ oder „lädt“ bringt ihn zur Station, ein Fehler zeigt ein Warnschild.',
            sprinkler_entity: 'Ventil oder Schalter',
            sprinkler_moisture: 'Bodenfeuchte (Sensor, %)',
            sprinkler_min: 'Trocken unter (%)',
            sprinkler_hint:
                'Sprüht Wasserbögen, solange das Ventil offen ist. Breite = Kreis, den er bewässert. Liegt die Bodenfeuchte unter dem Wert, wird der Rasen darum gelblich.',
            water_entity: 'Wasser läuft (Sensor oder Ventil)',
            water_house: '… oder wenn die Wasseruhr des Hauses zählt',
            water_hint:
                'Solange Wasser läuft, rinnt es aus dem Hahn bzw. der Brause. Mit der Wasseruhr (⚙ → Energie oder Durchfluss in ⚙ → Haus) zählt jeder Durchfluss über 0,3 l/min.',
            warning_entity: 'Unwetterwarnung (Stufe, z. B. DWD)',
            price_entity: 'Strompreis (sonst Tarif aus Energie)',
            price_forecast: 'Preisvorschau (JSON, z. B. Tibber)',
            water_flow: 'Wasser-Durchfluss (Sensor, l/min)',
            home_air_show: 'Luft an offenen Fenstern zeigen',
            mould_show: 'Schimmelrisiko zeigen (dunkle Ecken an Außenwänden, „Lüften“)',
            price_glow: 'Haus im Strompreis leuchten lassen',
            home_hint:
                'Unwetterwarnung: Stufe 1–4 (oder Wörter wie „Unwetter“) färbt Rahmen und Banner. Strompreis: Das Haus leuchtet grün, wenn er im Vergleich zu heute günstig ist, rot, wenn teuer; mit einer Preisvorschau steht die günstigste Stunde in der Energieleiste. Wasser: Läuft es länger als 30 Minuten, erscheint eine Warnung.',
            home_window_heat: 'Fenster seit {min} min offen, Heizung läuft',
            home_water_run: 'Wasser läuft seit {min} min ({flow} l/min)',
            home_air_out: 'Lüften',
            home_mower_error: 'Mähroboter: Fehler',
            home_adapter_stopped: 'Adapter gestoppt',
            home_adapter_disconnected: 'Adapter ohne Verbindung',
            home_offline: 'nicht erreichbar',
            home_battery_low: 'Batterie schwach',
            home_warning_1: 'Wetterwarnung',
            home_warning_2: 'Markante Wetterwarnung',
            home_warning_3: 'Unwetterwarnung',
            home_warning_4: 'Extreme Unwetterwarnung',
            home_price_cheap: 'günstig',
            home_price_normal: 'mittel',
            home_price_dear: 'teuer',
            home_cheapest: 'günstigste Stunde',
            home_health_none: 'Keine Geräte melden Batterie oder Erreichbarkeit.',
            home_health_ok: 'Alle {n} Geräte in Ordnung',
            home_health_unreach: '{n} nicht erreichbar',
            home_health_low: '{n} Batterien schwach',
            home_motion_little: 'wenig',
            home_motion_much: 'viel',
            home_motion_none: 'Heute noch keine Bewegung.',
            home_motion_nosensor: 'Keine Bewegungsmelder im Plan.',
            home_motion_total: '{n} Bewegungen seit Mitternacht',
        };
        const en: Record<string, string> = {
            heat_short_health: 'Health',
            heat_short_motion: 'Motion',
            heat_health: 'Health: batteries and reachability',
            heat_motion: 'Motion today',
            furn_robot_mower: 'Robot mower',
            furn_sprinkler: 'Sprinkler',
            furn_car_sedan: 'Saloon',
            furn_car_hatchback: 'Hatchback',
            furn_car_van: 'Van',
            fp3d_car_presence: 'At home (datapoint)',
            fp3d_car_color: 'Colour',
            fp3d_car_plate: 'Number plate',
            fp3d_car_hint:
                'The car stands here while the datapoint says it is there (on, home, present, parked or a number above 0, e.g. a tracker or a sensor in the garage); then it reverses into its place, else it drives away and only the marking stays. Without a datapoint it is always there. Width, length and height as for any furniture.',
            home_health_low_one: '1 battery low',
            home_last_update: 'Last update {time}',
            health_green: '"Health" view: also show rooms without a problem (green, "✓ n OK") – else only problems',
            health_badges:
                'Always show battery and reachability problems at the device (🔋, ⚠), not only in the "Health" view',
            active_color: 'Colour when active',
            active_color_reset: 'Default',
            health_stale: 'Unreachable after … minutes without an update',
            health_stale_auto: 'as the device reports it',
            health_stale_hint:
                'Empty: as the device reports it (UNREACH, online, available; battery devices that sleep between their reports only after 48 hours). With a number only the time of its last value counts, e.g. 15 for sensors that send every 5 minutes. Devices that only send on a change (door and window contacts) need a larger value. Counts for all floor plans.',
            mower_entity: 'Status (datapoint)',
            mower_hint:
                'Stands at its charging station. While it mows (Worx, Husqvarna, Gardena …) it drives lanes over the lawn it stands on (or the nearest one) and leaves mown stripes; "returning" or "charging" takes it to the station, an error shows a warning sign.',
            sprinkler_entity: 'Valve or switch',
            sprinkler_moisture: 'Soil moisture (sensor, %)',
            sprinkler_min: 'Dry below (%)',
            sprinkler_hint:
                'Sprays arcs of water while the valve is open. Width = the circle it waters. When the soil moisture is below the value, the lawn around it turns yellowish.',
            water_entity: 'Water runs (sensor or valve)',
            water_house: '… or while the house water meter counts',
            water_hint:
                'While water runs, it pours from the tap or the shower head. With the water meter (⚙ → Energy, or the flow in ⚙ → House) any flow above 0.3 l/min counts.',
            warning_entity: 'Severe weather warning (level, e.g. DWD)',
            price_entity: 'Electricity price (else the energy tariff)',
            price_forecast: 'Price forecast (JSON, e.g. Tibber)',
            water_flow: 'Water flow (sensor, l/min)',
            home_air_show: 'Show air at open windows',
            mould_show: 'Show the mould risk (dark corners at outer walls, "air the room")',
            price_glow: 'Let the house glow in the electricity price',
            home_hint:
                'Weather warning: level 1–4 (or words like "severe") colours the frame and the banner. Electricity price: the house glows green when it is cheap compared with today, red when dear; with a price forecast the cheapest hour shows in the energy bar. Water: when it runs longer than 30 minutes, a warning shows.',
            home_window_heat: 'Window open for {min} min while heating',
            home_water_run: 'Water running for {min} min ({flow} l/min)',
            home_air_out: 'Air the room',
            home_mower_error: 'Robot mower: error',
            home_adapter_stopped: 'adapter stopped',
            home_adapter_disconnected: 'adapter not connected',
            home_offline: 'unreachable',
            home_battery_low: 'battery low',
            home_warning_1: 'Weather warning',
            home_warning_2: 'Significant weather warning',
            home_warning_3: 'Severe weather warning',
            home_warning_4: 'Extreme weather warning',
            home_price_cheap: 'cheap',
            home_price_normal: 'medium',
            home_price_dear: 'dear',
            home_cheapest: 'cheapest hour',
            home_health_none: 'No device reports a battery or its reachability.',
            home_health_ok: 'All {n} devices fine',
            home_health_unreach: '{n} unreachable',
            home_health_low: '{n} batteries low',
            home_motion_little: 'little',
            home_motion_much: 'much',
            home_motion_none: 'No motion yet today.',
            home_motion_nosensor: 'No motion sensors in the plan.',
            home_motion_total: '{n} motions since midnight',
        };
        const lines = (t: Record<string, string>): string =>
            Object.entries(t)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(
            code,
            '  heat_values: "Werte am Raumnamen",',
            `  heat_values: "Werte am Raumnamen",${lines(de)}`,
            'home de',
        );
        code = replaceRequired(
            code,
            '  heat_values: "Values at the room names",',
            `  heat_values: "Values at the room names",${lines(en)}`,
            'home en',
        );
    }
    return code;
}

/**
 * Trees and bushes (trees.ts): furniture outside, dressed for the season from the date and the latitude (bare in
 * winter, blossom and fresh green in spring, fruit in late summer, autumn colours and falling leaves), with snow
 * while it snows, swaying in the wind.
 */
function treesMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "car_van",\n] as const;',
            '  "car_van",\n  "tree",\n  "tree_conifer",\n  "tree_fruit",\n  "bush",\n] as const;',
            'trees: furniture types',
        );
        code = replaceRequired(
            code,
            '"wind_vane", "robot_mower", "sprinkler"],',
            '"wind_vane", "robot_mower", "sprinkler", "tree", "tree_conifer", "tree_fruit", "bush"],',
            'trees: library group',
        );
        code = replaceRequired(
            code,
            '  car_van: [2.05, 5.3, 2.3],',
            [
                '  car_van: [2.05, 5.3, 2.3],',
                '  // trees and bushes: the crown (width, depth) and the height',
                '  tree: [4.5, 4.5, 7],',
                '  tree_conifer: [3, 3, 8],',
                '  tree_fruit: [3.5, 3.5, 4.2],',
                '  bush: [1.6, 1.6, 1.3],',
            ].join('\n'),
            'trees: sizes',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  car_van: ["vehicle", ["garage", "garden"]],',
            [
                '  car_van: ["vehicle", ["garage", "garden"]],',
                '  tree: ["outdoor", ["garden"]],',
                '  tree_conifer: ["outdoor", ["garden"]],',
                '  tree_fruit: ["outdoor", ["garden"]],',
                '  bush: ["outdoor", ["garden"]],',
            ].join('\n'),
            'trees: library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "car_sedan":\n    case "car_hatchback":\n    case "car_van": {',
            [
                '    case "tree":',
                '    case "tree_fruit":',
                '    case "bush": {',
                '      // a tree from above: its crown, a ring of leaves and the trunk (a bush has none)',
                '      const r = Math.min(w, d) / 2;',
                '      return [',
                '        circle(0, 0, r, "fp3d-sym-strong"),',
                '        circle(0, 0, r * 0.62),',
                '        ...(type === "bush" ? [] : [circle(0, 0, Math.min(0.18, r * 0.12), "fp3d-sym-fill")]),',
                '      ];',
                '    }',
                '    case "tree_conifer": {',
                '      // a conifer from above: its crown and the branches like a star',
                '      const r = Math.min(w, d) / 2;',
                '      return [',
                '        circle(0, 0, r, "fp3d-sym-strong"),',
                '        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => line(0, 0, Math.cos((i * Math.PI) / 4) * r * 0.9, Math.sin((i * Math.PI) / 4) * r * 0.9)),',
                '      ];',
                '    }',
                '    case "car_sedan":',
                '    case "car_hatchback":',
                '    case "car_van": {',
            ].join('\n'),
            'trees: symbols',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "car_sedan":\n    case "car_hatchback":\n    case "car_van":\n    case "robot_mower":',
            '    case "tree":\n    case "tree_conifer":\n    case "tree_fruit":\n    case "bush":\n    case "car_sedan":\n    case "car_hatchback":\n    case "car_van":\n    case "robot_mower":',
            'trees: drawn by the sky frame',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  furn_nav_light: "Positionslicht",',
            '  furn_nav_light: "Positionslicht",\n  furn_tree: "Laubbaum",\n  furn_tree_conifer: "Nadelbaum",\n  furn_tree_fruit: "Obstbaum",\n  furn_bush: "Strauch",',
            'trees de',
        );
        code = replaceRequired(
            code,
            '  furn_nav_light: "Navigation light",',
            '  furn_nav_light: "Navigation light",\n  furn_tree: "Broadleaf tree",\n  furn_tree_conifer: "Conifer",\n  furn_tree_fruit: "Fruit tree",\n  furn_bush: "Bush",',
            'trees en',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { animateTree as fp3dAnimateTree, buildTree as fp3dBuildTree, disposeTrees as fp3dDisposeTrees, treeKey as fp3dTreeKey, type TreeSpec as Fp3dTree } from "${root}/frontend/vendor-ext/trees.ts";\n${code}`;
        code = replaceRequired(
            code,
            '  private fp3dRainbow: Fp3dRainbow | null = null;\n',
            [
                '  private fp3dRainbow: Fp3dRainbow | null = null;',
                '  /** Trees and bushes, built anew when they, their floor, the look or the season change. */',
                '  private fp3dTrees: Fp3dTree[] = [];',
                '  private fp3dTreeGroup: Group | null = null;',
                '  private fp3dTreeSig = "";',
                '',
                '  fp3dSetTrees(list: Fp3dTree[]): void {',
                '    if (JSON.stringify(list) === JSON.stringify(this.fp3dTrees)) return;',
                '    this.fp3dTrees = list;',
                '    this.invalidate();',
                '  }',
                '',
            ].join('\n'),
            'trees: fields',
        );
        code = replaceRequired(
            code,
            '    this.fp3dSkyMoving = moving && !this.lowQuality;\n',
            [
                '    // the trees: they sway in the wind (without a known direction only a little), their leaves fall in autumn',
                '    const treeParts: { t: Fp3dTree; y: number }[] = [];',
                '    for (const tr of this.fp3dTrees) {',
                '      const fv = this.floorMap.get(tr.floor);',
                '      if (!fv || !fv.group.visible || fv.o < 0.3) continue;',
                '      treeParts.push({ t: tr, y: fv.group.position.y });',
                '    }',
                '    const treeSig = (light ? "l|" : "d|") + treeParts.map((p) => fp3dTreeKey(p.t, p.y)).join("|");',
                '    if (treeSig !== this.fp3dTreeSig) {',
                '      this.fp3dTreeSig = treeSig;',
                '      if (this.fp3dTreeGroup) {',
                '        this.root.remove(this.fp3dTreeGroup);',
                '        fp3dDisposeTrees(this.fp3dTreeGroup);',
                '        this.fp3dTreeGroup = null;',
                '      }',
                '      if (treeParts.length) {',
                '        const g = new Group();',
                '        for (const p of treeParts) {',
                '          const tree = fp3dBuildTree(p.t, !!light);',
                '          tree.position.set(p.t.x, p.y, p.t.z);',
                '          g.add(tree);',
                '        }',
                '        this.root.add(g);',
                '        this.fp3dTreeGroup = g;',
                '      }',
                '    }',
                '    if (this.fp3dTreeGroup) {',
                '      const tw = w ? { to: to ?? 0, speed: to === null ? w.speed * 0.4 : w.speed, gust } : null;',
                '      for (const c of this.fp3dTreeGroup.children) if (fp3dAnimateTree(c, tw, t, this.lowQuality ? 0 : dt)) moving = true;',
                '    }',
                '    this.fp3dSkyMoving = moving && !this.lowQuality;',
                '',
            ].join('\n'),
            'trees: every frame',
        );
        code = replaceRequired(
            code,
            '    this.fp3dRainbow?.dispose();\n',
            '    this.fp3dRainbow?.dispose();\n    if (this.fp3dTreeGroup) fp3dDisposeTrees(this.fp3dTreeGroup);\n',
            'trees: dispose',
        );
    }
    if (name === 'components/library.ts') {
        // the pictures of cars were empty before: a new key draws every picture once again
        code = replaceRequired(code, '|${THUMB_PX}|1`;', '|${THUMB_PX}|2`;', 'trees and cars: pictures drawn again');
    }
    if (name === 'viewer/preview.ts') {
        // the library's pictures: trees (in summer) and cars (in their first colour) come from their own builders
        code = `import { buildTree as fp3dPrevTree, disposeTrees as fp3dPrevDispose, isTreeKind as fp3dPrevIsTree } from "${root}/frontend/vendor-ext/trees.ts";\nimport { buildCar as fp3dPrevCar, CAR_COLORS as fp3dPrevCarColors, isCarKind as fp3dPrevIsCar } from "${root}/frontend/vendor-ext/cars.ts";\n${code}`;
        code = replaceRequired(
            code,
            "  scene.add(mesh, edges);\n\n  // look from the front right, a little from above; fit the item's box into the picture\n  const box = new Box3().setFromObject(mesh);",
            [
                '  scene.add(mesh, edges);',
                '  const fp3dOwn = fp3dPrevIsTree(item.type)',
                '    ? fp3dPrevTree({',
                '        id: item.type,',
                '        floor: "",',
                '        kind: item.type,',
                '        x: 0,',
                '        z: 0,',
                '        angle: 0,',
                '        w: item.w,',
                '        d: item.d,',
                '        h: item.h,',
                '        season: { leaf: 1, fresh: 0.2, autumn: 0, fall: 0, blossom: 0, fruit: item.type === "tree_fruit" ? 1 : 0 },',
                '        snow: 0,',
                '      })',
                '    : fp3dPrevIsCar(item.type)',
                '      ? fp3dPrevCar(item.type, item.w, item.d, item.h, fp3dPrevCarColors[item.type])',
                '      : null;',
                '  if (fp3dOwn) scene.add(fp3dOwn);',
                '',
                "  // look from the front right, a little from above; fit the item's box into the picture",
                '  const box = new Box3().setFromObject(fp3dOwn ?? mesh);',
            ].join('\n'),
            'trees and cars: library pictures',
        );
        code = replaceRequired(
            code,
            '  cache.set(key, url);\n',
            '  if (fp3dOwn) fp3dPrevDispose(fp3dOwn);\n  cache.set(key, url);\n',
            'trees and cars: pictures freed',
        );
    }
    if (name === 'components/view3d.ts') {
        code = `import { isTreeKind as fp3dIsTreeKind, seasonOf as fp3dSeasonOf, type TreeKind as Fp3dTreeKind } from "${root}/frontend/vendor-ext/trees.ts";\n${code}`;
        code = replaceRequired(
            code,
            '    v.fp3dSetVanes(\n',
            [
                '    // trees and bushes: the season from the date and the latitude (sun.sun), snow while it snows',
                '    const fp3dLat = hass.states["sun.sun"]?.attributes?.latitude;',
                '    const fp3dSeason = fp3dSeasonOf(Date.now(), typeof fp3dLat === "number" ? fp3dLat : null);',
                '    const fp3dSnowing = /snow/.test((fp3dWeatherId ? hass.states[fp3dWeatherId]?.state : "") ?? "") ? 1 : 0;',
                '    v.fp3dSetTrees(',
                '      b.floors.flatMap((fl) =>',
                '        fl.furniture',
                '          .filter((f) => fp3dIsTreeKind(f.type))',
                '          .map((f) => ({',
                '            id: f.id,',
                '            floor: fl.id,',
                '            kind: f.type as Fp3dTreeKind,',
                '            x: f.x,',
                '            z: f.z,',
                '            angle: ((f.rotation ?? 0) * Math.PI) / 180,',
                '            w: f.w,',
                '            d: f.d,',
                '            h: f.h,',
                '            season: fp3dSeason,',
                '            snow: fp3dSnowing,',
                '          })),',
                '      ),',
                '    );',
                '    v.fp3dSetVanes(',
            ].join('\n'),
            'trees to the viewer',
        );
    }
    return code;
}

/**
 * Taps on furniture that is drawn apart from the others: the moving parts (doors of a smart fridge, an awning, a
 * motorised curtain or screen) lie in their own mesh, so each keeps its triangles and a tap opens the item's entity;
 * cars, coffee machines and rainwater tanks of the home looks (home-fx.ts) are found by their furniture id.
 */
function tapMore(name: string, code: string): string {
    if (name === 'viewer/viewer3d.ts') {
        code = replaceRequired(
            code,
            '  gateTris: { id: string; start: number; end: number }[];\n',
            [
                '  gateTris: { id: string; start: number; end: number }[];',
                '  /** The moving parts by the id of their furniture (a tap opens its entity). */',
                '  fp3dMoveTris?: { id: string; start: number; end: number }[];',
                '',
            ].join('\n'),
            'tap: moving parts field',
        );
        code = replaceRequired(
            code,
            '      pushFridgeDoors(buf, f, mountBase(fv.floor, f), st?.l ?? 0, st?.r ?? 0);\n',
            [
                '      const fp3dStart = buf.count;',
                '      pushFridgeDoors(buf, f, mountBase(fv.floor, f), st?.l ?? 0, st?.r ?? 0);',
                '      fp3dMoves.push({ id: f.id, start: fp3dStart, end: buf.count });',
                '',
            ].join('\n'),
            'tap: fridge doors',
        );
        code = replaceRequired(
            code,
            '    const buf = new GeoBuffer();\n    for (const f of fv.floor.furniture) {\n      if (f.type !== "fridge_smart") continue;\n',
            '    const buf = new GeoBuffer();\n    const fp3dMoves: { id: string; start: number; end: number }[] = [];\n    for (const f of fv.floor.furniture) {\n      if (f.type !== "fridge_smart") continue;\n',
            'tap: moving parts list',
        );
        code = replaceRequired(
            code,
            '    for (const f of fv.floor.furniture) if (f.type === "awning") pushAwning(buf, f, mountBase(fv.floor, f), this.awnings.get(f.id)?.cur ?? 0);\n',
            [
                '    for (const f of fv.floor.furniture) {',
                '      if (f.type !== "awning") continue;',
                '      const fp3dStart = buf.count;',
                '      pushAwning(buf, f, mountBase(fv.floor, f), this.awnings.get(f.id)?.cur ?? 0);',
                '      fp3dMoves.push({ id: f.id, start: fp3dStart, end: buf.count });',
                '    }',
                '',
            ].join('\n'),
            'tap: awnings',
        );
        code = replaceRequired(
            code,
            '      if (kind && item) pushPackMotion(buf, item, kind, f, mountBase(fv.floor, f), this.awnings.get(f.id)?.cur ?? 0);\n',
            [
                '      if (!kind || !item) continue;',
                '      const fp3dStart = buf.count;',
                '      pushPackMotion(buf, item, kind, f, mountBase(fv.floor, f), this.awnings.get(f.id)?.cur ?? 0);',
                '      fp3dMoves.push({ id: f.id, start: fp3dStart, end: buf.count });',
                '',
            ].join('\n'),
            'tap: curtains and screens',
        );
        code = replaceRequired(
            code,
            '    fv.fridgeMesh.geometry.dispose();\n    fv.fridgeMesh.geometry = buf.geometry();\n',
            '    fv.fp3dMoveTris = fp3dMoves;\n    fv.fridgeMesh.geometry.dispose();\n    fv.fridgeMesh.geometry = buf.geometry();\n',
            'tap: keep the moving parts',
        );
        code = replaceRequired(
            code,
            '        const id = inRange(fv.gateTris, tri);\n        if (id && devices) return { entity: id };\n',
            [
                '        const id = inRange(fv.gateTris, tri);',
                '        if (id && devices) return { entity: id };',
                '        const fp3dItem = inRange(fv.fp3dMoveTris ?? [], tri);',
                '        const fp3dEntity = fp3dItem ? this.pickFurniture.get(fp3dItem) : undefined;',
                '        if (fp3dEntity && devices) return { entity: fp3dEntity };',
                '',
            ].join('\n'),
            'tap: on a moving part',
        );
        code = replaceRequired(
            code,
            '    // the gear of a boat lies apart (a tank is seen through berths and floors): a tap on it opens its sensor\n',
            [
                '    // a car, a coffee machine, a rainwater tank of the home looks: its entity, unless something tappable is nearer',
                '    const fp3dOwn = devices && !this.furnish ? this.fp3dHome.furnitureAt(ray) : null;',
                '    const fp3dOwnEntity = fp3dOwn ? this.pickFurniture.get(fp3dOwn.id) : undefined;',
                '    if (fp3dOwn && fp3dOwnEntity) {',
                '      const nearer = ray',
                '        .intersectObjects(this.activeFloors().flatMap((f) => [f.lampMesh, f.fridgeMesh].filter((m) => m.visible)), false)',
                '        .some((h) => h.distance < fp3dOwn.distance);',
                '      if (!nearer) return { entity: fp3dOwnEntity };',
                '    }',
                '    // the gear of a boat lies apart (a tank is seen through berths and floors): a tap on it opens its sensor',
                '',
            ].join('\n'),
            'tap: own furniture of the home looks',
        );
    }
    return code;
}

/**
 * Lying snow without the fun pack (pv-snow.ts): snow lies on roof and lawn whenever the weather reports snow and stays
 * while it freezes (up to three days, as the pack's `snowLevel` works it out); it lies on the roof's solar modules too
 * and goes from a field as soon as it produces. The pack's fairy lights and firework stay its own.
 */
function snowMore(name: string, code: string): string {
    if (name === 'winter.ts') {
        code = replaceRequired(
            code,
            '  if (!hasFeature("fun_winter") || winterOf(b).snow === false || !weatherId) return 0;',
            '  if (winterOf(b).snow === false || !weatherId) return 0;',
            'snow: without the fun pack',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '    const snow = winter ? snowLevel(hass, b, weatherEntity(hass, this.weatherEntityId ?? b.settings.weather_entity)) : 0;',
            '    const snow = this.replay ? 0 : snowLevel(hass, b, weatherEntity(hass, this.weatherEntityId ?? b.settings.weather_entity));',
            'snow: lies with the weather',
        );
        // once a minute: the snow melts in a thaw
        code = replaceRequired(
            code,
            '    this.watchWinter(winter);\n',
            '    this.watchWinter(winter || snow > 0);\n',
            'snow: melts by the minute',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { buildPvSnow as fp3dBuildPvSnow, writePvSnow as fp3dWritePvSnow } from "${root}/frontend/vendor-ext/pv-snow.ts";\n${code}`;
        code = replaceRequired(
            code,
            '  private solarTexts = new Set<Group>();',
            '  private solarTexts = new Set<Group>();\n  private fp3dPvSnows = new Set<Group>();',
            'snow: on the modules field',
        );
        code = replaceRequired(
            code,
            '      else writeSolarText(g, watts);\n    }\n',
            [
                '      else writeSolarText(g, watts);',
                '    }',
                '    for (const g of [...this.fp3dPvSnows]) {',
                '      let p = g.parent;',
                '      while (p && p !== this.root && p !== this.scene) p = p.parent;',
                '      if (!p) this.fp3dPvSnows.delete(g);',
                '      else fp3dWritePvSnow(g, watts);',
                '    }',
                '',
            ].join('\n'),
            'snow: cleared by the power',
        );
        code = replaceRequired(
            code,
            '          mesh.renderOrder = 8;\n          part.add(mesh);\n        }\n      }\n',
            [
                '          mesh.renderOrder = 8;',
                '          part.add(mesh);',
                '        }',
                '        // on the solar modules too, gone from a field as soon as it produces',
                '        const fp3dPvSnow = fp3dBuildPvSnow(',
                '          entries.map(({ face, field }) => ({ id: field.id, corners: fp3dFieldModules(face, field).map((m) => m.corners), n: face.n })),',
                '          geo.floor.elevation + geo.base,',
                '          this.roofSnow,',
                '        );',
                '        if (fp3dPvSnow) {',
                '          this.fp3dPvSnows.add(fp3dPvSnow);',
                '          fp3dWritePvSnow(fp3dPvSnow, this.solarWatts);',
                '          part.add(fp3dPvSnow);',
                '        }',
                '      }',
                '',
            ].join('\n'),
            'snow: on the modules',
        );
    }
    return code;
}

/**
 * MJPEG camera streams (camera-url.ts): a camera's `entity_picture` that is a stream (e.g. the web extension of
 * ioBroker.frigate, `../frigate.0/<camera>/stream.mjpeg`) keeps its URL in every <img>, so the stream runs on instead of
 * being closed and opened again by the refresh counter `fp3d=` every few seconds. Stills and data URLs as before.
 * The camera projection (`projectedCameras`) and the picture rules (`pictureUrl`) keep the counter: their URL becomes a
 * WebGL texture through a TextureLoader, which reads only the first frame of a stream, so only a new URL refreshes it.
 */
function mjpegStreams(name: string, code: string): string {
    const still = (tick: string): string =>
        `(picture.startsWith("data:") ? picture : \`\${picture}\${picture.includes("?") ? "&" : "?"}fp3d=\${${tick}}\`)`;
    if (name === 'components/quick-menu.ts') {
        code = `import { cameraSrc as fp3dCameraSrc } from "${root}/frontend/vendor-ext/camera-url.ts";\n${code}`;
        code = replaceRequired(
            code,
            `const src = picture ? ${still('this._tick')} : null;`,
            'const src = picture ? fp3dCameraSrc(picture, this._tick) : null;',
            'mjpeg: quick menu',
        );
    }
    if (name === 'components/room-panel.ts') {
        code = `import { cameraSrc as fp3dCameraSrc } from "${root}/frontend/vendor-ext/camera-url.ts";\n${code}`;
        code = replaceRequired(
            code,
            `const src = picture && !isUnavailable(st) ? ${still('this._tick')} : null;`,
            'const src = picture && !isUnavailable(st) ? fp3dCameraSrc(picture, this._tick) : null;',
            'mjpeg: room panel',
        );
    }
    if (name === 'components/view3d.ts') {
        code = `import { cameraSrc as fp3dCameraSrc } from "${root}/frontend/vendor-ext/camera-url.ts";\n${code}`;
        code = replaceRequired(
            code,
            `return picture && st && !isUnavailable(st) ? ${still('this.cameraTick')} : null;`,
            'return picture && st && !isUnavailable(st) ? fp3dCameraSrc(picture, this.cameraTick) : null;',
            'mjpeg: camera wall',
        );
        code = replaceRequired(
            code,
            `const src = picture && !isUnavailable(cam) ? ${still('Date.now()')} : null;`,
            'const src = picture && !isUnavailable(cam) ? fp3dCameraSrc(picture, Date.now()) : null;',
            'mjpeg: detection pop-up',
        );
        code = replaceRequired(
            code,
            `const src = picture && !isUnavailable(st) ? ${still('this.cameraTick')} : null;`,
            'const src = picture && !isUnavailable(st) ? fp3dCameraSrc(picture, this.cameraTick) : null;',
            'mjpeg: look through',
        );
    }
    return code;
}

/**
 * Window style "pass_through": a pass-through (e.g. from the kitchen into the living room) — a window with its sill
 * and height, drawn only as the gap in the wall: no frame, no glass, no sash, no blind.
 */
function passThroughMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            'export const WINDOW_STYLES = ["standard", "bars", "glass_wall", "slide", "porthole"] as const;',
            'export const WINDOW_STYLES = ["standard", "bars", "glass_wall", "slide", "porthole", "pass_through"] as const;',
            'pass-through: style',
        );
    }
    if (name === 'viewer/openings.ts') {
        code = replaceRequired(
            code,
            '    } else if (openingStyle(info.opening, info.exterior) === "slide") {\n',
            [
                '    } else if (openingStyle(info.opening, info.exterior) === "pass_through") {',
                '      // a pass-through: nothing but the gap in the wall',
                '    } else if (openingStyle(info.opening, info.exterior) === "slide") {',
                '',
            ].join('\n'),
            'pass-through: drawn as a gap',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '      } else {\n        // two panes in the middle of the wall; a double window has a post in the middle\n',
            [
                '      } else if (style === "pass_through") {',
                '        // a pass-through: a dashed line in the gap, as a passage',
                '        const mid = (across[0] - across[1]) / 2;',
                '        symbol = svg`<line class="fp3d-open-passage" x1=${q(p0, mid)[0]} y1=${q(p0, mid)[1]} x2=${q(p1, mid)[0]} y2=${q(p1, mid)[1]} />`;',
                '      } else {',
                '        // two panes in the middle of the wall; a double window has a post in the middle',
                '',
            ].join('\n'),
            'pass-through: plan symbol',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  style_passage: "Durchbruch (ohne Tür)",',
            '  style_passage: "Durchbruch (ohne Tür)",\n  style_pass_through: "Durchreiche (ohne Rahmen und Glas)",',
            'pass-through de',
        );
        code = replaceRequired(
            code,
            '  style_passage: "Opening (no door)",',
            '  style_passage: "Opening (no door)",\n  style_pass_through: "Pass-through (no frame, no glass)",',
            'pass-through en',
        );
    }
    return code;
}

/**
 * Server (server.ts, home-view.ts, home-fx.ts): a 19" rack or a NAS whose LEDs follow its socket: dark while off, the
 * power LED green while on, the activity LEDs flickering the faster the more power it draws.
 */
function serverMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "rain_tank",\n] as const;',
            '  "rain_tank",\n  "server",\n] as const;',
            'server: furniture types',
        );
        code = replaceRequired(
            code,
            '"wall_socket", "wifi_ap", "water_heater"',
            '"wall_socket", "wifi_ap", "server", "water_heater"',
            'server: library group',
        );
        code = replaceRequired(
            code,
            '  rain_tank: [0.7, 0.7, 1],',
            '  rain_tank: [0.7, 0.7, 1],\n  // a 24-unit 19" rack (a NAS: 0.2 × 0.25 × 0.2)\n  server: [0.6, 0.8, 1.2],',
            'server: sizes',
        );
        code = replaceRequired(
            code,
            '  tank_capacity?: number | null;',
            '  tank_capacity?: number | null;\n  /** A server: "rack" (19" cabinet) or "nas". */\n  server_kind?: string | null;',
            'server: fields',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  wifi_ap: ["tech", []],',
            '  wifi_ap: ["tech", []],\n  server: ["tech", ["office"]],',
            'server: library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "rain_tank":',
            [
                '    case "server":',
                '      // a server from above: its body and its front',
                '      return [rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"), line(-w / 2, d / 2 - Math.min(0.06, d * 0.2), w / 2, d / 2 - Math.min(0.06, d * 0.2))];',
                '    case "rain_tank":',
            ].join('\n'),
            'server: symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "rain_tank":\n',
            '    case "server":\n    case "rain_tank":\n',
            'server: drawn by the home looks',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            furn_server: 'Server / NAS',
            server_kind: 'Art',
            server_rack: 'Serverschrank (19″)',
            server_nas: 'NAS / Mini-Server',
            server_entity: 'Steckdose (Schalter oder Leistung)',
            server_hint:
                'Die LEDs folgen der Steckdose: aus (oder unter 2 W) alles dunkel, an die grüne Betriebs-LED, und die Aktivitäts-LEDs flackern umso schneller, je mehr Leistung er zieht. Ist die Steckdose nicht erreichbar, blinkt die Betriebs-LED orange. Ohne Steckdose läuft er als Bild. Ein NAS steht auf der Höhe eines Regals oder Schreibtischs darunter.',
        };
        const en: Record<string, string> = {
            furn_server: 'Server / NAS',
            server_kind: 'Kind',
            server_rack: 'Server rack (19″)',
            server_nas: 'NAS / mini server',
            server_entity: 'Socket (switch or power)',
            server_hint:
                'The LEDs follow the socket: off (or below 2 W) all dark, on the green power LED, and the activity LEDs flicker the faster the more power it draws. If the socket cannot be reached, the power LED blinks amber. Without a socket it runs as a picture. A NAS stands at the height of a shelf or desk below it.',
        };
        const lines = (t: Record<string, string>): string =>
            Object.entries(t)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(
            code,
            '  furn_rain_tank: "Regenwassertank",',
            `  furn_rain_tank: "Regenwassertank",${lines(de)}`,
            'server de',
        );
        code = replaceRequired(
            code,
            '  furn_rain_tank: "Rainwater tank",',
            `  furn_rain_tank: "Rainwater tank",${lines(en)}`,
            'server en',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '"coffee_machine", "rain_tank"]);',
            '"coffee_machine", "rain_tank", "server"]);',
            'server: no state links',
        );
        code = replaceRequired(
            code,
            '    if (f.type === "rain_tank")\n',
            [
                '    if (f.type === "server")',
                '      return html`<div class="fp3d-form fp3d-links">',
                '        <label class="fp3d-field"',
                '          >${this.t("server_kind" as I18nKey)}',
                '          <select ?disabled=${!this.isAdmin} @change=${(e: Event) => { const k = (e.target as HTMLSelectElement).value; set(k === "nas" ? { server_kind: k, w: 0.2, d: 0.25, h: 0.2 } : { server_kind: null, w: 0.6, d: 0.8, h: 1.2 }); }}>',
                '            ${["rack", "nas"].map((k) => html`<option value=${k} ?selected=${k === (f.server_kind ?? "rack")}>${this.t(`server_${k}` as I18nKey)}</option>`)}',
                '          </select></label',
                '        >',
                '        ${this.entitySelect(this.t("server_entity" as I18nKey), f.entity ?? null, undefined, this.entityOptions((id) => /^(switch|sensor|binary_sensor|input_boolean)\\./.test(id)), (v) => set({ entity: pick(v) }))}',
                '        <p class="fp3d-sub fp3d-wide">${this.t("server_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    if (f.type === "rain_tank")',
                '',
            ].join('\n'),
            'server: form',
        );
    }
    if (name === 'viewer/preview.ts') {
        code = `import { buildServer as fp3dPrevServer } from "${root}/frontend/vendor-ext/server.ts";\n${code}`;
        code = replaceRequired(
            code,
            '          ? fp3dPrevRainTank("barrel", item.w, item.d, item.h, 0.6)\n          : null;',
            '          ? fp3dPrevRainTank("barrel", item.w, item.d, item.h, 0.6)\n          : item.type === "server"\n            ? fp3dPrevServer("rack", item.w, item.d, item.h)\n            : null;',
            'server: library picture',
        );
    }
    return code;
}

/**
 * Rainwater tank (rain-tank.ts, home-view.ts, home-fx.ts): a rain barrel or a cistern in the garden, filled to the level
 * of its sensor, with the litres over it; while it rains, water runs in from above.
 */
function rainTankMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "coffee_machine",\n] as const;',
            '  "coffee_machine",\n  "rain_tank",\n] as const;',
            'rain tank: furniture types',
        );
        code = replaceRequired(
            code,
            '"tree_fruit", "bush"],',
            '"tree_fruit", "bush", "rain_tank"],',
            'rain tank: library group',
        );
        code = replaceRequired(
            code,
            '  coffee_machine: [0.28, 0.4, 0.38],',
            '  coffee_machine: [0.28, 0.4, 0.38],\n  // a 300 l rain barrel (a cistern: deeper, wider, in the ground)\n  rain_tank: [0.7, 0.7, 1],',
            'rain tank: sizes',
        );
        code = replaceRequired(
            code,
            '  car_plate?: string | null;',
            [
                '  car_plate?: string | null;',
                '  /** A rainwater tank: "barrel" on the ground or "cistern" in it. */',
                '  rain_kind?: string | null;',
                '  /** What a rainwater tank holds when full (l); missing: from its size. */',
                '  tank_capacity?: number | null;',
            ].join('\n'),
            'rain tank: fields',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  bush: ["outdoor", ["garden"]],',
            '  bush: ["outdoor", ["garden"]],\n  rain_tank: ["outdoor", ["garden"]],',
            'rain tank: library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "coffee_machine":',
            [
                '    case "rain_tank":',
                '      // a rain barrel from above: its rim and its lid',
                '      return [circle(0, 0, Math.min(w, d) / 2, "fp3d-sym-strong"), circle(0, 0, Math.min(w, d) * 0.3)];',
                '    case "coffee_machine":',
            ].join('\n'),
            'rain tank: symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "coffee_machine":\n',
            '    case "rain_tank":\n    case "coffee_machine":\n',
            'rain tank: drawn by the home looks',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            furn_rain_tank: 'Regenwassertank',
            rain_tank_kind: 'Art',
            rain_tank_barrel: 'Regentonne',
            rain_tank_cistern: 'Zisterne (im Boden)',
            rain_tank_entity: 'Füllstand (%, l, m³ oder cm)',
            rain_tank_capacity: 'Inhalt voll (l, 0: aus der Größe)',
            rain_tank_hint:
                'Das Wasser steht so hoch, wie der Sensor meldet: in %, in Litern oder m³ des Inhalts oder als Wasserhöhe in cm oder m (die Höhe des Tanks ist voll). Darüber stehen Liter und Prozent, unter 10 % in der Warnfarbe. Eine Zisterne liegt im Boden und ist durch die Erde zu sehen. Solange es laut Wetter regnet, läuft Wasser hinein.',
        };
        const en: Record<string, string> = {
            furn_rain_tank: 'Rainwater tank',
            rain_tank_kind: 'Kind',
            rain_tank_barrel: 'Rain barrel',
            rain_tank_cistern: 'Cistern (in the ground)',
            rain_tank_entity: 'Level (%, l, m³ or cm)',
            rain_tank_capacity: 'Capacity when full (l, 0: from its size)',
            rain_tank_hint:
                'The water stands as high as the sensor reports: in %, in litres or m³ of the capacity, or as the water height in cm or m (the tank height is full). Litres and percent are shown above it, below 10 % in the warning colour. A cistern lies in the ground and is seen through the earth. While the weather says it rains, water runs in.',
        };
        const lines = (t: Record<string, string>): string =>
            Object.entries(t)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(
            code,
            '  furn_coffee_machine: "Kaffeemaschine",',
            `  furn_coffee_machine: "Kaffeemaschine",${lines(de)}`,
            'rain tank de',
        );
        code = replaceRequired(
            code,
            '  furn_coffee_machine: "Coffee machine",',
            `  furn_coffee_machine: "Coffee machine",${lines(en)}`,
            'rain tank en',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '"car_hatchback", "car_van"]);',
            '"car_hatchback", "car_van", "coffee_machine", "rain_tank"]);',
            'rain tank, coffee machine: no state links',
        );
        code = replaceRequired(
            code,
            '    if (f.type === "coffee_machine")\n',
            [
                '    if (f.type === "rain_tank")',
                '      return html`<div class="fp3d-form fp3d-links">',
                '        <label class="fp3d-field"',
                '          >${this.t("rain_tank_kind" as I18nKey)}',
                '          <select ?disabled=${!this.isAdmin} @change=${(e: Event) => { const k = (e.target as HTMLSelectElement).value; set(k === "cistern" ? { rain_kind: k, w: 2.2, d: 1.6, h: 1.5 } : { rain_kind: null, w: 0.7, d: 0.7, h: 1 }); }}>',
                '            ${["barrel", "cistern"].map((k) => html`<option value=${k} ?selected=${k === (f.rain_kind ?? "barrel")}>${this.t(`rain_tank_${k}` as I18nKey)}</option>`)}',
                '          </select></label',
                '        >',
                '        ${this.num(this.t("rain_tank_capacity" as I18nKey), f.tank_capacity ?? 0, (v) => set({ tank_capacity: v > 0 ? Math.round(v) : null }), 50, 0)}',
                '        ${this.entitySelect(this.t("rain_tank_entity" as I18nKey), f.entity ?? null, undefined, this.entityOptions((id) => id.startsWith("sensor.")), (v) => set({ entity: pick(v) }))}',
                '        <p class="fp3d-sub fp3d-wide">${this.t("rain_tank_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    if (f.type === "coffee_machine")',
                '',
            ].join('\n'),
            'rain tank: form',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '      surface: (f, x, z, h) => surfaceHeight(f as Floor, x, z, h),\n',
            [
                '      surface: (f, x, z, h) => surfaceHeight(f as Floor, x, z, h),',
                '      raining: /rain|pour/.test((weatherId ? hass.states[weatherId]?.state : "") ?? ""),',
                '',
            ].join('\n'),
            'rain tank: rain to the home looks',
        );
    }
    if (name === 'viewer/preview.ts') {
        code = `import { buildRainTank as fp3dPrevRainTank } from "${root}/frontend/vendor-ext/rain-tank.ts";\n${code}`;
        code = replaceRequired(
            code,
            '        ? fp3dPrevCoffee(item.w, item.d, item.h)\n        : null;',
            '        ? fp3dPrevCoffee(item.w, item.d, item.h)\n        : item.type === "rain_tank"\n          ? fp3dPrevRainTank("barrel", item.w, item.d, item.h, 0.6)\n          : null;',
            'rain tank: library picture',
        );
    }
    return code;
}

/**
 * Smoke and steam (kitchen.ts, home-view.ts, home-fx.ts): a coffee machine on the worktop that steams while it brews
 * (by its socket), and smoke that fills a room from the ceiling down when its smoke detector goes off.
 */
function kitchenMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "bush",\n] as const;',
            '  "bush",\n  "coffee_machine",\n] as const;',
            'kitchen: furniture types',
        );
        code = replaceRequired(
            code,
            '"dishwasher", "fridge"],',
            '"dishwasher", "fridge", "coffee_machine"],',
            'kitchen: library group',
        );
        code = replaceRequired(
            code,
            '  bush: [1.6, 1.6, 1.3],',
            '  bush: [1.6, 1.6, 1.3],\n  // a coffee machine on the worktop\n  coffee_machine: [0.28, 0.4, 0.38],',
            'kitchen: sizes',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  bush: ["outdoor", ["garden"]],',
            '  bush: ["outdoor", ["garden"]],\n  coffee_machine: ["appliance", ["kitchen"]],',
            'kitchen: library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "tree":\n    case "tree_fruit":',
            [
                '    case "coffee_machine":',
                '      // a coffee machine from above: its body, the tank at the back and the cup at the front',
                '      return [rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"), line(-w / 2, -d / 2 + d * 0.22, w / 2, -d / 2 + d * 0.22), circle(0, d / 2 - d * 0.22, Math.min(w, d) * 0.16)];',
                '    case "tree":',
                '    case "tree_fruit":',
            ].join('\n'),
            'kitchen: symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "tree":\n    case "tree_conifer":',
            '    case "coffee_machine":\n    case "tree":\n    case "tree_conifer":',
            'kitchen: drawn by the home looks',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            furn_coffee_machine: 'Kaffeemaschine',
            coffee_entity: 'Steckdose (Schalter oder Leistung)',
            coffee_hint: `Dampf steigt aus der Tasse, solange sie brüht: ein Schalter, der an ist, oder eine Leistung ab 300 W (ein Messwert in W oder kW). Steht sie auf einer Arbeitsplatte, steht sie auf deren Höhe.`,
        };
        const en: Record<string, string> = {
            furn_coffee_machine: 'Coffee machine',
            coffee_entity: 'Socket (switch or power)',
            coffee_hint:
                'Steam rises from the cup while it brews: a switch that is on, or a power of 300 W or more (a reading in W or kW). Placed on a worktop, it stands at its height.',
        };
        const lines = (t: Record<string, string>): string =>
            Object.entries(t)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(code, '  furn_bush: "Strauch",', `  furn_bush: "Strauch",${lines(de)}`, 'kitchen de');
        code = replaceRequired(code, '  furn_bush: "Bush",', `  furn_bush: "Bush",${lines(en)}`, 'kitchen en');
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '    if (FP3D_WATER_TYPES.has(f.type))\n',
            [
                '    if (f.type === "coffee_machine")',
                '      return html`<div class="fp3d-form fp3d-links">',
                '        ${this.entitySelect(this.t("coffee_entity" as I18nKey), f.entity ?? null, undefined, this.entityOptions((id) => /^(switch|sensor|binary_sensor|input_boolean)\\./.test(id)), (v) => set({ entity: pick(v) }))}',
                '        <p class="fp3d-sub fp3d-wide">${this.t("coffee_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    if (FP3D_WATER_TYPES.has(f.type))',
                '',
            ].join('\n'),
            'kitchen: form',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '      leaks: own.filter((a) => a.kind === "water" && !!a.roomId && !!a.floorId).map((a) => ({ entity: a.entity, roomId: a.roomId as string, floorId: a.floorId as string })),\n',
            [
                '      leaks: own.filter((a) => a.kind === "water" && !!a.roomId && !!a.floorId).map((a) => ({ entity: a.entity, roomId: a.roomId as string, floorId: a.floorId as string })),',
                '      smokes: own.filter((a) => a.kind === "smoke" && !!a.roomId && !!a.floorId).map((a) => ({ entity: a.entity, roomId: a.roomId as string, floorId: a.floorId as string })),',
                '      surface: (f, x, z, h) => surfaceHeight(f as Floor, x, z, h),',
                '',
            ].join('\n'),
            'kitchen: smoke and surfaces to the home looks',
        );
    }
    if (name === 'viewer/preview.ts') {
        code = `import { buildCoffeeMachine as fp3dPrevCoffee } from "${root}/frontend/vendor-ext/kitchen.ts";\n${code}`;
        code = replaceRequired(
            code,
            '      : null;\n  if (fp3dOwn) scene.add(fp3dOwn);',
            '      : item.type === "coffee_machine"\n        ? fp3dPrevCoffee(item.w, item.d, item.h)\n        : null;\n  if (fp3dOwn) scene.add(fp3dOwn);',
            'kitchen: library picture',
        );
    }
    return code;
}

/**
 * The weather beyond the condition: wind from own sensors or the weather entity (wind indicators "wind_vane" that turn
 * with it; on the sea the waves run with it, whitecaps from 4 Bft, gusts ruffle the water), rain rings on the sea and
 * wet surfaces, cloud shadows drifting with the wind, fog from the visibility or the dew point, and a warning when the
 * air pressure falls fast (frontend/vendor-ext/weather-data.ts, sky-shade.ts, wind-vane.ts, sea.ts).
 */
function weatherMore(name: string, code: string): string {
    const data = `${root}/frontend/vendor-ext/weather-data.ts`;
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "nav_light",\n] as const;',
            '  "nav_light",\n  "wind_vane",\n] as const;',
            'vane type',
        );
        code = replaceRequired(
            code,
            '"propeller", "nav_light"],',
            '"propeller", "nav_light", "wind_vane"],',
            'vane in the library',
        );
        code = replaceRequired(
            code,
            '  nav_light: [0.14, 0.14, 0.1],',
            '  nav_light: [0.14, 0.14, 0.1],\n  // a wind indicator: the length of its arrow, sock or flag\n  wind_vane: [0.8, 0.8, 0.3],',
            'vane size',
        );
        code = replaceRequired(
            code,
            '  sea_speed?: string | null;',
            [
                '  sea_speed?: string | null;',
                '  /** The wind: sensors of its speed (kn, km/h or m/s by the unit), the direction it comes from (°) and the gusts; else the weather entity. */',
                '  wind_speed?: string | null;',
                '  wind_dir?: string | null;',
                '  wind_gust?: string | null;',
                "  /** The air pressure: a fast fall (3 hPa in 3 h) shows a warning; else the weather entity's pressure. */",
                '  pressure_entity?: string | null;',
            ].join('\n'),
            'wind settings type',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  nav_light: ["boat", []],',
            '  nav_light: ["boat", []],\n  wind_vane: ["outdoor", []],',
            'vane in the library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "tank":\n',
            [
                '    case "wind_vane":',
                '      // a wind indicator: its post and an arrow',
                '      return [',
                '        circle(0, 0, 0.04, "fp3d-sym-strong"),',
                '        line(0, d / 2 - 0.03, 0, -d / 2 + 0.03, "fp3d-sym-strong"),',
                '        line(-w / 6, -d / 2 + 0.15, 0, -d / 2 + 0.03, "fp3d-sym-strong"),',
                '        line(w / 6, -d / 2 + 0.15, 0, -d / 2 + 0.03, "fp3d-sym-strong"),',
                '      ];',
                '    case "tank":',
                '',
            ].join('\n'),
            'vane symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "tank":\n',
            '    case "wind_vane":\n    case "tank":\n',
            'vane not as furniture',
        );
    }
    if (name === 'viewer/theme.ts') {
        code = `import { SKY_GLSL as FP3D_SKY_GLSL, skyUniforms as fp3dSkyUniforms } from "${root}/frontend/vendor-ext/sky-shade.ts";\n${code}`;
        code = replaceRequired(
            code,
            '    Object.assign(shader.uniforms, uniform.style ?? styleUniforms);',
            '    Object.assign(shader.uniforms, uniform.style ?? styleUniforms);\n    Object.assign(shader.uniforms, fp3dSkyUniforms);',
            'sky uniforms',
        );
        code = replaceRequired(
            code,
            '.replace("#include <common>", `#include <common>\\n${GLSL}`)',
            '.replace("#include <common>", `#include <common>\\n${FP3D_SKY_GLSL}\\n${GLSL}`)',
            'sky shader code',
        );
        code = replaceRequired(
            code,
            '      cc *= fp3dK * fp3dStyleFloor(cc, n);',
            '      cc *= fp3dK * fp3dStyleFloor(cc, n);\n      // under the open sky: cloud shadows, wet in the rain\n      cc = fp3dSky(cc, n, vFp3dWorld);',
            'sky on surfaces',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = [
            `import { skyUniforms as fp3dSkyUniforms } from "${root}/frontend/vendor-ext/sky-shade.ts";`,
            `import { CloudLayer as Fp3dCloudLayer } from "${root}/frontend/vendor-ext/clouds.ts";`,
            `import { NightSky as Fp3dNightSky, type MoonView as Fp3dMoonView } from "${root}/frontend/vendor-ext/night-sky.ts";`,
            `import { Rainbow as Fp3dRainbow } from "${root}/frontend/vendor-ext/rainbow.ts";`,
            `import { setSeaWeather as fp3dSetSeaWeather } from "${root}/frontend/vendor-ext/sea.ts";`,
            `import { gustiness as fp3dGustiness, type Wind as Fp3dWind } from "${data}";`,
            `import { animateVane as fp3dAnimateVane, buildVane as fp3dBuildVane, disposeVanes as fp3dDisposeVanes, vaneKey as fp3dVaneKey, type VaneScene as Fp3dVaneScene, type VaneState as Fp3dVane } from "${root}/frontend/vendor-ext/wind-vane.ts";`,
            code,
        ].join('\n');
        code = replaceRequired(
            code,
            "  /** Pool Pro: the pools' water colour, movement, heating shimmer and cover; an empty list clears them. */\n  setPools(",
            [
                '  /** The wind (m/s, the direction it comes from, gusts) for the sea, the clouds and the wind indicators; null: unknown. */',
                '  private fp3dWind: Fp3dWind | null = null;',
                '  private fp3dVanes: Fp3dVane[] = [];',
                '  private fp3dVaneGroup: Group | null = null;',
                '  private fp3dVaneSig = "";',
                '  /** Clouds drift, whitecaps and rain move on the sea, an indicator swings: frames keep coming. */',
                '  private fp3dSkyMoving = false;',
                '  private fp3dSkyClock = 0;',
                '  /** The clouds themselves, over their shadows (made when first shown). */',
                '  private fp3dClouds: Fp3dCloudLayer | null = null;',
                '  /** The stars and the moon with its phase (made when first shown); the moon from sun.sun (null: unknown). */',
                '  private fp3dNightSky: Fp3dNightSky | null = null;',
                '  private fp3dMoon: Fp3dMoonView | null = null;',
                '  /** The rainbow (made when the sky is first shown). */',
                '  private fp3dRainbow: Fp3dRainbow | null = null;',
                '',
                '  fp3dSetMoon(m: Fp3dMoonView | null): void {',
                '    if (JSON.stringify(m) === JSON.stringify(this.fp3dMoon)) return;',
                '    this.fp3dMoon = m;',
                '    this.placeSky();',
                '    this.invalidate();',
                '  }',
                '',
                '  fp3dSetWind(w: Fp3dWind | null): void {',
                '    if (JSON.stringify(w) === JSON.stringify(this.fp3dWind)) return;',
                '    this.fp3dWind = w;',
                '    this.invalidate();',
                '  }',
                '',
                '  fp3dSetVanes(list: Fp3dVane[]): void {',
                '    if (JSON.stringify(list) === JSON.stringify(this.fp3dVanes)) return;',
                '    this.fp3dVanes = list;',
                '    this.invalidate();',
                '  }',
                '',
                '  /** Where the wind blows to in the plan (rad, clockwise from the top of the plan); null: no direction known. */',
                '  private fp3dWindTo(): number | null {',
                '    const w = this.fp3dWind;',
                '    if (!w || w.from === null) return null;',
                '    return ((this.fp3dNorth() + w.from + 180) * Math.PI) / 180;',
                '  }',
                '',
                '  /** The sky over the plan every frame: cloud shadows, wet surfaces, the weather on the sea, the wind indicators. */',
                '  private fp3dSkyFrame(): void {',
                '    const t = this.flowTime.value;',
                '    const dt = Math.min(1, Math.max(0, t - this.fp3dSkyClock));',
                '    this.fp3dSkyClock = t;',
                '    const w = this.fp3dWind;',
                '    const to = this.fp3dWindTo();',
                '    const dir: [number, number] | null = to === null ? null : [Math.sin(to), -Math.cos(to)];',
                '    const gust = fp3dGustiness(w);',
                '    const weather = this.weather;',
                '    const u = fp3dSkyUniforms;',
                '    // the shadows of the clouds: by day, in a natural look, under a broken sky (an overcast one casts no patches)',
                '    const cover = weather?.cloud ?? 0;',
                '    const elev = this.sun?.elevation ?? -90;',
                '    const shadows = !!weather && this.style.natural && elev > 2 && !this.lowQuality && !this.options.safeFx && cover > 0.08 && cover < 0.97;',
                '    u.uFp3dCloud.value = shadows ? Math.min(1, (elev - 2) / 8) : 0;',
                '    u.uFp3dCover.value = cover;',
                '    // the clouds themselves, in the looks with a real sky: where their shadows fall, coloured by the weather and the time of day',
                '    const cloudsOn = !!weather && (this.theme === "day" || this.style.natural) && !this.lowQuality && !this.options.safeFx && cover > 0.08;',
                '    if ((shadows || cloudsOn) && dir && w) {',
                '      const drift = Math.min(6, 0.5 + 0.3 * w.speed) * dt;',
                '      u.uFp3dCloudOff.value.set((u.uFp3dCloudOff.value.x + dir[0] * drift) % 100000, (u.uFp3dCloudOff.value.y + dir[1] * drift) % 100000);',
                '    }',
                '    u.uFp3dWet.value = weather && this.style.natural && !this.lowQuality ? Math.min(1, weather.rain * 1.4) : 0;',
                '    // under the open sky: the deck of a boat (its top floor), the roofs of a house (above its top floor)',
                '    const top = [...this.floors].sort((p, q) => q.group.position.y - p.group.position.y)[0];',
                '    u.uFp3dSkyMinY.value = !top ? 1e6 : this.fp3dSea ? top.group.position.y - 0.05 : top.group.position.y + top.floor.height - 0.05;',
                '    const seaWind = weather && w ? w.speed : 0;',
                '    if (this.fp3dSeaMesh) fp3dSetSeaWeather(this.fp3dSeaMesh, { dir, wind: seaWind, gust: weather ? gust : 0, rain: weather?.rain ?? 0 }, dt);',
                '    if (cloudsOn && !this.fp3dClouds) {',
                '      this.fp3dClouds = new Fp3dCloudLayer();',
                '      this.root.add(this.fp3dClouds.mesh);',
                '    }',
                '    let cloudsShown = false;',
                '    if (this.fp3dClouds) {',
                '      const north = this.fp3dNorth() * (Math.PI / 180);',
                '      const az = this.sun ? this.sun.azimuth * (Math.PI / 180) : null;',
                '      const b = this.weatherBox;',
                '      const house = new Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);',
                '      const houseR = Math.hypot((b.x1 - b.x0) / 2 - 6, (b.z1 - b.z0) / 2 - 6, (b.y1 - b.y0) / 2);',
                '      cloudsShown = this.fp3dClouds.update({',
                '        cover: cloudsOn ? cover : 0,',
                '        rain: weather?.rain ?? 0,',
                '        storm: (weather as { lightning?: boolean } | null)?.lightning ? 1 : 0,',
                '        elevation: this.sun?.elevation ?? null,',
                '        toSun: az === null ? null : [Math.sin(north + az), -Math.cos(north + az)],',
                '        off: u.uFp3dCloudOff.value,',
                '        house,',
                '        houseR,',
                '        top: b.y1 - 6,',
                '      });',
                '    }',
                '    // the night sky: stars as it gets dark, the moon with its phase while it is up',
                '    const nightOn = !!weather && weather.disc !== false && !!this.sun && !this.lowQuality && !this.options.safeFx;',
                '    if (nightOn && !this.fp3dNightSky) {',
                '      this.fp3dNightSky = new Fp3dNightSky();',
                '      this.root.add(this.fp3dNightSky.group);',
                '    }',
                '    if (this.fp3dNightSky) {',
                '      this.fp3dNightSky.update(',
                '        {',
                '          moon: nightOn ? this.fp3dMoon : null,',
                '          sun: nightOn ? this.sun : null,',
                '          north: this.fp3dNorth(),',
                '          cover,',
                '          camera: this.camera,',
                '          time: t,',
                '        },',
                '        this.renderer.getPixelRatio(),',
                '      );',
                '    }',
                '    // a rainbow opposite the low sun while it rains or just rained',
                '    if (nightOn && !this.fp3dRainbow) {',
                '      this.fp3dRainbow = new Fp3dRainbow();',
                '      this.root.add(this.fp3dRainbow.mesh);',
                '    }',
                '    this.fp3dRainbow?.update({',
                '      sun: nightOn ? this.sun : null,',
                '      north: this.fp3dNorth(),',
                '      cover,',
                '      rain: weather?.rain ?? 0,',
                '      camera: this.camera,',
                '      now: Date.now(),',
                '    });',
                '    let moving = ((u.uFp3dCloud.value > 0 || cloudsShown) && !!dir && !!w && w.speed > 0.2) || (!!this.fp3dSeaMesh && !!weather && (seaWind >= 5.5 || weather.rain > 0 || gust > 0));',
                '    // the wind indicators: built anew when they or their floor changed, turned by the wind every frame',
                '    const light = this.theme === "day" || this.style.natural;',
                '    const parts: { v: Fp3dVane; scene: Fp3dVaneScene }[] = [];',
                '    for (const v of this.fp3dVanes) {',
                '      const fv = this.floorMap.get(v.floor);',
                '      if (!fv || !fv.group.visible || fv.o < 0.3) continue;',
                '      parts.push({ v, scene: { floorY: fv.group.position.y, light } });',
                '    }',
                '    const sig = parts.map((p) => fp3dVaneKey(p.v, p.scene)).join("|");',
                '    if (sig !== this.fp3dVaneSig) {',
                '      this.fp3dVaneSig = sig;',
                '      if (this.fp3dVaneGroup) {',
                '        this.root.remove(this.fp3dVaneGroup);',
                '        fp3dDisposeVanes(this.fp3dVaneGroup);',
                '        this.fp3dVaneGroup = null;',
                '      }',
                '      if (parts.length) {',
                '        const g = new Group();',
                '        for (const p of parts) g.add(fp3dBuildVane(p.v, p.scene));',
                '        this.root.add(g);',
                '        this.fp3dVaneGroup = g;',
                '      }',
                '    }',
                '    if (this.fp3dVaneGroup) {',
                '      const vw = to === null || !w ? null : { to, speed: w.speed, gust };',
                '      for (const c of this.fp3dVaneGroup.children) fp3dAnimateVane(c, vw, t);',
                '      if (vw && vw.speed > 0.3) moving = true;',
                '    }',
                '    this.fp3dSkyMoving = moving && !this.lowQuality;',
                '  }',
                '',
                "  /** Pool Pro: the pools' water colour, movement, heating shimmer and cover; an empty list clears them. */",
                '  setPools(',
            ].join('\n'),
            'sky: setWind',
        );
        code = replaceRequired(
            code,
            '    if (!sun || !w || w.disc === false || cloud > 0.85 || (!night && sun.elevation < 1)) {',
            '    if (!sun || !w || w.disc === false || cloud > 0.85 || (!night && sun.elevation < 1) || (night && !!this.fp3dMoon)) {',
            'moon: the night sky draws it',
        );
        code = replaceRequired(
            code,
            '    this.fp3dGearFrame();\n',
            '    this.fp3dGearFrame();\n    this.fp3dSkyFrame();\n',
            'sky: every frame',
        );
        code = replaceRequired(
            code,
            '|| this.fp3dSeaMoving || this.fp3dGearMoving;',
            '|| this.fp3dSeaMoving || this.fp3dGearMoving || this.fp3dSkyMoving;',
            'sky: frames while the clouds drift',
        );
        code = replaceRequired(
            code,
            '    this.sunFx.dispose();\n',
            '    this.sunFx.dispose();\n    this.fp3dClouds?.dispose();\n    this.fp3dNightSky?.dispose();\n    this.fp3dRainbow?.dispose();\n',
            'clouds: dispose',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            "    // the compass ring's letters: the first letter of each direction in the user's language\n",
            [
                '    // the moon and the stars: from sun.sun (frontend/moon.ts)',
                '    const fp3dSunNum = (k: string): number | null => (typeof sun?.[k] === "number" ? (sun[k] as number) : null);',
                '    const [fp3dMe, fp3dMa, fp3dMp, fp3dMf] = ["moon_elevation", "moon_azimuth", "moon_phase", "moon_fraction"].map(fp3dSunNum);',
                '    v.fp3dSetMoon(',
                '      this.sunFx !== false && fp3dMe !== null && fp3dMa !== null && fp3dMp !== null && fp3dMf !== null',
                '        ? { elevation: fp3dMe, azimuth: fp3dMa, phase: fp3dMp, fraction: fp3dMf, sidereal: fp3dSunNum("sidereal") ?? 0, latitude: fp3dSunNum("latitude") ?? 50 }',
                '        : null,',
                '    );',
                "    // the compass ring's letters: the first letter of each direction in the user's language",
                '',
            ].join('\n'),
            'moon from sun.sun',
        );
        code = `import { beaufort as fp3dBeaufort, compassPoint as fp3dCompass, defaultVaneY as fp3dVaneY, fogOf as fp3dFogOf, PressureLog as Fp3dPressureLog, pressureFall as fp3dPressureFall, pressureHpa as fp3dPressureHpa, stormLevel as fp3dStormLevel, windOf as fp3dWindOf, type Sample as Fp3dSample, type States as Fp3dStates } from "${data}";\n${code}`;
        code = replaceRequired(
            code,
            '    const weather = raw ? limitEffects(raw, b.settings.weather_effects) : null;\n',
            [
                '    // the wind: the own sensors while they report, else the weather entity; fog also from the visibility or the dew point',
                '    const fp3dWeatherId = weatherEntity(hass, this.weatherEntityId ?? b.settings.weather_entity);',
                '    const fp3dWind = fp3dWindOf(hass.states as unknown as Fp3dStates, { speed: b.settings.wind_speed, dir: b.settings.wind_dir, gust: b.settings.wind_gust, weather: fp3dWeatherId }, Date.now());',
                '    const fp3dFog = fp3dFogOf(fp3dWeatherId ? hass.states[fp3dWeatherId]?.attributes : null) ?? 0;',
                '    const fp3dRaw = raw ? { ...raw, fog: Math.max(raw.fog, fp3dFog), wind: fp3dWind ? Math.min(1, (fp3dWind.speed * 3.6) / 60) : raw.wind } : null;',
                '    const weather = fp3dRaw ? limitEffects(fp3dRaw, b.settings.weather_effects) : null;',
                '    // the air pressure: a fast fall warns of a storm and darkens the sky',
                '    this.fp3dPressure(hass, b.settings.pressure_entity ?? null, fp3dWeatherId);',
                '',
            ].join('\n'),
            'wind and fog',
        );
        code = replaceRequired(
            code,
            '(elevation + 4) / 16))) * (1 - 0.45 * this.cloud);',
            '(elevation + 4) / 16))) * (1 - 0.45 * this.cloud) * (1 - 0.2 * this.fp3dStormLevel);',
            'storm: a darker sky',
        );
        code = replaceRequired(
            code,
            '    this.watchLightning(!!weather?.lightning);\n',
            [
                '    this.watchLightning(!!weather?.lightning);',
                '    v.fp3dSetWind(fp3dWind);',
                '    // the wind indicators: speed in knots on a boat, else in km/h, the compass point and Beaufort over them',
                '    const fp3dBoat = typeof b.settings.sea_level === "number";',
                '    const fp3dLetter = (k: string) => translate(hass, k as I18nKey).charAt(0).toUpperCase();',
                '    const [fp3dN, fp3dE, fp3dS, fp3dW] = ["compass_n", "compass_e", "compass_s", "compass_w"].map(fp3dLetter);',
                '    const fp3dPoints = [fp3dN, fp3dN + fp3dE, fp3dE, fp3dS + fp3dE, fp3dS, fp3dS + fp3dW, fp3dW, fp3dN + fp3dW];',
                '    const fp3dWindSpeed = (ms: number) => `${formatNumber(hass, fp3dBoat ? ms / 0.514444 : ms * 3.6, 0)} ${fp3dBoat ? "kn" : "km/h"}`;',
                '    const fp3dWindText = fp3dWind',
                '      ? [',
                '          fp3dWindSpeed(fp3dWind.speed),',
                '          fp3dWind.from !== null ? fp3dCompass(fp3dWind.from, fp3dPoints) : "",',
                '          `${fp3dBeaufort(fp3dWind.speed)} Bft`,',
                '          fp3dWind.gust !== null && fp3dWind.gust - fp3dWind.speed >= 2.5 ? `${translate(hass, "wind_gusts" as I18nKey)} ${fp3dWindSpeed(fp3dWind.gust)}` : "",',
                '        ]',
                '          .filter(Boolean)',
                '          .join(" · ")',
                '      : "";',
                '    v.fp3dSetVanes(',
                '      b.floors.flatMap((fl) =>',
                '        fl.furniture',
                '          .filter((f) => f.type === "wind_vane")',
                '          .map((f) => {',
                '            const kind = f.gear_kind ?? "windex";',
                '            return {',
                '              id: f.id,',
                '              floor: fl.id,',
                '              x: f.x,',
                '              z: f.z,',
                '              kind,',
                '              size: f.w,',
                '              base: f.gear_y ?? fp3dVaneY(kind),',
                '              mast: !!f.gear_mast,',
                '              label: fp3dWindText,',
                '              warn: !!fp3dWind && (fp3dWind.speed >= 10.8 || (fp3dWind.gust ?? 0) >= 13.9),',
                '            };',
                '          }),',
                '      ),',
                '    );',
                '',
            ].join('\n'),
            'wind to the viewer',
        );
        code = replaceRequired(
            code,
            '  private renderAlerts() {\n    const b = this.building;\n    if (!this._alerts.length || !b) return nothing;\n    const shown = this._alerts.slice(0, 3);\n    return html`<div class="fp3d-alert-banner" role="alert">\n',
            [
                '  /** The air pressure seen while the page is open, and from the history of its sensor (read every ten minutes). */',
                '  private fp3dPressLog = new Fp3dPressureLog();',
                '  private fp3dPressHist: { id: string; at: number; samples: Fp3dSample[] } | null = null;',
                '  /** The warning of a falling pressure (empty: none) and how strong it is (0 … 2). */',
                '  private fp3dStorm = "";',
                '  private fp3dStormLevel = 0;',
                '',
                '  /** Follows the air pressure (the sensor, else the weather entity) and warns when it falls fast. */',
                '  private fp3dPressure(hass: HomeAssistant, sensor: string | null, weatherId: string | null): void {',
                '    const id = sensor && sensor !== "none" && hass.states[sensor] ? sensor : null;',
                '    const st = id ? hass.states[id] : undefined;',
                '    const wa = weatherId ? hass.states[weatherId]?.attributes : undefined;',
                '    const raw = parseFloat(String(st ? st.state : (wa?.pressure ?? "")));',
                '    const unit = String((st ? st.attributes.unit_of_measurement : wa?.pressure_unit) ?? "hPa");',
                '    const now = Date.now();',
                '    let fall: number | null = null;',
                '    if (Number.isFinite(raw) && !this.replay) {',
                '      const hpa = fp3dPressureHpa(raw, unit);',
                '      if (hpa > 800 && hpa < 1100) this.fp3dPressLog.add(now, hpa);',
                '      if (id && (!this.fp3dPressHist || this.fp3dPressHist.id !== id || now - this.fp3dPressHist.at > 10 * 60 * 1000)) {',
                '        this.fp3dPressHist = { id, at: now, samples: this.fp3dPressHist?.id === id ? this.fp3dPressHist.samples : [] };',
                '        void (hass.callWS({ type: "history/history_during_period", start_time: new Date(now - 3.5 * 3600 * 1000).toISOString(), end_time: new Date(now).toISOString(), entity_ids: [id], minimal_response: true, no_attributes: true }) as Promise<Record<string, { s: string; lu: number }[]>>)',
                '          .then((res) => {',
                '            if (this.fp3dPressHist?.id !== id) return;',
                '            this.fp3dPressHist.samples = (res?.[id] ?? []).map((r) => ({ t: r.lu * 1000, v: fp3dPressureHpa(parseFloat(r.s), unit) })).filter((s) => s.v > 800 && s.v < 1100);',
                '            this.requestUpdate();',
                '          })',
                '          .catch(() => {});',
                '      }',
                '      fall = fp3dPressureFall(this.fp3dPressLog.merged(this.fp3dPressHist?.id === id ? this.fp3dPressHist.samples : []), now);',
                '    }',
                '    const level = fp3dStormLevel(fall);',
                '    const text = level && fall !== null ? `${translate(hass, (level === 2 ? "storm_warning" : "storm_falling") as I18nKey)} ${formatNumber(hass, fall, 1)} hPa / 3 h` : "";',
                '    this.fp3dStormLevel = level;',
                '    if (text !== this.fp3dStorm) {',
                '      this.fp3dStorm = text;',
                '      this.requestUpdate();',
                '    }',
                '  }',
                '',
                '  private renderAlerts() {',
                '    const b = this.building;',
                '    if ((!this._alerts.length && !this.fp3dStorm) || !b) return nothing;',
                '    const shown = this._alerts.slice(0, 3);',
                '    return html`<div class="fp3d-alert-banner" role="alert">',
                '      ${this.fp3dStorm ? html`<span class="fp3d-alert ${this.fp3dStormLevel === 2 ? "" : "fp3d-alert-alarm_pending"}" title=${this.fp3dStorm}>${this.fp3dStorm}</span>` : nothing}',
                '',
            ].join('\n'),
            'storm warning',
        );
        code = replaceRequired(
            code,
            '${this._alerts.length ? "fp3d-has-alerts" : ""}',
            '${this._alerts.length || this.fp3dStorm ? "fp3d-has-alerts" : ""}',
            'storm: room for the banner',
        );
    }
    if (name === 'components/editor.ts') {
        code = `import { defaultVaneY as fp3dVaneY, VANE_KINDS as FP3D_VANE_KINDS } from "${data}";\n${code}`;
        code = replaceRequired(
            code,
            '"propeller", "nav_light"]);',
            '"propeller", "nav_light", "wind_vane"]);',
            'vane: no state links',
        );
        code = replaceRequired(
            code,
            '${fp3dIsGear(f.type) ? this.fp3dRenderGearForm(f) : nothing}',
            '${fp3dIsGear(f.type) ? this.fp3dRenderGearForm(f) : nothing} ${f.type === "wind_vane" ? this.fp3dRenderVaneForm(f) : nothing}',
            'vane form',
        );
        code = replaceRequired(
            code,
            "  /** A boat's gear: what a tank holds and its sensors, the rudder angle, the engine speed, a navigation light. */\n",
            [
                '  /** A wind indicator: which one, its height, whether a mast or pole is drawn; the wind comes from the house settings. */',
                '  private fp3dRenderVaneForm(f: Furniture) {',
                '    const kind = f.gear_kind ?? "windex";',
                '    return html`<div class="fp3d-form fp3d-links">',
                '      <label class="fp3d-field fp3d-wide"',
                '        >${this.t("vane_kind" as I18nKey)}',
                '        <select ?disabled=${!this.isAdmin} @change=${(e: Event) => this.updateFurniture({ gear_kind: (e.target as HTMLSelectElement).value })}>',
                '          ${FP3D_VANE_KINDS.map((k) => html`<option value=${k} ?selected=${k === kind}>${this.t(`vane_${k}` as I18nKey)}</option>`)}',
                '        </select></label',
                '      >',
                '      ${this.num(this.t("gear_y" as I18nKey), f.gear_y ?? fp3dVaneY(kind), (v) => this.updateFurniture({ gear_y: Math.round(Math.min(40, Math.max(0, v)) * 100) / 100 }), 0.1, 0)}',
                '      <label class="fp3d-check fp3d-wide"',
                '        ><input type="checkbox" ?disabled=${!this.isAdmin} .checked=${!!f.gear_mast} @change=${(e: Event) => this.updateFurniture({ gear_mast: (e.target as HTMLInputElement).checked || undefined })} />',
                '        ${this.t("vane_mast" as I18nKey)}</label',
                '      >',
                '      <p class="fp3d-sub fp3d-wide">${this.t("vane_hint" as I18nKey)}</p>',
                '    </div>`;',
                '  }',
                '',
                "  /** A boat's gear: what a tank holds and its sensors, the rudder angle, the engine speed, a navigation light. */",
                '',
            ].join('\n'),
            'vane form method',
        );
        code = replaceRequired(
            code,
            '              <p class="fp3d-sub fp3d-wide">${this.t("rain_entity_hint")}</p>`\n          : nothing}\n',
            [
                '              <p class="fp3d-sub fp3d-wide">${this.t("rain_entity_hint")}</p>`',
                '          : nothing}',
                '        ${this.hass',
                '          ? html`${(["wind_speed", "wind_dir", "wind_gust", "pressure_entity"] as const).map((key) =>',
                '                this.entitySelect(this.t(key as I18nKey), s[key] ?? null, undefined, this.entityOptions((id) => id.startsWith("sensor.")), (v) => set({ [key]: v === "none" ? null : v })),',
                '              )}',
                '              <p class="fp3d-sub fp3d-wide">${this.t("wind_hint" as I18nKey)}</p>`',
                '          : nothing}',
                '',
            ].join('\n'),
            'wind settings',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            furn_wind_vane: 'Windanzeiger',
            vane_kind: 'Art',
            vane_windex: 'Verklicker (Masttopp)',
            vane_sock: 'Windsack',
            vane_flag: 'Flagge',
            vane_mast: 'Mast bzw. Stange bis zur Etage zeichnen',
            vane_hint:
                'Dreht sich mit dem Wind aus ⚙ → Haus (Wind-Sensoren) oder aus der Wetter-Entität: Der Verklicker zeigt in den Wind, Windsack und Flagge wehen mit ihm. Der Windsack steht ab 15 kn waagerecht, Böen lassen alle schwingen. Darüber stehen Wind, Richtung und Beaufort. Breite = Länge von Pfeil, Sack oder Flagge.',
            wind_speed: 'Wind (Sensor)',
            wind_dir: 'Windrichtung (Sensor, ° woher)',
            wind_gust: 'Böen (Sensor)',
            pressure_entity: 'Luftdruck (Sensor)',
            wind_hint:
                'Wind in kn, km/h oder m/s (nach der Einheit) und die Richtung, aus der er kommt (wahrer Wind, 0 = Norden). Ohne Sensor, oder wenn er seit einer Stunde nichts meldet, gilt der Wind der Wetter-Entität. Der Wind dreht die Windanzeiger, auf dem Meer laufen die Wellen mit ihm, ab 4 Bft mit Schaumkronen, Böen kräuseln das Wasser, die Wolkenschatten ziehen mit ihm. Fällt der Luftdruck in 3 Stunden um 3 hPa oder mehr, erscheint eine Warnung und der Himmel wird dunkler.',
            wind_gusts: 'Böen',
            storm_falling: 'Luftdruck fällt:',
            storm_warning: 'Sturmwarnung, Luftdruck fällt:',
        };
        const en: Record<string, string> = {
            furn_wind_vane: 'Wind indicator',
            vane_kind: 'Kind',
            vane_windex: 'Windex (masthead)',
            vane_sock: 'Windsock',
            vane_flag: 'Flag',
            vane_mast: 'Draw a mast or pole down to the floor',
            vane_hint:
                'Turns with the wind from ⚙ → House (wind sensors) or from the weather entity: the windex points into the wind, the windsock and the flag fly with it. The windsock stands out straight from 15 kn, gusts make them all swing. Above it: wind, direction and Beaufort. Width = length of the arrow, sock or flag.',
            wind_speed: 'Wind (sensor)',
            wind_dir: 'Wind direction (sensor, ° from)',
            wind_gust: 'Gusts (sensor)',
            pressure_entity: 'Air pressure (sensor)',
            wind_hint:
                'Wind in kn, km/h or m/s (by the unit) and the direction it comes from (true wind, 0 = north). Without a sensor, or when it has not reported for an hour, the wind of the weather entity counts. The wind turns the wind indicators; on the sea the waves run with it, with whitecaps from 4 Bft, gusts ruffle the water, the cloud shadows drift with it. When the air pressure falls by 3 hPa or more in 3 hours, a warning shows and the sky gets darker.',
            wind_gusts: 'gusts',
            storm_falling: 'Pressure falling:',
            storm_warning: 'Storm warning, pressure falling:',
        };
        const lines = (t: Record<string, string>): string =>
            Object.entries(t)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(
            code,
            '  furn_nav_light: "Positionslicht",',
            `  furn_nav_light: "Positionslicht",${lines(de)}`,
            'wind de',
        );
        code = replaceRequired(
            code,
            '  furn_nav_light: "Navigation light",',
            `  furn_nav_light: "Navigation light",${lines(en)}`,
            'wind en',
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
                '    const fp3dReach = this.hass?.states[pl.entity_id]?.attributes.iobroker_reach as "report" | "never" | number | undefined;',
                '    const fp3dSetReach = (reach: "report" | "never" | number | null) => window.dispatchEvent(new CustomEvent("iobroker-reach", { detail: { entityId: pl.entity_id, reach } }));',
                '    // the battery of the device: found (type-detector, else by name and role) or chosen here; it counts for the whole device',
                '    const fp3dAttrs = this.hass?.states[pl.entity_id]?.attributes ?? {};',
                '    const fp3dBattery = fp3dAttrs.iobroker_battery_id as string | null | undefined;',
                '    const fp3dBatteryOwn = fp3dAttrs.iobroker_battery_own as string | undefined;',
                '    const fp3dBatteryFrom = fp3dAttrs.iobroker_battery_from as string | undefined;',
                '    const fp3dSetBattery = (detail: { pick?: boolean; battery?: string | null }) =>',
                '      window.dispatchEvent(',
                '        new CustomEvent("iobroker-battery", {',
                '          detail: {',
                '            entityId: pl.entity_id,',
                '            current: fp3dBattery ?? null,',
                '            device: fp3dAttrs.health_device ? Object.values(this.hass?.states ?? {}).filter((s) => s.attributes.health_device === fp3dAttrs.health_device).map((s) => s.entity_id) : [],',
                '            ...detail,',
                '          },',
                '        }),',
                '      );',
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
                '          </p>',
                '          <div class="fp3d-form">',
                '            <label class="fp3d-field fp3d-wide"',
                '              >${this.t("device_reach" as I18nKey)}',
                '              <select',
                '                ?disabled=${!admin}',
                '                @change=${(e: Event) => {',
                '                  const v = (e.target as HTMLSelectElement).value;',
                '                  fp3dSetReach(v === "minutes" ? 15 : v === "report" || v === "never" ? v : null);',
                '                }}',
                '              >',
                '                ${(["", "report", "minutes", "never"] as const).map(',
                '                  (k) => html`<option value=${k} ?selected=${k === (typeof fp3dReach === "number" ? "minutes" : (fp3dReach ?? ""))}>${this.t(`device_reach_${k || "house"}` as I18nKey)}</option>`,',
                '                )}',
                '              </select></label',
                '            >',
                '            ${typeof fp3dReach === "number" && admin ? this.num(this.t("device_reach_min" as I18nKey), fp3dReach, (v) => fp3dSetReach(Math.round(Math.min(10080, Math.max(1, v)))), 1, 1) : nothing}',
                '            <label class="fp3d-check fp3d-wide"',
                '              ><input',
                '                type="checkbox"',
                '                ?disabled=${!admin}',
                '                .checked=${!!this.hass?.states[pl.entity_id]?.attributes.iobroker_reach_connected}',
                '                @change=${(e: Event) => window.dispatchEvent(new CustomEvent("iobroker-reach", { detail: { entityId: pl.entity_id, connected: (e.target as HTMLInputElement).checked } }))}',
                '              />',
                '              ${this.t("device_reach_connected" as I18nKey)}</label',
                '            >',
                '            <div class="fp3d-field fp3d-wide">',
                '              ${this.t("device_battery" as I18nKey)}',
                '              <span class="fp3d-datapoint">',
                '                ${fp3dBattery ? html`<code>${fp3dBattery}</code>` : html`<span>${this.t((fp3dBatteryOwn === "none" ? "device_battery_none" : "device_battery_missing") as I18nKey)}</span>`}',
                '                ${fp3dBatteryFrom ? html`<small class="fp3d-sub">(${this.t(`device_battery_${fp3dBatteryFrom}` as I18nKey)})</small>` : nothing}',
                '              </span>',
                '              ${admin',
                '                ? html`<span class="fp3d-datapoint">',
                '                    <button class="fp3d-btn" @click=${() => fp3dSetBattery({ pick: true })}>${this.t("device_battery_pick" as I18nKey)}</button>',
                '                    ${fp3dBatteryOwn !== "none" ? html`<button class="fp3d-btn" @click=${() => fp3dSetBattery({ battery: "none" })}>${this.t("device_battery_no" as I18nKey)}</button>` : nothing}',
                '                    ${fp3dBatteryFrom === "own" ? html`<button class="fp3d-btn" @click=${() => fp3dSetBattery({ battery: null })}>${this.t("device_battery_auto" as I18nKey)}</button>` : nothing}',
                '                  </span>`',
                '                : nothing}',
                '            </div>',
                '          </div>',
                '          <p class="fp3d-sub">${this.t("device_reach_hint" as I18nKey)}</p>`',
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
            '  marker_height: "Höhe des Symbols (m)",\n  datapoint: "Datenpunkt",\n  datapoint_change: "Ändern …",\n  datapoint_add: "+ Datenpunkt aus ioBroker",\n  device_reach: "Nicht erreichbar (Technik)",\n  device_reach_house: "Standard (⚙ Wetter & Warnungen)",\n  device_reach_report: "Wie das Gerät meldet",\n  device_reach_minutes: "Nach … Minuten ohne Update",\n  device_reach_never: "Nie (z. B. 12-V-Gerät, das abgeschaltet wird)",\n  device_reach_min: "Minuten ohne Update",\n  device_reach_connected: "Nur prüfen, solange sein Adapter verbunden ist (z. B. NMEA: Instrumente aus = normal)",\n  device_battery: "Batterie (Technik)",\n  device_battery_detector: "gefunden vom type-detector",\n  device_battery_guess: "vermutet nach Name und Rolle",\n  device_battery_own: "selbst gewählt",\n  device_battery_missing: "keine gefunden",\n  device_battery_none: "keine Batterie",\n  device_battery_pick: "Wählen …",\n  device_battery_no: "Keine Batterie",\n  device_battery_auto: "Automatisch",\n  device_reach_hint: "Gilt für das ganze Gerät, auch seine anderen Datenpunkte. Batteriegeräte schlafen zwischen zwei Meldungen: „Nach … Minuten“ mit etwas mehr als ihrem Sendeabstand. Geräte am Bordnetz, die mit ihm abgeschaltet werden: „Nie“ – dann zählt auch ein getrennter Adapter nicht. Die Batterie sucht zuerst der type-detector, sonst Name und Rolle; findet keiner die richtige, wähle sie hier (eine Zahl: Ladung in %, true/false: Batterie schwach).",',
            'datapoint de',
        );
        code = replaceRequired(
            code,
            '  marker_height: "Marker height (m)",',
            '  marker_height: "Marker height (m)",\n  datapoint: "Datapoint",\n  datapoint_change: "Change …",\n  datapoint_add: "+ Datapoint from ioBroker",\n  device_reach: "Unreachable (Technik)",\n  device_reach_house: "Default (⚙ Weather & warnings)",\n  device_reach_report: "As the device reports",\n  device_reach_minutes: "After … minutes without an update",\n  device_reach_never: "Never (e.g. a 12 V device that is switched off)",\n  device_reach_min: "Minutes without an update",\n  device_reach_connected: "Check only while its adapter is connected (e.g. NMEA: instruments off = normal)",\n  device_battery: "Battery (Health)",\n  device_battery_detector: "found by the type-detector",\n  device_battery_guess: "guessed by name and role",\n  device_battery_own: "chosen here",\n  device_battery_missing: "none found",\n  device_battery_none: "no battery",\n  device_battery_pick: "Choose …",\n  device_battery_no: "No battery",\n  device_battery_auto: "Automatic",\n  device_reach_hint: "Counts for the whole device, also its other datapoints. Battery devices sleep between their reports: after … minutes with a little more than their interval. Devices on the on-board supply that are switched off with it: never – then a disconnected adapter does not count either.",',
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
        // every look right in the menu "Anzeige" (the same choice as behind ⚙), not only behind ⚙
        code = replaceRequired(
            code,
            '          <div class="fp3d-seg" title=${this.t("plain_hint")}>',
            `          <div class="fp3d-seg" role="group" aria-label=\${this.t("style")}>
            <label class="fp3d-style-pick fp3d-menu-style" title=\${this.t("style")}>
              <span aria-hidden="true">🎨</span>
              <select
                aria-label=\${this.t("style")}
                @change=\${(e: Event) => {
                  this._theme = (e.target as HTMLSelectElement).value;
                  prefs.set("theme", this._theme);
                }}
              >
                \${styleOptions((k) => this.t(k), this._theme, { auto: true, house: true })}
              </select>
            </label>
          </div>
          <div class="fp3d-seg" title=\${this.t("plain_hint")}>`,
            'looks in the menu',
        );
        code = replaceRequired(
            code,
            '      .fp3d-opts-btn {\n',
            '      .fp3d-menu-style {\n        flex: 1;\n      }\n      .fp3d-menu-style select {\n        width: 100%;\n        max-width: none;\n      }\n      .fp3d-opts-btn {\n',
            'looks in the menu: width',
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
            code = (await readFile(join(root, 'frontend/entity-picker.ts'), 'utf8'))
                .replace('./picker-styles.js', '../styles.ts')
                // a copy of its own in this bundle: it reads the language from <html lang>, set by the page
                .replace("from './lang.js'", `from "${root}/frontend/lang.ts"`);
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
        code = keepEditorView(name, code);
        code = tvAppLogo(name, code);
        code = wheelOverLabels(name, code);
        code = panHint(name, code);
        code = sensorLook(name, code);
        code = editorDevices(name, code);
        code = markerLooks(name, code);
        code = solarText(name, code);
        code = sunArcFloor(name, code);
        code = keepFloor(name, code);
        code = deviceDatapoint(name, code);
        code = boatHeading(name, code);
        code = gpsPosition(name, code);
        code = kioskMode(name, code);
        code = seaWaves(name, code);
        code = timeTravelSource(name, code);
        code = boatAnchor(name, code);
        code = boatGear(name, code);
        code = upwardWindows(name, code);
        code = weatherMore(name, code);
        code = homeMore(name, code);
        code = treesMore(name, code);
        code = kitchenMore(name, code);
        code = rainTankMore(name, code);
        code = serverMore(name, code);
        code = tapMore(name, code);
        code = passThroughMore(name, code);
        code = mjpegStreams(name, code);
        code = snowMore(name, code);
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
            // Russian: our own language file (frontend/public/vendor/lang/ru.json)
            code = replaceRequired(code, '"pt", "tr"] as const;', '"pt", "tr", "ru"] as const;', 'Russian');
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
