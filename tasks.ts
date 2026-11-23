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

/** How much larger than upstream the cameras are drawn: a target the mouse hits easily (the beam starts at the lens). */
const CAMERA_SCALE = 1.8;

/**
 * A camera's field-of-view wedge starts at its lens, not on the floor under it: from there it falls to the floor it
 * sees, so the beam hangs at the camera instead of lying at another height (a wall camera at 1.8 m, its wedge on the
 * floor). Seen from above it stays the same wedge. Wall camera: the lens 0.1 m in front of the body, 0.055 m above
 * its mount height (pushCameraModel, both times CAMERA_SCALE); dome: just under the ceiling.
 */
function cameraBeam(name: string, code: string): string {
    if (name !== 'viewer/viewer3d.ts') {
        return code;
    }
    const k = CAMERA_SCALE;
    // the wall camera grows from its bracket at the wall (0.06 m behind its point), the dome from the ceiling down
    const ahead = (-0.06 + (0.1 + 0.06) * k).toFixed(3);
    code = replaceRequired(
        code,
        'const apex = [d.x, Math.max(groundAt(d.x, d.z), dome ? -Infinity : groundAt(d.x + dir[0] * 0.3, d.z + dir[1] * 0.3)), d.z];',
        `const apex = dome ? [d.x, H - ${(0.07 * k).toFixed(3)}, d.z] : [d.x + dir[0] * ${ahead}, d.y + ${(0.055 * k).toFixed(3)}, d.z + dir[1] * ${ahead}];`,
        'camera beam from the lens',
    );
    // looking through it: the eye in front of the larger lens (0.15 m ahead of its point was inside the body now)
    return replaceRequired(
        code,
        'target: new Vector3(d.x, y, d.z).addScaledVector(dir, 3.15), radius: 3,',
        `target: new Vector3(d.x, y, d.z).addScaledVector(dir, ${(3 + 0.17 * k).toFixed(2)}), radius: 3,`,
        'look through a camera in front of its lens',
    );
}

/**
 * The camera models CAMERA_SCALE times larger: the wall camera from its bracket at the wall into the room and up and
 * down from its mount height, the dome from the ceiling down. A tap on the model opens the camera.
 */
