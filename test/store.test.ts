import type { FileAccess, IoAccess, StateObject } from '../frontend/model';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, empty, mappedIds } from '../frontend/store';
import { entities, execute, validateMappings } from '../frontend/entities';

const objects: Record<string, StateObject> = {
    'lamp.power': { type: 'state', common: { type: 'boolean', write: true } },
    'lamp.dim': {
        type: 'state',
        common: { type: 'number', min: 0, max: 100, write: true },
    },
    'sensor.temp': { type: 'state', common: { type: 'number', write: false } },
};
const mapping = {
    entity_id: 'light.living',
    state: 'lamp.power',
    actions: {
        turn_on: [
            { id: 'lamp.power', value: true },
            { id: 'lamp.dim', field: 'brightness', scale: 100 / 255, optional: true },
        ],
        turn_off: [{ id: 'lamp.power', value: false }],
    },
};
/** File storage of home3d.0 in memory, like the socket of the web adapter offers it. */
function memoryFiles(fail?: () => void): FileAccess & { files: Map<string, Uint8Array> } {
    const files = new Map<string, Uint8Array>();
    return {
        files,
        readText: async name => (files.has(name) ? new TextDecoder().decode(files.get(name)) : null),
        writeText: async (name, text) => {
            fail?.();
            files.set(name, new TextEncoder().encode(text));
        },
        readDataUrl: async name => {
            const b = files.get(name);
            return b ? `data:image/png;base64,${Buffer.from(b).toString('base64')}` : null;
        },
        writeBinary: async (name, bytes) => {
            fail?.();
            files.set(name, bytes);
        },
        remove: async name => {
            files.delete(name);
        },
    };
}
async function fixture(fail?: () => void, legacy?: string) {
    const writes: [string, unknown][] = [];
    const io: IoAccess = {
        getObjects: async ids => Object.fromEntries(ids.filter(id => objects[id]).map(id => [id, objects[id]])),
        stateObjects: async () => objects,
        rooms: async () => ({}),
        getState: async () => ({ val: false }),
        setState: async (id, value) => writes.push([id, value]),
    };
    const files = memoryFiles();
    const store = new Store(io, files, legacy ? async () => legacy : undefined);
    await store.load();
    if (fail) {
        const failing = memoryFiles(fail);
        failing.files.clear();
        for (const [k, v] of files.files) {
            failing.files.set(k, v);
        }
        store.files = failing;
    }
    return { store, io, writes, files };
}

test('first start writes data.json with the main plan', async () => {
    const { files } = await fixture();
    const data = JSON.parse(new TextDecoder().decode(files.files.get('data.json')));
    assert.equal(data.version, 2);
    assert.equal(data.plans.main.revision, 0);
});
test('read-only (the user may not write the project): reads work, every change is refused, nothing is written', async () => {
    const { store, files } = await fixture();
    const before = new Map(files.files);
    store.readOnly = true;
    const got = await store.call({ type: 'home3d/building/get' });
    assert.equal(got.revision, 0);
    await assert.rejects(
        store.call({ type: 'home3d/building/save', base_revision: 0, building: empty() }),
        (e: Error & { code?: string }) => e.code === 'read_only' && /Nur ansehen/.test(e.message),
    );
    await assert.rejects(store.call({ type: 'iobroker/mappings/set', mappings: [] }), /Nur ansehen/);
    await assert.rejects(store.call({ type: 'home3d/history/snapshot' }), /Nur ansehen/);
    assert.deepEqual(files.files, before);
    // no data.json yet: shown empty, not created
    const empty2 = new Store(store.io, memoryFiles());
    empty2.readOnly = true;
    await empty2.load();
    assert.equal((empty2.files as ReturnType<typeof memoryFiles>).files.size, 0);
    assert.ok(empty2.data.plans.main);
});
test('unreachable after minutes without an update: saved for all plans, checked, cleared', async () => {
    const { store, files } = await fixture();
    const saved = (): unknown => JSON.parse(new TextDecoder().decode(files.files.get('data.json'))).health_stale_min;
    await store.call({ type: 'iobroker/health/set', minutes: 15 });
    assert.equal(store.data.health_stale_min, 15);
    assert.equal(saved(), 15);
    await assert.rejects(store.call({ type: 'iobroker/health/set', minutes: 0 }), /1 bis 10080/);
    await assert.rejects(store.call({ type: 'iobroker/health/set', minutes: 'x' }), /1 bis 10080/);
    assert.equal(store.data.health_stale_min, 15);
    await store.call({ type: 'iobroker/health/set', minutes: null });
    assert.equal(store.data.health_stale_min, null);
    assert.equal(saved(), null);
});

