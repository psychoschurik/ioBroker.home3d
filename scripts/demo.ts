// Local demo without ioBroker: serves www/ like the web adapter under /home3d/ and a simulated socket with demo
// devices as /lib/js/socket.io.js. Usage: `npm run demo` or `npm run demo -- artifacts/demo-house-0.2.0.json`.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { Building, Mapping, RoomObject, StateObject } from '../frontend/model';
import type { DemoHouse } from './demo-types';
import { discover } from '../frontend/entities';
import { empty } from '../frontend/store';

const root = resolve(__dirname, '..');
const www = join(root, 'www');
const PORT = Number(process.env.DEMO_PORT) || 8099;
const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
};

function smallHouse(): { objects: Record<string, StateObject>; building: Building; mappings: Mapping[]; values: Record<string, unknown> } {
    const objects: Record<string, StateObject> = {
        '0_userdata.0.demo.light': {
            _id: '0_userdata.0.demo.light',
            type: 'state',
            common: { name: 'Wohnzimmer Licht', type: 'boolean', role: 'switch.light', read: true, write: true },
        },
        '0_userdata.0.demo.temperature': {
            _id: '0_userdata.0.demo.temperature',
            type: 'state',
            common: { name: 'Wohnzimmer Temperatur', type: 'number', role: 'value.temperature', unit: '°C', read: true, write: false },
        },
    };
    const rooms: Record<string, RoomObject> = {
        'enum.rooms.living': {
            _id: 'enum.rooms.living',
            common: { name: 'Wohnzimmer', members: Object.keys(objects) },
        },
    };
    const building = empty();
    building.floors = [
        {
            id: 'eg',
            name: 'Erdgeschoss',
            elevation: 0,
            height: 2.6,
            cut_height: 1.2,
            rooms: [
                { id: 'living', name: 'Wohnzimmer', area_id: 'enum.rooms.living', points: [[0, 0], [6, 0], [6, 4], [0, 4]], floor_material: 'wood' },
                { id: 'kitchen', name: 'Küche', area_id: null, points: [[6, 0], [10, 0], [10, 4], [6, 4]], floor_material: 'tiles' },
            ],
            openings: [],
            furniture: [],
            placements: [],
            background: null,
            outdoor: [],
            walls: [],
            ha_floor: null,
        },
    ];
    const mappings = discover(objects, rooms).map(({ _meta, ...m }) => m);
    return {
        objects: { ...objects, ...rooms } as Record<string, StateObject>,
        building,
        mappings,
        values: { '0_userdata.0.demo.light': true, '0_userdata.0.demo.temperature': 21.6 },
    };
}

async function demoData(file?: string): Promise<string> {
    let house = smallHouse();
    if (file) {
        const demo = JSON.parse(await readFile(resolve(file), 'utf8')) as DemoHouse;
        house = {
            objects: Object.fromEntries(
                demo.definitions.map(({ id, def, ...common }) => [id, { _id: id, type: 'state', common }]),
            ) as Record<string, StateObject>,
            building: demo.building,
            mappings: demo.mappings,
            values: Object.fromEntries(demo.definitions.map(d => [d.id, d.def])),
        };
    }
    const data = {
        version: 2,
        plans: {
            main: { id: 'main', name: 'Demo', icon: null, site: null, created: Date.now() / 1000, revision: 1, building: house.building },
        },
        images: {},
        mappings: house.mappings,
        locate_plan: 'main',
    };
    return JSON.stringify({
        objects: {
            ...house.objects,
            'system.config': { type: 'config', common: { language: 'de' }, native: {} },
            'home3d.0': { type: 'meta', common: { name: '3D Home', type: 'meta.user' }, native: {} },
        },
        states: Object.fromEntries(Object.entries(house.values).map(([id, val]) => [id, { val }])),
        files: { 'home3d.0/data.json': Buffer.from(JSON.stringify(data)).toString('base64') },
    });
}

async function main(): Promise<void> {
    const socket = await build({
        entryPoints: [join(__dirname, 'demo-socket.ts')],
        bundle: true,
        write: false,
        format: 'iife',
        target: ['chrome94', 'safari15'],
        define: { __DEMO__: await demoData(process.argv[2]) },
    });
    const socketJs = socket.outputFiles[0].text;
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
                res.writeHead(200, { 'Content-Type': MIME['.js'] }).end('var socketUrl = ""; var socketSession = ""; var sysLang = "de";');
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