function cameraSize(name: string, code: string): string {
    if (name !== 'viewer/furniture.ts') {
        return code;
    }
    return replaceRequired(
        code,
        [
            '  if (model === "camera_ceiling") {',
            '    // dome: a flat base and a half-dome below it',
            '    b.cyl(0, 0, 0.07, y - 0.03, y, body, bodyTop, 12);',
            '    b.loft([-0.05, 0.05, -0.05, 0.05], [-0.025, 0.025, -0.025, 0.025], y - 0.1, y - 0.03, lens, body);',
            '    b.cyl(0, 0, 0.012, y - 0.075, y - 0.06, C.accent, C.accent, 6);',
            '    return;',
            '  }',
            '  // wall camera: bracket at the wall (-z), body pointing into the room (+z), lens in front',
            '  b.box(-0.02, 0.02, y - 0.02, y + 0.02, -0.06, -0.03, body, bodyTop);',
            '  b.box(-0.01, 0.01, y - 0.01, y + 0.06, -0.05, -0.03, body, bodyTop);',
            '  b.loft([-0.035, 0.035, -0.03, 0.09], [-0.04, 0.04, -0.03, 0.09], y + 0.02, y + 0.09, body, bodyTop);',
            '  b.lyingCyl("z", 0, 0.1, y + 0.03, y + 0.08, 0.03, 0.05, lens, C.accent, 10);',
            '  b.box(-0.006, 0.006, y + 0.075, y + 0.085, 0.085, 0.09, 0xff3b4f, 0xff3b4f);',
            '}',
        ].join('\n'),
        [
            `  // drawn ${CAMERA_SCALE} times the first size, an easier target: across (k), up and down from the mount (Y), from the wall (Z)`,
            `  const k = ${CAMERA_SCALE};`,
            '  const Y = (v: number) => y + v * k;',
            '  const Z = (v: number) => -0.06 + (v + 0.06) * k;',
            '  if (model === "camera_ceiling") {',
            '    // dome: a flat base and a half-dome below it',
            '    b.cyl(0, 0, 0.07 * k, Y(-0.03), y, body, bodyTop, 12);',
            '    b.loft([-0.05 * k, 0.05 * k, -0.05 * k, 0.05 * k], [-0.025 * k, 0.025 * k, -0.025 * k, 0.025 * k], Y(-0.1), Y(-0.03), lens, body);',
            '    b.cyl(0, 0, 0.012 * k, Y(-0.075), Y(-0.06), C.accent, C.accent, 6);',
            '    return;',
            '  }',
            '  // wall camera: bracket at the wall (-z), body pointing into the room (+z), lens in front',
            '  b.box(-0.02 * k, 0.02 * k, Y(-0.02), Y(0.02), Z(-0.06), Z(-0.03), body, bodyTop);',
            '  b.box(-0.01 * k, 0.01 * k, Y(-0.01), Y(0.06), Z(-0.05), Z(-0.03), body, bodyTop);',
            '  b.loft([-0.035 * k, 0.035 * k, Z(-0.03), Z(0.09)], [-0.04 * k, 0.04 * k, Z(-0.03), Z(0.09)], Y(0.02), Y(0.09), body, bodyTop);',
            '  b.lyingCyl("z", 0, Z(0.1), Y(0.03), Y(0.08), 0.03 * k, 0.05 * k, lens, C.accent, 10);',
            '  b.box(-0.006 * k, 0.006 * k, Y(0.075), Y(0.085), Z(0.085), Z(0.09), 0xff3b4f, 0xff3b4f);',
            '}',
        ].join('\n'),
        'larger cameras',
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
    code = `import { ICON_GROUPS as FP3D_ICON_GROUPS, markerInk as fp3dMarkerInk } from "${look}";\n${code}`;
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
            '        max-height: 300px;',
            '        overflow-y: auto;',
            '        padding-right: 4px;',
            '      }',
            '      .fp3d-icon-group {',
            '        flex: 0 0 100%;',
            '        margin: 8px 0 2px;',
            '        font-size: 11px;',
            '        color: var(--fp3d-muted);',
            '      }',
            '      .fp3d-icon-group:first-child {',
            '        margin-top: 0;',
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
            '        ${FP3D_ICON_GROUPS.map((g) => html`<div class="fp3d-icon-group">${this.t(`icon_group_${g.id}` as I18nKey)}</div>${g.icons.map((n) => html`<button type="button" class=${n === value?.replace(/^mdi:/, "") ? "fp3d-icon-pick fp3d-icon-pick-on" : "fp3d-icon-pick"} title=${n} ?disabled=${!this.isAdmin} @click=${() => onChange(n === value?.replace(/^mdi:/, "") ? null : n)}>${unsafeHTML(`<ha-icon icon="mdi:${n}"></ha-icon>`)}</button>`)}`)}',
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
 * Energy and household are called just "Energie" and "Haushalt", without "Pro". The pool's module is built in
 * (pool-module.ts, poolMore). Sound (a now-playing card over every playing speaker or player with its cover, title,
 * buttons and volume, rings around it, lines between grouped players) and screens (a TV shows its app's colour and
 * its cover) need nothing but the states and the players' actions.
 */
const SERVED = ['weather', 'time_travel', 'energy_pro', 'household', 'pool', 'sound', 'screens'];

/**
 * The fun extras, drawn by the page alone: pets, the Halloween ghost, the fairy lights along the eaves in Advent, snow
 * while it snows and the firework at New Year (their decorations of the furniture library came in packs: not here).
 */
const FUN_EXTRAS = ['fun_pets', 'fun_halloween', 'fun_winter'];

/** The served add-ons and the fun extras count as unlocked without a pack. */
function unlockServed(name: string, code: string): string {
    if (name !== 'features.ts') {
        return code;
    }
    return replaceRequired(
        code,
        '  const out = new Set<Feature>();',
        `  const out = new Set<Feature>(${JSON.stringify([...SERVED, ...FUN_EXTRAS])} as Feature[]);`,
        'served add-ons',
    );
}

/**
 * A method of a class of the 3D frontend (indented by two spaces, its body ends at the first line "  }") gets another
 * body; `signature` is the part before " {".
 */
function replaceMethod(code: string, signature: string, body: string, label: string): string {
    const head = `\n  ${signature} {\n`;
    const at = code.indexOf(head);
    const end = at < 0 ? -1 : code.indexOf('\n  }\n', at);
    if (at < 0 || end < 0 || code.indexOf(head, at + 1) >= 0) {
        throw new Error(`Upstream patch no longer matches: ${label}`);
    }
    return `${code.slice(0, at)}\n  ${signature} {\n    ${body}\n  }\n${code.slice(end + '\n  }\n'.length)}`;
}

/** Replaces every occurrence of `text`, which must occur `count` times. */
function replaceEvery(code: string, text: string, replacement: string, label: string, count: number): string {
    const parts = code.split(text);
    if (parts.length - 1 !== count) {
        throw new Error(`Upstream patch no longer matches: ${label} (${parts.length - 1} times)`);
    }
    return parts.join(replacement);
}

/**
 * Texts of the shop, the customer account, the licence, the supporter pass, the newsletter, the gifts, the Pro
 * teasers and the usage reports to the shop's server: emptied in de/en (and taken out of the language files), as
 * nothing shows them any more (`noShop`).
 */
const SHOP_TEXTS =
    /^(?:(?:license|offers|supporter|print|nl|gift|news|beta|ext|diag)_\w+|pro_(?:feature_\w+|title|locked|shop|unlock)|fun_(?:intro|in_account|register|register_steps|moved|open_settings)|(?:halloween|winter)_deco_hint|pack_(?:pro_module|fun_module|features|needs_module|licensed|error_wrong_instance)|modules_pro_note|module_(?:import_hint|waits_where|imported_waits)|card_pro_hint|tt_locked|auto_pro_teaser|chk_pro_(?:active|get)|energy_pro_active(?:_hint)?|hh_teaser_\w+|household_teaser_\w+|solar_pro_\w+)$/;

/**
 * The voice assistant of ioBroker is the adapter "Assistant": the 3D view's texts name it so, in every language
 * (i18n.ts, the microphone test in mic-probe.ts and the language files). A whole word only: "Home Assistant" has become "ioBroker" before, and
 * "HomeAssistant" in code is not touched.
 */
function assistantName(text: string): string {
    return text.replace(/\bAssist\b/g, 'Assistant');
}

/** de and en of a key of the 3D view's i18n. */
function setTexts(code: string, key: string, de: string, en: string): string {
    const texts = [de, en];
    let i = 0;
    const next = code.replace(new RegExp(String.raw`^ {2}${key}: "(?:[^"\\]|\\.)*",$`, 'gm'), line =>
        i < 2 ? `  ${key}: ${JSON.stringify(texts[i++])},` : line,
    );
    if (i !== 2) {
        throw new Error(`Upstream patch no longer matches: texts of ${key}`);
    }
    return next;
}

/**
 * Everything is free in ioBroker: no customer account, no shop, no licence, no supporter pass, no newsletter and no
 * "Pro". What the 3D view showed of them goes: the extensions page (also by `?tab=extensions` and the buttons that
 * opened it), the gift and the news, the teasers and locks of add-ons, the module import (modules came from the shop
 * as signed packs) and the usage reports to the shop's server. Add-ons whose backend is missing here (camera cockpit,
 * car) are left out instead of being offered. The fun extras are unlocked (`FUN_EXTRAS`); the ghost comes only when
 * switched on.
 */
function noShop(name: string, code: string): string {
    if (name === 'features.ts') {
        code = replaceRequired(
            code,
            'export function released(feature: Gated): boolean {\n',
            'export function released(feature: Gated): boolean {\n  // the usage reports went to the shop\'s server\n  if (feature === "diagnostics") return false;\n',
            'no usage reports',
        );
    }
    if (name === 'panel.ts') {
        code = replaceRequired(
            code,
            '    if (query.get("tab") === "extensions") this._mode = "extensions";\n',
            '',
            'no link to the extensions',
        );
        code = replaceEvery(
            code,
            '@open-extensions=${() => this.setMode("extensions")}',
            '',
            'no extensions buttons',
            2,
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceMethod(code, 'private renderNews()', 'return nothing;', 'no news of the shop');
        // the extensions page (shop connection, packs, offers, supporters, newsletter) is not even loaded
        code = replaceRequired(
            code,
            '// the extensions page is part of this bundle: the panel loads it the same way as the editor\nimport "./extensions.ts";\n',
            '',
            'no extensions page',
        );
        code = replaceRequired(
            code,
            '      { key: "modules", icon: "🧩", label: this.t("settings_modules"), admin: true },\n',
            '',
            'no module import',
        );
        code = replaceRequired(
            code,
            '      { key: "director", icon: "🎬", label: this.t("card_director"), admin: true },',
            '      ...(hasFeature("camera_cockpit") ? [{ key: "director" as const, icon: "🎬", label: this.t("card_director"), admin: true }] : []),',
            'director only with the camera cockpit',
        );
        code = replaceRequired(
            code,
            '      ${pro ? nothing : html`<p class="fp3d-sub">🔒 ${this.t("pro_feature_camera_cockpit")}</p>`}\n',
            '',
            'no lock of the director',
        );
        code = replaceRequired(
            code,
            '  private renderCameraDetections(cameraId: string) {\n    if (!this.hass) return nothing;',
            '  private renderCameraDetections(cameraId: string) {\n    if (!this.hass || !hasFeature("camera_cockpit")) return nothing;',
            'detections only with the camera cockpit',
        );
        code = replaceRequired(
            code,
            '      pro ? { state: "ok", label: this.t("chk_pro_active") } : { state: "opt", label: this.t("chk_pro_get"), href: shopUrl(this.hass?.language) },\n',
            '',
            'no energy unlock',
        );
        code = replaceRequired(
            code,
            /\n {4}<div class="fp3d-ext-teaser">[\s\S]*?<\/div>`;/,
            '`;',
            'no extensions teaser',
        );
        code = replaceRequired(
            code,
            /if \(!hasFeature\("auto_pro"\)\)\n\s+return html`<section class="fp3d-teaser">[\s\S]*?<\/section>`;/,
            'if (!hasFeature("auto_pro")) return nothing;',
            'no car teaser',
        );
        code = replaceRequired(
            code,
            /const teaser = !pro && released\("household"\)\n\s+\? html`[\s\S]*?<\/section>`\n\s+: nothing;/,
            'const teaser = nothing;',
            'no household teaser',
        );
        code = replaceRequired(
            code,
            /if \(!released\("household"\) \|\| !\(plant \|\| appliance \|\| fridge\)\) return nothing;[\s\S]*?<\/section>`;/,
            'return nothing;',
            'no household teaser of plants and appliances',
        );
        code = replaceRequired(
            code,
            /<p class="fp3d-sub">🔒 \$\{this\.t\("pro_feature_screens"\)\}[^\n]*<\/p>/,
            '',
            'no lock of the screen pictures',
        );
        // no supporter pass, so no 3D print of the plan for supporters in the backup
        code = replaceMethod(code, 'private checkSupporter(): void', 'return;', 'no supporter check');
        code = replaceRequired(
            code,
            /\n {8}\$\{this\._supporter && this\.isAdmin\n {10}\? html`<button[\s\S]*?<\/button>`\n {10}: nothing\}/,
            '',
            'no 3D print',
        );
        code = replaceRequired(
            code,
            '\n      ${this._supporter && this.isAdmin ? html`<p class="fp3d-sub">${this.t("print_editor_hint")}</p>` : nothing}',
            '',
            'no 3D print hint',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceMethod(code, 'private renderProHint()', 'return nothing;', 'no pro hint');
        code = replaceRequired(
            code,
            '        <p class="fp3d-wall-pro">🔒 ${translate(hass, "pro_feature_camera_cockpit")}</p>\n',
            '',
            'no lock of the camera wall',
        );
        code = replaceRequired(code, /(?<=\/\* |\()(Energie|Pool) Pro: /g, '', 'styles without Pro');
        code = replaceRequired(
            code,
            'hasFeature("fun_halloween") && b.settings.halloween?.ghost !== false',
            'hasFeature("fun_halloween") && b.settings.halloween?.ghost === true',
            'the ghost only when switched on',
        );
    }
    if (name === 'components/fun-packs.ts') {
        code = replaceRequired(
            code,
            'const ghost = this.building?.settings.halloween?.ghost !== false;',
            'const ghost = this.building?.settings.halloween?.ghost === true;',
            'the ghost switch off at first',
        );
        code = replaceRequired(
            code,
            '      <span class="fp3d-sub">${this.t("winter_deco_hint")}</span>\n',
            '',
            'no winter decorations',
        );
        code = replaceRequired(
            code,
            '      <span class="fp3d-sub">${this.t("halloween_deco_hint")}</span>\n',
            '',
            'no Halloween decorations',
        );
        code = replaceMethod(
            code,
            'private renderFunLocked(icon: string, name: string, feature: string)',
            'return nothing;',
            'no customer account',
        );
    }
    if (name === 'components/time-bar.ts') {
        code = replaceRequired(
            code,
            '${isBeta("time_travel") ? html` <a class="beta" href=${DISCORD_URL} target="_blank" rel="noopener" title=${t("beta_bar")}>🧪 BETA</a>` : nothing}',
            '',
            'no supporter beta',
        );
    }
    if (name === 'card-editor.ts') {
        code = replaceRequired(
            code,
            '\n      <p class="hint">${this.t("card_pro_hint")}</p>',
            '',
            'no pro hint of the card',
        );
    }
    if (name === 'packs.ts') {
        // the English names of the shop's packs ("Pro: Car Pro"): without "Pro" as well
        code = replaceRequired(code, /"Pro: ([^"]*?)(?: Pro)?"/g, '"$1"', 'pack names without Pro');
    }
    if (name === 'i18n.ts') {
        let blank = 0;
        code = code.replace(/^ {2}(\w+): "(?:[^"\\]|\\.)*",$/gm, (line, key: string) => {
            if (!SHOP_TEXTS.test(key)) {
                return line;
            }
            blank++;
            return `  ${key}: "",`;
        });
        if (blank < 300) {
            throw new Error(`Upstream patch no longer matches: shop texts (${blank})`);
        }
        code = setTexts(code, 'fun_title', 'Spaß-Extras', 'Fun extras');
        code = setTexts(
            code,
            'fun_intro_settings',
            'Extras zum Spaß: Haustiere, ein kleiner Geist zu Halloween, Lichterketten, Schnee und ein Feuerwerk im Winter. Hier schaltest du sie ein und aus.',
            'Extras for fun: pets, a little ghost at Halloween, fairy lights, snow and a firework in winter. Switch them on and off here.',
        );
        code = setTexts(
            code,
            'fun_feature_halloween',
            'Ein kleiner Geist, der ab und zu durchs Haus schwebt – nachts öfter.',
            'A little ghost that floats through the house now and then – more often at night.',
        );
        code = setTexts(
            code,
            'fun_feature_winter',
            'Lichterketten an der Dachtraufe in der Adventszeit, Schnee auf Dach und Rasen, solange es schneit, und ein Feuerwerk über dem Haus zu Silvester um Mitternacht.',
            "Fairy lights along the eaves in Advent, snow on the roof and the lawn while it snows, and a firework over the house at New Year's midnight.",
        );
        code = setTexts(
            code,
            'backup_full_hint',
            'Eine Datei mit dem Plan und allen Hintergrund- und Bildschirmbildern.',
            'One file with the plan and every background and screen picture.',
        );
        code = setTexts(
            code,
            'vehicle_to_spot_hint',
            'Ein Fahrzeug als einfaches Möbel steht immer da. Als Stellplatz erscheint es nur, wenn ein Sensor das Auto meldet.',
            'A vehicle as plain furniture always stands there. As a parking spot it appears only while a sensor reports the car.',
        );
    }
    return code;
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
                '  /** A wind indicator of the kind flag: which flag it flies (frontend/vendor-ext/flags.ts; missing: the plain one). */',
                '  gear_flag?: string | null;',
                '  /** A hatch: how far it opens (°, default 70). */',
                '  gear_angle?: number | null;',
                '  /** A hatch: the datapoint of its opening angle (° or %, % up to gear_angle), beside or instead of its contact. */',
                '  gear_angle_entity?: EntityRef;',
            ].join('\n'),
            'gear fields',
        );
    }
    if (name === 'alerts.ts') {
        // an open deck hatch in the rain: the warning of an open window, with the hatch's contact
        code = `import { hatchPose as fp3dHatchPose } from "${kinds}";\n${code}`;
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
            '  /** The contacts and angle datapoints of the deck hatches (open in the rain: a warning). */\n  hatches?: string[];\n  /** Haushalt Pro: the fridges with door sensors (their doors may not stand open too long). */',
            'hatches: sources type',
        );
        code = replaceRequired(
            code,
            '  return { rooms, alarms: ids.filter((id) => id.startsWith("alarm_control_panel.")), weather, outage, rain, fridges };',
            [
                '  const hatches = building.floors.flatMap((fl) => fl.furniture.filter((f) => f.type === "hatch").flatMap((f) => [f.gear_entity, f.gear_angle_entity].filter((id): id is string => !!id && id !== "none")));',
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
                '        if (f.type !== "hatch") continue;',
                '        // open by its contact, or by the angle its datapoint reports',
                '        const contact = f.gear_entity && f.gear_entity !== "none" ? f.gear_entity : null;',
                '        const angleId = f.gear_angle_entity && f.gear_angle_entity !== "none" ? f.gear_angle_entity : null;',
                '        const ang = angleId ? hass.states[angleId] : undefined;',
                '        const pose = fp3dHatchPose(contact ? (hass.states[contact]?.state ?? null) : null, ang ? { n: parseFloat(ang.state), unit: String(ang.attributes.unit_of_measurement ?? "") } : null, f.gear_angle ?? undefined);',
                '        if (!pose?.open) continue;',
                '        const room = floor.rooms.find((r) => r.points.length >= 3 && pointInPolygon([f.x, f.z], r.points));',
                '        out.push({ kind: "window_rain", entity: (contact ?? angleId) as string, roomId: room?.id ?? null, floorId: floor.id });',
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
                '    const pick = (key: "gear_entity" | "gear_liters" | "gear_angle_entity", label: string, filter: (id: string) => boolean) =>',
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
                '      ${hatch ? pick("gear_angle_entity", this.t("gear_angle_entity" as I18nKey), (id) => ["sensor.", "number.", "input_number."].some((d) => id.startsWith(d))) : nothing}',
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
        code = `import { HATCH_ANGLE as FP3D_HATCH_ANGLE, hatchPose as fp3dHatchPose, defaultLightY as fp3dLightY, isGear as fp3dIsGear, lightOn as fp3dLightOn, tankFill as fp3dTankFill, tankWarn as fp3dTankWarn, type GearType as Fp3dGearType } from "${kinds}";\n${code}`;
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
                '            let entity = ent;',
                '            const n = fp3dNum(ent);',
                '            const kind = f.gear_kind ?? (f.type === "tank" ? "water" : f.type === "nav_light" ? "anchor" : f.type === "hatch" ? "square" : null);',
                '            let value: number | null = null;',
                '            let label = "";',
                '            let warn = false;',
                '            let hatchAngle: number | null = null;',
                '            if (f.type === "tank" && n) {',
                '              value = fp3dTankFill(n.n, n.unit);',
                '              // the contents in litres, or in kg (a gas bottle on a scale): as its datapoint says',
                '              const amount = f.gear_liters && f.gear_liters !== "none" ? fp3dNum(f.gear_liters) : null;',
                '              const unit = amount?.unit.trim() || "l";',
                '              label = `${fp3dTr(`gear_tank_${kind}`)} ${Math.round(value * 100)} %${amount ? ` · ${formatNumber(hass, amount.n, unit === "kg" && amount.n < 100 ? 1 : 0)} ${unit}` : ""}`;',
                '              warn = fp3dTankWarn(kind, value);',
                '            } else if (f.type === "rudder" && n) {',
                '              value = n.n;',
                '              label = `${fp3dTr("gear_rudder_short")} ${formatNumber(hass, Math.abs(n.n), 0)}°${n.n > 0.5 ? ` ${fp3dTr("gear_stb")}` : n.n < -0.5 ? ` ${fp3dTr("gear_port")}` : ""}`;',
                '            } else if (f.type === "propeller" && n) {',
                '              value = Math.max(0, n.n);',
                '              label = value > 1 ? `${formatNumber(hass, value, 0)} ${fp3dTr("gear_rpm")}` : "";',
                '            } else if (f.type === "nav_light" && ent && hass.states[ent]) {',
                '              value = fp3dLightOn(hass.states[ent].state);',
                '            } else if (f.type === "hatch") {',
                '              // open by its contact; the lid at the angle a datapoint reports (° or %), else at the one set',
                '              const angleId = f.gear_angle_entity && f.gear_angle_entity !== "none" ? f.gear_angle_entity : null;',
                '              const pose = fp3dHatchPose(ent ? (hass.states[ent]?.state ?? null) : null, fp3dNum(angleId), f.gear_angle ?? FP3D_HATCH_ANGLE);',
                '              if (pose) {',
                '                value = pose.open;',
                '                hatchAngle = Math.round(pose.angle);',
                '                label = pose.open ? `${fp3dTr("gear_hatch_open")}${pose.measured ? ` ${formatNumber(hass, pose.angle, 0)}°` : ""}` : "";',
                '              }',
                '              // its details: the contact, else the angle',
                '              entity = ent ?? angleId;',
                '            }',
                '            const base = f.type === "nav_light" ? (f.gear_y ?? fp3dLightY(kind)) : f.type === "tank" ? (f.mount_y ?? 0) : 0;',
                '            return { id: f.id, floor: fl.id, type: f.type as Fp3dGearType, x: f.x, z: f.z, rotation: f.rotation, w: f.w, d: f.d, h: f.h, base, variant: kind, value, label, warn, mast: !!f.gear_mast, angle: hatchAngle ?? f.gear_angle ?? FP3D_HATCH_ANGLE, entity };',
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
                '  gear_liters: "Inhalt in Litern oder kg (optional)",',
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
                '  gear_angle_entity: "Winkel aus Datenpunkt (optional, ° oder %)",',
                '  gear_hatch_open: "Luke offen",',
                '  gear_hint_hatch: "Eine Decksluke mit getöntem Deckel, das Scharnier an der vorderen Kante (ungedreht: im Grundriss oben). Meldet der Kontakt offen, steht der Deckel im Öffnungswinkel auf zwei Gasfedern. Liefert ein Datenpunkt den Winkel, steht er so weit offen (in % bis zum Öffnungswinkel); ohne Kontakt gilt die Luke dann ab 1° als offen. Regnet es, solange sie offen ist, kommt die Warnung „offen bei Regen“. Breite und Tiefe = Größe der Luke, Höhe = Höhe des Rahmens.",',
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
                '  gear_liters: "Contents in litres or kg (optional)",',
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
                '  gear_angle_entity: "Angle from a datapoint (optional, ° or %)",',
                '  gear_hatch_open: "Hatch open",',
                '  gear_hint_hatch: "A deck hatch with a smoked lid, hinged at its front edge (unturned: at the top of the plan). While the contact reports open the lid stands at its opening angle on two gas struts. When a datapoint gives the angle, it stands open that far (in % up to the opening angle); without a contact the hatch then counts as open from 1°. If it rains while it is open, the warning \\u201copen in the rain\\u201d comes. Width and depth = size of the hatch, height = height of its frame.",',
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
            icon_group_light: 'Licht',
            icon_group_appliances: 'Haushaltsgeräte',
            icon_group_climate: 'Klima & Wetter',
            icon_group_water: 'Wasser & Tanks',
            icon_group_power: 'Strom & Energie',
            icon_group_openings: 'Türen, Fenster & Beschattung',
            icon_group_security: 'Sicherheit',
            icon_group_media: 'Medien & Netzwerk',
            icon_group_garden: 'Garten & Außen',
            icon_group_vehicles: 'Fahrzeuge',
            icon_group_boat: 'Boot',
            icon_group_rooms: 'Räume & Sonstiges',
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
            home_parcel: '📦 Paket · {time}',
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
            icon_group_light: 'Light',
            icon_group_appliances: 'Appliances',
            icon_group_climate: 'Climate & weather',
            icon_group_water: 'Water & tanks',
            icon_group_power: 'Power & energy',
            icon_group_openings: 'Doors, windows & shading',
            icon_group_security: 'Security',
            icon_group_media: 'Media & network',
            icon_group_garden: 'Garden & outdoors',
            icon_group_vehicles: 'Vehicles',
            icon_group_boat: 'Boat',
            icon_group_rooms: 'Rooms & more',
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
            home_parcel: '📦 Parcel · {time}',
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
 * Furniture of the house the 3D frontend did not have (frontend/vendor-ext/house-items.ts): a spiral stair (it cuts a
 * round opening into the floor above), a wood stove, a chimney and a sauna cabin. And a tank for heating oil: the
 * boat's tank with the kind "oil", offered in the library's section "Heizung" (a library entry may preset fields of
 * the item it places).
 */
function houseItems(name: string, code: string): string {
    const items = `${root}/frontend/vendor-ext/house-items.ts`;
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "water_heater",\n',
            '  "water_heater",\n  "stairs_spiral",\n  "fireplace",\n  "chimney",\n  "sauna",\n  "railing",\n  "stairs_outdoor",\n  "light_well",\n',
            'house items: types',
        );
        code = replaceRequired(
            code,
            '"stairs", "stairs_u", "robot_vacuum"]',
            '"stairs", "stairs_u", "stairs_spiral", "railing", "fireplace", "chimney", "sauna", "robot_vacuum"]',
            'house items: library group',
        );
        code = replaceRequired(
            code,
            '"sprinkler", "tree", "tree_conifer",',
            '"sprinkler", "stairs_outdoor", "light_well", "tree", "tree_conifer",',
            'house items: outdoor group',
        );
        code = replaceRequired(
            code,
            '  water_heater: [0.56, 0.56, 1.5],',
            [
                '  water_heater: [0.56, 0.56, 1.5],',
                '  // a spiral stair (its height reaches the next floor when placed), a wood stove with its flue pipe, a chimney, a sauna cabin',
                '  stairs_spiral: [1.6, 1.6, 2.75],',
                '  fireplace: [0.6, 0.5, 2.4],',
                '  chimney: [0.5, 0.5, 3],',
                '  sauna: [2, 1.8, 2.05],',
                '  // a railing (its length, thickness, height), steps of stone outside, a light well in front of a cellar window',
                '  railing: [1.2, 0.05, 1],',
                '  stairs_outdoor: [1.4, 1.6, 0.8],',
                '  light_well: [1.2, 0.6, 1],',
            ].join('\n'),
            'house items: sizes',
        );
        code = replaceRequired(
            code,
            'export const STAIR_TYPES = new Set<string>(["stairs", "stairs_u"]);',
            'export const STAIR_TYPES = new Set<string>(["stairs", "stairs_u", "stairs_spiral"]);',
            'house items: spiral stair is a stair',
        );
    }
    if (name === 'packs.ts') {
        code = replaceRequired(
            code,
            '  if (f.mount_y != null) return f.mount_y;\n',
            '  if (f.mount_y != null) return f.mount_y;\n  // a light well goes down from the ground to the floor in front of its window: it stands on the floor, not on the lawn\n  if (f.type === "light_well") return 0;\n',
            'house items: light well on the floor',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  stairs_u: ["stairs", ["hall", "living"]],',
            '  stairs_u: ["stairs", ["hall", "living"]],\n  stairs_spiral: ["stairs", ["hall", "living"]],\n  railing: ["stairs", ["hall", "living", "garden"]],\n  stairs_outdoor: ["outdoor", ["garden"]],\n  light_well: ["outdoor", ["garden"]],',
            'house items: spiral stair in the index',
        );
        code = replaceRequired(
            code,
            '  water_heater: ["heating", ["utility", "bath", "garage"]],',
            [
                '  water_heater: ["heating", ["utility", "bath", "garage"]],',
                '  fireplace: ["heating", ["living"]],',
                '  chimney: ["architecture", []],',
                '  sauna: ["bath", ["bath", "hobby"]],',
            ].join('\n'),
            'house items: index',
        );
        code = replaceRequired(
            code,
            '  /** Placed mirrored (the twin of an item that comes left-handed only: the corner sofa for the other side). */\n  mirror?: boolean;',
            "  /** Placed mirrored (the twin of an item that comes left-handed only: the corner sofa for the other side). */\n  mirror?: boolean;\n  /** Fields set on the placed item (the oil tank: the boat's tank holding heating oil, in its size). */\n  preset?: Record<string, unknown>;",
            'house items: entry preset',
        );
        code = replaceRequired(
            code,
            '    if (!e.family) e.family = e.type;\n  }\n  return out;\n}',
            [
                '    if (!e.family) e.family = e.type;',
                '  }',
                "  // the boat's tank for heating oil, in the house's section of heating",
                '  const tank = out.find((e) => e.type === "tank" && !e.mirror);',
                '  if (tank) {',
                '    const label = src.basicName("tank_oil");',
                '    out.push({',
                '      ...tank,',
                '      key: "tank#oil",',
                '      label,',
                '      search: `${label} ${src.basicNameEn("tank_oil")} heizöl öltank tank ${src.kindName("heating")} ${KIND_WORDS.heating}`,',
                '      kind: "heating",',
                '      rooms: ["utility", "garage"],',
                '      size: [0.72, 1.6, 1.55],',
                '      preset: { gear_kind: "oil", w: 0.72, d: 1.6, h: 1.55 },',
                '    });',
                '  }',
                '  return out;',
                '}',
            ].join('\n'),
            'house items: oil tank entry',
        );
    }
    if (name === 'components/library.ts') {
        code = replaceRequired(
            code,
            'detail: { type: entry.type, mirror: !!entry.mirror }',
            'detail: { type: entry.type, mirror: !!entry.mirror, preset: entry.preset ?? null }',
            'house items: preset to the editor',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '@library-add=${(e: CustomEvent<{ type: string; mirror?: boolean }>) => this.addFurniture(e.detail.type, !!e.detail.mirror)}',
            '@library-add=${(e: CustomEvent<{ type: string; mirror?: boolean; preset?: Partial<Furniture> | null }>) => this.addFurniture(e.detail.type, !!e.detail.mirror, e.detail.preset ?? null)}',
            'house items: preset placed',
        );
        code = replaceRequired(
            code,
            '  private addFurniture(type: string, mirror = false): void {',
            '  private addFurniture(type: string, mirror = false, preset: Partial<Furniture> | null = null): void {',
            'house items: preset argument',
        );
        code = replaceRequired(
            code,
            '...(mirror ? { mirror: true } : {}) };\n    this.change((_, f) => f.furniture.push(item));',
            '...(mirror ? { mirror: true } : {}), ...(preset ?? {}) };\n    this.change((_, f) => f.furniture.push(item));',
            'house items: preset fields',
        );
        // the plan symbol of the outdoor steps counts its steps by the height
        code = replaceRequired(
            code,
            '<g class="fp3d-furn-sym">${furnitureSymbol(f.type, f.w, f.d)}</g>',
            '<g class="fp3d-furn-sym">${furnitureSymbol(f.type, f.w, f.d, f.h)}</g>',
            'house items: symbol height',
        );
    }
    if (name === 'viewer/outdoor.ts') {
        code = `import { wellHoles as fp3dWellHoles } from "${items}";\nimport { furnitureFootprint as fp3dFootprint } from "../model.ts";\n${code}`;
        code = replaceRequired(
            code,
            '        const holes = outdoorHoles(areas, index);\n',
            [
                '        const holes = outdoorHoles(areas, index);',
                '        // light wells in front of cellar windows cut their holes into the lawn or path around them (house-items.ts)',
                '        if (!outdoorStanding(a.type)) holes.push(...fp3dWellHoles(floor.furniture, a.points, fp3dFootprint).map((h) => ccw(h)));',
                '',
            ].join('\n'),
            'house items: light well holes',
        );
    }
    if (name === 'viewer/build.ts') {
        code = `import { spiralHole as fp3dSpiralHole } from "${items}";\n${code}`;
        code = replaceRequired(
            code,
            '      if (f.type === "stairs_u") return uStairHole(f);',
            '      if (f.type === "stairs_u") return uStairHole(f);\n      if (f.type === "stairs_spiral") return [fp3dSpiralHole(f)];',
            'house items: round stair opening',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = `import { chimney as fp3dChimney, HOUSE_NATURAL as FP3D_HOUSE_NATURAL, HOUSE_NEON as FP3D_HOUSE_NEON, lightWell as fp3dLightWell, outdoorSteps as fp3dOutdoorSteps, railing as fp3dRailing, sauna as fp3dSauna, spiralStairs as fp3dSpiralStairs, woodStove as fp3dWoodStove } from "${items}";\n${code}`;
        code = replaceRequired(
            code,
            'const EDGE_GLOW = shade(0x37e0ff, 0.45);',
            'const EDGE_GLOW = shade(0x37e0ff, 0.45);\n/** The house items (house-items.ts): their own colours and the furniture outlines. */\nconst FP3D_HC = palette(FP3D_HOUSE_NEON, FP3D_HOUSE_NATURAL);\nconst FP3D_EDGES = { furn: EDGE_FURN, faint: EDGE_FAINT, glow: EDGE_GLOW };',
            'house items: colours',
        );
        code = replaceRequired(
            code,
            '  /** Vertical cylinder with `n` sides. */\n',
            [
                '  /** An upright prism over a polygon in local coordinates (the treads of a spiral stair). */',
                '  prism(pts: Vec2[], y0: number, y1: number, side: number, top = side, edges: Color | null = null): void {',
                '    if (y1 - y0 < 1e-4 || pts.length < 3) return;',
                '    const poly = pts.map(([x, z]) => this.tf(x, z));',
                '    pushPrism(this.buf, ccw(poly), y0, y1, side, top, { aoFrom: 0, bottom: y0 > 0.05 });',
                '    if (edges) this.outline(poly, y0, y1, edges);',
                '  }',
                '',
                '  /** Vertical cylinder with `n` sides. */',
                '',
            ].join('\n'),
            'house items: prism',
        );
        code = replaceRequired(
            code,
            '    case "stairs_u":\n      stairsU(b, w, d, h);\n      break;',
            [
                '    case "stairs_u":',
                '      stairsU(b, w, d, h);',
                '      break;',
                '    case "stairs_spiral":',
                '      fp3dSpiralStairs(b, C, FP3D_EDGES, w, d, h);',
                '      break;',
                '    case "fireplace":',
                '      fp3dWoodStove(b, C, FP3D_HC, FP3D_EDGES, w, d, h);',
                '      break;',
                '    case "chimney":',
                '      fp3dChimney(b, FP3D_HC, FP3D_EDGES, w, d, h);',
                '      break;',
                '    case "sauna":',
                '      fp3dSauna(b, C, FP3D_HC, FP3D_EDGES, w, d, h);',
                '      break;',
                '    case "railing":',
                '      fp3dRailing(b, C, FP3D_EDGES, w, d, h);',
                '      break;',
                '    case "stairs_outdoor":',
                '      fp3dOutdoorSteps(b, FP3D_HC, FP3D_EDGES, w, d, h);',
                '      break;',
                '    case "light_well":',
                '      fp3dLightWell(b, C, FP3D_HC, FP3D_EDGES, w, d, h);',
                '      break;',
            ].join('\n'),
            'house items: drawn',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            'export function furnitureSymbol(type: string, w: number, d: number): Part[] | typeof nothing {',
            'export function furnitureSymbol(type: string, w: number, d: number, h = 0): Part[] | typeof nothing {',
            'house items: symbol height argument',
        );
        code = `import { houseSymbol as fp3dHouseSymbol } from "${items}";
${code}`;
        code = replaceRequired(
            code,
            '    case "stairs_u": {\n',
            [
                '    case "stairs_spiral": {',
                '      // the round stair: its outline, the pole, the treads as spokes and an arrow up along the walking line',
                '      const r = Math.min(w, d) / 2;',
                '      const n = 14;',
                '      const step = (2 * Math.PI) / (n + 1);',
                '      const at = (rr: number, a: number): [number, number] => [Math.sin(a) * rr, Math.cos(a) * rr];',
                '      const out: Part[] = [circle(0, 0, r, "fp3d-sym-strong"), circle(0, 0, Math.min(0.06, r * 0.12), "fp3d-sym-fill")];',
                '      for (let i = 0; i <= n; i++) out.push(line(0, 0, ...at(r, step * i)));',
                '      const rw = r * 0.62;',
                '      const end = step * (n - 0.5);',
                '      for (let i = 0; i < 24; i++) out.push(line(...at(rw, step / 2 + ((end - step / 2) * i) / 24), ...at(rw, step / 2 + ((end - step / 2) * (i + 1)) / 24), "fp3d-sym-strong"));',
                '      const [tx, tz] = at(rw, end);',
                '      const [ux, uz] = [Math.cos(end), -Math.sin(end)];',
                '      const [nx, nz] = [Math.sin(end), Math.cos(end)];',
                '      out.push(line(tx - ux * 0.16 + nx * 0.1, tz - uz * 0.16 + nz * 0.1, tx, tz, "fp3d-sym-strong"), line(tx - ux * 0.16 - nx * 0.1, tz - uz * 0.16 - nz * 0.1, tx, tz, "fp3d-sym-strong"));',
                '      return out;',
                '    }',
                '    case "fireplace":',
                '      // a wood stove: its body, the glass door at the front and the flue pipe',
                '      return [rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"), line(-w * 0.36, d / 2 - 0.03, w * 0.36, d / 2 - 0.03, "fp3d-sym-strong"), circle(0, -d * 0.1, Math.min(0.075, w * 0.15))];',
                '    case "chimney":',
                '      // a chimney: the stack and its flue',
                '      return [rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"), rect(-w * 0.2, -d * 0.2, w * 0.2, d * 0.2, "fp3d-sym-fill")];',
                '    case "sauna": {',
                '      // a sauna: its walls, the benches along the back, the stove in the front right corner, the door on the left',
                '      const t = 0.06;',
                '      const zu = Math.min(-d / 2 + t + 0.6, d / 2 - t - 0.3);',
                '      const zl = Math.max(zu, Math.min(-d / 2 + t + 1.1, d / 2 - t - 0.55));',
                '      const doorW = Math.max(0.4, Math.min(0.7, w - 0.5));',
                '      const dx0 = -w / 2 + Math.min(0.2, (w - doorW) / 3);',
                '      return [',
                '        rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"),',
                '        rect(-w / 2 + t, -d / 2 + t, w / 2 - t, d / 2 - t),',
                '        line(-w / 2 + t, zu, w / 2 - t, zu),',
                '        line(-w / 2 + t, zl, w / 2 - t, zl),',
                '        rect(w / 2 - t - 0.45, d / 2 - t - 0.42, w / 2 - t - 0.05, d / 2 - t - 0.06, "fp3d-sym-fill"),',
                '        line(dx0, d / 2, dx0 + doorW, d / 2, "fp3d-sym-fill"),',
                '      ];',
                '    }',
                '    case "railing":',
                '    case "stairs_outdoor":',
                '    case "light_well":',
                '      return fp3dHouseSymbol(type, w, d, h, { rect, line }) ?? nothing;',
                '    case "stairs_u": {',
                '',
            ].join('\n'),
            'house items: symbols',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  furn_stairs_u: "U-Treppe mit Podest",',
            [
                '  furn_stairs_u: "U-Treppe mit Podest",',
                '  furn_stairs_spiral: "Wendeltreppe",',
                '  furn_fireplace: "Kaminofen",',
                '  furn_chimney: "Schornstein",',
                '  furn_sauna: "Sauna",',
                '  furn_tank_oil: "Öltank",',
                '  gear_tank_oil: "Heizöl",',
                '  furn_railing: "Geländer",',
                '  furn_stairs_outdoor: "Außentreppe",',
                '  furn_light_well: "Lichtschacht",',
            ].join('\n'),
            'house items: de',
        );
        code = replaceRequired(
            code,
            '  furn_stairs_u: "U-stair with landing",',
            [
                '  furn_stairs_u: "U-stair with landing",',
                '  furn_stairs_spiral: "Spiral staircase",',
                '  furn_fireplace: "Wood stove",',
                '  furn_chimney: "Chimney",',
                '  furn_sauna: "Sauna",',
                '  furn_tank_oil: "Oil tank",',
                '  gear_tank_oil: "Heating oil",',
                '  furn_railing: "Railing",',
                '  furn_stairs_outdoor: "Outdoor steps",',
                '  furn_light_well: "Light well",',
            ].join('\n'),
            'house items: en',
        );
    }
    return code;
}

/**
 * An area outside that lies above the ground (a raised terrace, a plateau on a hill, a raised bed) is filled down to
 * the ground instead of floating as a slab: its block reaches from the ground (or from its lowest point, if that lies
 * deeper) to its top. On a hill, a flat plateau beside a sloping bank then reads as earth, not as a shelf.
 */
function groundFill(name: string, code: string): string {
    if (name === 'viewer/outdoor.ts') {
        code = replaceRequired(
            code,
            'import { areaGround, bounds, centroid, gateSpans, groundDrop, isAxisRect,',
            'import { areaGround, bounds, centroid, gateSpans, groundDrop, groundLevel, isAxisRect,',
            'fill: import',
        );
        code = replaceRequired(
            code,
            [
                '        const holes = outdoorHoles(areas, index);',
                '        pushPrism(buf, poly, lowest, a.slope ? topAt : g + look.top, look.side, look.color, { aoFrom: lowest, holes });',
            ].join('\n'),
            [
                '        const holes = outdoorHoles(areas, index);',
                '        // above the ground it is filled down to it (a raised terrace, a plateau on a hill), not a floating slab',
                '        const base = Math.min(lowest, groundLevel(floor));',
                '        pushPrism(buf, poly, base, a.slope ? topAt : g + look.top, look.side, look.color, { aoFrom: base, holes });',
            ].join('\n'),
            'fill: down to the ground',
        );
    }
    return code;
}

/**
 * A balcony's railing only where the deck would drop (rail-spans.ts): not where a garden on the hill reaches up to it
 * (an area of a lower floor at the deck's level), nor where a terrace, another balcony or a room continues it.
 */
function balconyRails(name: string, code: string): string {
    const rails = `${root}/frontend/vendor-ext/rail-spans.ts`;
    if (name === 'viewer/outdoor.ts') {
        code = [
            `import { railSpans as fp3dRailSpans } from "${rails}";`,
            'import { outdoorTopAt as fp3dOutdoorTopAt } from "../model.ts";',
            code,
        ].join('\n');
        code = replaceRequired(
            code,
            'const GATE_SIDE = 0x31467d;',
            [
                '/** The model behind the railing check: the top of an area, and which areas stand (hedge, fence). */',
                'const FP3D_RAIL_MODEL = {',
                '  topAt: (fl: unknown, o: unknown, x: number, z: number) => fp3dOutdoorTopAt(fl as Floor, o as OutdoorArea, x, z),',
                '  standing: (type: string) => outdoorStanding(type as OutdoorType),',
                '};',
                '',
                'const GATE_SIDE = 0x31467d;',
            ].join('\n'),
            'rails: model',
        );
        code = replaceRequired(
            code,
            [
                '          if (againstWall(floor, p, q)) continue;',
                '          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);',
                '          const y0 = g + look.top;',
                '          lines.seg([p[0], y0 + rail, p[1]], [q[0], y0 + rail, q[1]], top, ALWAYS);',
                '          lines.seg([p[0], y0 + 0.1, p[1]], [q[0], y0 + 0.1, q[1]], bar, ALWAYS);',
                '          // bars every 12 cm, posts at the ends',
                '          const n = Math.max(1, Math.round(len / 0.12));',
                '          for (let k = 0; k <= n; k++) {',
                '            const t = k / n;',
                '            const x = p[0] + (q[0] - p[0]) * t;',
                '            const z = p[1] + (q[1] - p[1]) * t;',
                '            lines.seg([x, y0, z], [x, y0 + rail, z], k === 0 || k === n ? top : bar, ALWAYS);',
                '          }',
                '        }',
            ].join('\n'),
            [
                '          if (againstWall(floor, p, q)) continue;',
                '          const y0 = g + look.top;',
                '          // only the parts where the deck would drop: none where a garden on the hill reaches up to it',
                '          for (const [t0, t1] of fp3dRailSpans(floor, a, p, q, y0, FP3D_RAIL_MODEL)) {',
                '            const pa: Vec2 = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0];',
                '            const qa: Vec2 = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1];',
                '            const len = Math.hypot(qa[0] - pa[0], qa[1] - pa[1]);',
                '            lines.seg([pa[0], y0 + rail, pa[1]], [qa[0], y0 + rail, qa[1]], top, ALWAYS);',
                '            lines.seg([pa[0], y0 + 0.1, pa[1]], [qa[0], y0 + 0.1, qa[1]], bar, ALWAYS);',
                '            // bars every 12 cm, posts at the ends',
                '            const n = Math.max(1, Math.round(len / 0.12));',
                '            for (let k = 0; k <= n; k++) {',
                '              const t = k / n;',
                '              const x = pa[0] + (qa[0] - pa[0]) * t;',
                '              const z = pa[1] + (qa[1] - pa[1]) * t;',
                '              lines.seg([x, y0, z], [x, y0 + rail, z], k === 0 || k === n ? top : bar, ALWAYS);',
                '            }',
                '          }',
                '        }',
            ].join('\n'),
            'rails: only where it drops',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { setRailFloors as fp3dSetRailFloors } from "${rails}";\n${code}`;
        code = replaceRequired(
            code,
            '      const geo = buildFloorGeometry(withVehicles(floor, this.parked),',
            '      fp3dSetRailFloors(b.floors);\n      const geo = buildFloorGeometry(withVehicles(floor, this.parked),',
            'rails: floors',
        );
    }
    return code;
}

/**
 * A window or door glazed up under the roof (gable-glass.ts, "Bis unters Dach verglast"): in a wall under the roof a
 * transom over the opening and fixed glass above it up to the slope, the wall left out there – the gable window that
 * follows the roof.
 */
function gableGlass(name: string, code: string): string {
    const glass = `${root}/frontend/vendor-ext/gable-glass.ts`;
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  top_hung?: boolean;\n',
            '  top_hung?: boolean;\n  /** Glazed up under the roof: a transom over it, fixed glass up to the slope (a wall under the roof only). */\n  to_roof?: boolean;\n',
            'gable glass: model',
        );
    }
    if (name === 'viewer/build.ts') {
        code = `import { glazedTops as fp3dGlazedTops, roofTops as fp3dRoofTops } from "${glass}";\n${code}`;
        code = replaceRequired(
            code,
            '  hingeAtStart: boolean;\n  exterior: boolean;\n}',
            "  hingeAtStart: boolean;\n  exterior: boolean;\n  /** Glazed up under the roof: the roof's height (less a gap) at evenly spaced points from its start to its end. */\n  roof_tops?: number[] | null;\n}",
            'gable glass: info',
        );
        code = replaceRequired(
            code,
            '    const sill = Math.max(0, Math.min(o.sill + fp3dLift, top - 0.1));\n',
            [
                '    const sill = Math.max(0, Math.min(o.sill + fp3dLift, top - 0.1));',
                '    // glazed up under the roof: the roof over the opening, where it leaves room for glass above it',
                '    const fp3dTops =',
                '      o.to_roof && (o.type === "window" || o.type === "door") && (roofUnder || wall.slope)',
                '        ? fp3dGlazedTops(fp3dRoofTops(width, (k) => topAt(wall.a[0] + ax[0] * (s0 + k), wall.a[1] + ax[1] * (s0 + k), wallHeight(wall, floor.height), wall) - 0.02), top)',
                '        : null;',
                '',
            ].join('\n'),
            'gable glass: tops',
        );
        code = replaceRequired(
            code,
            '      exterior: wall.exterior || freeLeft !== undefined,\n',
            '      exterior: wall.exterior || freeLeft !== undefined,\n      roof_tops: fp3dTops,\n',
            'gable glass: info tops',
        );
        code = replaceRequired(
            code,
            '    list.push({ s0, s1: s0 + width, sill, top, info });',
            '    // glazed up to the roof: no wall over the opening\n    list.push({ s0, s1: s0 + width, sill, top: fp3dTops ? Math.max(...fp3dTops) + 0.05 : top, info });',
            'gable glass: span',
        );
        code = replaceRequired(
            code,
            '  const bottom = Math.max(sp.sill, 0.004);\n',
            [
                '  const bottom = Math.max(sp.sill, 0.004);',
                '  // glazed up under the roof: the jambs reach the slope, the top edge follows it',
                '  const fp3dTops = info.roof_tops;',
                '  if (fp3dTops) {',
                '    const n = fp3dTops.length - 1;',
                '    const sAt = (i: number) => sp.s0 + ((sp.s1 - sp.s0) * i) / n;',
                '    for (const nn of [info.faceRoom, -info.faceOut]) {',
                '      lines.segSplit(at(sp.s0, nn, bottom), at(sp.s0, nn, fp3dTops[0]), EDGE_SOFT, cut, b);',
                '      lines.segSplit(at(sp.s1, nn, bottom), at(sp.s1, nn, fp3dTops[n]), EDGE_SOFT, cut, b);',
                '      for (let i = 0; i < n; i++) lines.seg(at(sAt(i), nn, fp3dTops[i]), at(sAt(i + 1), nn, fp3dTops[i + 1]), EDGE_SOFT, foldAt(Math.min(fp3dTops[i], fp3dTops[i + 1])));',
                '      if (sp.sill > 0.01) lines.seg(at(sp.s0, nn, sp.sill), at(sp.s1, nn, sp.sill), EDGE_SOFT, foldAt(sp.sill));',
                '    }',
                '    for (const [s, y] of [[sp.s0, fp3dTops[0]], [sp.s1, fp3dTops[n]]]) {',
                '      lines.seg(at(s, info.faceRoom, y), at(s, -info.faceOut, y), EDGE_SOFT, foldAt(y));',
                '      if (sp.sill > 0.01) lines.seg(at(s, info.faceRoom, sp.sill), at(s, -info.faceOut, sp.sill), EDGE_SOFT, foldAt(sp.sill));',
                '      if (sp.sill < cut && y > cut) lines.seg(at(s, info.faceRoom, cut), at(s, -info.faceOut, cut), EDGE_CUT, CUT_OFFSET + b);',
                '    }',
                '    return;',
                '  }',
                '',
            ].join('\n'),
            'gable glass: lines',
        );
    }
    if (name === 'viewer/openings.ts') {
        code = `import { glassStrips as fp3dGlassStrips, topAtX as fp3dTopAtX } from "${glass}";\n${code}`;
        code = replaceRequired(
            code,
            '    frameTris.push({ id: info.opening.id, start: fStart, end: frames.count });\n',
            [
                '    // glazed up under the roof: a transom over the opening, fixed glass up to the slope, a frame along it',
                '    const fp3dTops = info.roof_tops;',
                '    if (fp3dTops && info.opening.type !== "garage") {',
                '      const fw = 0.06;',
                '      const fd = 0.035;',
                '      const y0 = T + fw;',
                '      const fold = (y: number) => (y >= cut - 1e-6 ? bucket : ALWAYS);',
                '      // a quad seen from both sides',
                '      const quad = (buf: GeoBuffer, a: number[], b: number[], c: number[], d: number[], col: Color, f: number, uv?: number[]) => {',
                '        buf.tri(a, b, c, col, col, col, uv, f);',
                '        buf.tri(a, c, d, col, col, col, uv, f);',
                '        buf.tri(a, c, b, col, col, col, uv, f);',
                '        buf.tri(a, d, c, col, col, col, uv, f);',
                '      };',
                '      splitBox(frames, tf, 0, W, mid - fd, mid + fd, T, y0, frameC, frameTop, cut, bucket);',
                '      const left = fp3dTopAtX(fp3dTops, W, 0);',
                '      const right = fp3dTopAtX(fp3dTops, W, W);',
                '      if (left > y0 + 0.01) splitBox(frames, tf, 0, fw, mid - fd, mid + fd, y0, left, frameC, frameTop, cut, bucket);',
                '      if (right > y0 + 0.01) splitBox(frames, tf, W - fw, W, mid - fd, mid + fd, y0, right, frameC, frameTop, cut, bucket);',
                '      const n = fp3dTops.length - 1;',
                '      const under = shade(frameC.getHex(), 0.8);',
                '      for (let i = 0; i < n; i++) {',
                '        const xa = (W * i) / n;',
                '        const xb = (W * (i + 1)) / n;',
                '        const ya = Math.max(y0, fp3dTops[i]);',
                '        const yb = Math.max(y0, fp3dTops[i + 1]);',
                '        const ba = Math.max(y0, ya - fw);',
                '        const bb = Math.max(y0, yb - fw);',
                '        if (ya - y0 < 1e-3 && yb - y0 < 1e-3) continue;',
                '        const f = fold(Math.min(ba, bb));',
                '        for (const nn of [mid - fd, mid + fd]) quad(frames, tf(xa, nn, ba), tf(xb, nn, bb), tf(xb, nn, yb), tf(xa, nn, ya), frameC, f);',
                '        quad(frames, tf(xa, mid - fd, ya), tf(xb, mid - fd, yb), tf(xb, mid + fd, yb), tf(xa, mid + fd, ya), frameTop, f);',
                '        quad(frames, tf(xa, mid - fd, ba), tf(xb, mid - fd, bb), tf(xb, mid + fd, bb), tf(xa, mid + fd, ba), under, f);',
                '      }',
                '      const glassC = OP.GLASS as Color;',
                '      for (const g of fp3dGlassStrips(fp3dTops, W, y0, fw)) {',
                '        quad(glass, tf(g.x0, mid, g.y0), tf(g.x1, mid, g.y0), tf(g.x1, mid, g.yb), tf(g.x0, mid, g.ya), glassC, fold(g.y0), [0, 0.5, 1, 0.5, 1, 0.5]);',
                '      }',
                '    }',
                '    frameTris.push({ id: info.opening.id, start: fStart, end: frames.count });',
                '',
            ].join('\n'),
            'gable glass: glazing',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '        ${this.len(this.t("opening_height"), o.height, (v) => this.updateOpening({ height: Math.max(0.3, v) }), 0.01, 0.3)}\n',
            [
                '        ${o.type === "window" || o.type === "door"',
                '          ? html`<label class="fp3d-check fp3d-wide" title=${this.t("opening_to_roof_hint")}',
                '              ><input type="checkbox" .checked=${!!o.to_roof} ?disabled=${!admin} @change=${(ev: Event) => this.updateOpening({ to_roof: (ev.target as HTMLInputElement).checked || undefined })} />',
                '              ${this.t("opening_to_roof")}</label',
                '            >`',
                '          : nothing}',
                '        ${this.len(this.t("opening_height"), o.height, (v) => this.updateOpening({ height: Math.max(0.3, v) }), 0.01, 0.3)}',
                '',
            ].join('\n'),
            'gable glass: switch',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  top_hung: "Klappfenster (oben angeschlagen, öffnet nach oben)",',
            [
                '  top_hung: "Klappfenster (oben angeschlagen, öffnet nach oben)",',
                '  opening_to_roof: "Bis unters Dach verglast",',
                '  opening_to_roof_hint: "In einer Wand unter dem Dach: über dem Fenster oder der Tür ein Kämpfer, darüber feste Verglasung bis unter die Dachschräge – das Giebelfenster, das der Dachneigung folgt.",',
            ].join('\n'),
            'gable glass: de',
        );
        code = replaceRequired(
            code,
            '  top_hung: "Top-hung (opens upwards)",',
            [
                '  top_hung: "Top-hung (opens upwards)",',
                '  opening_to_roof: "Glazed up to the roof",',
                '  opening_to_roof_hint: "In a wall under the roof: a transom over the window or door, fixed glass above it up to the slope – the gable window that follows the roof.",',
            ].join('\n'),
            'gable glass: en',
        );
    }
    return code;
}

/**
 * A balcony cut into the roof (roof-cut.ts, "Dacheinschnitt"): switched on at a balcony of an attic floor, the
 * roof's slope opens over it, and along its edges that do not lie at a room's wall a wall stands from the deck up
 * under the roof – the cheeks at the sides, the parapet in front; where that wall is a railing high, the railing goes.
 */
function roofCuts(name: string, code: string): string {
    const cut = `${root}/frontend/vendor-ext/roof-cut.ts`;
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  slope_dir?: SlopeDir;\n',
            '  slope_dir?: SlopeDir;\n  /** A balcony cut into the roof (Dacheinschnitt): the roof opens over it, walls stand up to it along its edges. */\n  roof_cut?: boolean;\n',
            'roof cut: model',
        );
    }
    if (name === 'viewer/roof.ts') {
        code = `import { cutHole as fp3dCutHole } from "${cut}";\nimport { onSection as fp3dOnSection } from "../roof-sections.ts";\n${code}`;
        code = replaceRequired(
            code,
            "    // a dormer's rear runs into the slope: no gable there, only at its front (the lower end of the slope)\n",
            [
                '    // a balcony cut into the roof (Dacheinschnitt): the slope opens over it',
                '    for (const fl of b.floors) {',
                '      for (const a of fl.outdoor ?? []) {',
                '        if (a.type !== "balcony" || !a.roof_cut || a.points.length < 3) continue;',
                '        const cx = a.points.reduce((t, q) => t + q[0], 0) / a.points.length;',
                '        const cz = a.points.reduce((t, q) => t + q[1], 0) / a.points.length;',
                '        if (sec.open || !fp3dOnSection(sec, cx, cz)) continue;',
                '        holes.push(fp3dCutHole(a.points.map((q) => sectionUV(sec, q[0], q[1]))));',
                '      }',
                '    }',
                "    // a dormer's rear runs into the slope: no gable there, only at its front (the lower end of the slope)",
                '',
            ].join('\n'),
            'roof cut: hole',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { setRoofUnder as fp3dSetRoofUnder } from "${cut}";\n${code}`;
        code = replaceRequired(
            code,
            '      fp3dSetRailFloors(b.floors);\n',
            '      fp3dSetRailFloors(b.floors);\n      // the roof over this floor, for the walls of a balcony cut into it\n      fp3dSetRoofUnder(roofUnder ?? null);\n',
            'roof cut: roof',
        );
    }
    if (name === 'viewer/outdoor.ts') {
        code = `import { cheekFoot as fp3dCheekFoot, cheekHigh as fp3dCheekHigh, cheekPieces as fp3dCheekPieces, roofAt as fp3dRoofAt } from "${cut}";\n${code}`;
        code = replaceRequired(
            code,
            'const GATE_SIDE = 0x31467d;',
            [
                "/** The walls of a balcony cut into the roof: like the house's walls. */",
                'const FP3D_CHEEK = palette({ side: 0x131d31, top: 0x14303f }, { side: 0xf0ede8, top: 0xf7f5f1 });',
                '',
                'const GATE_SIDE = 0x31467d;',
            ].join('\n'),
            'roof cut: colours',
        );
        code = replaceRequired(
            code,
            '          if (againstWall(floor, p, q)) continue;\n          const y0 = g + look.top;\n',
            [
                '          if (againstWall(floor, p, q)) continue;',
                '          // cut into the roof: a wall from under the deck up to the roof along this edge, no railing where it is high enough',
                '          if (a.roof_cut) {',
                '            const fp3dPieces = fp3dCheekPieces(p, q, g + look.top);',
                '            for (const c of fp3dPieces) {',
                '              pushPrism(buf, ccw(fp3dCheekFoot(c.a, c.b, 0.2)), g - slab, (x, z) => fp3dRoofAt(x, z) ?? g + look.top + rail, FP3D_CHEEK.side, FP3D_CHEEK.top, { aoFrom: g });',
                '            }',
                '            if (fp3dCheekHigh(fp3dPieces, g + look.top, rail, Math.hypot(q[0] - p[0], q[1] - p[1]))) continue;',
                '          }',
                '          const y0 = g + look.top;',
                '',
            ].join('\n'),
            'roof cut: walls',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '        <label class="fp3d-check fp3d-wide" title=${this.t("outdoor_cut_hint")}',
            [
                '        ${a.type === "balcony"',
                '          ? html`<label class="fp3d-check fp3d-wide" title=${this.t("balcony_roof_cut_hint")}',
                '              ><input type="checkbox" .checked=${!!a.roof_cut} ?disabled=${!admin} @change=${(ev: Event) => this.updateOutdoor({ roof_cut: (ev.target as HTMLInputElement).checked || undefined })} />',
                '              ${this.t("balcony_roof_cut")}</label',
                '            >`',
                '          : nothing}',
                '        <label class="fp3d-check fp3d-wide" title=${this.t("outdoor_cut_hint")}',
            ].join('\n'),
            'roof cut: switch',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  balcony_rail: "Geländerhöhe",',
            [
                '  balcony_rail: "Geländerhöhe",',
                '  balcony_roof_cut: "Dacheinschnitt",',
                '  balcony_roof_cut_hint: "Der Balkon liegt im Dach: Darüber ist das Dach offen, an seinen freien Rändern stehen Wände vom Boden bis unters Dach – seitlich die Wangen, vorn die Brüstung. Wo eine Wand geländerhoch ist, entfällt das Geländer.",',
            ].join('\n'),
            'roof cut: de',
        );
        code = replaceRequired(
            code,
            '  balcony_rail: "Railing height",',
            [
                '  balcony_rail: "Railing height",',
                '  balcony_roof_cut: "Cut into the roof",',
                '  balcony_roof_cut_hint: "The balcony lies in the roof: the roof is open above it, and along its free edges walls stand from the deck up under the roof – the cheeks at the sides, the parapet in front. Where a wall is as high as a railing, the railing goes.",',
            ].join('\n'),
            'roof cut: en',
        );
    }
    return code;
}

