// Local demo of the built page without ioBroker: serves www/ like the web adapter under /home3d/ and a simulated
// socket with demo devices as /lib/js/socket.io.js. Run `npm run build` first.
// Usage: `npm run demo` or `npm run demo -- artifacts/demo-house-0.2.0.json`. For development with hot reload: `npm run dev`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { DEMO_INFO, demoSocketScript } from './demo-data';

const www = join(resolve(__dirname, '..'), 'www');
const PORT = Number(process.env.DEMO_PORT) || 8099;
const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css',
    '.json': 'application/json',
    '.map': 'application/json',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
};

async function main(): Promise<void> {
    const socketJs = await demoSocketScript(process.argv[2]);
    createServer((req, res) => {
        void (async () => {
            const url = new URL(req.url || '/', 'http://localhost');
            if (url.pathname === '/' || url.pathname === '/home3d' || url.pathname === '/home3d/') {
                res.writeHead(302, { Location: '/home3d/index.html' }).end();
                return;
            }
            if (url.pathname === '/lib/js/socket.io.js') {
                res.writeHead(200, { 'Content-Type': MIME['.js'] }).end(socketJs);
                return;
            }
            if (url.pathname === '/home3d/_socket/info.js') {
                res.writeHead(200, { 'Content-Type': MIME['.js'] }).end(DEMO_INFO);
                return;
            }
            const file = resolve(www, `.${decodeURIComponent(url.pathname.replace(/^\/home3d/, ''))}`);
            if (!url.pathname.startsWith('/home3d/') || !file.startsWith(www + sep)) {
                res.writeHead(404).end();
                return;
            }
            try {
                const content = await readFile(file);
                res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
                res.end(content);
            } catch {
                res.writeHead(404).end();
            }
        })();
    }).listen(PORT, '127.0.0.1', () =>
        console.log(`Demo (simulated devices only): http://127.0.0.1:${PORT}/home3d/index.html`),
    );
}
main().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
