// Vite: our page in frontend/ (index.html, the connection to ioBroker, the dialogs with React and
// @iobroker/gui-components) -> www/. The 3D frontend is built on its own into www/vendor/ (tasks.ts) and loaded at
// runtime as ./vendor/home3d.js, so it stays outside this bundle.
//   npm run build   everything (tasks.ts uses this config for the page)
//   npm run dev     dev server with hot reload and the simulated socket of the demo (scripts/dev.ts)
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { DEMO_INFO, demoSocketScript } from './scripts/demo-data';

const root = __dirname;
const version: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const VENDOR = /^\.\/vendor\/home3d[\w-]*\.js$/;

/** `./vendor/home3d.js` is the 3D frontend, loaded next to bridge.js at runtime: not part of this bundle. */
const vendor: Plugin = {
    name: 'home3d-vendor',
    enforce: 'pre',
    resolveId(source, _importer, options) {
        if (!VENDOR.test(source)) {
            return null;
        }
        if (this.environment?.mode !== 'dev' || options?.ssr) {
            return { id: source, external: true };
        }
        // dev server: the built bundles in www/vendor (they load their siblings, lang/ and assets/ relatively)
        const file = join(root, 'www', source);
        if (!existsSync(file)) {
            this.error(`Missing ${file}: run \`npm run build-vendor\` first.`);
        }
        return file;
    },
};

/** dev server: the simulated socket of the demo instead of the socket of the web adapter. */
const demoSocket: Plugin = {
    name: 'home3d-demo-socket',
    apply: 'serve',
    async configureServer(server) {
        const socketJs = await demoSocketScript(process.env.HOME3D_DEMO);
        server.middlewares.use((req, res, next) => {
            const path = (req.url || '').split('?')[0];
            if (path === '/lib/js/socket.io.js' || path === '/_socket/info.js') {
                res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
                res.end(path === '/_socket/info.js' ? DEMO_INFO : socketJs);
                return;
            }
            next();
        });
    },
};

export default defineConfig({
    root: join(root, 'frontend'),
    // web serves the page under /home3d/, possibly behind a proxy: only relative links
    base: './',
    publicDir: join(root, 'frontend/public'),
    plugins: [vendor, demoSocket, react({})],
    define: { __HOME3D_VERSION__: JSON.stringify(version) },
    // FileViewer of @iobroker/gui-components imports Buffer
    resolve: { alias: { buffer: 'buffer/' } },
    build: {
        outDir: join(root, 'www'),
        emptyOutDir: false,
        target: ['safari15', 'chrome94'],
        // www/assets holds our pictures (public/assets)
        assetsDir: 'chunks',
        // every target browser loads modules on its own; the polyfill is not needed
        modulePreload: { polyfill: false },
        // no source maps in the package (the React chunk alone would add 4 MB); `npm run dev` has them
        sourcemap: false,
        // licenses of everything bundled into the page (React, MUI, @iobroker/gui-components, socket-client, …)
        license: { fileName: 'licenses/page-licenses.md' },
        chunkSizeWarningLimit: 3000,
        reportCompressedSize: false,
        rolldownOptions: {
            output: {
                // a fixed name: the tests and the package check look for it
                entryFileNames: 'bridge.js',
                chunkFileNames: 'chunks/[name]-[hash].js',
            },
        },
    },
    server: { port: Number(process.env.DEMO_PORT) || 8099, host: '127.0.0.1', strictPort: true },
});
