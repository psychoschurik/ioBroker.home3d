/*!
 * ioBroker build tasks of home3d.
 *
 * The adapter has no backend: everything runs in the browser and is served by the web adapter from www/.
 *   npm run build          builds everything
 *   npm run build-vendor   only the 3D frontend from vendor-src/home3d/src  -> www/vendor/home3d*.js
 *   npm run build-bridge   only the ioBroker connection from frontend/        -> www/bridge.js
 */
import { build, type Plugin } from 'esbuild';
import { readFileSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const root = __dirname;
const src = join(root, 'vendor-src/home3d/src');
const version: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const TARGET = ['safari15', 'chrome94'];

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

/** Applies the ioBroker theme and removes the shop, help and community parts of the upstream frontend. */
const patches: Plugin = {
    name: 'iobroker-ui',
    setup(builder) {
        builder.onLoad({ filter: /\.ts$/ }, async ({ path: file }) => {
            if (!file.startsWith(src)) {
                return undefined;
            }
            let code = await readFile(file, 'utf8');
            const name = relative(src, file).replaceAll('\\', '/');
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
                code = code.replaceAll('./images/solar-pro.jpg', 'assets/connected-home.svg');
            }
            // Only human-readable names are changed, never protocol IDs.
            code = localLinks(code).replaceAll('Home Assistant', 'ioBroker');
            return { contents: code, loader: 'ts', resolveDir: dirname(file) };
        });
    },
};

/** The 3D frontend: 8 bundles that load each other relative to import.meta.url. */
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
    for (const [out, entry] of Object.entries(entries)) {
        await build({
            entryPoints: [join(src, entry)],
            outfile: join(root, `www/vendor/${out}.js`),
            bundle: true,
            format: 'esm',
            target: TARGET,
            minify: true,
            legalComments: 'none',
            define,
            plugins: [patches],
            nodePaths: [join(root, 'node_modules')],
            logLevel: 'warning',
        });
    }
    const lang = join(root, 'www/vendor/lang');
    for (const file of await readdir(lang)) {
        const target = join(lang, file);
        await writeFile(target, localLinks(await readFile(target, 'utf8')).replaceAll('Home Assistant', 'ioBroker'));
    }
    // The shop illustration of upstream is replaced by our own SVG and is not shipped.
    await rm(join(root, 'www/vendor/images/solar-pro.jpg'), { force: true });
    console.log(`3D frontend ${version}: ${Object.keys(entries).length} bundles built.`);
}

/** The connection to ioBroker (socket of the web adapter, storage, device dialog) with `@iobroker/socket-client`. */
async function buildBridge(): Promise<void> {
    await build({
        entryPoints: [join(root, 'frontend/bridge.ts')],
        outfile: join(root, 'www/bridge.js'),
        bundle: true,
        format: 'esm',
        target: TARGET,
        minify: true,
        sourcemap: true,
        // loaded at runtime from www/vendor/, built by buildVendor()
        external: ['./vendor/*'],
        define: { __HOME3D_VERSION__: JSON.stringify(version) },
        logLevel: 'warning',
    });
    console.log(`ioBroker connection ${version}: www/bridge.js built.`);
}

async function main(): Promise<void> {
    if (process.argv.includes('--vendor')) {
        await buildVendor();
    } else if (process.argv.includes('--bridge')) {
        await buildBridge();
    } else {
        await buildVendor();
        await buildBridge();
    }
}

main().catch((e: unknown) => {
    console.error(`Cannot build: ${(e as Error).message}`);
    process.exit(1);
});