/**
 * A wall outside (outdoor type "wall"): a garden wall, a retaining wall where the hill goes up – a stone block of its
 * own height standing on the ground, drawn like a hedge but of stone.
 */
function gardenWalls(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '"hedge", "fence", "pergola", "balcony"] as const;',
            '"hedge", "fence", "wall", "pergola", "balcony"] as const;',
            'garden wall: type',
        );
        code = replaceRequired(code, '  fence: 1.0,\n', '  fence: 1.0,\n  wall: 1.0,\n', 'garden wall: height');
        code = replaceRequired(
            code,
            '  return type === "hedge" || type === "fence" || type === "pergola";',
            '  return type === "hedge" || type === "fence" || type === "wall" || type === "pergola";',
            'garden wall: standing',
        );
    }
    if (name === 'viewer/outdoor.ts') {
        code = replaceRequired(
            code,
            '  fence: { color: 0x1d2946, side: 0x1d2946, edge: 0x5b7cff, edgeAlpha: 0.45 },\n',
            '  fence: { color: 0x1d2946, side: 0x1d2946, edge: 0x5b7cff, edgeAlpha: 0.45 },\n  wall: { color: 0x2b3042, side: 0x222737, edge: 0x5b7cff, edgeAlpha: 0.4 },\n',
            'garden wall: look',
        );
        code = replaceRequired(
            code,
            'fence: { color: 0xd8d3cb, side: 0xc8c2b9, edge: 0x5b7cff, edgeAlpha: 0.2 }, pergola:',
            'fence: { color: 0xd8d3cb, side: 0xc8c2b9, edge: 0x5b7cff, edgeAlpha: 0.2 }, wall: { color: 0xb3ab9e, side: 0x9d9588, edge: 0x5b7cff, edgeAlpha: 0.15 }, pergola:',
            'garden wall: light look',
        );
        code = replaceRequired(
            code,
            '        if (a.type === "hedge") outline((x, z) => groundAt(x, z) + 0.004);',
            '        if (a.type === "hedge" || a.type === "wall") outline((x, z) => groundAt(x, z) + 0.004);',
            'garden wall: foot',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '      .fp3d-out-pool polygon {',
            '      .fp3d-out-wall polygon {\n        fill: rgba(170, 176, 200, 0.28);\n        stroke: rgba(200, 206, 230, 0.7);\n      }\n      .fp3d-out-pool polygon {',
            'garden wall: plan',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  out_fence: "Zaun",',
            '  out_fence: "Zaun",\n  out_wall: "Mauer",',
            'garden wall: de',
        );
        code = replaceRequired(
            code,
            '  out_fence: "Fence",',
            '  out_fence: "Fence",\n  out_wall: "Wall",',
            'garden wall: en',
        );
    }
    return code;
}

/**
 * A room whose floor lies higher than its floor (room-level.ts): split level without a floor of its own, the dining
 * area three steps above the living room. Its floor and the step face are drawn at that height, everything standing
 * in it stands on it (furniture, wall cabinets and wall lights with it), its windows and doors count from it, the
 * light falls on it and the walk goes up with it; its ceiling stays, unless it has a ceiling height of its own.
 */
function roomLevels(name: string, code: string): string {
    const lv = `${root}/frontend/vendor-ext/room-level.ts`;
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  ceiling_height?: number | null;\n',
            "  ceiling_height?: number | null;\n  /** How far the room's floor lies above its floor's level (m, 0 … 3; null = 0): split level within one floor. */\n  floor_level?: number | null;\n",
            'room level: model',
        );
    }
    if (name === 'packs.ts') {
        code = `import { levelAt as fp3dLevelAt } from "${lv}";\n${code}`;
        code = replaceRequired(
            code,
            '  if (!rooms.length || rooms.some((r) => pointInPolygon([f.x, f.z], r.points))) return 0;',
            '  if (!rooms.length) return 0;\n  // a raised room: on its floor\n  if (rooms.some((r) => pointInPolygon([f.x, f.z], r.points))) return fp3dLevelAt(rooms, f.x, f.z);',
            'room level: ground',
        );
        code = replaceRequired(
            code,
            '  if (f.type === "lamp_wall") return WALL_LAMP_Y;',
            '  if (f.type === "lamp_wall") return WALL_LAMP_Y + fp3dLevelAt(floor.rooms, f.x, f.z);',
            'room level: wall lamp',
        );
        code = replaceRequired(
            code,
            '      return item.wall_y ?? 1;',
            '      return (item.wall_y ?? 1) + fp3dLevelAt(floor.rooms, f.x, f.z);',
            'room level: wall item',
        );
        code = replaceRequired(
            code,
            '      return builtinBase(f) || groundUnder(floor, f);',
            '      return builtinBase(f) ? builtinBase(f) + fp3dLevelAt(floor.rooms, f.x, f.z) : groundUnder(floor, f);',
            'room level: built-in',
        );
    }
    if (name === 'viewer/build.ts') {
        code = `import { roomLevel as fp3dRoomLevel } from "${lv}";\n${code}`;
        code = replaceRequired(
            code,
            '    const look = FLOOR_LOOK[room.floor_material] ?? FLOOR_LOOK.wood;\n    const top = new Color(look.color);\n',
            "    const look = FLOOR_LOOK[room.floor_material] ?? FLOOR_LOOK.wood;\n    const top = new Color(look.color);\n    // a raised room: its floor higher, the slab's side the step up to it\n    const fp3dLv = fp3dRoomLevel(room);\n",
            'room level: floor',
        );
        code = replaceRequired(
            code,
            '      floorBuf.tri([a[0], 0, a[1]], [c[0], 0, c[1]], [b[0], 0, b[1]], top, top, top, [a[0], a[1], c[0], c[1], b[0], b[1]], ALWAYS, look.tile);',
            '      floorBuf.tri([a[0], fp3dLv, a[1]], [c[0], fp3dLv, c[1]], [b[0], fp3dLv, b[1]], top, top, top, [a[0], a[1], c[0], c[1], b[0], b[1]], ALWAYS, look.tile);',
            'room level: top',
        );
        code = replaceRequired(
            code,
            [
                '        floorBuf.tri([a[0], -SLAB, a[1]], [a[0], 0, a[1]], [b[0], 0, b[1]], slab);',
                '        floorBuf.tri([a[0], -SLAB, a[1]], [b[0], 0, b[1]], [b[0], -SLAB, b[1]], slab);',
            ].join('\n'),
            [
                '        floorBuf.tri([a[0], -SLAB, a[1]], [a[0], fp3dLv, a[1]], [b[0], fp3dLv, b[1]], slab);',
                '        floorBuf.tri([a[0], -SLAB, a[1]], [b[0], fp3dLv, b[1]], [b[0], -SLAB, b[1]], slab);',
            ].join('\n'),
            'room level: step',
        );
        code = replaceRequired(
            code,
            '        holeLines.seg([a[0], 0.006, a[1]], [b[0], 0.006, b[1]], EDGE_TOP);',
            '        holeLines.seg([a[0], fp3dLv + 0.006, a[1]], [b[0], fp3dLv + 0.006, b[1]], EDGE_TOP);',
            'room level: hole rim',
        );
        // a window or a door of the raised room counts from its floor
        code = replaceRequired(
            code,
            [
                '    const top = Math.min(lowestTop(wall.a, ax, s0, s0 + width, wallHeight(wall, floor.height), wall) - 0.02, o.sill + o.height);',
                '    const sill = Math.max(0, Math.min(o.sill, top - 0.1));',
            ].join('\n'),
            [
                '    const fp3dLift = fp3dRoomLevel(floor.rooms.find((r) => r.id === o.room_id));',
                '    const top = Math.min(lowestTop(wall.a, ax, s0, s0 + width, wallHeight(wall, floor.height), wall) - 0.02, o.sill + fp3dLift + o.height);',
                '    const sill = Math.max(0, Math.min(o.sill + fp3dLift, top - 0.1));',
            ].join('\n'),
            'room level: openings',
        );
    }
    if (name === 'viewer/lighting.ts') {
        code = `import { roomLevel as fp3dRoomLevel } from "${lv}";\n${code}`;
        code = replaceRequired(
            code,
            '  floor.rooms.forEach((r, ri) => {\n    if (r.points.length < 3) return;\n',
            '  floor.rooms.forEach((r, ri) => {\n    if (r.points.length < 3) return;\n    // a raised room: the light lies on its floor\n    const fp3dY = LIFT + fp3dRoomLevel(r);\n',
            'room level: light',
        );
        code = replaceRequired(
            code,
            '          quad([a, LIFT, b], [a, LIFT, b1], [a1, LIFT, b1], [a1, LIFT, b], [0, 1, 0], ri, -1);',
            '          quad([a, fp3dY, b], [a, fp3dY, b1], [a1, fp3dY, b1], [a1, fp3dY, b], [0, 1, 0], ri, -1);',
            'room level: light cells',
        );
        code = replaceRequired(
            code,
            '          quad([p0[0], LIFT, p0[1]], [p1[0], LIFT, p1[1]], [p2[0], LIFT, p2[1]], [p2[0], LIFT, p2[1]], [0, 1, 0], ri, -1);',
            '          quad([p0[0], fp3dY, p0[1]], [p1[0], fp3dY, p1[1]], [p2[0], fp3dY, p2[1]], [p2[0], fp3dY, p2[1]], [0, 1, 0], ri, -1);',
            'room level: light parts',
        );
    }
    if (name === 'viewer/walk.ts') {
        code = `import { levelAt as fp3dLevelAt } from "${lv}";\n${code}`;
        code = replaceRequired(
            code,
            '    return (fv ? fv.floor.elevation + fv.y : this.map.floor.elevation) + EYE;',
            '    // up with a raised room\n    return (fv ? fv.floor.elevation + fv.y : this.map.floor.elevation) + EYE + fp3dLevelAt(this.map.floor.rooms, this.state.x, this.state.z);',
            'room level: walk',
        );
    }
    if (name === 'components/editor.ts') {
        code = `import { levelValue as fp3dLevelValue, MAX_ROOM_LEVEL as FP3D_MAX_ROOM_LEVEL } from "${lv}";\n${code}`;
        code = replaceRequired(
            code,
            '        <p class="fp3d-sub fp3d-wide">${this.t("room_ceiling_hint")}</p>\n',
            [
                '        <p class="fp3d-sub fp3d-wide">${this.t("room_ceiling_hint")}</p>',
                '        ${this.len(this.t("room_floor_level"), room.floor_level ?? 0, (v) => this.updateRoom({ floor_level: fp3dLevelValue(v) }), 0.05, 0)}',
                '        <p class="fp3d-sub fp3d-wide">${this.t("room_floor_level_hint", { max: FP3D_MAX_ROOM_LEVEL })}</p>',
                '',
            ].join('\n'),
            'room level: field',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  room_ceiling: "Deckenhöhe (m)",',
            [
                '  room_ceiling: "Deckenhöhe (m)",',
                '  room_floor_level: "Boden höher (m)",',
                '  room_floor_level_hint: "Split-Level ohne eigene Etage: Der Boden des Raums liegt so viel höher (bis {max} m), z. B. der Essplatz drei Stufen über dem Wohnzimmer. Möbel, Fenster und Türen des Raums zählen ab seinem Boden; die Decke bleibt – für dieselbe Raumhöhe die Deckenhöhe um den Versatz erhöhen. Die Stufen hinauf sind eine Treppe im tieferen Raum.",',
            ].join('\n'),
            'room level: de',
        );
        code = replaceRequired(
            code,
            '  room_ceiling: "Ceiling height (m)",',
            [
                '  room_ceiling: "Ceiling height (m)",',
                '  room_floor_level: "Floor raised (m)",',
                '  room_floor_level_hint: "Split level without a floor of its own: the room\'s floor lies this much higher (up to {max} m), e.g. the dining area three steps above the living room. The room\'s furniture, windows and doors count from its floor; the ceiling stays – for the same room height raise the ceiling height by the same amount. The steps up are a stair in the lower room.",',
            ].join('\n'),
            'room level: en',
        );
    }
    return code;
}

/**
 * A floor's outline from its outer walls closes over a wall left open in part (outline-gaps.ts): a passage of height 0
 * to a stair room broke the loop, and the floor lost its outline – no earth around it, no roof from it.
 */
function outlineGaps(name: string, code: string): string {
    if (name === 'roof-sections.ts') {
        code = `import { gapSegments as fp3dGapSegments } from "${root}/frontend/vendor-ext/outline-gaps.ts";\n${code}`;
        code = replaceRequired(
            code,
            '  const segs: Seg[] = walls.map((w) => ({ a: w.a, b: w.b }));\n',
            [
                '  const segs: Seg[] = walls.map((w) => ({ a: w.a, b: w.b }));',
                '  // a wall open in part leaves a gap in the loop: its open ends are joined straight',
                '  for (const [a, b] of fp3dGapSegments(segs.map((w) => [w.a, w.b] as [Vec2, Vec2]))) segs.push({ a, b });',
                '',
            ].join('\n'),
            'outline gaps',
        );
    }
    return code;
}

/**
 * Heights at the corners of an area outside (area-heights.ts): a lawn up a hill, a bank beside the drive. The surface
 * runs between the corners (mean value coordinates: straight along the edges, smooth inside), drawn with points of
 * its own inside; everything that stands on it or looks at it (lamps, furniture, snow, light, light wells) follows
 * through `groundDrop`. The earth at the house follows such an area lying higher beside its walls.
 */
function areaHeights(name: string, code: string): string {
    const heights = `${root}/frontend/vendor-ext/area-heights.ts`;
    if (name === 'model.ts') {
        code = `import { cornerRise as fp3dCornerRise } from "${heights}";\n${code}`;
        code = replaceRequired(
            code,
            '  slope_dir?: SlopeDir;\n',
            "  slope_dir?: SlopeDir;\n  /** Height of each corner over the area's level (m, null = 0): the surface runs between them (a hillside). */\n  heights?: (number | null)[] | null;\n",
            'area heights: model',
        );
        code = replaceRequired(
            code,
            '  return a.type === "pool" ? 0 : outdoorDrop(a, x, z);',
            '  return a.type === "pool" ? 0 : outdoorDrop(a, x, z) - fp3dCornerRise(a.points, a.heights, x, z);',
            'area heights: drop',
        );
    }
    if (name === 'viewer/outdoor.ts') {
        code = `import { hasHeights as fp3dHasHeights, heightRange as fp3dHeightRange, innerPoints as fp3dInnerPoints } from "${heights}";\n${code}`;
        code = replaceRequired(
            code,
            '    const lowest = g - (a.type === "pool" ? 0 : (a.slope ?? 0));',
            '    const lowest = g - (a.type === "pool" ? 0 : (a.slope ?? 0) - fp3dHeightRange(a.heights)[0]);',
            'area heights: lowest',
        );
        code = replaceRequired(
            code,
            '        pushPrism(buf, poly, base, a.slope ? topAt : g + look.top, look.side, look.color, { aoFrom: base, holes });',
            [
                '        // corners at heights of their own: points inside let the surface bend between them',
                '        const fp3dRaised = a.type !== "pool" && fp3dHasHeights(a.heights);',
                '        const fp3dInner = fp3dRaised ? fp3dInnerPoints(poly, holes).map((q) => [q]) : [];',
                '        pushPrism(buf, poly, base, a.slope || fp3dRaised ? topAt : g + look.top, look.side, look.color, { aoFrom: base, holes: [...holes, ...fp3dInner] });',
            ].join('\n'),
            'area heights: surface',
        );
    }
    if (name === 'geometry/wells.ts') {
        code = `import { raisedAround as fp3dRaisedAround } from "${heights}";\n${code}`;
        // a floor stands in the ground too where a garden lies clearly higher beside it (up a hill)
        code = replaceRequired(
            code,
            '  return !!outline && outline.some(([x, z]) => terrainAt(x, z) - floor.elevation > -0.15);',
            [
                '  if (!outline) return false;',
                '  if (outline.some(([x, z]) => terrainAt(x, z) - floor.elevation > -0.15)) return true;',
                '  return fp3dRaisedAround(outline, (p) => coverAt(b, floor, p), (p) => terrainAt(p[0], p[1]) - floor.elevation);',
            ].join('\n'),
            'area heights: in the ground',
        );
    }
    if (name === 'viewer/earth.ts') {
        code = replaceRequired(
            code,
            'import { earthOutline, inGround, WELL_DEPTH, wellBelowGround } from "../geometry/wells.ts";',
            'import { coverAt as fp3dCoverAt, earthOutline, inGround, WELL_DEPTH, wellBelowGround } from "../geometry/wells.ts";',
            'area heights: earth import',
        );
        code = replaceRequired(
            code,
            '      const g0 = ground(p0[0], p0[1]);\n      const g1 = ground(p1[0], p1[1]);\n',
            [
                '      // the earth reaches up to an area outside lying higher beside the wall (a garden up a hill)',
                '      const fp3dUp = (s: number) => fp3dCoverAt(b, floor, at(s, 0.3)) ?? -Infinity;',
                '      const g0 = Math.min(H, Math.max(ground(p0[0], p0[1]), fp3dUp(s0)));',
                '      const g1 = Math.min(H, Math.max(ground(p1[0], p1[1]), fp3dUp(s1)));',
                '',
            ].join('\n'),
            'area heights: earth',
        );
    }
    if (name === 'winter.ts') {
        code = `import { hasHeights as fp3dHasHeights } from "${heights}";\n${code}`;
        code = replaceRequired(
            code,
            '...(a.slope ? { follow: { areaId: a.id, lift: 0.025 } } : {})',
            '...(a.slope || fp3dHasHeights(a.heights) ? { follow: { areaId: a.id, lift: 0.025 } } : {})',
            'area heights: snow',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { hasHeights as fp3dHasHeights, innerPoints as fp3dInnerPoints } from "${heights}";\n${code}`;
        code = replaceRequired(
            code,
            [
                '        for (const tri of triangulate(t.points)) {',
                '          for (const i of tri) {',
                '            const [px, pz] = t.points[i];',
            ].join('\n'),
            [
                '        // on an area with heights at its corners the snow bends with it',
                '        const fp3dIn = area && fp3dHasHeights(area.heights) ? fp3dInnerPoints(t.points) : [];',
                '        const fp3dAll = [...t.points, ...fp3dIn];',
                '        for (const tri of triangulate(t.points, fp3dIn.map((q) => [q]))) {',
                '          for (const i of tri) {',
                '            const [px, pz] = fp3dAll[i];',
            ].join('\n'),
            'area heights: snow patches',
        );
    }
    if (name === 'components/editor.ts') {
        code = `import { hasHeights as fp3dHasHeights, heightsInsert as fp3dHeightsInsert, heightsRemove as fp3dHeightsRemove, heightsSet as fp3dHeightsSet } from "${heights}";\n${code}`;
        // a corner put in halfway along an edge takes the height halfway
        code = replaceRequired(
            code,
            '        a.points.splice(i + 1, 0, [round((p[0] + q[0]) / 2), round((p[1] + q[1]) / 2)]);\n',
            [
                '        const fp3dH = fp3dHeightsInsert(a.heights, a.points.length, i);',
                '        a.points.splice(i + 1, 0, [round((p[0] + q[0]) / 2), round((p[1] + q[1]) / 2)]);',
                '        if (fp3dH) a.heights = fp3dH;',
                '',
            ].join('\n'),
            'area heights: corner in',
        );
        code = replaceRequired(
            code,
            '      this.updateOutdoor({ points: a.points.filter((_, k) => k !== i).map((p) => [...p] as Vec2), ...(a.gates ? { gates: gates?.length ? gates : undefined } : {}) });',
            '      this.updateOutdoor({ points: a.points.filter((_, k) => k !== i).map((p) => [...p] as Vec2), ...(a.gates ? { gates: gates?.length ? gates : undefined } : {}), ...(a.heights ? { heights: fp3dHeightsRemove(a.heights, n, i) } : {}) });',
            'area heights: corner out',
        );
        // every corner's height beside its x and z
        code = replaceRequired(
            code,
            [
                '        (p, i) => html`<div class="fp3d-point">',
                '          <span class="fp3d-muted">${i + 1}</span>',
                '          ${this.len(this.t("x"), p[0], (v) => setPoint(i, 0, v))} ${this.len(this.t("z"), p[1], (v) => setPoint(i, 1, v))}',
            ].join('\n'),
            [
                '        (p, i) => html`<div class=${a.type !== "pool" && a.points.length >= 3 ? "fp3d-point fp3d-point-h" : "fp3d-point"}>',
                '          <span class="fp3d-muted">${i + 1}</span>',
                '          ${this.len(this.t("x"), p[0], (v) => setPoint(i, 0, v))} ${this.len(this.t("z"), p[1], (v) => setPoint(i, 1, v))}',
                '          ${a.type !== "pool" && a.points.length >= 3 ? this.len(this.t("corner_height"), a.heights?.[i] ?? 0, (v) => Number.isFinite(v) && this.updateOutdoor({ heights: fp3dHeightsSet(a.heights, a.points.length, i, v) }), 0.05) : nothing}',
            ].join('\n'),
            'area heights: field',
        );
        code = replaceRequired(
            code,
            '      )}\n    </details>`;\n  }\n\n  private deleteOutdoor(): void {',
            '      )}\n      ${a.type !== "pool" && a.points.length >= 3 ? html`<p class="fp3d-sub">${this.t("corner_height_hint")}</p>` : nothing}\n    </details>`;\n  }\n\n  private deleteOutdoor(): void {',
            'area heights: hint',
        );
        // in the plan the corner's number carries its height
        code = replaceRequired(
            code,
            [
                '      return svg`<g class="fp3d-vertex" data-out-vertex=${`${a.id}:${i}`}><circle cx=${x} cy=${y} r="16" class="fp3d-hit" /><circle cx=${x} cy=${y} r="6" /></g>',
                '        <text class="fp3d-vertex-no" x=${x + 9} y=${y - 9}>${i + 1}</text>`;',
            ].join('\n'),
            [
                '      const fp3dH = fp3dHasHeights(a.heights) ? (a.heights?.[i] ?? 0) : null;',
                '      return svg`<g class="fp3d-vertex" data-out-vertex=${`${a.id}:${i}`}><circle cx=${x} cy=${y} r="16" class="fp3d-hit" /><circle cx=${x} cy=${y} r="6" /></g>',
                '        <text class="fp3d-vertex-no" x=${x + 9} y=${y - 9}>${i + 1}${fp3dH !== null ? ` · ${fp3dH > 0 ? "+" : ""}${this.m(fp3dH, 2)}` : ""}</text>`;',
            ].join('\n'),
            'area heights: plan',
        );
        code = replaceRequired(
            code,
            '      .fp3d-point-sel .fp3d-muted {',
            '      .fp3d-point-h {\n        grid-template-columns: 18px 1fr 1fr 1fr auto;\n      }\n      .fp3d-point-sel .fp3d-muted {',
            'area heights: css',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  outdoor_slope: "Gefälle (m)",',
            [
                '  outdoor_slope: "Gefälle (m)",',
                '  corner_height: "Höhe (m)",',
                '  corner_height_hint: "Höhe: wie weit die Ecke über der Fläche liegt (über ihrem Höhenversatz). Die Fläche verläuft zwischen den Ecken – ein Hang, eine Böschung; das Erdreich am Haus folgt ihr.",',
            ].join('\n'),
            'area heights: de',
        );
        code = replaceRequired(
            code,
            '  outdoor_slope: "Slope (m)",',
            [
                '  outdoor_slope: "Slope (m)",',
                '  corner_height: "Height (m)",',
                '  corner_height_hint: "Height: how far the corner lies above the area (above its height offset). The surface runs between the corners – a hillside, a bank; the earth at the house follows it.",',
            ].join('\n'),
            'area heights: en',
        );
    }
    return code;
}

/**
 * The background picture can be stretched in one direction (`stretch`: its depth against its width): a scan or a
 * photo of a plan is often a few percent longer one way. The ruler can scale it only along the measured stretch
 * (width or depth), and the form has the stretch in percent.
 */
