// Development of the page with hot reload: the Vite dev server (vite.config.ts) with the simulated socket of the demo.
// The 3D frontend comes from www/vendor and is built first when it is missing.
// Usage: `npm run dev` or `npm run dev -- artifacts/demo-house.json` (a house for the demo, like `npm run demo`).
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// The package is CommonJS (tests, scripts): Vite bundles its config, the native config loader is not used.
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true';
const root = resolve(__dirname, '..');
if (process.argv[2]) {
    process.env.HOME3D_DEMO = resolve(process.argv[2]);
}

async function main(): Promise<void> {
    if (!existsSync(join(root, 'www/vendor/home3d.js'))) {
        console.log('www/vendor is missing: building the 3D frontend first …');
        execFileSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), 'tasks.ts', '--vendor'], {
            cwd: root,
            stdio: 'inherit',
        });
    }
    const { createServer } = await import('vite');
    const server = await createServer({ configFile: join(root, 'vite.config.ts') });
    await server.listen();
    server.printUrls();
    console.log('Simulated devices only (no ioBroker). The page reloads on every change in frontend/.');
}
main().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
