// Data and socket of the local demo (simulated devices, no ioBroker): used by `npm run demo` (scripts/demo.ts, serves
// the built www/) and by `npm run dev` (vite.config.ts, the Vite dev server). Not part of the adapter package.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { Building, Mapping, RoomObject, StateObject } from '../frontend/model';
import type { DemoHouse } from './demo-types';
import { discover } from '../frontend/entities';
import { empty } from '../frontend/store';

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

export async function demoData(file?: string): Promise<string> {
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
    // the instance's own states (home3d.0.show, home3d.0.places) as the install creates them
    const pkg = JSON.parse(await readFile(resolve('io-package.json'), 'utf8')) as {
        instanceObjects: { _id: string; type: string; common: unknown; native: unknown }[];
    };
    const own = Object.fromEntries(
        pkg.instanceObjects
            .filter(o => o._id)
            .map(o => [`home3d.0.${o._id}`, { type: o.type, common: o.common, native: o.native }]),
    );
    return JSON.stringify({
        objects: {
            ...house.objects,
            ...own,
            'system.config': { type: 'config', common: { language: process.env.DEMO_LANG || 'de' }, native: {} },
            'home3d.0': { type: 'meta', common: { name: '3D Home', type: 'meta.user' }, native: {} },
        },
        states: Object.fromEntries(Object.entries(house.values).map(([id, val]) => [id, { val }])),
        files: { 'home3d.0/data.json': Buffer.from(JSON.stringify(data)).toString('base64') },
    });
}


/** The simulated socket as a classic script, served as `/lib/js/socket.io.js` like the one of the web adapter. */
export async function demoSocketScript(file?: string): Promise<string> {
    const out = await build({
        configFile: false,
        logLevel: 'warn',
        publicDir: false,
        define: { __DEMO__: await demoData(file) },
        build: {
            write: false,
            minify: false,
            target: ['chrome94', 'safari15'],
            lib: { entry: resolve(__dirname, 'demo-socket.ts'), formats: ['iife'], name: 'home3dDemoSocket' },
        },
    });
    const result = Array.isArray(out) ? out[0] : out;
    if (!('output' in result)) {
        throw new Error('demo socket: no output');
    }
    return result.output[0].type === 'chunk' ? result.output[0].code : '';
}

/** What `_socket/info.js` of the web adapter sets. */
export const DEMO_INFO = 'var socketUrl = ""; var socketSession = ""; var sysLang = "de";';