function bgStretch(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            "  /** Turn about the picture's middle (degrees, clockwise in the plan). */\n  rotation?: number;\n}",
            "  /** Turn about the picture's middle (degrees, clockwise in the plan). */\n  rotation?: number;\n  /** Its depth against its width, stretched (1 = as the picture is; 0.975 = 2.5 % shorter in depth). */\n  stretch?: number | null;\n}",
            'background stretch: model',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '    _bgRulerLen: { state: true },\n',
            '    _bgRulerLen: { state: true },\n    _bgRulerAxis: { state: true },\n',
            'background stretch: state',
        );
        code = replaceRequired(
            code,
            '  private declare _bgRulerLen: number;\n',
            "  private declare _bgRulerLen: number;\n  /** The ruler scales only along the measured stretch: the picture's width or its depth, whichever is nearer. */\n  private declare _bgRulerAxis: boolean;\n",
            'background stretch: declare',
        );
        code = replaceRequired(
            code,
            '    this._bgRuler = null;\n    this._bgRulerLen = 0;\n    this._bgLevel = null;\n',
            '    this._bgRuler = null;\n    this._bgRulerLen = 0;\n    this._bgRulerAxis = false;\n    this._bgLevel = null;\n',
            'background stretch: init',
        );
        // every height of the picture: its width by the picture's own aspect and the stretch
        code = replaceEvery(
            code,
            'const h = bg.width * img.aspect;',
            'const h = bg.width * img.aspect * (bg.stretch ?? 1);',
            'background stretch: heights',
            3,
        );
        code = replaceRequired(
            code,
            'const h = bg.width * (img?.aspect ?? 1);',
            'const h = bg.width * (img?.aspect ?? 1) * (bg.stretch ?? 1);',
            'background stretch: turn handle',
        );
        code = replaceRequired(
            code,
            '    const h = w * img.aspect;\n    const rot = bg.rotation ?? 0;',
            '    const h = w * img.aspect * (bg.stretch ?? 1);\n    const rot = bg.rotation ?? 0;',
            'background stretch: drawn',
        );
        code = replaceRequired(
            code,
            '  private bgLocal(bg: Background, world: Vec2, aspect: number): Vec2 {\n    const h = bg.width * aspect;',
            '  private bgLocal(bg: Background, world: Vec2, aspect: number): Vec2 {\n    const h = bg.width * aspect * (bg.stretch ?? 1);',
            'background stretch: local',
        );
        // the ruler: along one direction only, the picture is scaled along its own axis nearest the measured line
        code = replaceRequired(
            code,
            [
                '    const k = real / measured;',
                '    // scaling about p keeps the turn: the centre moves to p + k (c − p), the size grows by k',
                '    const h = bg.width * img.aspect * (bg.stretch ?? 1);',
                '    const c: Vec2 = [bg.x + bg.width / 2, bg.z + h / 2];',
                '    const p = pts[0];',
            ].join('\n'),
            [
                '    const k = real / measured;',
                '    // scaling about p keeps the turn: the centre moves to p + k (c − p), the size grows by k',
                '    const h = bg.width * img.aspect * (bg.stretch ?? 1);',
                '    const c: Vec2 = [bg.x + bg.width / 2, bg.z + h / 2];',
                '    const p = pts[0];',
                '    if (this._bgRulerAxis) {',
                "      // only along the picture's width or its depth (its own axes, turned with it), whichever the line follows",
                '      const a = ((bg.rotation ?? 0) * Math.PI) / 180;',
                '      const ux: Vec2 = [Math.cos(a), Math.sin(a)];',
                '      const dx = pts[1][0] - pts[0][0];',
                '      const dz = pts[1][1] - pts[0][1];',
                '      const along = Math.abs(dx * ux[0] + dz * ux[1]) >= Math.abs(-dx * ux[1] + dz * ux[0]);',
                '      const u: Vec2 = along ? ux : [-ux[1], ux[0]];',
                '      const t = (c[0] - p[0]) * u[0] + (c[1] - p[1]) * u[1];',
                '      const c3: Vec2 = [c[0] + (k - 1) * t * u[0], c[1] + (k - 1) * t * u[1]];',
                '      const w3 = along ? bg.width * k : bg.width;',
                '      const h3 = along ? h : h * k;',
                '      const stretch = Math.round((h3 / (w3 * img.aspect)) * 10000) / 10000;',
                '      this.updateFloor({ background: { ...bg, width: round(w3), stretch: Math.abs(stretch - 1) < 1e-4 ? null : stretch, x: round(c3[0] - w3 / 2), z: round(c3[1] - h3 / 2) } });',
                '      this._bgRuler = null;',
                '      this._bgRulerLen = 0;',
                '      return;',
                '    }',
            ].join('\n'),
            'background stretch: ruler',
        );
        code = replaceRequired(
            code,
            '                          <button class="fp3d-btn fp3d-primary" ?disabled=${!(this._bgRulerLen > 0)} @click=${() => this.applyBgRuler(this._bgRulerLen)}>${this.t("bg_ruler_apply")}</button>`',
            [
                '                          <label class="fp3d-check fp3d-wide"',
                '                            ><input type="checkbox" .checked=${this._bgRulerAxis} @change=${(e: Event) => (this._bgRulerAxis = (e.target as HTMLInputElement).checked)} />',
                '                            ${this.t("bg_ruler_axis")}</label',
                '                          >',
                '                          <button class="fp3d-btn fp3d-primary" ?disabled=${!(this._bgRulerLen > 0)} @click=${() => this.applyBgRuler(this._bgRulerLen)}>${this.t("bg_ruler_apply")}</button>`',
            ].join('\n'),
            'background stretch: ruler option',
        );
        // the form: the stretch in percent beside the width (the depth then follows from the picture)
        code = replaceRequired(
            code,
            '              ${this.num(this.t("background_rotation"), bg.rotation ?? 0,',
            '              ${this.num(this.t("background_stretch"), Math.round((bg.stretch ?? 1) * 10000) / 100, (v) => this.updateFloor({ background: { ...bg, stretch: v > 0 && Math.abs(v - 100) > 1e-3 ? Math.round(v * 100) / 10000 : null } }), 0.1)}\n              ${this.num(this.t("background_rotation"), bg.rotation ?? 0,',
            'background stretch: form',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  background_width: "Breite im Plan (m)",',
            '  background_width: "Breite im Plan (m)",\n  background_stretch: "Tiefe gestreckt (%)",\n  bg_ruler_axis: "Nur in dieser Richtung (Breite oder Tiefe des Bildes)",',
            'background stretch: de',
        );
        code = replaceRequired(
            code,
            '  background_width: "Width in plan (m)",',
            '  background_width: "Width in plan (m)",\n  background_stretch: "Depth stretched (%)",\n  bg_ruler_axis: "Only in this direction (the picture\'s width or depth)",',
            'background stretch: en',
        );
    }
    return code;
}

/**
 * A straight stair is a flight of slabs, open below (like the U-stair's second flight), not a solid wedge: in a
 * split-level house the flights lie above each other (hall → half floor above the garage → flat below → garage), each
 * on the floor it starts from, and the one below passes under the one above.
 */
function stairFlights(name: string, code: string): string {
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    b.box(-w / 2, w / 2, 0, y1, z0, z1, C.wood, C.woodTop);',
            '    b.box(-w / 2, w / 2, Math.max(0, y1 - rise - 0.2), y1, z0, z1, C.wood, C.woodTop);',
            'stairs: open below',
        );
        code = replaceRequired(
            code,
            '/** Straight stair rising towards -z (the back), with a handrail on the +x side. */',
            '/** Straight stair rising towards -z (the back), a flight of slabs open below, with a handrail on the +x side. */',
            'stairs: doc',
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
                '          tree.position.set(p.t.x, p.y + (p.t.y ?? 0), p.t.z);',
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
                '            // it stands on the ground there: a lawn on a hill, a raised bed (in a room: on its floor)',
                '            y: fl.rooms.some((r) => r.points.length >= 3 && pointInPolygon([f.x, f.z], r.points)) ? 0 : outdoorGround(fl, f.x, f.z),',
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
 * Own 3D objects (own-models.ts, own-model-form.ts): the furniture type "model3d" shows a model file uploaded in the
 * editor (GLB with its colours and textures, OBJ and STL in one colour), scaled into its box; a tap opens its entity.
 * The files lie in the instance's storage (store.ts: `home3d/model/*`).
 */
function ownModels(name: string, code: string): string {
    const models = `${root}/frontend/vendor-ext/own-models.ts`;
    if (name === 'model.ts') {
        // at the end of the types (other patches add theirs there too)
        const start = code.indexOf('export const FURNITURE_TYPES = [');
        const end = start < 0 ? -1 : code.indexOf('\n] as const;', start);
        if (end < 0) {
            throw new Error('Upstream patch no longer matches: own models: furniture types');
        }
        code = `${code.slice(0, end)}\n  "model3d",${code.slice(end)}`;
        code = replaceRequired(
            code,
            'export const FURNITURE_SIZE: Record<FurnitureType, [number, number, number]> = {\n',
            'export const FURNITURE_SIZE: Record<FurnitureType, [number, number, number]> = {\n  // an own 3D object: its box until a model gives its own size\n  model3d: [1, 1, 1],\n',
            'own models: size',
        );
        code = replaceRequired(
            code,
            'export const FURNITURE_GROUPS: Record<string, FurnitureType[]> = {\n',
            'export const FURNITURE_GROUPS: Record<string, FurnitureType[]> = {\n  own: ["model3d"],\n',
            'own models: shown',
        );
        // it may stand for any device: an entity to switch and a tap that opens it
        code = replaceRequired(
            code,
            '  "island",\n  "sink",\n]);',
            '  "island",\n  "sink",\n  "model3d",\n]);',
            'own models: electric',
        );
        code = replaceRequired(
            code,
            '  variant: string | null;\n',
            '  variant: string | null;\n  /** An own 3D object (type "model3d"): the ID of its model file (`home3d/model/list`). */\n  model?: string | null;\n',
            'own models: field',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            'const BASIC: Record<string, [Kind, Room[]]> = {\n',
            'const BASIC: Record<string, [Kind, Room[]]> = {\n  model3d: ["deco", []],\n',
            'own models: library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "tree":\n    case "tree_fruit":',
            [
                '    case "model3d": {',
                '      // an own 3D object from above: its box and a cube',
                '      const r = Math.min(w, d) * 0.3;',
                '      const p = [0, 1, 2, 3, 4, 5].map((i) => [Math.cos(Math.PI / 6 + (i * Math.PI) / 3) * r, Math.sin(Math.PI / 6 + (i * Math.PI) / 3) * r]);',
                '      return [',
                '        rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"),',
                '        ...p.map((a, i) => line(a[0], a[1], p[(i + 1) % 6][0], p[(i + 1) % 6][1])),',
                '        ...[1, 3, 5].map((i) => line(0, 0, p[i][0], p[i][1])),',
                '      ];',
                '    }',
                '    case "tree":',
                '    case "tree_fruit":',
            ].join('\n'),
            'own models: symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "tree":\n    case "tree_conifer":',
            '    case "model3d":\n    case "tree":\n    case "tree_conifer":',
            'own models: drawn apart',
        );
    }
    if (name === 'viewer/preview.ts') {
        code = `import { modelPreview as fp3dPrevModel } from "${models}";\n${code}`;
        code = replaceRequired(
            code,
            '  const fp3dOwn = fp3dOwn0 ?? fp3dBoat;\n',
            '  const fp3dOwn = fp3dOwn0 ?? fp3dBoat ?? (item.type === "model3d" ? fp3dPrevModel(item.w, item.d, item.h) : null);\n',
            'own models: library picture',
        );
    }
    if (name === 'components/editor.ts') {
        code = `import { modelForm as fp3dModelForm } from "${root}/frontend/vendor-ext/own-model-form.ts";\n${code}`;
        code = replaceRequired(
            code,
            '      ${f.type === "lamp_pendant"\n',
            [
                '      ${f.type === "model3d"',
                '        ? fp3dModelForm(f, {',
                '            hass: this.hass as never,',
                '            admin,',
                '            t: (k: string) => this.t(k as I18nKey),',
                '            update: (p: Record<string, unknown>) => this.updateFurniture(p as Partial<Furniture>),',
                '            redraw: () => this.requestUpdate(),',
                '          })',
                '        : nothing}',
                '      ${f.type === "lamp_pendant"',
                '',
            ].join('\n'),
            'own models: fields',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { buildModelItem as fp3dBuildModelItem, modelFurniture as fp3dModelFurniture, modelKey as fp3dModelKey, modelsVersion as fp3dModelsVersion, onModelChange as fp3dOnModelChange, setModelReader as fp3dSetModelReader, type ModelSpec as Fp3dModelSpec } from "${models}";\n${code}`;
        code = replaceRequired(
            code,
            '  private fp3dTreeSig = "";\n',
            [
                '  private fp3dTreeSig = "";',
                '  /** Own 3D objects, built anew when they, their floor, the look or a loaded model change. */',
                '  private fp3dModels: Fp3dModelSpec[] = [];',
                '  private fp3dModelGroup: Group | null = null;',
                '  private fp3dModelSig = "";',
                '  private fp3dModelOff: (() => void) | null = null;',
                '',
                '  /** Where the model files come from: set here, in the bundle of the viewer, which loads them. */',
                '  fp3dSetModelReader(fn: Parameters<typeof fp3dSetModelReader>[0]): void {',
                '    fp3dSetModelReader(fn);',
                '  }',
                '',
                '  fp3dSetModels(list: Fp3dModelSpec[]): void {',
                '    // a model that finished loading is drawn at once',
                '    this.fp3dModelOff ??= fp3dOnModelChange(() => this.invalidate());',
                '    if (JSON.stringify(list) === JSON.stringify(this.fp3dModels)) return;',
                '    this.fp3dModels = list;',
                '    this.invalidate();',
                '  }',
                '',
            ].join('\n'),
            'own models: fields',
        );
        code = replaceRequired(
            code,
            '    this.fp3dSkyMoving = moving && !this.lowQuality;\n',
            [
                '    // own 3D objects: the model in its box (a box while it loads or when its file is missing)',
                '    const modelParts: { m: Fp3dModelSpec; y: number }[] = [];',
                '    for (const m of this.fp3dModels) {',
                '      const fv = this.floorMap.get(m.floor);',
                '      if (!fv || !fv.group.visible || fv.o < 0.3) continue;',
                '      modelParts.push({ m, y: fv.group.position.y });',
                '    }',
                '    const modelSig = `${light ? "l" : "d"}|${fp3dModelsVersion()}|${modelParts.map((p) => fp3dModelKey(p.m, p.y)).join("|")}`;',
                '    if (modelSig !== this.fp3dModelSig) {',
                '      this.fp3dModelSig = modelSig;',
                '      if (this.fp3dModelGroup) {',
                '        this.root.remove(this.fp3dModelGroup);',
                '        this.fp3dModelGroup = null;',
                '      }',
                '      if (modelParts.length) {',
                '        const g = new Group();',
                '        for (const p of modelParts) {',
                '          const item = fp3dBuildModelItem(p.m, !!light);',
                '          item.position.set(p.m.x, p.y + p.m.y, p.m.z);',
                '          g.add(item);',
                '        }',
                '        this.root.add(g);',
                '        this.fp3dModelGroup = g;',
                '      }',
                '    }',
                '    this.fp3dSkyMoving = moving && !this.lowQuality;',
                '',
            ].join('\n'),
            'own models: every frame',
        );
        code = replaceRequired(
            code,
            '    if (this.fp3dTreeGroup) fp3dDisposeTrees(this.fp3dTreeGroup);\n',
            '    if (this.fp3dTreeGroup) fp3dDisposeTrees(this.fp3dTreeGroup);\n    this.fp3dModelOff?.();\n',
            'own models: dispose',
        );
        code = replaceRequired(
            code,
            '    // the gear of a boat lies apart (a tank is seen through berths and floors): a tap on it opens its sensor\n',
            [
                '    // an own 3D object: its entity, unless something tappable is nearer',
                '    if (devices && !this.furnish && this.fp3dModelGroup) {',
                '      const hit = ray.intersectObject(this.fp3dModelGroup, true)[0];',
                '      const fp3dModelId = hit ? fp3dModelFurniture(hit.object) : null;',
                '      const fp3dModelEntity = fp3dModelId ? this.pickFurniture.get(fp3dModelId) : undefined;',
                '      if (hit && fp3dModelEntity) {',
                '        const nearer = ray',
                '          .intersectObjects(this.activeFloors().flatMap((f) => [f.lampMesh, f.fridgeMesh].filter((m) => m.visible)), false)',
                '          .some((h) => h.distance < hit.distance);',
                '        if (!nearer) return { entity: fp3dModelEntity };',
                '      }',
                '    }',
                '    // the gear of a boat lies apart (a tank is seen through berths and floors): a tap on it opens its sensor',
                '',
            ].join('\n'),
            'own models: tap',
        );
    }
    if (name === 'components/view3d.ts') {
        code = `import type { ModelExt as Fp3dModelExt } from "${root}/frontend/vendor-ext/model-files.ts";\n${code}`;
        code = replaceRequired(
            code,
            '    v.fp3dSetTrees(\n',
            [
                '    // own 3D objects: their files come from the storage of the instance',
                '    v.fp3dSetModelReader((id) => hass.callWS<{ data: string; ext: Fp3dModelExt }>({ type: "home3d/model/get", model_id: id }));',
                '    v.fp3dSetModels(',
                '      b.floors.flatMap((fl) =>',
                '        fl.furniture',
                '          .filter((f) => f.type === "model3d")',
                '          .map((f) => ({',
                '            id: f.id,',
                '            floor: fl.id,',
                '            model: f.model ?? null,',
                '            x: f.x,',
                '            z: f.z,',
                '            angle: ((f.rotation ?? 0) * Math.PI) / 180,',
                '            w: f.w,',
                '            d: f.d,',
                '            h: f.h,',
                '            mirror: !!f.mirror,',
                '            // its height above the floor; outside on the ground there',
                '            y: (f.mount_y ?? 0) + (fl.rooms.some((r) => r.points.length >= 3 && pointInPolygon([f.x, f.z], r.points)) ? 0 : outdoorGround(fl, f.x, f.z)),',
                '          })),',
                '      ),',
                '    );',
                '    v.fp3dSetTrees(',
                '',
            ].join('\n'),
            'own models to the viewer',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            furn_model3d: 'Eigenes 3D-Objekt',
            model3d_file: '3D-Modell',
            model3d_none: '– keins –',
            model3d_missing: 'Datei fehlt',
            model3d_upload: '3D-Datei hochladen …',
            model3d_reading: 'Wird gelesen …',
            model3d_tris: 'Dreiecke',
            model3d_natural: 'Originalgröße',
            model3d_prune: 'Unbenutzte Modelle löschen',
            model3d_prune_hint: 'Löscht die hochgeladenen Modelle, die kein Grundriss mehr verwendet.',
            model3d_hint:
                'GLB (glTF 2.0) bringt Farben und Texturen mit, OBJ und STL erscheinen einfarbig. Das Modell füllt die Box aus Breite, Tiefe und Höhe. Höchstens 20 MB.',
            model3d_many: 'Sehr viele Dreiecke: auf Tablets kann die 3D-Ansicht ruckeln.',
            model3d_err_big: 'Die Datei ist größer als 20 MB.',
            model3d_err_tris: 'Das Modell hat mehr als 2 Millionen Dreiecke.',
            model3d_err_format: 'Die Datei ist kein lesbares 3D-Modell (GLB, glTF, OBJ oder STL).',
            model3d_err_draco:
                'Mit Draco komprimierte Modelle kann die Seite nicht lesen: bitte ohne Kompression exportieren.',
            model3d_err_ktx2:
                'Texturen im Format KTX2 kann die Seite nicht lesen: bitte mit PNG- oder JPEG-Texturen exportieren.',
            model3d_err_external:
                'Die glTF-Datei verweist auf weitere Dateien: bitte als GLB (eine Datei) exportieren.',
            model3d_err_empty: 'Die Datei enthält keine Flächen.',
        };
        const en: Record<string, string> = {
            furn_model3d: 'Own 3D object',
            model3d_file: '3D model',
            model3d_none: '– none –',
            model3d_missing: 'File missing',
            model3d_upload: 'Upload a 3D file …',
            model3d_reading: 'Reading …',
            model3d_tris: 'triangles',
            model3d_natural: 'Original size',
            model3d_prune: 'Delete unused models',
            model3d_prune_hint: 'Deletes the uploaded models that no floor plan uses any more.',
            model3d_hint:
                'GLB (glTF 2.0) brings its colours and textures, OBJ and STL show in one colour. The model fills the box of width, depth and height. At most 20 MB.',
            model3d_many: 'Very many triangles: the 3D view may stutter on tablets.',
            model3d_err_big: 'The file is larger than 20 MB.',
            model3d_err_tris: 'The model has more than 2 million triangles.',
            model3d_err_format: 'The file is not a readable 3D model (GLB, glTF, OBJ or STL).',
            model3d_err_draco: 'The page cannot read models compressed with Draco: please export without compression.',
            model3d_err_ktx2: 'The page cannot read textures in KTX2: please export with PNG or JPEG textures.',
            model3d_err_external: 'The glTF file refers to further files: please export as GLB (one file).',
            model3d_err_empty: 'The file contains no faces.',
        };
        const lines = (texts: Record<string, string>): string =>
            Object.entries(texts)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(
            code,
            '  furn_nav_light: "Positionslicht",',
            `  furn_nav_light: "Positionslicht",${lines(de)}`,
            'own models de',
        );
        code = replaceRequired(
            code,
            '  furn_nav_light: "Navigation light",',
            `  furn_nav_light: "Navigation light",${lines(en)}`,
            'own models en',
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
 * Players (Klang & Kino): a tap on a media player shows its card with the controls for a few minutes even while it
 * does not play (tapped again: gone; long press: its details as before), and a player or media furniture marked
 * "always show the controls" (`media_card`) keeps its card. A player that is off or ready says so on the card, and
 * one that can be switched gets ⏻.
 */
function mediaMore(name: string, code: string): string {
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            'interface HoloCard {',
            [
                '/** How long a tapped player shows its card while it does not play (ms). */',
                'const FP3D_MEDIA_PIN_MS = 5 * 60 * 1000;',
                '',
                'interface HoloCard {',
            ].join('\n'),
            'media pin: duration',
        );
        code = replaceRequired(
            code,
            '  media?: { id: string; title: string; artist: string; picture: string | null; volume: number; playing: boolean };',
            '  media?: { id: string; title: string; artist: string; picture: string | null; volume: number; playing: boolean; state?: string; pinned?: boolean };',
            'media pin: card type',
        );
        code = replaceRequired(
            code,
            '  private declare _holos: HoloCard[];',
            [
                '  private declare _holos: HoloCard[];',
                '  /** Players tapped to show their card, until when (ms). */',
                '  private fp3dMediaPins = new Map<string, number>();',
                '  /** The players that have a card now. */',
                '  private fp3dMediaCards = new Set<string>();',
            ].join('\n'),
            'media pin: fields',
        );
        code = replaceRequired(
            code,
            '      const seenMedia = new Set<string>();',
            '      const seenMedia = new Set<string>();\n      this.fp3dMediaCards = new Set<string>();',
            'media pin: cards seen',
        );
        code = replaceRequired(
            code,
            '      const add = (floor: Building["floors"][number], id: string, x: number, z: number, top: number, name: string) => {',
            '      const add = (floor: Building["floors"][number], id: string, x: number, z: number, top: number, name: string, always = false) => {',
            'media pin: always',
        );
        code = replaceRequired(
            code,
            / {8}const showing = (!isUnavailable\(st\) && \(st\.state === "playing".*?\));\n/,
            [
                '        // shown while it plays – or always (marked so), or for a while after a tap',
                '        const fp3dPinned = !this.ro && !isUnavailable(st) && (always || (this.fp3dMediaPins.get(id) ?? 0) > Date.now());',
                '        const fp3dByItself = $1;',
                '        const showing = fp3dByItself || fp3dPinned;',
                '',
            ].join('\n'),
            'media pin: showing',
        );
        code = replaceRequired(
            code,
            '        const title = label || translate(hass, "holo_media_playing");',
            '        const title = label || translate(hass, st.state === "playing" ? "holo_media_playing" : st.state === "paused" ? "holo_media_paused" : st.state === "off" || st.state === "standby" ? ("holo_media_off" as I18nKey) : ("holo_media_ready" as I18nKey));',
            'media pin: title',
        );
        code = replaceRequired(
            code,
            /( {10}media: \{ id, title, .*?, playing )\},\n/,
            '$1, state: st.state, pinned: fp3dPinned },\n',
            'media pin: state',
        );
        code = replaceRequired(
            code,
            '        anchors.push(anchor);\n        cards.push(card);\n',
            '        anchors.push(anchor);\n        cards.push(card);\n        this.fp3dMediaCards.add(id);\n',
            'media pin: card shown',
        );
        code = replaceRequired(
            code,
            '          if (e) add(floor, e, f.x, f.z, mountBase(floor, f) + f.h, f.name || furnitureName(hass, f.type));',
            '          if (e) add(floor, e, f.x, f.z, mountBase(floor, f) + f.h, f.name || furnitureName(hass, f.type), !!(f as { media_card?: boolean }).media_card);',
            'media pin: furniture always',
        );
        code = replaceRequired(
            code,
            '      for (const floor of b.floors) for (const pl of floor.placements) add(floor, pl.entity_id, pl.x, pl.z, pl.y ?? 1.1, pl.name || entityName(hass, pl.entity_id));',
            '      for (const floor of b.floors) for (const pl of floor.placements) add(floor, pl.entity_id, pl.x, pl.z, pl.y ?? 1.1, pl.name || entityName(hass, pl.entity_id), !!(pl as { media_card?: boolean }).media_card);',
            'media pin: placement always',
        );
        // a card shown only by a tap or the mark does not linger after it (the grace is for a player between two songs)
        code = replaceRequired(
            code,
            '        if (!this.ro) this.mediaGrace.set(id, { until: Date.now() + 45000, card, source: sound[sound.length - 1], anchor });',
            '        if (!this.ro && fp3dByItself) this.mediaGrace.set(id, { until: Date.now() + 45000, card, source: sound[sound.length - 1], anchor });',
            'media pin: no grace',
        );
        // the card: what an idle player is doing, and ⏻ for one that can be switched
        code = replaceRequired(
            code,
            '${playing ? `● ${t("holo_media_playing")}` : t("holo_media_paused")}',
            '${playing ? `● ${t("holo_media_playing")}` : m.state === "off" || m.state === "standby" ? t("holo_media_off" as I18nKey) : m.state && m.state !== "paused" ? t("holo_media_ready" as I18nKey) : t("holo_media_paused")}',
            'media pin: state text',
        );
        code = replaceRequired(
            code,
            '          ? html`<div class="fp3d-holo-media-controls">\n',
            [
                '          ? html`<div class="fp3d-holo-media-controls">',
                '                ${typeof features === "number" && (features & 384) !== 0',
                '                  ? html`<button aria-label=${t("holo_media_power" as I18nKey)} class=${m.state === "off" || m.state === "standby" ? "" : "fp3d-holo-on"} @pointerdown=${press.down} @pointerup=${press.up(() => call(m.state === "off" || m.state === "standby" ? "turn_on" : "turn_off"))} @click=${press.key(() => call(m.state === "off" || m.state === "standby" ? "turn_on" : "turn_off"))}>⏻</button>`',
                '                  : nothing}',
                '',
            ].join('\n'),
            'media pin: power',
        );
        // a tap on a player without a card shows it (again: hides it); with its card: the details as before
        code = replaceRequired(
            code,
            '    // a detection pin opens its sensor\n    if (entityId.startsWith("detect:")) {\n      openMoreInfo(this, entityId.slice(7));\n      return;\n    }\n',
            [
                '    // a detection pin opens its sensor',
                '    if (entityId.startsWith("detect:")) {',
                '      openMoreInfo(this, entityId.slice(7));',
                '      return;',
                '    }',
                '    if (hasFeature("sound") && kindOf(entityId) === "media" && this.hass?.states[entityId]) {',
                '      if ((this.fp3dMediaPins.get(entityId) ?? 0) > Date.now()) {',
                '        this.fp3dMediaPins.delete(entityId);',
                '        this.mediaGrace.delete(entityId);',
                '        this.syncDevices(true);',
                '        return;',
                '      }',
                '      // no card, or (the cards only on hover) only its dot: show the card',
                '      const fp3dAt = this._holos.findIndex((c) => c.kind === "media" && c.media?.id === entityId);',
                '      if (!this.fp3dMediaCards.has(entityId) || (fp3dAt >= 0 && this.fp3dPeeking(fp3dAt))) {',
                '        this.fp3dMediaPins.set(entityId, Date.now() + FP3D_MEDIA_PIN_MS);',
                '        if (!this.holoVisible()) this.toggleHolos();',
                '        setTimeout(() => this.syncDevices(true), FP3D_MEDIA_PIN_MS + 300);',
                '        this.syncDevices(true);',
                '        return;',
                '      }',
                '    }',
                '',
            ].join('\n'),
            'media pin: tap',
        );
    }
    if (name === 'components/editor.ts') {
        const check = (scope: string, update: string): string =>
            [
                `\${/^media_player\\./.test(${scope}) && hasFeature("sound")`,
                '          ? html`<label class="fp3d-check fp3d-wide" title=${this.t("media_card_hint" as I18nKey)}',
                `              ><input type="checkbox" .checked=\${!!(${update.split('|')[0]} as { media_card?: boolean }).media_card} ?disabled=\${!this.isAdmin} @change=\${(ev: Event) => this.${update.split('|')[1]}({ media_card: (ev.target as HTMLInputElement).checked || undefined } as never)} />`,
                '              ${this.t("media_card" as I18nKey)}</label',
                '            >`',
                '          : nothing}',
            ].join('\n');
        code = replaceRequired(
            code,
            '        ${hasFeature("energy_pro") && !lamp && !["grid_point", "meter", "inverter", "home_battery"].includes(f.type)',
            `        ${check('f.entity ?? ""', 'f|updateFurniture')}\n        \${hasFeature("energy_pro") && !lamp && !["grid_point", "meter", "inverter", "home_battery"].includes(f.type)`,
            'media card: furniture form',
        );
        code = replaceRequired(
            code,
            '        ${hasFeature("energy_pro") && powerSensorFor(this.hass!, pl.entity_id)',
            `        ${check('pl.entity_id', 'pl|updateDevice')}\n        \${hasFeature("energy_pro") && powerSensorFor(this.hass!, pl.entity_id)`,
            'media card: placement form',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  holo_media_paused: "Pause",',
            [
                '  holo_media_paused: "Pause",',
                '  holo_media_off: "aus",',
                '  holo_media_ready: "bereit",',
                '  holo_media_power: "Ein/Aus",',
                '  media_card: "Steuerung immer zeigen",',
                '  media_card_hint: "Die Glaskarte mit den Knöpfen (Wiedergabe, Lautstärke, Ein/Aus) steht immer über dem Player, nicht nur solange er spielt. Ohne Haken zeigt ein Tipp auf den Player sie für 5 Minuten.",',
            ].join('\n'),
            'media card de',
        );
        code = replaceRequired(
            code,
            '  holo_media_paused: "paused",',
            [
                '  holo_media_paused: "paused",',
                '  holo_media_off: "off",',
                '  holo_media_ready: "ready",',
                '  holo_media_power: "On/off",',
                '  media_card: "Always show the controls",',
                '  media_card_hint: "The glass card with the buttons (playback, volume, on/off) always stands over the player, not only while it plays. Without the tick a tap on the player shows it for 5 minutes.",',
            ].join('\n'),
            'media card en',
        );
    }
    return code;
}

/**
 * How the glass cards over the devices show (frontend/vendor-ext/card-peek.ts): always, only while pointed at, or not
 * at all, chosen in the menu "Anzeige" (per browser). In the mode "hover" each card leaves its dot on the device: the
 * mouse on the dot or on the card shows it, a tap or click on the dot keeps it until the next one.
 */
function cardModes(name: string, code: string): string {
    if (name === 'components/view3d.ts') {
        code = `import { CardPeek as Fp3dCardPeek, dotRadius as fp3dDotRadius, holoKey as fp3dHoloKey, holoModeOf as fp3dHoloModeOf, holoModeValue as fp3dHoloModeValue, type HoloMode as Fp3dHoloMode } from "${root}/frontend/vendor-ext/card-peek.ts";\n${code}`;
        code = replaceRequired(
            code,
            '      this._holoShow = localStorage.getItem("home3d.holos") !== "0";\n',
            [
                '      const fp3dHolos = fp3dHoloModeOf(localStorage.getItem("home3d.holos"));',
                '      this._holoShow = fp3dHolos !== "off";',
                '      this.fp3dHoloHover = fp3dHolos !== "always";',
                '',
            ].join('\n'),
            'card modes: stored',
        );
        code = replaceRequired(
            code,
            '      localStorage.setItem("home3d.holos", this._holoShow ? "1" : "0");\n',
            '      localStorage.setItem("home3d.holos", fp3dHoloModeValue(this.fp3dHoloMode()));\n',
            'card modes: toggle keeps the mode',
        );
        code = replaceRequired(
            code,
            '  private holoVisible(): boolean {\n',
            [
                '  /** The cards only while pointed at (else always, while they show at all). */',
                '  private fp3dHoloHover = true;',
                '  private fp3dPeek = new Fp3dCardPeek(() => this.viewer?.fp3dPlaceCards());',
                '  private fp3dPeekEvents = false;',
                '',
                '  fp3dHoloMode(): Fp3dHoloMode {',
                '    return !this._holoShow ? "off" : this.fp3dHoloHover ? "hover" : "always";',
                '  }',
                '',
                '  /** How many glass cards there are (the menu offers their modes only then). */',
                '  fp3dHoloCount(): number {',
                '    return this._holos.filter((c) => c.kind !== "bin").length;',
                '  }',
                '',
                '  fp3dSetHoloMode(mode: Fp3dHoloMode): void {',
                '    this._holoShow = mode !== "off";',
                '    if (mode !== "off") this.fp3dHoloHover = mode === "hover";',
                '    this.fp3dPeek.clear();',
                '    try {',
                '      localStorage.setItem("home3d.holos", fp3dHoloModeValue(mode));',
                '    } catch {',
                '      // private mode: the choice lasts for this page only',
                '    }',
                '    this.viewer?.fp3dPlaceCards();',
                '  }',
                '',
                '  /** In the mode "hover": whether card `index` shows only its dot now. */',
                '  private fp3dPeeking(index: number): boolean {',
                '    if (this.holograms !== null || !this.fp3dHoloHover) return false;',
                '    const card = this._holos[index];',
                '    if (!card || card.kind === "bin") return false;',
                '    if (this.fp3dPeek.shows(fp3dHoloKey(card))) return false;',
                '    // a player tapped to show its card, or marked "always show the controls", shows it',
                '    return !(card.kind === "media" && card.media?.pinned);',
                '  }',
                '',
                "  /** The pointer on a card's dot or on the card, a tap on the dot (once, for the whole view). */",
                '  private fp3dPeekListen(): void {',
                '    if (this.fp3dPeekEvents) return;',
                '    this.fp3dPeekEvents = true;',
                '    const keyOf = (e: Event, dotOnly = false): string | null => {',
                '      const el = (e.target as Element | null)?.closest?.("[data-holo]");',
                '      if (!el || !(el.classList.contains("fp3d-holo-hover") || (!dotOnly && el.classList.contains("fp3d-holo")))) return null;',
                '      const card = this._holos[Number(el.getAttribute("data-holo"))];',
                '      return card && card.kind !== "bin" ? fp3dHoloKey(card) : null;',
                '    };',
                '    this.renderRoot.addEventListener("pointerover", (e) => {',
                '      const key = keyOf(e);',
                '      if (key) this.fp3dPeek.enter(key);',
                '    });',
                '    this.renderRoot.addEventListener("pointerout", (e) => {',
                '      const key = keyOf(e);',
                '      // from the dot onto its card or within the card: still the same card',
                '      const to = (e as PointerEvent).relatedTarget as Element | null;',
                '      if (key && (!to || keyOf({ target: to } as unknown as Event) !== key)) this.fp3dPeek.leave(key);',
                '    });',
                '    this.renderRoot.addEventListener("click", (e) => {',
                '      const key = keyOf(e, true);',
                '      if (!key) return;',
                '      e.stopPropagation();',
                '      this.fp3dPeek.tap(key);',
                '    });',
                '  }',
                '',
                '  private holoVisible(): boolean {',
                '',
            ].join('\n'),
            'card modes: methods',
        );
        code = replaceRequired(
            code,
            '      this.viewer.setAnchorCallback((i, x, y, on, scale, facing) => this.placeHolo(i, x, y, on, scale, facing));\n',
            '      this.viewer.setAnchorCallback((i, x, y, on, scale, facing) => this.placeHolo(i, x, y, on, scale, facing));\n      this.fp3dPeekListen();\n',
            'card modes: listen',
        );
        // a device's card hangs from a point on the device, not 25 cm above it: its dot sits on it instead of floating
        code = replaceRequired(
            code,
            '          p = [f.x, floor.elevation + mountBase(floor, f) + f.h + 0.25, f.z];\n',
            '          p = [f.x, floor.elevation + mountBase(floor, f) + f.h + 0.04, f.z];\n',
            'card modes: the dot on the device',
        );
        code = replaceRequired(
            code,
            '    if (main && on !== this._holoOn) this._holoOn = on;\n',
            [
                '    // the mode "hover": only the card\'s dot, until pointed at',
                '    const fp3dDot = on && this.fp3dPeeking(index);',
                '    if (main && (on && !fp3dDot) !== this._holoOn) this._holoOn = on && !fp3dDot;',
                '',
            ].join('\n'),
            'card modes: the energy bar while only the dot shows',
        );
        code = replaceRequired(
            code,
            '    const hidden = !on;\n    if (el.hidden !== hidden) el.hidden = hidden;\n',
            [
                '    if (link) {',
                '      const fp3dHover = on && this.holograms === null && this.fp3dHoloHover && card?.kind !== "bin";',
                '      link.classList.toggle("fp3d-holo-hover", fp3dHover);',
                '      link.classList.toggle("fp3d-holo-peek", fp3dDot && on);',
                '      // the same dot whether its card shows or not: a smaller one would slip from under the pointer, the card',
                '      // would close and open again every second',
                '      (link.lastElementChild as SVGCircleElement | null)?.setAttribute("r", fp3dHover ? String(fp3dDotRadius(scale)) : "3");',
                '    }',
                '    if (fp3dDot && on) {',
                '      if (!el.hidden) el.hidden = true;',
                '      if (link) {',
                '        if (link.hasAttribute("hidden")) link.toggleAttribute("hidden", false);',
                '        const dot = link.lastElementChild as SVGCircleElement | null;',
                '        dot?.setAttribute("cx", x.toFixed(1));',
                '        dot?.setAttribute("cy", y.toFixed(1));',
                '      }',
                '      return;',
                '    }',
                '    const hidden = !on;',
                '    if (el.hidden !== hidden) el.hidden = hidden;',
                '',
            ].join('\n'),
            'card modes: only the dot',
        );
        code = replaceRequired(
            code,
            '      .fp3d-holo-min {\n        width: 150px;\n      }\n',
            [
                '      /* the mode "hover": a card\'s dot answers the pointer; it is as small as its distance makes it, with a',
                '         glow, and an invisible ring around it catches the pointer (also while its card shows) */',
                '      .fp3d-holo-hover circle {',
                '        pointer-events: all;',
                '        cursor: pointer;',
                '        stroke: transparent;',
                '        stroke-width: 14;',
                '      }',
                '      .fp3d-holo-peek line {',
                '        display: none;',
                '      }',
                '      .fp3d-holo-min {',
                '        width: 150px;',
                '      }',
                '',
            ].join('\n'),
            'card modes: the dot',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = replaceRequired(
            code,
            '  setAnchorCallback(cb: ((index: number, x: number, y: number, visible: boolean, scale: number, facing: boolean) => void) | null): void {\n',
            [
                '  /** The cards are placed again now (one shows or leaves only its dot), not only when the view moves. */',
                '  fp3dPlaceCards(): void {',
                '    this.labelsDirty = true;',
                '    this.invalidate();',
                '  }',
                '',
                '  setAnchorCallback(cb: ((index: number, x: number, y: number, visible: boolean, scale: number, facing: boolean) => void) | null): void {',
                '',
            ].join('\n'),
            'card modes: place the cards again',
        );
    }
    if (name === 'panel.ts') {
        code = replaceRequired(
            code,
            '            <button aria-pressed=${this._plain} @click=${() => this.setPlain(true)}>${this.t("plain_on")}</button>\n          </div>\n',
            [
                '            <button aria-pressed=${this._plain} @click=${() => this.setPlain(true)}>${this.t("plain_on")}</button>',
                '          </div>',
                '          ${(this.view3d() as unknown as { fp3dHoloCount?(): number } | null)?.fp3dHoloCount?.()',
                '            ? html`<div class="fp3d-seg" role="group" aria-label=${this.t("holo_mode" as I18nKey)} title=${this.t("holo_mode_hint" as I18nKey)}>',
                '                ${(["always", "hover", "off"] as const).map(',
                '                  (m) =>',
                '                    html`<button',
                '                      aria-pressed=${(this.view3d() as unknown as { fp3dHoloMode?(): string } | null)?.fp3dHoloMode?.() === m}',
                '                      @click=${() => {',
                '                        (this.view3d() as unknown as { fp3dSetHoloMode?(mode: string): void } | null)?.fp3dSetHoloMode?.(m);',
                '                        this.requestUpdate();',
                '                      }}',
                '                    >',
                '                      ${this.t(`holo_mode_${m}` as I18nKey)}',
                '                    </button>`,',
                '                )}',
                '              </div>`',
                '            : nothing}',
                '',
            ].join('\n'),
            'card modes: menu',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  holos_hint: "Hologramme der Anlage und der Geräte ein- oder ausblenden",\n',
            [
                '  holos_hint: "Hologramme der Anlage und der Geräte ein- oder ausblenden",',
                '  holo_mode: "Glaskarten",',
                '  holo_mode_always: "Karten immer",',
                '  holo_mode_hover: "Karten beim Zeigen",',
                '  holo_mode_off: "Ohne Karten",',
                '  holo_mode_hint: "Glaskarten der Geräte: immer sichtbar, nur solange die Maus auf ihrem Punkt oder der Karte steht (ein Klick oder Tipp auf den Punkt hält sie offen), oder gar nicht",',
                '',
            ].join('\n'),
            'card modes: de',
        );
        code = replaceRequired(
            code,
            '  holos_hint: "Show or hide the holograms of the plant and the devices",\n',
            [
                '  holos_hint: "Show or hide the holograms of the plant and the devices",',
                '  holo_mode: "Glass cards",',
                '  holo_mode_always: "Cards always",',
                '  holo_mode_hover: "Cards on hover",',
                '  holo_mode_off: "No cards",',
                '  holo_mode_hint: "Glass cards of the devices: always shown, only while the mouse is on their dot or the card (a click or tap on the dot keeps one open), or not at all",',
                '',
            ].join('\n'),
            'card modes: en',
        );
    }
    return code;
}

/**
 * The round buttons on the glass cards (player, devices) stay round: a full row (three buttons, the volume and its
 * "15 %", or more buttons) squeezed them into ovals and broke the volume's text; now the slider gives way and what does
 * not fit goes to the next line.
 */
function roundCardButtons(name: string, code: string): string {
    if (name !== 'components/view3d.ts') {
        return code;
    }
    code = replaceRequired(
        code,
        '      .fp3d-holo-media-controls {\n        display: flex;\n        align-items: center;\n        gap: 6px;\n',
        '      .fp3d-holo-media-controls {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 6px;\n',
        'round buttons: a full row wraps',
    );
    code = replaceRequired(
        code,
        '      .fp3d-holo-media-controls button {\n        width: 28px;\n        height: 28px;\n',
        [
            '      .fp3d-holo-media-controls button {',
            '        flex: none;',
            '        display: inline-grid;',
            '        place-items: center;',
            '        padding: 0;',
            '        line-height: 1;',
            '        width: 28px;',
            '        height: 28px;',
            '',
        ].join('\n'),
        'round buttons: never squeezed',
    );
    code = replaceRequired(
        code,
        '      .fp3d-holo-media-controls input[type="range"] {\n        width: 70px;\n',
        '      .fp3d-holo-media-controls input[type="range"] {\n        flex: 1 1 48px;\n        min-width: 48px;\n        max-width: 90px;\n        width: auto;\n        margin: 0;\n',
        'round buttons: the slider gives way',
    );
    code = replaceRequired(
        code,
        '      .fp3d-holo-vol {\n        font-size: 11px;\n',
        '      .fp3d-holo-vol {\n        flex: none;\n        white-space: nowrap;\n        font-size: 11px;\n',
        'round buttons: the volume on one line',
    );
    return code;
}

/** A dialog's head (its title and ✕) that stays at the top while the rest scrolls; `pad`: the dialog's padding. */
const stickyHead = (selector: string, pad: [number, number]): string =>
    [
        `      ${selector} {`,
        '        position: sticky;',
        `        top: -${pad[0]}px;`,
        '        z-index: 3;',
        `        margin: -${pad[0]}px -${pad[1]}px 0;`,
        `        padding: ${pad[0]}px ${pad[1]}px 8px;`,
        '        background: var(--fp3d-chrome-solid);',
        '        border-top-left-radius: inherit;',
        '        border-top-right-radius: inherit;',
        '      }',
        '',
    ].join('\n');

/**
 * Dialogs scroll only their content: the title and ✕ stay at the top. The editor's settings dialogs get a scrolling
 * body; the sheets of the 3D view (device sheets, pop-ups, view settings), the central and the editor's part card,
 * which scroll as a whole, keep their head sticky.
 */
function fixedDialogHeads(name: string, code: string): string {
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '        max-height: calc(100% - 16px);\n        overflow: auto;\n        padding: 14px 18px 18px;',
            '        max-height: calc(100% - 16px);\n        overflow: hidden;\n        display: flex;\n        flex-direction: column;\n        padding: 14px 8px 18px 18px;',
            'dialog: head and body',
        );
        code = replaceRequired(
            code,
            '      .fp3d-dialog-head h3 {\n        margin: 0;\n      }\n',
            [
                '      .fp3d-dialog-head h3 {',
                '        margin: 0;',
                '      }',
                '      .fp3d-dialog-head {',
                '        flex: none;',
                '        padding-right: 10px;',
                '      }',
                '      /* only the content scrolls: the title and ✕ stay at the top */',
                '      .fp3d-dialog-body {',
                '        flex: 1 1 auto;',
                '        min-height: 0;',
                '        overflow-y: auto;',
                '        margin-left: -4px;',
                '        padding: 2px 10px 4px 4px;',
                '      }',
                '',
            ].join('\n'),
            'dialog: scrolling body',
        );
        code = replaceRequired(
            code,
            '      .fp3d-pc-title {\n',
            `${stickyHead('.fp3d-pc > .fp3d-wv-head', [14, 16])}      .fp3d-pc-title {\n`,
            'part card: sticky head',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '      .fp3d-sheet header {\n',
            `${stickyHead('.fp3d-sheet > header', [14, 16])}      .fp3d-sheet header {\n`,
            'sheets: sticky head',
        );
        code = replaceRequired(
            code,
            '      .fp3d-central-top {\n',
            `${stickyHead('.fp3d-central > .fp3d-central-top', [12, 14])}      .fp3d-central-top {\n`,
            'central: sticky head',
        );
    }
    return code;
}

