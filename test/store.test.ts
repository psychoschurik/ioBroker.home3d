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
