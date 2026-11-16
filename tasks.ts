/*!
 * ioBroker build tasks of home3d (Vite).
 *
 * The adapter has no backend: everything runs in the browser and is served by the web adapter from www/, which is
 * generated completely:
 *   npm run build          builds everything
 *   npm run build-app      only our page from frontend/ (vite.config.ts)   -> www/index.html, www/bridge.js, www/chunks/
 *   npm run build-vendor   only the 3D frontend from vendor-src/home3d/src  -> www/vendor/home3d*.js
 */
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build, type Plugin } from 'vite';

// The package is CommonJS (tests, scripts): Vite bundles its config, the native config loader is not used.
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true';

const posix = (p: string): string => p.replaceAll('\\', '/');
const root = posix(__dirname);
const src = `${root}/vendor-src/home3d/src`;
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