/**
 * Voice control through the adapter Assistant (frontend/assistant.ts answers the voice requests): the settings lose
 * what only the upstream platform has (the sentence file it reads, the screen name for its service), the pipeline is
 * an instance of assistant, and the texts say so.
 */
function assistantVoice(name: string, code: string): string {
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            / {6}<label class="fp3d-field fp3d-wide"\n {8}>\$\{this\.t\("voice_sentences"\)\}[\s\S]*?\$\{this\.t\("voice_sentences_file"\)\}<\/p>\n/,
            '',
            'voice sentences',
        );
        code = replaceRequired(
            code,
            / {8}<label class="fp3d-wide"\n {10}>\$\{this\.t\("screen_name"\)\}[\s\S]*?<\/label>\n {6}<\/div>\n {6}<p class="fp3d-sub">\$\{this\.t\("screen_name_hint"\)\}<\/p>\n/,
            '      </div>\n',
            'screen name',
        );
    }
    if (name === 'voice/mic-probe.ts') {
        code = replaceRequired(code, '    pipe_ok: "Assist-Pipeline",', '    pipe_ok: "Assistant",', 'mic test de');
        code = replaceRequired(code, '    pipe_ok: "Assist pipeline",', '    pipe_ok: "Assistant",', 'mic test en');
        code = replaceRequired(
            code,
            / {4}pipe_no: "Keine Assist-Pipeline[^\n]*",/,
            `    pipe_no: ${JSON.stringify('Kein Adapter Assistant gefunden. Installiere ihn, schalte ihn ein und richte in seinen Einstellungen eine Spracherkennung ein.')},`,
            'mic test de',
        );
        code = replaceRequired(
            code,
            / {4}pipe_no: "No Assist pipeline[^\n]*",/,
            `    pipe_no: ${JSON.stringify('No adapter Assistant found. Install it, switch it on and set up speech to text in its settings.')},`,
            'mic test en',
        );
    }
    if (name === 'i18n.ts') {
        const texts: Record<string, [string, string]> = {
            voice_hint: [
                'Ein Mikrofon-Knopf unten links in der 3D-Ansicht: antippen und sprechen. „Zeig das Wohnzimmer“, „Obergeschoss“ oder „das ganze Haus“ zeigt den Ort; alles andere („Licht im Flur an“) geht an den Assistant von ioBroker.',
                "A microphone button at the bottom left of the 3D view: tap it and speak. “Show the living room”, “upper floor” or “the whole house” shows the place; anything else (“turn on the hall light”) goes to ioBroker's Assistant.",
            ],
            voice_examples: [
                '„Zeig das Wohnzimmer“|„Geh ins Obergeschoss“|„Zeig das ganze Haus“|„Zeig die Waschmaschine“ / „Wo ist der Trockner?“|„Zeig die Kamera Haustür“ / „Zeig die Auffahrtkamera“|„Zeig die Kameras“|Alles andere („Licht im Flur an“) geht an den Assistant',
                '“Show the living room”|“Go to the upper floor”|“Show the whole house”|“Show the washing machine” / “Where is the dryer?”|“Show the front door camera” / “Show the driveway camera”|“Show the cameras”|Anything else (“turn on the hall light”) goes to the Assistant',
            ],
            voice_needs: [
                'Braucht https, die Freigabe des Mikrofons (in Fully Kiosk: Web Content Settings → Mikrofonzugriff) und den Adapter Assistant mit einer Spracherkennung, eingerichtet in seinen Einstellungen.',
                'Needs https, the microphone allowed (in Fully Kiosk: Web Content Settings → microphone access) and the adapter Assistant with speech to text, set up in its settings.',
            ],
            voice_no_pipeline: [
                'Kein Assistant gefunden: Installiere den Adapter Assistant, schalte ihn ein und richte dort eine Spracherkennung ein.',
                'No Assistant found: install the adapter Assistant, switch it on and set up its speech to text.',
            ],
            card_voice_hint: [
                '„Zeig das Wohnzimmer“ zeigt den Raum, andere Sätze gehen an den Assistant von ioBroker. Braucht https und ein freigegebenes Mikrofon',
                "“Show the living room” shows the room, other sentences go to ioBroker's Assistant. Needs https and an allowed microphone",
            ],
            director_mic_hint: [
                'Prüft auf diesem Gerät https, Mikrofon und die Spracherkennung des Assistant und zeigt, welchen Raum ein Satz öffnen würde. Es wird nichts geschaltet.',
                "Checks https, the microphone and the Assistant's speech to text on this device and shows which room a sentence would open. Nothing is switched.",
            ],
            voice_pipeline: ['Assistant auf diesem Gerät', 'Assistant on this device'],
            voice_pipeline_preferred: ['Der erste eingeschaltete', 'The first one switched on'],
            voice_room_hint: [
                'Hängt das Tablet in einem Raum, reichen Sätze ohne Raumnamen: „Licht an“, „Mach hier das Licht aus“ oder „Rollladen runter“ gelten dann für diesen Raum. Nennst du einen Raum, gilt der genannte. Zur Auswahl stehen die Räume des Plans, die mit einem ioBroker-Raum verknüpft sind.',
                'When the tablet hangs in a room, sentences without a room name are enough: "Lights on", "Turn off the lights here" or "Close the blinds" then apply to this room. When you name a room, that room counts. You can choose the plan\'s rooms that are linked to an ioBroker room.',
            ],
        };
        for (const [key, [de, en]] of Object.entries(texts)) {
            code = setTexts(code, key, de, en);
        }
    }
    return code;
}

/**
 * A speaker beside the volume of a media player (frontend/vendor-ext/media-mute.ts): in the glass card, the quick menu
 * and the room's panel. A click mutes it by its own mute, or sets its volume to 0 and back; while silent the speaker is
 * crossed out and orange and the slider dims.
 */
function mediaMute(name: string, code: string): string {
    const imports = `import { canMute as fp3dCanMute, isMuted as fp3dIsMuted, muteCall as fp3dMuteCall, speakerPath as fp3dSpeakerPath } from "${root}/frontend/vendor-ext/media-mute.ts";\n`;
    const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${fp3dSpeakerPath(MUTED)} /></svg>';
    if (name === 'components/view3d.ts') {
        code = imports + code;
        code = replaceRequired(
            code,
            '        call("volume_set", { volume_level: v / 100 });\n      }\n    };\n',
            [
                '        call("volume_set", { volume_level: v / 100 });',
                '      }',
                '    };',
                '    const fp3dPlayer = hass.states[m.id];',
                '    const fp3dMuted = !!fp3dPlayer && fp3dCanMute(fp3dPlayer) && fp3dIsMuted(fp3dPlayer);',
                '    const fp3dMute = () => {',
                '      const c = fp3dPlayer && fp3dMuteCall(fp3dPlayer);',
                '      if (!c) return;',
                '      this.requestUpdate();',
                '      if (c.service === "volume_set") setVolume(Math.round((c.data.volume_level as number) * 100), true);',
                '      else call(c.service, c.data);',
                '    };',
                '',
            ].join('\n'),
            'mute: the card',
        );
        code = replaceRequired(
            code,
            '                <input\n                  type="range"\n                  min="0"\n                  max="100"\n                  .value=${String(volume)}\n',
            [
                '                ${fp3dPlayer && fp3dCanMute(fp3dPlayer)',
                `                  ? html\`<button class="fp3d-mute \${fp3dMuted ? "fp3d-mute-on" : ""}" aria-label=\${t(fp3dMuted ? "media_unmute" : "media_mute")} title=\${t(fp3dMuted ? "media_unmute" : "media_mute")} @pointerdown=\${press.down} @pointerup=\${press.up(fp3dMute)} @click=\${press.key(fp3dMute)}>${icon.replace('MUTED', 'fp3dMuted')}</button>\``,
                '                  : nothing}',
                '                <input',
                '                  type="range"',
                '                  min="0"',
                '                  max="100"',
                '                  .value=${String(volume)}',
                '',
            ].join('\n'),
            'mute: the card button',
        );
        code = replaceRequired(
            code,
            '      .fp3d-holo-media-controls input[type="range"] {\n',
            [
                '      .fp3d-holo-media-controls .fp3d-mute {',
                '        display: inline-flex;',
                '        align-items: center;',
                '        justify-content: center;',
                '        flex: none;',
                '        padding: 0;',
                '      }',
                '      .fp3d-mute svg {',
                '        width: 15px;',
                '        height: 15px;',
                '        fill: currentColor;',
                '      }',
                '      .fp3d-holo-media-controls .fp3d-mute-on {',
                '        color: #ff9f1c;',
                '        border-color: #ff9f1c;',
                '      }',
                '      .fp3d-mute-on + input[type="range"] {',
                '        opacity: 0.4;',
                '      }',
                '      .fp3d-holo-media-controls input[type="range"] {',
                '',
            ].join('\n'),
            'mute: the card style',
        );
    }
    if (name === 'components/quick-menu.ts') {
        code = imports + code;
        code = replaceRequired(
            code,
            // the volume's slider (the quick menu has other sliders before it)
            '      ${vol !== null\n        ? html`<input\n            class="qm-slider"\n',
            [
                '      ${vol !== null',
                '        ? html`<div class="qm-volume">${fp3dCanMute(st)',
                `            ? html\`<button class="qm-mute \${fp3dIsMuted(st) ? "qm-mute-on" : ""}" aria-label=\${this.t(fp3dIsMuted(st) ? "media_unmute" : "media_mute")} title=\${this.t(fp3dIsMuted(st) ? "media_unmute" : "media_mute")} @click=\${() => { const c = fp3dMuteCall(st); if (c) { this.call("media_player", c.service, c.data); this.requestUpdate(); } }}>${icon.replace('MUTED', 'fp3dIsMuted(st)')}</button>\``,
                '            : nothing}<input',
                '            class="qm-slider"',
                '',
            ].join('\n'),
            'mute: quick menu button',
        );
        code = replaceRequired(
            code,
            '            @change=${(e: Event) => this.call("media_player", "volume_set", { volume_level: Number((e.target as HTMLInputElement).value) / 100 })}\n          />`',
            '            @change=${(e: Event) => this.call("media_player", "volume_set", { volume_level: Number((e.target as HTMLInputElement).value) / 100 })}\n          /></div>`',
            'mute: quick menu row',
        );
        code = replaceRequired(
            code,
            '      .qm-slider {\n',
            [
                '      .qm-volume {',
                '        display: flex;',
                '        align-items: center;',
                '        gap: 8px;',
                '      }',
                '      .qm-volume .qm-slider {',
                '        flex: 1;',
                '        min-width: 0;',
                '      }',
                '      .qm-mute {',
                '        flex: none;',
                '        display: inline-flex;',
                '        align-items: center;',
                '        justify-content: center;',
                '        width: 32px;',
                '        height: 32px;',
                '        padding: 0;',
                '        border-radius: 50%;',
                '        border: 1px solid rgba(127, 127, 127, 0.4);',
                '        background: transparent;',
                '        color: inherit;',
                '        cursor: pointer;',
                '      }',
                '      .qm-mute svg {',
                '        width: 18px;',
                '        height: 18px;',
                '        fill: currentColor;',
                '      }',
                '      .qm-mute-on {',
                '        color: #ff9f1c;',
                '        border-color: #ff9f1c;',
                '      }',
                '      .qm-mute-on + .qm-slider {',
                '        opacity: 0.4;',
                '      }',
                '      .qm-slider {',
                '',
            ].join('\n'),
            'mute: quick menu style',
        );
    }
    if (name === 'components/room-panel.ts') {
        code = imports + code;
        // a <div> instead of the <label>: a button inside would take the label's clicks
        code = replaceRequired(
            code,
            [
                '        ? html`<label class="fp3d-rp-slider"',
                '            ><span>${this.t("volume")}</span>',
                '            <input',
                '              type="range"',
                '              min="0"',
                '              max="100"',
                '              .value=${String(Math.round(a.volume_level * 100))}',
                '              @change=${(e: Event) => this.call("media_player", "volume_set", { entity_id: id, volume_level: Number((e.target as HTMLInputElement).value) / 100 })}',
                '          /></label>`',
            ].join('\n'),
            [
                '        ? html`<div class="fp3d-rp-slider"',
                '            ><span class="fp3d-rp-vol">${fp3dCanMute(st)',
                `              ? html\`<button class="fp3d-btn fp3d-rp-small fp3d-mute \${fp3dIsMuted(st) ? "fp3d-mute-on" : ""}" aria-label=\${this.t(fp3dIsMuted(st) ? "media_unmute" : "media_mute")} title=\${this.t(fp3dIsMuted(st) ? "media_unmute" : "media_mute")} ?disabled=\${na} @click=\${() => { const c = fp3dMuteCall(st); if (c) { this.call("media_player", c.service, { entity_id: id, ...c.data }); this.requestUpdate(); } }}>${icon.replace('MUTED', 'fp3dIsMuted(st)')}</button>\``,
                '              : nothing}${this.t("volume")}</span>',
                '            <input',
                '              type="range"',
                '              min="0"',
                '              max="100"',
                '              aria-label=${this.t("volume")}',
                '              .value=${String(Math.round(a.volume_level * 100))}',
                '              @change=${(e: Event) => this.call("media_player", "volume_set", { entity_id: id, volume_level: Number((e.target as HTMLInputElement).value) / 100 })}',
                '          /></div>`',
            ].join('\n'),
            'mute: room panel',
        );
        code = replaceRequired(
            code,
            '      .fp3d-rp-slider input {\n',
            [
                '      .fp3d-rp-vol {',
                '        display: inline-flex;',
                '        align-items: center;',
                '        gap: 6px;',
                '      }',
                '      .fp3d-rp-vol .fp3d-mute {',
                '        display: inline-flex;',
                '        align-items: center;',
                '        justify-content: center;',
                '        padding: 4px 6px;',
                '      }',
                '      .fp3d-mute svg {',
                '        width: 16px;',
                '        height: 16px;',
                '        fill: currentColor;',
                '      }',
                '      .fp3d-mute-on {',
                '        color: #ff9f1c;',
                '        border-color: #ff9f1c;',
                '      }',
                '      .fp3d-rp-slider:has(.fp3d-mute-on) input {',
                '        opacity: 0.4;',
                '      }',
                '      .fp3d-rp-slider input {',
                '',
            ].join('\n'),
            'mute: room panel style',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  volume: "Lautstärke",',
            '  volume: "Lautstärke",\n  media_mute: "Stumm schalten",\n  media_unmute: "Ton wieder an",',
            'mute de',
        );
        code = replaceRequired(
            code,
            '  volume: "Volume",',
            '  volume: "Volume",\n  media_mute: "Mute",\n  media_unmute: "Unmute",',
            'mute en',
        );
    }
    return code;
}