test('concurrent saves: stale revision cannot overwrite a newer floor plan', async () => {
    const { store } = await fixture();
    const b = empty();
    b.settings.north = 42;
    const results = await Promise.allSettled([
        store.call({ type: 'home3d/building/save', base_revision: 0, building: b }),
        store.call({ type: 'home3d/building/save', base_revision: 0, building: empty() }),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    if (results[1].status === 'rejected') {
        assert.equal(results[1].reason.code, 'stale_plan');
    }
    assert.equal(store.data.plans.main.building.settings.north, 42);
});
test('a save of another browser is taken over and reported', async () => {
    const { store, files } = await fixture();
    const events: [string, unknown][] = [];
    store.onEvent((type, payload) => events.push([type, payload]));
    const other = JSON.parse(new TextDecoder().decode(files.files.get('data.json')));
    other.plans.main.revision = 5;
    other.plans.main.building.settings.north = 7;
    files.files.set('data.json', new TextEncoder().encode(JSON.stringify(other)));
    await store.sync();
    assert.equal(store.data.plans.main.building.settings.north, 7);
    assert.deepEqual(events, [['home3d/building/subscribe', { plan: 'main', revision: 5 }]]);
    // a save based on the old revision is stale now
    await assert.rejects(
        store.call({ type: 'home3d/building/save', base_revision: 0, building: empty() }),
        /anderswo gespeichert/,
    );
});
test('persistence failure rolls back revisions and sends no events', async () => {
    const { store } = await fixture(() => {
        throw Error('disk full');
    });
    const events: string[] = [];
    store.onEvent(type => events.push(type));
    await assert.rejects(store.call({ type: 'home3d/building/save', building: empty() }), /disk full/);
    assert.equal(store.data.plans.main.revision, 0);
    assert.deepEqual(events, []);
});
test('snapshots are kept in history/<plan>.json and restore previous content', async () => {
    const { store, files } = await fixture();
    await store.call({ type: 'home3d/history/snapshot' });
    assert.ok(files.files.has('history/main.json'));
    const b = empty();
    b.settings.north = 90;
    await store.call({ type: 'home3d/building/save', building: b });
    const { snapshots } = await store.call({ type: 'home3d/history/list' });
    await store.call({ type: 'home3d/history/restore', snapshot_id: snapshots[0].id });
    assert.equal(store.data.plans.main.building.settings.north, 0);
    assert.equal(store.data.plans.main.revision, 2);
});
test('images are stored as files and read back as data URL', async () => {
    const { store, files } = await fixture();
    const url = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
    await store.call({ type: 'home3d/image/set', image_id: 'floor 1', data: url });
    const name = store.data.images['floor 1'];
    assert.match(name, /^images\/x[0-9a-f]+\.png$/);
    assert.equal(new TextDecoder().decode(files.files.get(name)), 'png');
    assert.equal((await store.call({ type: 'home3d/image/get', image_id: 'floor 1' })).data, url);
    await assert.rejects(store.call({ type: 'home3d/image/set', image_id: 'x', data: 'data:text/html,<b>' }), /PNG/);
});
test('the storage state of 0.4.0 is migrated once', async () => {
    const legacy = {
        plans: {
            main: {
                id: 'main',
                name: 'Haus',
                icon: null,
                site: null,
                created: 1,
                revision: 3,
                building: empty(),
                snapshots: [{ id: 's', revision: 1, saved_at: 1, floors: 0, rooms: 0, furniture: 0, building: empty() }],
            },
        },
        images: { bg: `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}` },
        mappings: [mapping],
        locate_plan: 'main',
    };
    const { store, files } = await fixture(undefined, JSON.stringify(legacy));
    assert.equal(store.data.plans.main.revision, 3);
    assert.equal(store.data.mappings.length, 1);
    assert.ok(files.files.has('history/main.json'));
    assert.equal(store.data.images.bg, 'images/bg.jpg');
    assert.equal('snapshots' in store.data.plans.main, false);
});
test('plan copy, trash and restore preserve independent buildings', async () => {
    const { store } = await fixture();
    const { plan } = await store.call({ type: 'home3d/plans/create', copy_of: 'main', name: 'Garage' });
    await store.call({ type: 'home3d/plans/delete', plan });
    assert.equal(store.list().trash.length, 1);
    await store.call({ type: 'home3d/plans/restore', plan });
    assert.equal(store.list().plans.length, 2);
    assert.notEqual(store.data.plans.main.building, store.data.plans[plan].building);
});
test('mappings are validated against the objects of their datapoints only', async () => {
    const { store } = await fixture();
    assert.deepEqual(mappedIds([mapping]).sort(), ['lamp.dim', 'lamp.power']);
    assert.deepEqual(await store.call({ type: 'iobroker/mappings/set', mappings: [mapping] }), { saved: 1 });
    await assert.rejects(
        store.call({ type: 'iobroker/mappings/set', mappings: [{ ...mapping, state: 'missing.state' }] }),
        /Datenpunkt fehlt/,
    );
    assert.equal(store.data.mappings[0].state, 'lamp.power');
});
test('the own "unreachable" setting of a device is checked and given to its entity', async () => {
    const { store } = await fixture();
    for (const reach of ['report', 'never', 15] as const) {
        await store.call({ type: 'iobroker/mappings/set', mappings: [{ ...mapping, reach, reach_connected: true }] });
    }
    assert.equal(store.data.mappings[0].reach, 15);
    assert.equal(store.data.mappings[0].reach_connected, true);
    for (const reach of [0, 1.5, 20000, 'sometimes']) {
        await assert.rejects(
            store.call({ type: 'iobroker/mappings/set', mappings: [{ ...mapping, reach }] }),
            /nicht erreichbar/i,
        );
    }
    await assert.rejects(
        store.call({ type: 'iobroker/mappings/set', mappings: [{ ...mapping, reach_connected: 'yes' }] }),
        /reach_connected/,
    );
    const list = entities(store.data.mappings, { 'lamp.power': { val: true } } as never, {});
    assert.equal(list['light.living'].attributes.iobroker_reach, 15);
    assert.equal(list['light.living'].attributes.iobroker_reach_connected, true);
});
test('device actions scale brightness and reject out-of-range values before any write', async () => {
    const { io, writes } = await fixture();
    await execute([mapping], 'light', 'turn_on', { entity_id: mapping.entity_id, brightness: 127.5 }, io);
    assert.deepEqual(writes, [
        ['lamp.power', true],
        ['lamp.dim', 50],
    ]);
    writes.length = 0;
    await assert.rejects(
        execute([mapping], 'light', 'turn_on', { entity_id: mapping.entity_id, brightness: 500 }, io),
        /Bereich/,
    );
    assert.equal(writes.length, 0);
});
test('unmapped services, read-only states and wrong types are rejected', async () => {
    const { io } = await fixture();
    await assert.rejects(
        execute([mapping], 'light', 'explode', { entity_id: mapping.entity_id }, io),
        /nicht zugeordnet/,
    );
    assert.throws(
        () => validateMappings([{ ...mapping, actions: { x: [{ id: 'sensor.temp', value: 5 }] } }], objects),
        /nicht schreibbar/,
    );
    await assert.rejects(
        execute(
            [{ ...mapping, actions: { x: [{ id: 'lamp.power', value: 'true' }] } }],
            'light',
            'x',
            { entity_id: mapping.entity_id },
            io,
        ),
        /Werttyp/,
    );
});
test('state conversion preserves quality, units and scaled attributes', () => {
    const m = {
        ...mapping,
        attributes: {
            brightness: { id: 'lamp.dim', scale: 2.55 },
            unit_of_measurement: '%',
        },
    };
    const state = entities([m], { 'lamp.power': { val: true }, 'lamp.dim': { val: 100 } }, objects);
    assert.equal(state['light.living'].state, 'on');
    assert.ok(Math.abs(state['light.living'].attributes.brightness - 255) < 0.001);
    assert.equal(entities([m], {}, objects)['light.living'].state, 'unavailable');
});
test('malformed backup leaves existing plans unchanged', async () => {
    const { store } = await fixture();
    await assert.rejects(
        store.call({
            type: 'home3d/backup/import',
            building: empty(),
            plans: [{ id: '__proto__', building: empty() }],
        }),
        /ID/,
    );
    assert.equal(store.data.plans.main.revision, 0);
});

/** A plan with a lamp of `light.living` and a background picture `bg`, and the mapping of the lamp. */
async function projectFixture() {
    const f = await fixture();
    const b = empty();
    b.floors.push({
        id: 'eg',
        name: 'EG',
        rooms: [],
        furniture: [{ id: 'lamp', type: 'lamp_ceiling', entity: 'light.living' }],
        background: { image_id: 'bg', x: 0, z: 0, width: 10, opacity: 0.5 },
    });
    await f.store.call({ type: 'home3d/building/save', building: b });
    await f.store.call({ type: 'home3d/image/set', image_id: 'bg', data: 'data:image/png;base64,cG5n' });
    await f.store.call({ type: 'iobroker/mappings/set', mappings: [mapping, { ...mapping, entity_id: 'light.unused' }] });
    return f;
}
test('a project carries its building, its pictures and only the mappings it uses', async () => {
    const { store } = await projectFixture();
    const file = await store.call({ type: 'home3d/project/export' });
    assert.equal(file.format, 'home3d');
    assert.deepEqual(Object.keys(file.iobroker.images), ['bg']);
    assert.deepEqual(
        file.iobroker.mappings.map((m: { entity_id: string }) => m.entity_id),
        ['light.living'],
    );
    // into an empty installation: a new plan with picture and device
    const other = (await fixture()).store;
    const res = await other.call({ type: 'home3d/project/import', project: JSON.stringify(file), name: 'Haus' });
    assert.equal(other.data.plans[res.plan].name, 'Haus');
    assert.equal(other.data.plans.main.building.floors.length, 0, 'the open plan is not replaced');
    assert.equal(res.images, 1);
    assert.equal(res.devices, 1);
    assert.deepEqual(res.skipped, []);
    assert.equal((await other.call({ type: 'home3d/image/get', image_id: 'bg' })).data, 'data:image/png;base64,cG5n');
    assert.deepEqual(
        other.data.mappings.map(m => m.entity_id),
        ['light.living'],
    );
});
test('a project import renames what is taken and skips datapoints missing here', async () => {
    const { store } = await projectFixture();
    const file = await store.call({ type: 'home3d/project/export' });
    // the same project again: equal mapping is reused, the taken picture gets a new ID
    const again = await store.call({ type: 'home3d/project/import', project: file });
    const copy = store.data.plans[again.plan].building;
    assert.equal(again.devices, 1);
    assert.deepEqual(again.renamed, []);
    assert.notEqual(copy.floors[0].background.image_id, 'bg');
    assert.ok(store.data.images[copy.floors[0].background.image_id]);
    assert.equal(store.data.plans.main.building.floors[0].background.image_id, 'bg');
    // another device under the same entity_id: renamed in the mapping and in the building
    file.iobroker.mappings[0] = { ...mapping, actions: { turn_on: [{ id: 'lamp.power', value: true }] } };
    const renamed = await store.call({ type: 'home3d/project/import', project: file });
    assert.deepEqual(renamed.renamed, [{ from: 'light.living', to: 'light.living_2' }]);
    assert.equal(store.data.plans[renamed.plan].building.floors[0].furniture[0].entity, 'light.living_2');
    assert.ok(store.data.mappings.some(m => m.entity_id === 'light.living_2'));
    // a datapoint that is missing here: the device is skipped, the plan still comes
    file.iobroker.mappings[0] = { ...mapping, state: 'missing.state' };
    const missing = await store.call({ type: 'home3d/project/import', project: file });
    assert.match(missing.skipped[0].reason, /Datenpunkt fehlt/);
    assert.ok(store.data.plans[missing.plan]);
    await assert.rejects(store.call({ type: 'home3d/project/import', project: '{"x":1}' }), /Grundriss/);
});
test('a full backup keeps the mappings of the devices', async () => {
    const { store } = await projectFixture();
    const backup = await store.call({ type: 'home3d/backup/export' });
    assert.equal(backup.mappings.length, 2);
    const other = (await fixture()).store;
    const res = await other.call({
        type: 'home3d/backup/import',
        ...backup,
        mappings: [...backup.mappings, { ...mapping, entity_id: 'light.gone', state: 'missing.state' }],
    });
    assert.deepEqual(
        other.data.mappings.map(m => m.entity_id),
        ['light.living', 'light.unused'],
    );
    assert.deepEqual(
        res.skipped.map((s: { id: string }) => s.id),
        ['light.gone'],
    );
    // an older backup without mappings keeps the current ones
    await other.call({ type: 'home3d/backup/import', building: empty() });
    assert.equal(other.data.mappings.length, 2);
});