/**
 * "Zeigen" beside a placed device in the editor's list of a room: the device is chosen, the plan moves it into the
 * middle (zoomed in enough to see it), and rings run out from it for a moment. Without it a device just placed is
 * hard to find among the other symbols.
 */
function findDevice(name: string, code: string): string {
    if (name === 'components/editor.ts') {
        code = replaceEvery(
            code,
            '</small>` : nothing}</span>\n        </button>\n',
            [
                '</small>` : nothing}</span>',
                '        </button>',
                '        ${placed',
                '          ? html`<button class="fp3d-pin fp3d-find" title=${this.t("devices_find")} aria-label=${this.t("devices_find")} @click=${() => this.fp3dFind(id)}>',
                '              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">',
                '                <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" />',
                '              </svg>',
                '            </button>`',
                '          : nothing}',
                '',
            ].join('\n'),
            'find a device: button',
            1,
        );
        code = replaceRequired(
            code,
            '\n  private selectItem(kind: "room" | "opening" | "furniture" | "device" | "outdoor" | "wall", id: string | null): void {',
            [
                '',
                '  /**',
                '   * "Zeigen": the device is chosen (a light placed as a lamp: the lamp), the plan moves it into the middle,',
                '   * and rings run out from it.',
                '   */',
                '  private fp3dFind(id: string): void {',
                '    const pl = this.floor?.placements.find((x) => x.entity_id === id);',
                '    const lamp = pl ? undefined : this.floor?.furniture.find((m) => isLamp(m.type) && m.entity === id);',
                '    const at: Vec2 | null = pl ? [pl.x, pl.z] : lamp ? [lamp.x, lamp.z] : null;',
                '    if (!at) return;',
                '    if (lamp) this.selectItem("furniture", lamp.id);',
                '    else this.selectItem("device", id);',
                '    // near enough that the symbols around it stand apart (a boat or a crowded room: 0.3 m between them)',
                '    const scale = Math.max(this._view.scale, 120);',
                '    const { w, h } = this._size ?? { w: 800, h: 600 };',
                '    this._view = { scale, ox: w / 2 - at[0] * scale, oy: h / 2 - at[1] * scale };',
                '    void this.updateComplete.then(() => {',
                '      const plan = this.renderRoot.querySelector("svg.fp3d-plan");',
                '      if (!plan) return;',
                '      plan.querySelector(".fp3d-find-at")?.remove();',
                '      const [x, y] = this.toScreen(at);',
                '      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");',
                '      g.setAttribute("class", "fp3d-find-at");',
                '      g.setAttribute("transform", `translate(${x} ${y})`);',
                '      const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");',
                '      ring.setAttribute("r", "14");',
                '      ring.setAttribute("class", "fp3d-find-ring");',
                '      g.append(ring);',
                '      plan.append(g);',
                '      setTimeout(() => g.remove(), 3300);',
                '    });',
                '  }',
                '',
                '  private selectItem(kind: "room" | "opening" | "furniture" | "device" | "outdoor" | "wall", id: string | null): void {',
            ].join('\n'),
            'find a device: method',
        );
        code = replaceRequired(
            code,
            '      .fp3d-device-sel circle:not(.fp3d-hit) {',
            [
                '      .fp3d-find-ring {',
                '        fill: none;',
                '        stroke: #ff9f1c;',
                '        stroke-width: 4;',
                '        vector-effect: non-scaling-stroke;',
                '        pointer-events: none;',
                '        transform-box: fill-box;',
                '        transform-origin: center;',
                '        animation: fp3d-find 1.1s ease-out 3;',
                '      }',
                '      @keyframes fp3d-find {',
                '        from {',
                '          transform: scale(1);',
                '          opacity: 1;',
                '        }',
                '        to {',
                '          transform: scale(4);',
                '          opacity: 0;',
                '        }',
                '      }',
                '      .fp3d-device-sel circle:not(.fp3d-hit) {',
            ].join('\n'),
            'find a device: rings',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  devices_place: "Platzieren",',
            '  devices_place: "Platzieren",\n  devices_find: "Im Plan zeigen",',
            'find a device de',
        );
        code = replaceRequired(
            code,
            '  devices_place: "Place",',
            '  devices_place: "Place",\n  devices_find: "Show in the plan",',
            'find a device en',
        );
    }
    return code;
}

/**
 * The device rows of a room in the editor fit the panel: the name gives way (it breaks inside a long word too), the
 * buttons beside it keep their size, so "Platzieren" is never cut off.
 */
function deviceRowsFit(name: string, code: string): string {
    if (name !== 'components/editor.ts') {
        return code;
    }
    return replaceRequired(
        code,
        '      .fp3d-dev-name span {\n        overflow: hidden;\n        text-overflow: ellipsis;\n      }',
        [
            '      .fp3d-dev-name span {',
            '        overflow: hidden;',
            '        text-overflow: ellipsis;',
            '        min-width: 0;',
            '        overflow-wrap: anywhere;',
            '      }',
            '      .fp3d-dev-row {',
            '        flex-wrap: wrap;',
            '        justify-content: flex-end;',
            '        gap: 2px 4px;',
            '      }',
            // a narrow panel: the buttons move below the name, at the right
            '      .fp3d-dev-row > .fp3d-dev-name {',
            '        flex: 1 1 9em;',
            '      }',
            '      .fp3d-dev-row > :not(.fp3d-dev-name) {',
            '        flex: none;',
            '      }',
            '      .fp3d-dev-row > .fp3d-pin {',
            '        padding: 2px 4px;',
            '      }',
        ].join('\n'),
        'device rows fit',
    );
}

/**
 * The 3D view steered from ioBroker (frontend/show.ts): `home3d.0.show` names a place or a device in words, the view
 * flies there as the spoken "Zeig …" would (the same matching: plan names, ioBroker rooms, furniture and device
 * names, synonyms); `home3d.0.places` lists the names it knows, so an agent can pick one.
 */
function showFromIoBroker(name: string, code: string): string {
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '  private async handleSentence(',
            [
                '  /** ioBroker (home3d.0.show): shows the place or device named in words; the name shown, or null when none has it. */',
                '  async fp3dShow(words: string): Promise<string | null> {',
                '    const hass = this.hass;',
                '    const b = this.building;',
                '    if (!hass || !b || !words.trim()) return null;',
                '    const v = await loadVoice();',
                '    const { devices, items } = this.spokenDevices(hass, b, v.SYNONYMS);',
                '    // a device answers only when it is asked to be shown',
                '    const place = v.showTarget(`show ${words}`, b, devices, (r) => (r.area_id ? hass.areas?.[r.area_id]?.name : null));',
                '    if (!place || place.kind === "cameras") return null;',
                '    this.directing.touch(Date.now());',
                '    if (place.kind === "device") {',
                '      const item = items.get(place.id);',
                '      if (!item) return null;',
                '      this.goTo(item);',
                '      return place.name;',
                '    }',
                '    if (place.kind === "house") {',
                '      this.fire("floor-tap", { floorId: null });',
                '      return translate(hass, "all_floors");',
                '    }',
                '    if (place.kind === "floor") {',
                '      this.fire("floor-tap", { floorId: place.floorId });',
                '      return place.name;',
                '    }',
                '    if (this.floorId !== place.floorId) this.fire("floor-tap", { floorId: place.floorId });',
                '    // a tap on the open room would close it',
                '    if (this.roomId !== place.roomId) setTimeout(() => this.fire("room-tap", { floorId: place.floorId, roomId: place.roomId }), 60);',
                '    return place.name;',
                '  }',
                '',
                '  /** ioBroker (home3d.0.places): the floors with their rooms and the named devices (with their room), as JSON. */',
                '  async fp3dPlaces(): Promise<string | null> {',
                '    const hass = this.hass;',
                '    const b = this.building;',
                '    if (!hass || !b) return null;',
                '    const v = await loadVoice();',
                '    const { devices } = this.spokenDevices(hass, b, v.SYNONYMS);',
                '    const floors: Record<string, string[]> = {};',
                '    for (const f of b.floors) floors[f.name] = zonesOf(f).map((r) => r.name).filter((n) => !!n);',
                '    const seen = new Set<string>();',
                '    const named: { name: string; room?: string }[] = [];',
                '    for (const d of devices) {',
                '      const key = `${d.name}|${d.room}`;',
                '      if (!d.name || seen.has(key)) continue;',
                '      seen.add(key);',
                '      named.push(d.room ? { name: d.name, room: d.room } : { name: d.name });',
                '    }',
                '    return JSON.stringify({ floors, devices: named });',
                '  }',
                '',
                '  private async handleSentence(',
            ].join('\n'),
            'show from ioBroker: view',
        );
    }
    if (name === 'panel.ts') {
        code = replaceRequired(
            code,
            '  private view3d() {',
            [
                '  /** ioBroker (home3d.0.show): the 3D view shows a place or device named in words; its name, or null (also in the editor). */',
                '  fp3dShow(words: string): Promise<string | null> {',
                '    const view = this._mode === "view" ? (this.view3d() as unknown as { fp3dShow?(w: string): Promise<string | null> } | null) : null;',
                '    return view?.fp3dShow?.(words) ?? Promise.resolve(null);',
                '  }',
                '',
                '  /** ioBroker (home3d.0.places): the names home3d.0.show knows, as JSON; null without a 3D view. */',
                '  fp3dPlaces(): Promise<string | null> {',
                '    const view = this.view3d() as unknown as { fp3dPlaces?(): Promise<string | null> } | null;',
                '    return view?.fp3dPlaces?.() ?? Promise.resolve(null);',
                '  }',
                '',
                '  private view3d() {',
            ].join('\n'),
            'show from ioBroker: panel',
        );
    }
    return code;
}

/**
 * No locating ("Ortung", "Live Presence"): who is in which room by Bluetooth needs the server that reads the signal
 * strengths of all receivers, learns the rooms and works out the place; ioBroker has none of it. Hidden: the menu
 * entry, the plan choice in ⚙ → Grundrisse, the located people; the voice no longer asks the server.
 */
function noLocate(name: string, code: string): string {
    if (name === 'features.ts') {
        code = replaceRequired(
            code,
            'export function released(feature: Gated): boolean {\n',
            'export function released(feature: Gated): boolean {\n  // locating needs a server ioBroker does not have\n  if (feature === "locate") return false;\n',
            'no locating',
        );
    }
    if (name === 'components/plan-manager.ts') {
        code = `import { released as fp3dReleased } from "../features.ts";\n${code}`;
        code = replaceRequired(
            code,
            '      ${this.plans.length > 1\n        ? html`<h4>${this.t("plan_locate")}</h4>',
            '      ${this.plans.length > 1 && fp3dReleased("locate")\n        ? html`<h4>${this.t("plan_locate")}</h4>',
            'no locating: plan',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '      const located = await hass\n        .callWS<{ text: string; rooms: string[]; admins_only: boolean } | null>({ type: "home3d/locate/ask"',
            '      const located = !released("locate") ? null : await hass\n        .callWS<{ text: string; rooms: string[]; admins_only: boolean } | null>({ type: "home3d/locate/ask"',
            'no locating: voice',
        );
    }
    return code;
}

/**
 * The furniture library's pictures of a boat's anchor and gear: the viewer draws them itself, not as furniture, so
 * their pictures stayed empty; they are built as in the viewer (frontend/vendor-ext/boat-picture.ts). Patched after
 * every other picture of preview.ts. The pictures kept in the browser get a new key: the empty ones are drawn anew.
 */
function boatPictures(name: string, code: string): string {
    if (name === 'viewer/preview.ts') {
        code = `import { boatPicture as fp3dBoatPicture, disposeBoatPicture as fp3dBoatDispose } from "${root}/frontend/vendor-ext/boat-picture.ts";\n${code}`;
        code = replaceRequired(
            code,
            '  const fp3dOwn = fp3dPrevIsTree(item.type)',
            '  const fp3dOwn0 = fp3dPrevIsTree(item.type)',
            'boat pictures',
        );
        code = replaceRequired(
            code,
            '  if (fp3dOwn) scene.add(fp3dOwn);',
            [
                '  const fp3dBoat = fp3dOwn0 ? null : fp3dBoatPicture(item.type, item.w, item.d, item.h, item.variant ?? null);',
                '  const fp3dOwn = fp3dOwn0 ?? fp3dBoat;',
                '  if (fp3dOwn) scene.add(fp3dOwn);',
            ].join('\n'),
            'boat pictures: built',
        );
        code = replaceRequired(
            code,
            '  if (fp3dOwn) fp3dPrevDispose(fp3dOwn);',
            '  if (fp3dBoat) fp3dBoatDispose(fp3dBoat);\n  else if (fp3dOwn) fp3dPrevDispose(fp3dOwn);',
            'boat pictures: freed',
        );
    }
    if (name === 'viewer/preview.ts') {
        // the awning: the viewer draws it with its cover (run out as far as that says), here half way out
        code = replaceRequired(
            code,
            'import { pushFurniture, pushPackLamp } from "./furniture.ts";',
            'import { pushAwning, pushFurniture, pushPackLamp } from "./furniture.ts";',
            'awning picture: import',
        );
        code = replaceRequired(
            code,
            '    pushFurniture(buf, lines, new GeoBuffer(), f, 0, true);\n',
            '    pushFurniture(buf, lines, new GeoBuffer(), f, 0, true);\n    if (item.type === "awning") pushAwning(buf, f, 0, 0.6);\n',
            'awning picture',
        );
    }
    if (name === 'components/library.ts') {
        code = replaceRequired(
            code,
            '|${THUMB_PX}|2`;',
            '|${THUMB_PX}|${/^(anchor|tank|rudder|propeller|nav_light|hatch|awning|robot_mower|sprinkler|wind_vane|parking)$/.test(entry.type) ? 3 : 2}`;',
            'boat pictures: drawn anew',
        );
    }
    return code;
}

/**
 * A gas bottle: the boat's tank holding gas (frontend/vendor-ext/boat-gear.ts draws it with its valve and collar),
 * offered in the library as an item of its own, round in the plan. A library entry with a preset (the oil tank, the
 * gas bottle) gets its own picture: the library keeps the pictures by type otherwise, and the preset's kind is drawn.
 */
/**
 * The parking spots in the time travel: the sensors of the cars (furniture `car_*`, drawn by home-fx.ts) are fetched
 * with the others, so a car stands in its spot as it did then (only the spot's own sensor was fetched); a spot taken
 * or left is an event on the bar ("Parkplatz belegt/frei"), and a tap on it flies to the spot.
 */
function parkingTimeTravel(name: string, code: string): string {
    const homeData = `${root}/frontend/vendor-ext/home-data.ts`;
    if (name === 'timetravel/classify.ts') {
        code = replaceRequired(
            code,
            '| "robot" | "washer" | "weather";',
            '| "robot" | "washer" | "weather" | "car";',
            'time travel: car role',
        );
        return replaceRequired(
            code,
            '  for (const id of appliancePower(hass, building, spec).keys()) set(id, "washer");\n',
            [
                '  for (const id of appliancePower(hass, building, spec).keys()) set(id, "washer");',
                "  // a parking spot's or a car's sensor: the spot taken or free (a car came or left)",
                '  for (const floor of building.floors)',
                '    for (const f of floor.furniture)',
                '      if (["parking", "car_sedan", "car_hatchback", "car_van"].includes(f.type) && typeof f.entity === "string") set(f.entity, "car");',
                '',
            ].join('\n'),
            'time travel: cars have a role',
        );
    }
    if (name === 'timetravel/events.ts') {
        code = `import { carPresent as fp3dCarPresent } from "${homeData}";\n${code}`;
        code = replaceRequired(
            code,
            '  | "pv_peak";',
            '  | "pv_peak"\n  | "car_in"\n  | "car_out";',
            'time travel: car kinds',
        );
        code = replaceRequired(
            code,
            '  pv_peak: 8,\n};',
            '  pv_peak: 8,\n  car_in: 30,\n  car_out: 28,\n};',
            'time travel: car rank',
        );
        code = replaceRequired(
            code,
            '  pv_peak: "energy",\n};',
            '  pv_peak: "energy",\n  car_in: "openings",\n  car_out: "openings",\n};',
            'time travel: car category',
        );
        return replaceRequired(
            code,
            '        case "robot":\n',
            [
                '        case "car": {',
                '          // a parking spot taken or left: present and away (unknown is neither)',
                '          const known = (s: string) => s !== "unknown" && s !== "unavailable";',
                '          const here = (s: string) => fp3dCarPresent({ state: s, attributes: {} });',
                '          if (known(c.from) && known(c.to) && here(c.to) !== here(c.from)) add(c.t, here(c.to) ? "car_in" : "car_out", id);',
                '          break;',
                '        }',
                '        case "robot":',
                '',
            ].join('\n'),
            'time travel: car events',
        );
    }
    if (name === 'components/time-bar.ts') {
        return replaceRequired(
            code,
            '  pv_peak: "#ffe27a",\n};',
            '  pv_peak: "#ffe27a",\n  car_in: "#ff9a5c",\n  car_out: "#ff9a5c",\n};',
            'time travel: car colour',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '    const entities = watchedEntities(hass, b, { openings, furniture, heat: true, warnings, weatherEntityId: this.weatherEntityId });',
            [
                "    // the home's own looks too: a car's sensor puts it into its spot (or not) as it was then",
                '    const entities = [...new Set([...watchedEntities(hass, b, { openings, furniture, heat: true, warnings, weatherEntityId: this.weatherEntityId }), ...fp3dHomeWatched(hass, b, (a) => areaEntities(hass, a), false)])];',
            ].join('\n'),
            'time travel: the home looks are fetched',
        );
        return replaceRequired(
            code,
            '    const area = entityAreaId(hass, entity);\n',
            [
                "    // a parking spot's or a car's sensor (a spot taken or left): the spot",
                '    for (const floor of b.floors) {',
                '      const f = floor.furniture.find((m) => m.entity === entity && ["parking", "car_sedan", "car_hatchback", "car_van"].includes(m.type));',
                '      if (!f) continue;',
                '      const room = floor.rooms.find((r) => r.points.length >= 3 && pointInPolygon([f.x, f.z], r.points));',
                '      this.goTo({ kind: "device", name: f.name || entityName(hass, entity), where: "", floorId: floor.id, roomId: room?.id ?? null, entity, icon: null, x: f.x, z: f.z, y: 1 });',
                '      return;',
                '    }',
                '    const area = entityAreaId(hass, entity);',
                '',
            ].join('\n'),
            'time travel: a car event flies to its spot',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  tt_ev_robot_done: "{name} fertig",\n',
            '  tt_ev_robot_done: "{name} fertig",\n  tt_ev_car_in: "Parkplatz belegt: {name}",\n  tt_ev_car_out: "Parkplatz frei: {name}",\n',
            'time travel: car texts de',
        );
        return replaceRequired(
            code,
            '  tt_ev_robot_done: "{name} done",\n',
            '  tt_ev_robot_done: "{name} done",\n  tt_ev_car_in: "Parking spot taken: {name}",\n  tt_ev_car_out: "Parking spot free: {name}",\n',
            'time travel: car texts en',
        );
    }
    return code;
}

function gasBottle(name: string, code: string): string {
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '      preset: { gear_kind: "oil", w: 0.72, d: 1.6, h: 1.55 },\n    });\n  }\n',
            [
                '      preset: { gear_kind: "oil", w: 0.72, d: 1.6, h: 1.55 },',
                '    });',
                '    // a gas bottle (11 kg of propane): beside the tank, a card of its own',
                '    const gas = src.basicName("tank_gas");',
                '    out.push({',
                '      ...tank,',
                '      key: "tank#gas",',
                '      label: gas,',
                '      search: `${gas} ${src.basicNameEn("tank_gas")} gasflasche gas flasche propan butan lpg grill camping ${src.kindName(tank.kind)} ${KIND_WORDS[tank.kind]}`,',
                '      family: "tank_gas",',
                '      rooms: [...new Set([...tank.rooms, "garden", "kitchen"])],',
                '      size: [0.3, 0.3, 0.59],',
                '      preset: { gear_kind: "gas", w: 0.3, d: 0.3, h: 0.59 },',
                '    });',
                '  }',
                '',
            ].join('\n'),
            'gas bottle: library entry',
        );
    }
    if (name === 'components/library.ts') {
        // the picture of an entry with a preset is its own (key), else the type's
        code = replaceRequired(
            code,
            '      if (!entry || this._thumbs.has(entry.type)) continue;',
            '      if (!entry || this._thumbs.has(fp3dPic(entry))) continue;',
            'gas bottle: picture key (seen)',
        );
        code = replaceRequired(
            code,
            '    if (this._thumbs.has(entry.type) || this.wanted.has(entry.type)) return;\n    this.wanted.add(entry.type);',
            '    if (this._thumbs.has(fp3dPic(entry)) || this.wanted.has(fp3dPic(entry))) return;\n    this.wanted.add(fp3dPic(entry));',
            'gas bottle: picture key (wanted)',
        );
        code = replaceRequired(
            code,
            '      const key = `${entry.type}|${entry.packRelease}|',
            '      const key = `${fp3dPic(entry)}|${entry.packRelease}|',
            'gas bottle: picture key (cache)',
        );
        code = replaceRequired(
            code,
            '            next.set(entry.type, url);\n            this._thumbs = next;\n          } else this.wanted.delete(entry.type);\n        })\n        .catch(() => this.wanted.delete(entry.type))',
            '            next.set(fp3dPic(entry), url);\n            this._thumbs = next;\n          } else this.wanted.delete(fp3dPic(entry));\n        })\n        .catch(() => this.wanted.delete(fp3dPic(entry)))',
            'gas bottle: picture key (drawn)',
        );
        code = replaceRequired(
            code,
            '    const pic = this._thumbs.get(shown.type) ?? this._thumbs.get(first.type);',
            '    const pic = this._thumbs.get(fp3dPic(shown)) ?? this._thumbs.get(fp3dPic(first));',
            'gas bottle: picture key (card)',
        );
        code = replaceRequired(
            code,
            'class=${(this._thumbs.has(shown.type) ? shown : first).mirror',
            'class=${(this._thumbs.has(fp3dPic(shown)) ? shown : first).mirror',
            'gas bottle: picture key (mirrored)',
        );
        code = replaceRequired(
            code,
            'const THUMB_PX = 96;\n',
            "const THUMB_PX = 96;\n/** The key of an entry's picture: an entry with a preset (the oil tank, the gas bottle) has its own. */\nconst fp3dPic = (e: LibraryEntry): string => (e.preset ? e.key : e.type);\n",
            'gas bottle: picture key',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            'return mod.furniturePreview({ type: entry.type, w, d, h, variant: null, lamp: LAMP_MODEL[entry.type] ?? null }, 96, this.packs ?? []);',
            'return mod.furniturePreview({ type: entry.type, w, d, h, variant: typeof entry.preset?.gear_kind === "string" ? entry.preset.gear_kind : null, lamp: LAMP_MODEL[entry.type] ?? null }, 96, this.packs ?? []);',
            'gas bottle: picture of the preset kind',
        );
        code = replaceRequired(
            code,
            '<g class="fp3d-furn-sym">${furnitureSymbol(f.type, f.w, f.d, f.h)}</g>',
            '<g class="fp3d-furn-sym">${furnitureSymbol(f.type === "tank" && f.gear_kind === "gas" ? "tank_gas" : f.type, f.w, f.d, f.h)}</g>',
            'gas bottle: round in the plan',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "tank":\n      // a tank: its outline and the filler cap\n',
            [
                '    case "tank_gas":',
                '      // a gas bottle from above: its body, the collar and the valve',
                '      return [circle(0, 0, Math.max(0.02, Math.min(w, d) / 2 - 0.01), "fp3d-sym-strong"), circle(0, 0, Math.min(w, d) * 0.3), circle(0, 0, 0.02)];',
                '    case "tank":',
                '      // a tank: its outline and the filler cap',
                '',
            ].join('\n'),
            'gas bottle: plan symbol',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  furn_tank_oil: "Öltank",',
            '  furn_tank_oil: "Öltank",\n  furn_tank_gas: "Gasflasche",',
            'gas bottle: de',
        );
        code = replaceRequired(
            code,
            '  furn_tank_oil: "Oil tank",',
            '  furn_tank_oil: "Oil tank",\n  furn_tank_gas: "Gas bottle",',
            'gas bottle: en',
        );
    }
    return code;
}

/**
 * One bar instead of two (frontend/shell.ts): the page's own bar (logo, status, projects, devices, kiosk, help) goes
 * into the slots "start" (instead of the title "3D Home") and "end" (before the version and ⚙) of the panel's header.
 * In the clean view, where the header is gone, a header with only those slots stays, as the page's bar did before.
 */
function oneBar(name: string, code: string): string {
    if (name !== 'panel.ts') {
        return code;
    }
    code = replaceRequired(
        code,
        '          <h1>3D Home</h1>\n',
        '          <slot name="start"></slot>\n',
        'one bar: start',
    );
    code = replaceRequired(
        code,
        '          <span class="fp3d-version" title=${this.t("version_hint"',
        // "status": the page's status while something is wrong; "edit": its status while all is fine, "Projekte" and
        // "Geräte verbinden", only in the editor (`placeStatus` in shell.ts)
        '          <slot name="status"></slot>${this._mode === "editor" ? html`<slot name="edit"></slot>` : nothing}<slot name="end"></slot>\n          <span class="fp3d-version" title=${this.t("version_hint"',
        'one bar: end',
    );
    code = replaceRequired(
        code,
        '${(this._clean && this._mode === "view") || this.kiosk ? nothing : html`<header class="fp3d-header">',
        '${this.kiosk ? nothing : this._clean && this._mode === "view" ? (this.querySelector(":scope > [slot]") ? html`<header class="fp3d-header"><slot name="start"></slot><span class="fp3d-grow"></span><slot name="status"></slot><slot name="end"></slot></header>` : nothing) : html`<header class="fp3d-header">',
        'one bar: the clean view keeps the page bar',
    );
    return code;
}

/**
 * Robot vacuums (device-cards.ts): the robot drives by the state of an ioBroker datapoint too (the codes of
 * Xiaomi/Roborock, plain words), and finds its datapoint by name when none is linked.
 */
function robotMore(name: string, code: string): string {
    if (name !== 'components/view3d.ts') {
        return code;
    }
    code = `import { mainEntity as fp3dDeviceMain, robotState as fp3dRobotState } from "${root}/frontend/vendor-ext/device-cards.ts";\n${code}`;
    return replaceRequired(
        code,
        [
            '        if (!isRobotVacuum(f.type)) continue;',
            '        const entity = this.furnitureLinks.get(f.id)?.entity ?? null;',
            '        const state = entity ? hass.states[entity]?.state : undefined;',
        ].join('\n'),
        [
            '        if (!isRobotVacuum(f.type)) continue;',
            '        const entity = this.furnitureLinks.get(f.id)?.entity ?? fp3dDeviceMain(hass, f);',
            '        const state = fp3dRobotState(entity ? hass.states[entity]?.state : undefined);',
        ].join('\n'),
        'robot: ioBroker states',
    );
}

/**
 * Pool (pool-module.ts): the module that gives the pools their life is built into this page instead of coming from a
 * pack – registered in every bundle's copy of modules.ts and kept when the packs are synced. With it the pool tool
 * draws pipes, a pool's form has its datapoints, the water shows the pump, the heating, the light and the cover.
 */
function poolMore(name: string, code: string): string {
    if (name !== 'modules.ts') {
        return code;
    }
    code = `import { poolModule as fp3dPoolModule } from "${root}/frontend/vendor-ext/pool-module.ts";\nimport { deviceModule as fp3dDeviceModule } from "${root}/frontend/vendor-ext/device-cards.ts";\n${code}`;
    code = replaceRequired(
        code,
        'const loaded = new Map<string, Loaded>();',
        [
            '/** Modules built into this page (no pack): never dropped when the packs are synced. */',
            'const builtin = new Set<string>(["home3d.pool", "home3d.devices"]);',
            'const loaded = new Map<string, Loaded>([',
            '  ["home3d.pool", { id: "home3d.pool", release: 1, module: fp3dPoolModule as unknown as NeonModule }],',
            '  ["home3d.devices", { id: "home3d.devices", release: 1, module: fp3dDeviceModule as unknown as NeonModule }],',
            ']);',
        ].join('\n'),
        'pool: built-in module',
    );
    return replaceRequired(
        code,
        'for (const id of [...loaded.keys()]) if (!wanted.has(id)) loaded.delete(id);',
        'for (const id of [...loaded.keys()]) if (!wanted.has(id) && !builtin.has(id)) loaded.delete(id);',
        'pool: built-in module kept',
    );
}

/**
 * Air vent of a ventilation (air-vent.ts, home-view.ts, home-fx.ts): a new piece under switches and tech, drawn by the
 * home looks; a disc valve under the ceiling or a grille on the wall, fresh air streaming out of it (supply) or used air
 * drawn into it (exhaust) while its fan runs, thicker and faster the higher its stage.
 */
function airVentMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "heat_store",\n] as const;',
            '  "heat_store",\n  "air_vent",\n] as const;',
            'vent: furniture type',
        );
        code = replaceRequired(
            code,
            '"water_heater", "heat_store"',
            '"water_heater", "heat_store", "air_vent"',
            'vent: library group',
        );
        code = replaceRequired(
            code,
            '  heat_store: [0.75, 0.75, 1.9],',
            '  heat_store: [0.75, 0.75, 1.9],\n  // a disc valve under the ceiling (a grille on the wall: 0.3 × 0.04 × 0.15)\n  air_vent: [0.2, 0.2, 0.05],',
            'vent: size',
        );
        code = replaceRequired(
            code,
            '  store_heat?: string | null;',
            '  store_heat?: string | null;\n  /** An air vent: "exhaust" (used air into it), else supply (fresh air out of it). */\n  vent_flow?: string | null;',
            'vent: fields',
        );
        code = replaceRequired(
            code,
            '  if (f.type === "wifi_ap") return f.variant === "wall" ? 2.1 : Math.max(0, ceiling - f.h);',
            '  if (f.type === "wifi_ap") return f.variant === "wall" ? 2.1 : Math.max(0, ceiling - f.h);\n  if (f.type === "air_vent") return f.variant === "wall" ? 2.0 : Math.max(0, ceiling - f.h);',
            'vent: mount height',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  heat_store: ["tech", ["utility"]],',
            '  heat_store: ["tech", ["utility"]],\n  air_vent: ["tech", ["bath", "kitchen", "utility"]],',
            'vent: library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "heat_store":',
            [
                '    case "air_vent":',
                '      // a grille on the wall (flat) with its slats, else the disc valve from below',
                '      return d < 0.1',
                '        ? [rect(-w / 2, -d / 2, w / 2, d / 2), line(-w * 0.3, 0, w * 0.3, 0)]',
                '        : [circle(0, 0, Math.min(w, d) / 2), circle(0, 0, Math.min(w, d) * 0.33)];',
                '    case "heat_store":',
            ].join('\n'),
            'vent: symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "heat_store":\n    case "ebike":\n',
            '    case "air_vent":\n    case "heat_store":\n    case "ebike":\n',
            'vent: drawn by the home looks',
        );
    }
    if (name === 'viewer/preview.ts') {
        code = `import { buildAirVent as fp3dPrevAirVent } from "${root}/frontend/vendor-ext/air-vent.ts";\n${code}`;
        code = replaceRequired(
            code,
            '                  ? fp3dPrevHeatStore(item.w, item.d, item.h)\n                  : null;',
            '                  ? fp3dPrevHeatStore(item.w, item.d, item.h)\n                  : item.type === "air_vent"\n                    ? fp3dPrevAirVent(item.w, item.d, item.h, false, "supply")\n                    : null;',
            'vent: library picture',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            furn_air_vent: 'Lüftungsauslass',
            vent_mount: 'Montage',
            vent_ceiling: 'Tellerventil an der Decke',
            vent_wall: 'Gitter an der Wand',
            vent_flow: 'Luft',
            vent_supply: 'Zuluft (frische Luft strömt heraus)',
            vent_exhaust: 'Abluft (verbrauchte Luft wird abgesaugt)',
            vent_fan: 'Lüfter (Stufe, Leistung, Schalter)',
            vent_hint:
                'Solange der Lüfter läuft, strömt an einem Zuluft-Auslass hellblaue frische Luft heraus und wird an einem Abluft-Auslass graue Luft angesaugt – dichter, schneller und weiter mit der Stufe. Es zählen ein Lüfter (mit Prozent), eine Stufe (bis 4 als 0–4, bis 10 als 0–10, sonst %), eine Leistung (W), ein Luftvolumen (m³/h), eine Drehzahl, ein Betriebsmodus mit Namen (niedrig, normal, hoch, Intensiv …) oder ein Schalter.',
        };
        const en: Record<string, string> = {
            furn_air_vent: 'Air vent',
            vent_mount: 'Mounting',
            vent_ceiling: 'Disc valve on the ceiling',
            vent_wall: 'Grille on the wall',
            vent_flow: 'Air',
            vent_supply: 'Supply (fresh air streams out)',
            vent_exhaust: 'Exhaust (used air is drawn in)',
            vent_fan: 'Fan (stage, power, switch)',
            vent_hint:
                'While the fan runs, light blue fresh air streams out of a supply vent and grey air is drawn into an exhaust vent – thicker, faster and farther with the stage. A fan (with its percentage), a stage (up to 4 as 0–4, up to 10 as 0–10, else %), a power (W), an air volume (m³/h), a speed, an operating mode by name (low, normal, high, boost …) or a switch count.',
        };
        const lines = (t: Record<string, string>): string =>
            Object.entries(t)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(
            code,
            '  furn_waste_bin: "Mülltonne",',
            `  furn_waste_bin: "Mülltonne",${lines(de)}`,
            'vent de',
        );
        code = replaceRequired(
            code,
            '  furn_waste_bin: "Waste bin",',
            `  furn_waste_bin: "Waste bin",${lines(en)}`,
            'vent en',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '"heat_pump", "ebike", "heat_store"]);',
            '"heat_pump", "ebike", "heat_store", "air_vent"]);',
            'vent: no state links',
        );
        code = replaceRequired(
            code,
            '    if (f.type === "heat_store")\n',
            [
                '    if (f.type === "air_vent")',
                '      return html`<div class="fp3d-form fp3d-links">',
                '        <label class="fp3d-field"',
                '          >${this.t("vent_mount" as I18nKey)}',
                '          <select ?disabled=${!this.isAdmin} @change=${(e: Event) => { const v = (e.target as HTMLSelectElement).value; const [w, d, h] = v === "wall" ? [0.3, 0.04, 0.15] : [0.2, 0.2, 0.05]; set({ variant: v === "wall" ? "wall" : null, w, d, h, mount_y: null }); }}>',
                '            <option value="" ?selected=${f.variant !== "wall"}>${this.t("vent_ceiling" as I18nKey)}</option>',
                '            <option value="wall" ?selected=${f.variant === "wall"}>${this.t("vent_wall" as I18nKey)}</option>',
                '          </select></label',
                '        >',
                '        <label class="fp3d-field"',
                '          >${this.t("vent_flow" as I18nKey)}',
                '          <select ?disabled=${!this.isAdmin} @change=${(e: Event) => set({ vent_flow: (e.target as HTMLSelectElement).value === "exhaust" ? "exhaust" : null })}>',
                '            <option value="" ?selected=${f.vent_flow !== "exhaust"}>${this.t("vent_supply" as I18nKey)}</option>',
                '            <option value="exhaust" ?selected=${f.vent_flow === "exhaust"}>${this.t("vent_exhaust" as I18nKey)}</option>',
                '          </select></label',
                '        >',
                '        ${this.entitySelect(this.t("vent_fan" as I18nKey), f.entity ?? null, undefined, this.entityOptions((id) => /^(fan|switch|sensor|number|input_number|select|input_select|input_boolean|binary_sensor|climate)\\./.test(id)), (v) => set({ entity: pick(v) }))}',
                '        <p class="fp3d-sub fp3d-wide">${this.t("vent_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    if (f.type === "heat_store")',
                '',
            ].join('\n'),
            'vent: form',
        );
    }
    return code;
}

/**
 * Hot water or buffer store (heat-store.ts, home-view.ts, home-fx.ts): a new piece under switches and tech, drawn by
 * the home looks; a window in its jacket shows its water's layers coloured by temperature (from its sensors at the
 * top, the middle and the bottom), and while it is heated a flame burns under it.
 */
function heatStoreMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "ebike",\n] as const;',
            '  "ebike",\n  "heat_store",\n] as const;',
            'store: furniture type',
        );
        code = replaceRequired(
            code,
            '"server", "water_heater"',
            '"server", "water_heater", "heat_store"',
            'store: library group',
        );
        code = replaceRequired(
            code,
            '  ebike: [1.8, 0.62, 1.1],',
            '  ebike: [1.8, 0.62, 1.1],\n  // a 500 l buffer store\n  heat_store: [0.75, 0.75, 1.9],',
            'store: size',
        );
        code = replaceRequired(
            code,
            '  ebike_presence?: string | null;',
            '  ebike_presence?: string | null;\n  /** A store: its sensors in the middle and at the bottom (the top one is its entity), what heats it. */\n  store_mid?: string | null;\n  store_bottom?: string | null;\n  store_heat?: string | null;',
            'store: fields',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  ebike: ["vehicle", ["garage", "garden"]],',
            '  ebike: ["vehicle", ["garage", "garden"]],\n  heat_store: ["tech", ["utility"]],',
            'store: library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "ebike":',
            [
                '    case "heat_store":',
                '      // the round store from above, its window at the front',
                '      return [ellipse(0, 0, w / 2, d / 2), line(-w * 0.15, d / 2 - 0.02, w * 0.15, d / 2 - 0.02)];',
                '    case "ebike":',
            ].join('\n'),
            'store: symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "ebike":\n    case "heat_pump":\n',
            '    case "heat_store":\n    case "ebike":\n    case "heat_pump":\n',
            'store: drawn by the home looks',
        );
    }
    if (name === 'viewer/preview.ts') {
        code = `import { buildHeatStore as fp3dPrevHeatStore } from "${root}/frontend/vendor-ext/heat-store.ts";\n${code}`;
        code = replaceRequired(
            code,
            '                ? fp3dPrevEbike(item.w, item.d, item.h)\n                : null;',
            '                ? fp3dPrevEbike(item.w, item.d, item.h)\n                : item.type === "heat_store"\n                  ? fp3dPrevHeatStore(item.w, item.d, item.h)\n                  : null;',
            'store: library picture',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            furn_heat_store: 'Speicher (Warmwasser / Puffer)',
            store_top: 'Temperatur oben',
            store_mid: 'Temperatur Mitte',
            store_bottom: 'Temperatur unten',
            store_heat: 'Heizung (Brenner, Heizstab, Pumpe)',
            store_hint:
                'Ein Fenster in der Hülle zeigt die Schichten des Wassers nach Temperatur: blau bis 20 °C, über Türkis, Grün und Gelb bis rot bei 70 °C. Zwischen den Fühlern oben, in der Mitte und unten verläuft die Temperatur gerade; mit einem Fühler sind alle Schichten wie er. Solange der Datenpunkt der Heizung an ist (oder ab 20 W zieht), brennt unter dem Speicher eine Flamme.',
        };
        const en: Record<string, string> = {
            furn_heat_store: 'Store (hot water / buffer)',
            store_top: 'Temperature at the top',
            store_mid: 'Temperature in the middle',
            store_bottom: 'Temperature at the bottom',
            store_heat: 'Heating (burner, heating rod, pump)',
            store_hint:
                'A window in the jacket shows the layers of the water by temperature: blue up to 20 °C, through cyan, green and yellow to red at 70 °C. Between the sensors at the top, the middle and the bottom it runs in a straight line; with one sensor all layers are as it. While the heating datapoint is on (or draws 20 W and more), a flame burns under the store.',
        };
        const lines = (t: Record<string, string>): string =>
            Object.entries(t)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(
            code,
            '  furn_waste_bin: "Mülltonne",',
            `  furn_waste_bin: "Mülltonne",${lines(de)}`,
            'store de',
        );
        code = replaceRequired(
            code,
            '  furn_waste_bin: "Waste bin",',
            `  furn_waste_bin: "Waste bin",${lines(en)}`,
            'store en',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '"heat_pump", "ebike"]);',
            '"heat_pump", "ebike", "heat_store"]);',
            'store: no state links',
        );
        const temp = '/^(sensor|input_number|number|climate|water_heater)\\./';
        code = replaceRequired(
            code,
            '    if (f.type === "ebike")\n',
            [
                '    if (f.type === "heat_store")',
                '      return html`<div class="fp3d-form fp3d-links">',
                `        \${this.entitySelect(this.t("store_top" as I18nKey), f.entity ?? null, undefined, this.entityOptions((id) => ${temp}.test(id)), (v) => set({ entity: pick(v) }))}`,
                `        \${this.entitySelect(this.t("store_mid" as I18nKey), f.store_mid ?? null, undefined, this.entityOptions((id) => ${temp}.test(id)), (v) => set({ store_mid: pick(v) }))}`,
                `        \${this.entitySelect(this.t("store_bottom" as I18nKey), f.store_bottom ?? null, undefined, this.entityOptions((id) => ${temp}.test(id)), (v) => set({ store_bottom: pick(v) }))}`,
                '        ${this.entitySelect(this.t("store_heat" as I18nKey), f.store_heat ?? null, undefined, this.entityOptions((id) => /^(switch|sensor|binary_sensor|input_boolean|climate|water_heater|select)\\./.test(id)), (v) => set({ store_heat: pick(v) }))}',
                '        <p class="fp3d-sub fp3d-wide">${this.t("store_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    if (f.type === "ebike")',
                '',
            ].join('\n'),
            'store: form',
        );
    }
    return code;
}

/**
 * E-bike (ebike.ts, home-view.ts, home-fx.ts): a new piece under vehicles, drawn by the home looks; the five LEDs on its
 * battery show its charge, the charger stands beside it with its cable while it charges (the next LED blinks), and with
 * a presence datapoint it is gone while it is out.
 */
function ebikeMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "heat_pump",\n] as const;',
            '  "heat_pump",\n  "ebike",\n] as const;',
            'e-bike: furniture type',
        );
        code = replaceRequired(
            code,
            '  vehicles: ["parking",',
            '  vehicles: ["parking", "ebike",',
            'e-bike: library group',
        );
        code = replaceRequired(
            code,
            '  heat_pump: [1.0, 0.4, 0.85],',
            '  heat_pump: [1.0, 0.4, 0.85],\n  // an e-bike: its length, the handlebar, its height\n  ebike: [1.8, 0.62, 1.1],',
            'e-bike: size',
        );
        code = replaceRequired(
            code,
            '  heat_pump_defrost?: string | null;',
            '  heat_pump_defrost?: string | null;\n  /** An e-bike: its charger (power or switch) and whether it is home (a tracker, a sensor). */\n  ebike_charge?: string | null;\n  ebike_presence?: string | null;',
            'e-bike: fields',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  heat_pump: ["outdoor", ["garden", "utility"]],',
            '  heat_pump: ["outdoor", ["garden", "utility"]],\n  ebike: ["vehicle", ["garage", "garden"]],',
            'e-bike: library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "heat_pump":',
            [
                '    case "ebike":',
                '      // the two wheels and the frame between them, the handlebar across',
                '      return [ellipse(-w * 0.31, 0, w * 0.18, Math.min(0.04, d * 0.1)), ellipse(w * 0.31, 0, w * 0.18, Math.min(0.04, d * 0.1)), line(-w * 0.31, 0, w * 0.31, 0), line(w * 0.22, -d * 0.45, w * 0.22, d * 0.45)];',
                '    case "heat_pump":',
            ].join('\n'),
            'e-bike: symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "heat_pump":\n    case "server":\n',
            '    case "ebike":\n    case "heat_pump":\n    case "server":\n',
            'e-bike: drawn by the home looks',
        );
    }
    if (name === 'viewer/preview.ts') {
        code = `import { buildEbike as fp3dPrevEbike } from "${root}/frontend/vendor-ext/ebike.ts";\n${code}`;
        code = replaceRequired(
            code,
            '              ? fp3dPrevHeatPump(item.w, item.d, item.h)\n              : null;',
            '              ? fp3dPrevHeatPump(item.w, item.d, item.h)\n              : item.type === "ebike"\n                ? fp3dPrevEbike(item.w, item.d, item.h)\n                : null;',
            'e-bike: library picture',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            furn_ebike: 'E-Bike',
            ebike_entity: 'Akkustand (%)',
            ebike_charge: 'Ladegerät (Leistung oder Schalter)',
            ebike_presence: 'Anwesenheit (zuhause)',
            ebike_hint:
                'Die fünf LEDs am Akku zeigen den Ladestand (rot bis 20 %, gelb bis zur Hälfte, dann grün), über dem Rad stehen die Prozent. Zieht das Ladegerät Leistung (ab 5 W) oder ist sein Schalter an, steht es mit Kabel neben dem Rad und die nächste LED blinkt. Mit einem Datenpunkt für die Anwesenheit ist das Rad weg, solange es unterwegs ist.',
        };
        const en: Record<string, string> = {
            furn_ebike: 'E-bike',
            ebike_entity: 'Battery level (%)',
            ebike_charge: 'Charger (power or switch)',
            ebike_presence: 'Presence (home)',
            ebike_hint:
                'The five LEDs on the battery show its charge (red up to 20 %, amber up to half, then green), the percent stand over the bike. While the charger draws power (from 5 W) or its switch is on, it stands beside the bike with its cable and the next LED blinks. With a presence datapoint the bike is gone while it is out.',
        };
        const lines = (t: Record<string, string>): string =>
            Object.entries(t)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(
            code,
            '  furn_waste_bin: "Mülltonne",',
            `  furn_waste_bin: "Mülltonne",${lines(de)}`,
            'e-bike de',
        );
        code = replaceRequired(
            code,
            '  furn_waste_bin: "Waste bin",',
            `  furn_waste_bin: "Waste bin",${lines(en)}`,
            'e-bike en',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '"server", "bin_spot", "heat_pump"]);',
            '"server", "bin_spot", "heat_pump", "ebike"]);',
            'e-bike: no state links',
        );
        code = replaceRequired(
            code,
            '    if (f.type === "heat_pump")\n',
            [
                '    if (f.type === "ebike")',
                '      return html`<div class="fp3d-form fp3d-links">',
                '        ${this.entitySelect(this.t("ebike_entity" as I18nKey), f.entity ?? null, undefined, this.entityOptions((id) => /^(sensor|input_number|number)\\./.test(id)), (v) => set({ entity: pick(v) }))}',
                '        ${this.entitySelect(this.t("ebike_charge" as I18nKey), f.ebike_charge ?? null, undefined, this.entityOptions((id) => /^(switch|sensor|binary_sensor|input_boolean)\\./.test(id)), (v) => set({ ebike_charge: pick(v) }))}',
                '        ${this.entitySelect(this.t("ebike_presence" as I18nKey), f.ebike_presence ?? null, undefined, this.entityOptions((id) => /^(device_tracker|person|binary_sensor|sensor|input_boolean|switch)\\./.test(id)), (v) => set({ ebike_presence: pick(v) }))}',
                '        <p class="fp3d-sub fp3d-wide">${this.t("ebike_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    if (f.type === "heat_pump")',
                '',
            ].join('\n'),
            'e-bike: form',
        );
    }
    return code;
}

/**
 * Heat pump (heat-pump.ts, home-view.ts, home-fx.ts): the outdoor unit of a heat pump, drawn by the home looks; its fan
 * turns the faster the more power it draws (or steadily by its switch) and runs down when it stops; while its defrost
 * datapoint reports defrosting, the fan stands and steam rises from it. Also: the doorbells are watched, so the parcel
 * at the front door comes with the ring.
 */
function heatPumpMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "bin_spot",\n] as const;',
            '  "bin_spot",\n  "heat_pump",\n] as const;',
            'heat pump: furniture type',
        );
        code = replaceRequired(
            code,
            '  outdoor: ["awning",',
            '  outdoor: ["awning", "heat_pump",',
            'heat pump: library group',
        );
        code = replaceRequired(
            code,
            '  bin_spot: [2.4, 0.9, 0.02],',
            '  bin_spot: [2.4, 0.9, 0.02],\n  // the outdoor unit of an air-to-water heat pump\n  heat_pump: [1.0, 0.4, 0.85],',
            'heat pump: size',
        );
        code = replaceRequired(
            code,
            '  server_kind?: string | null;',
            '  server_kind?: string | null;\n  /** A heat pump: the datapoint that tells it defrosts (on, or a mode naming it). */\n  heat_pump_defrost?: string | null;',
            'heat pump: field',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  bin_spot: ["household", ["garden"]],',
            '  bin_spot: ["household", ["garden"]],\n  heat_pump: ["outdoor", ["garden", "utility"]],',
            'heat pump: library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "bin_spot":',
            [
                '    case "heat_pump":',
                '      // the unit from above, its fan side at the front',
                '      return [rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"), line(-w / 2, d / 2 - Math.min(0.06, d * 0.2), w / 2, d / 2 - Math.min(0.06, d * 0.2)), ellipse(-w * 0.12, 0, Math.min(w * 0.3, d * 0.4), Math.min(w * 0.3, d * 0.4))];',
                '    case "bin_spot":',
            ].join('\n'),
            'heat pump: symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "server":\n    case "rain_tank":\n',
            '    case "heat_pump":\n    case "server":\n    case "rain_tank":\n',
            'heat pump: drawn by the home looks',
        );
    }
    if (name === 'viewer/preview.ts') {
        code = `import { buildHeatPump as fp3dPrevHeatPump } from "${root}/frontend/vendor-ext/heat-pump.ts";\n${code}`;
        code = replaceRequired(
            code,
            '            ? fp3dPrevServer("rack", item.w, item.d, item.h)\n            : null;',
            '            ? fp3dPrevServer("rack", item.w, item.d, item.h)\n            : item.type === "heat_pump"\n              ? fp3dPrevHeatPump(item.w, item.d, item.h)\n              : null;',
            'heat pump: library picture',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            furn_heat_pump: 'Wärmepumpe (Außengerät)',
            heat_pump_entity: 'Leistung oder Schalter',
            heat_pump_defrost: 'Abtauen (Datenpunkt)',
            heat_pump_hint:
                'Der Lüfter dreht umso schneller, je mehr Leistung die Wärmepumpe zieht (ab 60 W; mit einem Schalter gleichmäßig), und läuft nach dem Abschalten langsam aus. Meldet der Datenpunkt „Abtauen“ an (oder einen Betriebsmodus mit „Abtauen“ oder „Defrost“), steht der Lüfter und Dampf steigt aus dem Gerät auf.',
        };
        const en: Record<string, string> = {
            furn_heat_pump: 'Heat pump (outdoor unit)',
            heat_pump_entity: 'Power or switch',
            heat_pump_defrost: 'Defrost (datapoint)',
            heat_pump_hint:
                'The fan turns the faster the more power the heat pump draws (from 60 W; steadily with a switch) and runs down slowly when it stops. While the defrost datapoint is on (or an operating mode naming "defrost"), the fan stands and steam rises from the unit.',
        };
        const lines = (t: Record<string, string>): string =>
            Object.entries(t)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(
            code,
            '  furn_waste_bin: "Mülltonne",',
            `  furn_waste_bin: "Mülltonne",${lines(de)}`,
            'heat pump de',
        );
        code = replaceRequired(
            code,
            '  furn_waste_bin: "Waste bin",',
            `  furn_waste_bin: "Waste bin",${lines(en)}`,
            'heat pump en',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '"rain_tank", "server", "bin_spot"]);',
            '"rain_tank", "server", "bin_spot", "heat_pump"]);',
            'heat pump: no state links',
        );
        code = replaceRequired(
            code,
            '    if (f.type === "bin_spot")\n',
            [
                '    if (f.type === "heat_pump")',
                '      return html`<div class="fp3d-form fp3d-links">',
                '        ${this.entitySelect(this.t("heat_pump_entity" as I18nKey), f.entity ?? null, undefined, this.entityOptions((id) => /^(switch|sensor|binary_sensor|input_boolean)\\./.test(id)), (v) => set({ entity: pick(v) }))}',
                '        ${this.entitySelect(this.t("heat_pump_defrost" as I18nKey), f.heat_pump_defrost ?? null, undefined, this.entityOptions((id) => /^(switch|sensor|binary_sensor|input_boolean|select|input_select)\\./.test(id)), (v) => set({ heat_pump_defrost: pick(v) }))}',
                '        <p class="fp3d-sub fp3d-wide">${this.t("heat_pump_hint" as I18nKey)}</p>',
                '      </div>`;',
                '    if (f.type === "bin_spot")',
                '',
            ].join('\n'),
            'heat pump: form',
        );
    }
    if (name === 'components/view3d.ts') {
        // the doorbells change no shown state of their own: watched, the parcel comes with the ring
        code = replaceRequired(
            code,
            '...fp3dHomeWatched(hass, b, (a) => areaEntities(hass, a), this.heatMode === "health")])]',
            '...fp3dHomeWatched(hass, b, (a) => areaEntities(hass, a), this.heatMode === "health"), ...doorbellEntities(hass, b.settings.director?.doorbell_entity)])]',
            'parcel: the doorbells watched',
        );
    }
    return code;
}

/**
 * Waste bins at the street (bin-spots.ts): a new piece "bin spot" (a paved pad at the street); a bin that is out (its
 * "put out" entity is on, else from the evening before its pickup until the pickup's morning, as its tag glows) stands
 * on the nearest spot of its floor, in a row, turned like it. The floors are built again only when a bin goes out or
 * comes back, as with the cars in the parking spots.
 */
function binsMore(name: string, code: string): string {
    if (name === 'model.ts') {
        code = replaceRequired(
            code,
            '  "server",\n] as const;',
            '  "server",\n  "bin_spot",\n] as const;',
            'bins: furniture type',
        );
        code = replaceRequired(
            code,
            '  household: ["waste_bin", "mailbox"],',
            '  household: ["waste_bin", "bin_spot", "mailbox"],',
            'bins: library group',
        );
        code = replaceRequired(
            code,
            '  server: [0.6, 0.8, 1.2],',
            '  server: [0.6, 0.8, 1.2],\n  // a pad at the street for three or four bins\n  bin_spot: [2.4, 0.9, 0.02],',
            'bins: size',
        );
    }
    if (name === 'library-index.ts') {
        code = replaceRequired(
            code,
            '  waste_bin: ["household", ["garden", "garage", "utility"]],',
            '  waste_bin: ["household", ["garden", "garage", "utility"]],\n  bin_spot: ["household", ["garden"]],',
            'bins: library index',
        );
    }
    if (name === 'components/furniture2d.ts') {
        code = replaceRequired(
            code,
            '    case "server":',
            [
                '    case "bin_spot":',
                '      // the pad and the edge of the street',
                '      return [rect(-w / 2, -d / 2, w / 2, d / 2, "fp3d-sym-strong"), line(-w / 2, d / 2 - Math.min(0.1, d * 0.15), w / 2, d / 2 - Math.min(0.1, d * 0.15))];',
                '    case "server":',
            ].join('\n'),
            'bins: symbol',
        );
    }
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    case "server":\n    case "rain_tank":\n',
            [
                '    case "bin_spot":',
                '      // a paved pad at the street where the bins go out',
                '      b.box(-w / 2, w / 2, 0, Math.max(0.01, h), -d / 2, d / 2, 0x9ea4aa, 0xb4bac0);',
                '      return;',
                '    case "server":',
                '    case "rain_tank":',
                '',
            ].join('\n'),
            'bins: the pad',
        );
    }
    if (name === 'i18n.ts') {
        const de: Record<string, string> = {
            furn_bin_spot: 'Tonnenplatz (Straße)',
            bin_spot_hint:
                'Hierhin rollen die Mülltonnen, wenn sie draußen stehen: mit ihrem Datenpunkt „rausgestellt“, sonst vom Vorabend der Abholung bis zum Morgen (wie ihr Schild leuchtet). Sie stehen nebeneinander auf dem nächsten Tonnenplatz ihrer Etage, gedreht wie er; die Vorderseite zeigt zur Straße.',
        };
        const en: Record<string, string> = {
            furn_bin_spot: 'Bin spot (street)',
            bin_spot_hint:
                'The waste bins roll here while they are out: by their "put out" datapoint, else from the evening before the pickup until its morning (as their tag glows). They stand side by side on the nearest bin spot of their floor, turned like it; the front faces the street.',
        };
        const lines = (t: Record<string, string>): string =>
            Object.entries(t)
                .map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)},`)
                .join('');
        code = replaceRequired(
            code,
            '  furn_waste_bin: "Mülltonne",',
            `  furn_waste_bin: "Mülltonne",${lines(de)}`,
            'bins de',
        );
        code = replaceRequired(
            code,
            '  furn_waste_bin: "Waste bin",',
            `  furn_waste_bin: "Waste bin",${lines(en)}`,
            'bins en',
        );
    }
    if (name === 'components/editor.ts') {
        code = replaceRequired(
            code,
            '"coffee_machine", "rain_tank", "server"]);',
            '"coffee_machine", "rain_tank", "server", "bin_spot"]);',
            'bins: no state links',
        );
        code = replaceRequired(
            code,
            '    if (f.type === "server")\n',
            [
                '    if (f.type === "bin_spot")',
                '      return html`<div class="fp3d-form fp3d-links"><p class="fp3d-sub fp3d-wide">${this.t("bin_spot_hint" as I18nKey)}</p></div>`;',
                '    if (f.type === "server")',
                '',
            ].join('\n'),
            'bins: form',
        );
    }
    if (name === 'viewer/viewer3d.ts') {
        code = `import { binsSig as fp3dBinsSig, withBinsOut as fp3dWithBins, type BinPlace as Fp3dBinPlace } from "${root}/frontend/vendor-ext/bin-spots.ts";\n${code}`;
        code = replaceRequired(
            code,
            '  /** Vehicles in the parking spots (spot id -> pack item type); a change rebuilds the floors. */\n',
            [
                '  private fp3dBins = new Map<string, Fp3dBinPlace>();',
                '  private fp3dBinsKey = "";',
                '  /** Waste bins that are out, standing at the street (bin id -> place); a change rebuilds the floors. */',
                '  fp3dSetBinsOut(places: Map<string, Fp3dBinPlace>): void {',
                '    const sig = fp3dBinsSig(places);',
                '    if (sig === this.fp3dBinsKey) return;',
                '    this.fp3dBinsKey = sig;',
                '    this.fp3dBins = places;',
                '    if (this.building) {',
                '      this.rebuild();',
                '      this.invalidate();',
                '    }',
                '  }',
                '',
                '  /** Vehicles in the parking spots (spot id -> pack item type); a change rebuilds the floors. */',
                '',
            ].join('\n'),
            'bins: setter',
        );
        code = replaceRequired(
            code,
            'buildFloorGeometry(withVehicles(floor, this.parked),',
            'buildFloorGeometry(fp3dWithBins(withVehicles(floor, this.parked), this.fp3dBins),',
            'bins: built at the street',
        );
        // their contact shadows go with them
        code = replaceRequired(
            code,
            '        const mesh = contactShadows(fv.floor);',
            '        const mesh = contactShadows(fp3dWithBins(fv.floor, this.fp3dBins));',
            'bins: shadows at the street',
        );
    }
    if (name === 'components/view3d.ts') {
        code = `import { binsOut as fp3dBinsOut, type BinPlace as Fp3dBinPlace } from "${root}/frontend/vendor-ext/bin-spots.ts";\n${code}`;
        code = replaceRequired(
            code,
            '    v.setParked(parkedVehicles(hass, b));\n',
            [
                '    v.setParked(parkedVehicles(hass, b));',
                '    // waste bins that are out stand at the street: by their own switch, else as their tag glows',
                '    this.fp3dBinsAt = this.replay',
                '      ? new Map()',
                '      : fp3dBinsOut(b.floors, (f) =>',
                '          typeof f.bin_out === "string" && f.bin_out !== "none"',
                '            ? binOut(f, hass)',
                '            : !!binDue(f, hass, this.pickups, new Date(), { from: b.settings.household?.bin_from, until: b.settings.household?.bin_until })?.glow,',
                '        );',
                '    v.fp3dSetBinsOut(this.fp3dBinsAt);',
                '',
            ].join('\n'),
            'bins: out to the viewer',
        );
        code = replaceRequired(
            code,
            '  private householdState(',
            '  /** Waste bins standing at the street now (bin id -> place). */\n  private fp3dBinsAt = new Map<string, Fp3dBinPlace>();\n\n  private householdState(',
            'bins: field',
        );
        // the bin's tag goes with it
        code = replaceRequired(
            code,
            'this.binHolos.push({ id: f.id, floorId: floor.id, x: f.x, z: f.z, y: mountBase(floor, f) + f.h, r: Math.max(f.w, f.d) / 2, name: label,',
            'this.binHolos.push({ id: f.id, floorId: floor.id, x: this.fp3dBinsAt.get(f.id)?.x ?? f.x, z: this.fp3dBinsAt.get(f.id)?.z ?? f.z, y: mountBase(floor, f) + f.h, r: Math.max(f.w, f.d) / 2, name: label,',
            'bins: the tag at the street',
        );
    }
    return code;
}

/**
 * The flag of a mailbox (mail-flag.ts, home-view.ts, home-fx.ts): it swings up while post lies in the box and folds
 * back once it is taken out, on every shape; the fixed flag of the US mailbox on a post goes.
 */
function mailFlagMore(name: string, code: string): string {
    if (name === 'viewer/furniture.ts') {
        code = replaceRequired(
            code,
            '    b.box(w / 2, w / 2 + 0.015, h - boxH * 0.4, h + 0.08, -d * 0.1, -d * 0.04, 0x8a1c1c);\n    b.box(w / 2, w / 2 + 0.015, h + 0.02, h + 0.08, -d * 0.04, d * 0.12, 0x8a1c1c);\n',
            '    // its flag moves with the post (frontend/vendor-ext/mail-flag.ts)\n',
            'mail flag: not fixed',
        );
    }
    if (name === 'components/view3d.ts') {
        code = replaceRequired(
            code,
            '      surface: (f, x, z, h) => surfaceHeight(f as Floor, x, z, h),\n',
            '      surface: (f, x, z, h) => surfaceHeight(f as Floor, x, z, h),\n      mailPost: (f) => mailboxPost(f as never, hass),\n',
            'mail flag: post to the home looks',
        );
        code = replaceRequired(
            code,
            '      mailPost: (f) => mailboxPost(f as never, hass),\n',
            '      mailPost: (f) => mailboxPost(f as never, hass),\n      bells: doorbellEntities(hass, b.settings.director?.doorbell_entity),\n',
            'parcel: the doorbells to the home looks',
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
                '              flag: f.gear_flag ?? "plain",',
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
        code = `import { defaultVaneY as fp3dVaneY, VANE_KINDS as FP3D_VANE_KINDS } from "${data}";\nimport { flagChoices as fp3dFlagChoices } from "${root}/frontend/vendor-ext/flags.ts";\n${code}`;
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
                '      ${kind === "flag"',
                '        ? html`<label class="fp3d-field fp3d-wide"',
                '            >${this.t("vane_design" as I18nKey)}',
                '            <select ?disabled=${!this.isAdmin} @change=${(e: Event) => this.updateFurniture({ gear_flag: (e.target as HTMLSelectElement).value })}>',
                '              ${fp3dFlagChoices(this.hass?.language ?? "en", this.t("flag_plain" as I18nKey)).map((c) => html`<option value=${c.id} ?selected=${c.id === (f.gear_flag ?? "plain")}>${c.name}</option>`)}',
                '            </select></label',
                '          >`',
                '        : nothing}',
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
            vane_design: 'Welche Flagge',
            flag_plain: 'Blau-Weiß (ohne Land)',
            vane_mast: 'Mast bzw. Stange bis zur Etage zeichnen',
            vane_hint:
                'Dreht sich mit dem Wind aus ⚙ → Haus (Wind-Sensoren) oder aus der Wetter-Entität: Der Verklicker zeigt in den Wind, Windsack und Flagge wehen mit ihm. Der Windsack steht ab 15 kn waagerecht, Böen lassen alle schwingen. Darüber stehen Wind, Richtung und Beaufort. Breite = Länge von Pfeil, Sack oder Flagge; die Höhe der Flagge folgt ihrem Land.',
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
            vane_design: 'Which flag',
            flag_plain: 'Blue and white (no country)',
            vane_mast: 'Draw a mast or pole down to the floor',
            vane_hint:
                'Turns with the wind from ⚙ → House (wind sensors) or from the weather entity: the windex points into the wind, the windsock and the flag fly with it. The windsock stands out straight from 15 kn, gusts make them all swing. Above it: wind, direction and Beaufort. Width = length of the arrow, sock or flag; the height of the flag follows its country.',
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
                '    // the kind of the device and its datapoints by part (a light: switch, dimmer, colour, white tone …), each chosen',
                '    // in the object browser of ioBroker (frontend/datapoint.ts); a new kind gives the device a new ID, which the plan follows',
                '    const fp3dDomain = pl.entity_id.slice(0, pl.entity_id.indexOf("."));',
                '    const fp3dKinds = ["light", "switch", "cover", "climate", "fan", "lock", "media_player", "sensor", "binary_sensor"];',
                '    const fp3dParts = fp3dAttrs.iobroker_parts as [string, string | null][] | undefined;',
                '    const fp3dPart = (part: string, remove = false) =>',
                '      window.dispatchEvent(new CustomEvent("iobroker-part", { detail: { entityId: pl.entity_id, part, label: this.t(`part_${part}` as I18nKey), remove } }));',
                '    const fp3dRekind = (from: string, to: string) => {',
                '      // every use of the old ID in the plan (its place, furniture, scenes, cards) takes the new one',
                '      const swap = (o: unknown): void => {',
                '        if (!o || typeof o !== "object") return;',
                '        const rec = o as Record<string, unknown>;',
                '        for (const key of Object.keys(rec)) {',
                '          if (rec[key] === from) rec[key] = to;',
                '          else swap(rec[key]);',
                '        }',
                '      };',
                '      this.change((doc) => swap(doc));',
                '      this._deviceId = to;',
                '    };',
                '    const fp3dPartRow = ([k, id]: [string, string | null]) => html`<div class="fp3d-part">',
                '      <span>${this.t(`part_${k}` as I18nKey)}</span>',
                '      ${id ? html`<code>${id}</code>` : html`<small class="fp3d-sub">${this.t("part_none" as I18nKey)}</small>`}',
                '      ${admin',
                '        ? html`<button class="fp3d-btn" @click=${() => fp3dPart(k)}>${this.t("part_pick" as I18nKey)}</button>',
                '            ${id ? html`<button class="fp3d-btn" title=${this.t("part_remove" as I18nKey)} aria-label=${this.t("part_remove" as I18nKey)} @click=${() => fp3dPart(k, true)}>×</button>` : nothing}`',
                '        : nothing}',
                '    </div>`;',
                '    // a media player has many parts: those not set fold away',
                '    const fp3dMany = (fp3dParts?.length ?? 0) > 9;',
                '    const fp3dKindBlock =',
                '      fp3dDatapoint && fp3dKinds.includes(fp3dDomain)',
                '        ? html`<div class="fp3d-form">',
                '            <label class="fp3d-field fp3d-wide"',
                '              >${this.t("device_kind" as I18nKey)}',
                '              <select',
                '                ?disabled=${!admin}',
                '                @change=${(e: Event) => {',
                '                  const kind = (e.target as HTMLSelectElement).value;',
                '                  const from = pl.entity_id;',
                '                  window.dispatchEvent(',
                '                    new CustomEvent("iobroker-kind", { detail: { entityId: from, kind, label: this.t(`kind_${kind}` as I18nKey), done: (to: string) => fp3dRekind(from, to) } }),',
                '                  );',
                '                }}',
                '              >',
                '                ${fp3dKinds.map((k) => html`<option value=${k} ?selected=${k === fp3dDomain}>${this.t(`kind_${k}` as I18nKey)}</option>`)}',
                '              </select></label',
                '            >',
                '            ${fp3dParts',
                '              ? html`<div class="fp3d-field fp3d-wide fp3d-parts">',
                '                  ${this.t("device_parts" as I18nKey)}',
                '                  ${fp3dParts.filter(([, id]) => id || !fp3dMany).map(fp3dPartRow)}',
                '                  ${fp3dMany && fp3dParts.some(([, id]) => !id)',
                '                    ? html`<details>',
                '                        <summary>${this.t("device_parts_more" as I18nKey, { n: fp3dParts.filter(([, id]) => !id).length })}</summary>',
                '                        ${fp3dParts.filter(([, id]) => !id).map(fp3dPartRow)}',
                '                      </details>`',
                '                    : nothing}',
                '                </div>',
                '                <p class="fp3d-sub fp3d-wide">${this.t("device_parts_hint" as I18nKey)}</p>`',
                '              : nothing}',
                '          </div>`',
                '        : nothing;',
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
                '          ${fp3dKindBlock}',
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
            '      .fp3d-datapoint {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 6px;\n      }\n      .fp3d-datapoint code {\n        overflow-wrap: anywhere;\n      }\n      .fp3d-parts {\n        gap: 4px;\n      }\n      .fp3d-part {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 6px;\n        padding: 3px 0;\n        border-top: 1px solid var(--fp3d-line, rgba(127, 127, 127, 0.2));\n      }\n      .fp3d-part > span:first-child {\n        flex: 0 0 9.5em;\n      }\n      .fp3d-part code {\n        flex: 1 1 8em;\n        overflow-wrap: anywhere;\n        font-size: 0.85em;\n      }\n      .fp3d-parts summary {\n        cursor: pointer;\n        padding: 4px 0;\n      }\n      .fp3d-dev-title {',
            'datapoint style',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  marker_height: "Höhe des Symbols (m)",',
            '  marker_height: "Höhe des Symbols (m)",\n  datapoint: "Datenpunkt",\n  datapoint_change: "Ändern …",\n  datapoint_add: "+ Datenpunkt aus ioBroker",\n  device_reach: "Nicht erreichbar (Technik)",\n  device_reach_house: "Standard (⚙ Wetter & Warnungen)",\n  device_reach_report: "Wie das Gerät meldet",\n  device_reach_minutes: "Nach … Minuten ohne Update",\n  device_reach_never: "Nie (z. B. 12-V-Gerät, das abgeschaltet wird)",\n  device_reach_min: "Minuten ohne Update",\n  device_reach_connected: "Nur prüfen, solange sein Adapter verbunden ist (z. B. NMEA: Instrumente aus = normal)",\n  device_battery: "Batterie (Technik)",\n  device_battery_detector: "gefunden vom type-detector",\n  device_battery_guess: "vermutet nach Name und Rolle",\n  device_battery_own: "selbst gewählt",\n  device_battery_missing: "keine gefunden",\n  device_battery_none: "keine Batterie",\n  device_battery_pick: "Wählen …",\n  device_battery_no: "Keine Batterie",\n  device_battery_auto: "Automatisch",\n  device_kind: "Gerätetyp",\n  kind_light: "Licht",\n  kind_switch: "Schalter",\n  kind_cover: "Rollladen, Jalousie, Markise",\n  kind_climate: "Heizung, Klima",\n  kind_fan: "Ventilator, Lüfter",\n  kind_lock: "Schloss",\n  kind_media_player: "Medien (TV, Lautsprecher)",\n  kind_sensor: "Sensor (Messwert)",\n  kind_binary_sensor: "Melder (an/aus)",\n  device_parts: "Datenpunkte des Geräts",\n  device_parts_more: "Weitere Teile ({n})",\n  device_parts_hint: "Jedes Teil ist ein Datenpunkt. „Wählen …“ öffnet die Objekte von ioBroker. Was fehlt, bietet die 3D-Ansicht nicht an: ohne Farbe kein Farbwähler, ohne Farbtemperatur kein Weißton. Ein anderer Gerätetyp sucht die passenden Teile neben dem Datenpunkt.",\n  part_none: "nicht gesetzt",\n  part_pick: "Wählen …",\n  part_remove: "Teil entfernen",\n  part_switch: "Schalter (an/aus)",\n  part_brightness: "Helligkeit (Dimmer)",\n  part_rgb: "Farbe (#RRGGBB)",\n  part_red: "Rot",\n  part_green: "Grün",\n  part_blue: "Blau",\n  part_hue: "Farbton",\n  part_saturation: "Sättigung",\n  part_color_temp: "Farbtemperatur (Weißton)",\n  part_position: "Position (setzen)",\n  part_position_actual: "Position (Ist)",\n  part_open: "Öffnen (Taste)",\n  part_close: "Schließen (Taste)",\n  part_stop: "Stopp (Taste)",\n  part_tilt: "Lamellen (setzen)",\n  part_tilt_actual: "Lamellen (Ist)",\n  part_target: "Solltemperatur",\n  part_current: "Ist-Temperatur",\n  part_humidity: "Luftfeuchte",\n  part_mode: "Modus",\n  part_power: "Ein/Aus",\n  part_boost: "Boost",\n  part_speed: "Stufe, Drehzahl",\n  part_lock: "Schloss (auf/zu)",\n  part_state: "Zustand",\n  part_play: "Wiedergabe (Taste)",\n  part_pause: "Pause (Taste)",\n  part_next: "Weiter (Taste)",\n  part_prev: "Zurück (Taste)",\n  part_volume: "Lautstärke (setzen)",\n  part_volume_actual: "Lautstärke (Ist)",\n  part_volume_up: "Lauter (Taste)",\n  part_volume_down: "Leiser (Taste)",\n  part_mute: "Stumm",\n  part_title: "Titel",\n  part_artist: "Interpret",\n  part_album: "Album",\n  part_cover: "Cover-Bild",\n  part_duration: "Dauer",\n  part_elapsed: "Gespielt",\n  part_app: "App (YouTube …)",\n  part_input: "Eingang (HDMI …)",\n  device_reach_hint: "Gilt für das ganze Gerät, auch seine anderen Datenpunkte. Batteriegeräte schlafen zwischen zwei Meldungen: „Nach … Minuten“ mit etwas mehr als ihrem Sendeabstand. Geräte am Bordnetz, die mit ihm abgeschaltet werden: „Nie“ – dann zählt auch ein getrennter Adapter nicht. Die Batterie sucht zuerst der type-detector, sonst Name und Rolle; findet keiner die richtige, wähle sie hier (eine Zahl: Ladung in %, true/false: Batterie schwach).",',
            'datapoint de',
        );
        code = replaceRequired(
            code,
            '  marker_height: "Marker height (m)",',
            '  marker_height: "Marker height (m)",\n  datapoint: "Datapoint",\n  datapoint_change: "Change …",\n  datapoint_add: "+ Datapoint from ioBroker",\n  device_reach: "Unreachable (Technik)",\n  device_reach_house: "Default (⚙ Weather & warnings)",\n  device_reach_report: "As the device reports",\n  device_reach_minutes: "After … minutes without an update",\n  device_reach_never: "Never (e.g. a 12 V device that is switched off)",\n  device_reach_min: "Minutes without an update",\n  device_reach_connected: "Check only while its adapter is connected (e.g. NMEA: instruments off = normal)",\n  device_battery: "Battery (Health)",\n  device_battery_detector: "found by the type-detector",\n  device_battery_guess: "guessed by name and role",\n  device_battery_own: "chosen here",\n  device_battery_missing: "none found",\n  device_battery_none: "no battery",\n  device_battery_pick: "Choose …",\n  device_battery_no: "No battery",\n  device_battery_auto: "Automatic",\n  device_kind: "Device type",\n  kind_light: "Light",\n  kind_switch: "Switch",\n  kind_cover: "Blind, shutter, awning",\n  kind_climate: "Heating, air conditioning",\n  kind_fan: "Fan",\n  kind_lock: "Lock",\n  kind_media_player: "Media (TV, speaker)",\n  kind_sensor: "Sensor (value)",\n  kind_binary_sensor: "Binary sensor (on/off)",\n  device_parts: "Datapoints of the device",\n  device_parts_more: "More parts ({n})",\n  device_parts_hint: "Each part is a datapoint. “Choose …” opens the objects of ioBroker. What is missing the 3D view does not offer: no colour, no colour picker; no colour temperature, no white tone. Another device type looks for its parts beside the datapoint.",\n  part_none: "not set",\n  part_pick: "Choose …",\n  part_remove: "Remove part",\n  part_switch: "Switch (on/off)",\n  part_brightness: "Brightness (dimmer)",\n  part_rgb: "Colour (#RRGGBB)",\n  part_red: "Red",\n  part_green: "Green",\n  part_blue: "Blue",\n  part_hue: "Hue",\n  part_saturation: "Saturation",\n  part_color_temp: "Colour temperature (white tone)",\n  part_position: "Position (set)",\n  part_position_actual: "Position (actual)",\n  part_open: "Open (button)",\n  part_close: "Close (button)",\n  part_stop: "Stop (button)",\n  part_tilt: "Slats (set)",\n  part_tilt_actual: "Slats (actual)",\n  part_target: "Target temperature",\n  part_current: "Current temperature",\n  part_humidity: "Humidity",\n  part_mode: "Mode",\n  part_power: "On/off",\n  part_boost: "Boost",\n  part_speed: "Speed, level",\n  part_lock: "Lock (open/locked)",\n  part_state: "State",\n  part_play: "Play (button)",\n  part_pause: "Pause (button)",\n  part_next: "Next (button)",\n  part_prev: "Previous (button)",\n  part_volume: "Volume (set)",\n  part_volume_actual: "Volume (actual)",\n  part_volume_up: "Louder (button)",\n  part_volume_down: "Quieter (button)",\n  part_mute: "Mute",\n  part_title: "Title",\n  part_artist: "Artist",\n  part_album: "Album",\n  part_cover: "Cover picture",\n  part_duration: "Duration",\n  part_elapsed: "Played",\n  part_app: "App (YouTube …)",\n  part_input: "Input (HDMI …)",\n  device_reach_hint: "Counts for the whole device, also its other datapoints. Battery devices sleep between their reports: after … minutes with a little more than their interval. Devices on the on-board supply that are switched off with it: never – then a disconnected adapter does not count either.",',
            'datapoint en',
        );
    }
    return code;
}

/**
 * A long press on a media player opens its quick menu, as on a light: play, volume and its sources (a TV's apps and
 * inputs: YouTube, Netflix, HDMI 1 …, frontend/media.ts). Upstream the menu can show them but opened the details only.
 */
function mediaMenu(name: string, code: string): string {
    if (name !== 'components/view3d.ts') {
        return code;
    }
    return replaceRequired(
        code,
        '    if (kind === "light" || kind === "cover" || kind === "switch" || kind === "fan" || kind === "lock" || kind === "camera") this._menu = { entity: entityId, x, y };\n    else openMoreInfo(this, entityId);',
        '    if (kind === "light" || kind === "cover" || kind === "switch" || kind === "fan" || kind === "lock" || kind === "camera" || (kind === "media" && hasFeature("sound"))) this._menu = { entity: entityId, x, y };\n    else openMoreInfo(this, entityId);',
        'quick menu of a media player',
    );
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
  /** A look over the whole picture: inked outlines, painted or a warm diorama. */
  post?: "toon" | "gouache" | "cozy";
  /** Walls of vertical boards with a skirting board (0–1, natural materials). */
  walls?: number;
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
  { id: "hygge", base: "day", group: "homely", natural: true, signal: true, shadows: true, floors: 1, walls: 1, sun: 0.35, ao: 0.5, saturate: 0.05, line: "#a08462", post: "cozy", bg: ["#bcb184", "#a3986b"], aliases: ["hygge", "diorama", "kuschelig", "spielzeughaus", "isometrisch", "cosy", "dollhouse diorama"] },
];`,
            'own styles',
        );
    }
    if (name === 'i18n.ts') {
        code = replaceRequired(
            code,
            '  style_warm: "Warm / Holz & Papier",',
            '  style_warm: "Warm / Holz & Papier",\n  style_dollhouse: "Puppenhaus",\n  style_comic: "Comic",\n  style_gouache: "Gouache",\n  style_hygge: "Hygge (Diorama)",',
            'style names de',
        );
        code = replaceRequired(
            code,
            '  style_warm: "Warm / Wood & paper",',
            '  style_warm: "Warm / Wood & paper",\n  style_dollhouse: "Dollhouse",\n  style_comic: "Comic",\n  style_gouache: "Gouache",\n  style_hygge: "Hygge (diorama)",',
            'style names en',
        );
        // the energy view and the household are part of the adapter, not Pro add-ons; nothing is "Pro" here
        code = code
            .replace('Was Energie und Energie Pro brauchen.', 'Was die Energie-Ansicht braucht.')
            .replace('What energy and Energy Pro need.', 'What the energy view needs.')
            .replaceAll(/ \((Energie|Energy|Haushalt|Household) Pro\)/g, '')
            .replaceAll(/ \(Pro: [^)]*\)/g, '')
            .replaceAll(
                /"(Energie|Energy|Haushalt|Household) Pro: (\w)/g,
                (_, _name: string, c: string) => `"${c.toUpperCase()}`,
            )
            .replaceAll(/(Energie|Energy|Haushalt|Household|Auto|Car|Pool) Pro\b/g, '$1');
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
      cc *= fp3dK * fp3dStyleFloor(cc, n);
      #ifdef FP3D_WALL
      // Hygge: walls of vertical boards with a skirting board
      if (vFp3dWall > 0.5) cc *= fp3dStyleWall(n);
      #endif`,
            'style toon light',
        );
        // the wall boards (frontend/vendor-ext/hygge.ts): their own uniform, the wall mark per vertex, the GLSL
        code = `import { WALL_ATTRIBUTE as FP3D_WALL_ATTRIBUTE, WALL_GLSL as FP3D_WALL_GLSL } from "${root}/frontend/vendor-ext/hygge.ts";\n${code}`;
        code = replaceRequired(
            code,
            '    uStToon: { value: 0 },',
            '    uStToon: { value: 0 },\n    uStWalls: { value: 0 },',
            'style walls uniform',
        );
        code = replaceRequired(
            code,
            '  u.uStToon.value = s.natural ? (s.toon ?? 0) : 0;',
            '  u.uStToon.value = s.natural ? (s.toon ?? 0) : 0;\n  u.uStWalls.value = s.natural ? (s.walls ?? 0) : 0;',
            'style walls value',
        );
        code = replaceRequired(
            code,
            '#ifdef FP3D_LIT\nvarying float vFp3dLit;\n#endif\nfloat fp3dHash',
            '#ifdef FP3D_LIT\nvarying float vFp3dLit;\n#endif\n#ifdef FP3D_WALL\nvarying float vFp3dWall;\n#endif\nuniform float uStWalls;\nfloat fp3dHash',
            'style walls varying',
        );
        // Hygge: the planks of a wooden floor stay visible from further away, their joints at least a pixel wide
        code = replaceRequired(
            code,
            '  float fade = (1.0 - smoothstep(0.006, 0.04, fwidth(p.x) + fwidth(p.y))) * uStFloors;',
            '  float fp3dFw = fwidth(p.x) + fwidth(p.y);\n  float fade = (1.0 - (uStWalls > 0.0 ? smoothstep(0.03, 0.07, fp3dFw) : smoothstep(0.006, 0.04, fp3dFw))) * uStFloors;\n  float fp3dSeam = uStWalls > 0.0 ? max(0.006, fp3dFw * 0.6) : 0.006;',
            'hygge floor fade',
        );
        code = replaceRequired(
            code,
            '    float seam = smoothstep(0.0, 0.006, min(fx, w - fx)) * smoothstep(0.0, 0.006, min(fz, L - fz));',
            '    float seam = smoothstep(0.0, fp3dSeam, min(fx, w - fx)) * smoothstep(0.0, fp3dSeam, min(fz, L - fz));',
            'hygge floor seams',
        );
        code = replaceRequired(
            code,
            'vec3 fp3dThemed(vec3 c, bool line, bool accent) {',
            '${FP3D_WALL_GLSL}\nvec3 fp3dThemed(vec3 c, bool line, bool accent) {',
            'style walls function',
        );
        code = replaceRequired(
            code,
            'attribute float ${LIT_ATTRIBUTE};\\nvarying float vFp3dLit;\\n#endif`)',
            'attribute float ${LIT_ATTRIBUTE};\\nvarying float vFp3dLit;\\n#endif\\n#ifdef FP3D_WALL\\nattribute float ${FP3D_WALL_ATTRIBUTE};\\nvarying float vFp3dWall;\\n#endif`)',
            'style walls vertex attribute',
        );
        code = replaceRequired(
            code,
            'vFp3dLit = ${LIT_ATTRIBUTE};\\n#endif`',
            'vFp3dLit = ${LIT_ATTRIBUTE};\\n#endif\\n#ifdef FP3D_WALL\\nvFp3dWall = ${FP3D_WALL_ATTRIBUTE};\\n#endif`',
            'style walls vertex varying',
        );
    }
    if (name === 'viewer/build.ts') {
        // Hygge: the walls are marked, so only they get boards, not the furniture in the same buffer
        code = `import { markWalls as fp3dMarkWalls } from "${root}/frontend/vendor-ext/hygge.ts";\n${code}`;
        code = replaceRequired(
            code,
            '  pushOutdoor(wallBuf, lines, floor, waterBuf);',
            '  const fp3dWallTris = wallBuf.count;\n  pushOutdoor(wallBuf, lines, floor, waterBuf);',
            'walls marked: count',
        );
        code = replaceRequired(
            code,
            '    walls: wallBuf.geometry(),',
            '    walls: fp3dMarkWalls(wallBuf.geometry(), fp3dWallTris),',
            'walls marked: attribute',
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
        // Hygge: the wall material reads the wall mark of build.ts (boards only on walls, not on furniture)
        code = replaceRequired(
            code,
            '      wall: themed(makeFoldable(new MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), mask, "solid"), this.themeUniform),',
            '      wall: Object.assign(themed(makeFoldable(new MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), mask, "solid"), this.themeUniform), { defines: { FP3D_WALL: "" } }),',
            'walls marked: material',
        );
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
            code = replaceMethod(code, 'private renderGift()', 'return nothing;', 'gift');
            code = replaceMethod(code, 'private renderExtensions()', 'return nothing;', 'extensions page');
        }
        if (name === 'components/editor.ts') {
            code = replaceRequired(
                code,
                /private renderHelpLinks\(\) \{[\s\S]*?\n {2}\}/,
                'private renderHelpLinks() { return html`<section class="fp3d-help"><h3>ioBroker</h3><p class="fp3d-sub">Geräte über den Objektbaum auswählen. Die Zuordnung verwendet deine ioBroker-Datenpunkt-IDs.</p><a class="fp3d-btn" href="help.html" target="_blank">Hilfe & Bedienung</a></section>`; }',
                'help',
            );
            code = replaceMethod(code, 'private renderProCard()', 'return nothing;', 'pro teaser');
        }
        code = looks(name, code);
        code = unlockServed(name, code);
        code = proButtons(name, code);
        code = noShop(name, code);
        code = keepUndoHistory(name, code);
        code = keepEditorView(name, code);
        code = tvAppLogo(name, code);
        code = wheelOverLabels(name, code);
        code = panHint(name, code);
        code = cameraBeam(name, code);
        code = cameraSize(name, code);
        code = sensorLook(name, code);
        code = editorDevices(name, code);
        code = markerLooks(name, code);
        code = solarText(name, code);
        code = sunArcFloor(name, code);
        code = keepFloor(name, code);
        code = deviceDatapoint(name, code);
        code = mediaMenu(name, code);
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
        code = groundFill(name, code);
        code = balconyRails(name, code);
        code = stairFlights(name, code);
        code = bgStretch(name, code);
        code = houseItems(name, code);
        code = areaHeights(name, code);
        code = outlineGaps(name, code);
        code = roomLevels(name, code);
        code = gardenWalls(name, code);
        code = roofCuts(name, code);
        code = gableGlass(name, code);
        code = kitchenMore(name, code);
        code = rainTankMore(name, code);
        code = serverMore(name, code);
        code = tapMore(name, code);
        code = passThroughMore(name, code);
        code = mjpegStreams(name, code);
        code = snowMore(name, code);
        code = mailFlagMore(name, code);
        code = binsMore(name, code);
        code = heatPumpMore(name, code);
        code = ebikeMore(name, code);
        code = heatStoreMore(name, code);
        code = airVentMore(name, code);
        code = poolMore(name, code);
        code = robotMore(name, code);
        code = mediaMore(name, code);
        code = cardModes(name, code);
        code = roundCardButtons(name, code);
        code = oneBar(name, code);
        code = boatPictures(name, code);
        code = gasBottle(name, code);
        code = parkingTimeTravel(name, code);
        code = fixedDialogHeads(name, code);
        code = noLocate(name, code);
        code = showFromIoBroker(name, code);
        code = assistantVoice(name, code);
        code = deviceRowsFit(name, code);
        code = findDevice(name, code);
        code = mediaMute(name, code);
        code = ownModels(name, code);
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
        if (name === 'voice/mic-probe.ts') {
            // the microphone test has its own texts
            code = assistantName(code);
        }
        if (name === 'i18n.ts') {
            code = assistantName(code);
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
                'return hass.callWS({ type: "home3d/backup/import", building, packs, mappings: (backup as { mappings?: unknown }).mappings, models: (backup as { models?: unknown }).models,',
                'backup mappings and models',
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
        await writeFile(
            target,
            assistantName(localLinks(await readFile(target, 'utf8')).replaceAll('Home Assistant', 'ioBroker')),
        );
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
