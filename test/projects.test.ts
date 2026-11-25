import type { IoAccess, StateObject } from '../frontend/model';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_PROJECT,
    Projects,
    backupFileName,
    inFolder,
    newProjectId,
    projectFolder,
    projectFromUrl,
    projectLabel,
    projectLink,
    readBackup,
    type ProjectStorage,
} from '../frontend/projects';
import { Store } from '../frontend/store';
import { mergePlaces, withoutProject } from '../frontend/show';
import { projectKey, projectParam } from '../frontend/vendor-ext/project-key';

const objects: Record<string, StateObject> = {
    'lamp.power': { type: 'state', common: { type: 'boolean', write: true } },
};
const io: IoAccess = {
    getObjects: async ids => Object.fromEntries(ids.filter(id => objects[id]).map(id => [id, objects[id]])),
    stateObjects: async () => objects,
    rooms: async () => ({}),
    getState: async () => ({ val: false }),
    setState: async () => {},
};
const lamp = { entity_id: 'switch.lamp', state: 'lamp.power' };

/** The files of home3d.0 in memory, with folders as the socket of web lists them. */
function memoryStorage(): ProjectStorage & { files: Map<string, Uint8Array> } {
    const files = new Map<string, Uint8Array>();
    return {
        files,
        readText: async name => (files.has(name) ? new TextDecoder().decode(files.get(name)) : null),
        writeText: async (name, text) => {
            files.set(name, new TextEncoder().encode(text));
        },
        readDataUrl: async name => {
            const b = files.get(name);
            return b ? `data:image/png;base64,${Buffer.from(b).toString('base64')}` : null;
        },
        writeBinary: async (name, bytes) => {
            files.set(name, bytes);
        },
        remove: async name => {
            files.delete(name);
        },
        list: async folder => {
            const prefix = folder ? `${folder}/` : '';
            const entries = new Map<string, boolean>();
            for (const key of files.keys()) {
                if (key.startsWith(prefix)) {
                    const [name, ...rest] = key.slice(prefix.length).split('/');
                    entries.set(name, rest.length > 0);
                }
            }
            return [...entries].map(([file, isDir]) => ({ file, isDir }));
        },
        removeFolder: async folder => {
            for (const key of [...files.keys()]) {
                if (key.startsWith(`${folder}/`)) {
                    files.delete(key);
                }
            }
        },
        copy: async (from, to) => {
            const b = files.get(from);
            if (b) {
                files.set(to, b.slice());
            }
        },
        move: async (from, to) => {
            const b = files.get(from);
            if (b) {
                files.set(to, b);
                files.delete(from);
            }
        },
    };
}
const json = (s: ProjectStorage & { files: Map<string, Uint8Array> }, name: string): any =>
    JSON.parse(new TextDecoder().decode(s.files.get(name)));
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('a page opens the project of its link; every project has its folder, the default one too', () => {
    assert.equal(projectFromUrl(''), DEFAULT_PROJECT);
    assert.equal(projectFromUrl('?kiosk&project=boot'), 'boot');
    assert.equal(projectFromUrl('?project='), DEFAULT_PROJECT);
    assert.throws(() => projectFromUrl('?project=../data'), { code: 'bad_project' });
    assert.throws(() => projectFromUrl('?project=Boot'), { code: 'bad_project' });
    // the folder of the exported files is no project
    assert.throws(() => projectFromUrl('?project=exports'), { code: 'bad_project' });
    assert.equal(projectFromUrl('?project=default'), DEFAULT_PROJECT);
    assert.equal(projectFolder(DEFAULT_PROJECT), 'default');
    assert.equal(projectFolder('boot'), 'boot');
    assert.equal(projectLink(DEFAULT_PROJECT), 'index.html');
    assert.equal(projectLink('boot'), 'index.html?project=boot');
    assert.equal(projectLink('boot', { kiosk: '' }), 'index.html?kiosk&project=boot');
    assert.equal(projectLink(DEFAULT_PROJECT, { view: 'card' }), 'index.html?view=card');
    assert.equal(projectLabel({ id: DEFAULT_PROJECT, name: null }), 'Standardprojekt');
    assert.equal(projectLabel({ id: 'boot', name: 'Dufour 460' }), 'Dufour 460');
});

test('a new project gets a free ID from its name, never default or exports', () => {
    assert.equal(newProjectId('Ferienhaus Süd', []), 'ferienhaus-sued');
    assert.equal(newProjectId('Boot', ['boot', 'boot-2']), 'boot-3');
    assert.equal(newProjectId('Default', []), 'default-2');
    assert.equal(newProjectId('Exports', []), 'exports-2');
    assert.equal(newProjectId('Main', []), 'main');
    assert.equal(newProjectId('Дача', []), 'project');
    assert.equal(newProjectId('Дача', ['project']), 'project-2');
    assert.match(newProjectId('x'.repeat(100), []), /^x{32}$/);
    assert.equal(backupFileName('Ferienhaus Süd', new Date('2026-11-25T10:00:00Z')), 'home3d-project-ferienhaus-sued-2026-11-25.json');
});

test('the store of a project keeps its files in its folder', async () => {
    const storage = memoryStorage();
    const store = new Store(io, inFolder(storage, projectFolder('boot')));
    await store.load();
    await store.call({ type: 'home3d/image/set', image_id: 'deck', data: PNG });
    assert.ok(storage.files.has('boot/data.json'));
    assert.ok(storage.files.has('boot/images/deck.png'));
    assert.ok(!storage.files.has('data.json'));
    assert.equal(json(storage, 'boot/data.json').images.deck, 'images/deck.png');
});

test('a link to a project that is not there is an error and writes nothing', async () => {
    const storage = memoryStorage();
    const store = new Store(io, inFolder(storage, projectFolder('gone')));
    await assert.rejects(store.load(false), { code: 'not_found' });
    assert.equal(storage.files.size, 0);
});

test('projects: create, list, rename and delete; the default project stays', async () => {
    const storage = memoryStorage();
    const projects = new Projects(storage, io);
    // the default project before its first start
    assert.deepEqual(await projects.list(), [{ id: 'default', name: null, plans: 1, devices: 0 }]);
    const id = await projects.create('  Dufour 460 ');
    assert.equal(id, 'dufour-460');
    assert.equal(json(storage, 'dufour-460/data.json').name, 'Dufour 460');
    await assert.rejects(projects.create('   '), { code: 'bad_name' });
    const other = await projects.create('Dufour 460');
    assert.equal(other, 'dufour-460-2');
    await projects.rename(other, 'Ferienhaus');
    const list = await projects.list();
    assert.deepEqual(
        list.map(p => [p.id, p.name, p.plans]),
        [
            ['default', null, 1],
            ['dufour-460', 'Dufour 460', 1],
            ['dufour-460-2', 'Ferienhaus', 1],
        ],
    );
    await projects.remove(other);
    assert.equal([...storage.files.keys()].some(k => k.startsWith('dufour-460-2/')), false);
    await assert.rejects(projects.remove(DEFAULT_PROJECT), { code: 'default_project' });
    // a folder without data.json is no project, nor are the exported files
    storage.files.set('stray/images/a.png', new Uint8Array([1]));
    storage.files.set('exports/data.json', new TextEncoder().encode('{}'));
    assert.deepEqual(
        (await projects.list()).map(p => p.id),
        ['default', 'dufour-460'],
    );
    // and its ID is not given out again
    assert.equal(await projects.create('Stray'), 'stray-2');
});

test('a copy of a project takes its plans, trash, pictures, models, restore points and devices', async () => {
    const storage = memoryStorage();
    const main = new Store(io, inFolder(storage, projectFolder(DEFAULT_PROJECT)));
    await main.load();
    await main.call({ type: 'home3d/iobroker/mappings/set', mappings: [lamp] });
    await main.call({ type: 'home3d/image/set', image_id: 'deck', data: PNG });
    await main.call({ type: 'home3d/history/snapshot' });
    const { plan } = await main.call({ type: 'home3d/plans/create', name: 'Garten' });
    await main.call({ type: 'home3d/plans/delete', plan });
    await main.call({ type: 'home3d/iobroker/position/set', id: 'gps.0.position' });
    const projects = new Projects(storage, io);
    const id = await projects.copy(DEFAULT_PROJECT, 'Kopie');
    // other projects are not part of the main project's copy
    await projects.create('Boot');
    const copyOfCopy = await projects.copy(id, 'Kopie 2');
    for (const target of [id, copyOfCopy]) {
        const store = projects.store(target);
        await store.load(false);
        assert.equal(store.data.name, target === id ? 'Kopie' : 'Kopie 2');
        assert.deepEqual(store.data.mappings, [lamp]);
        assert.equal(store.data.position_id, 'gps.0.position');
        assert.equal((await store.call({ type: 'home3d/plans/list' })).trash.length, 1);
        assert.equal((await store.call({ type: 'home3d/image/get', image_id: 'deck' })).data, PNG);
        assert.equal((await store.call({ type: 'home3d/history/list' })).snapshots.length, 1);
    }
    assert.ok(![...storage.files.keys()].some(k => k.startsWith(`${copyOfCopy}/boot/`)));
    // the original stays as it was
    assert.equal(main.data.name, undefined);
});

test('a project exported as a file comes back as a new project with its name and settings', async () => {
    const storage = memoryStorage();
    const projects = new Projects(storage, io);
    const id = await projects.create('Boot');
    const boat = projects.store(id);
    await boat.load(false);
    await boat.call({ type: 'home3d/iobroker/mappings/set', mappings: [lamp] });
    await boat.call({ type: 'home3d/iobroker/health/set', minutes: 30 });
    await boat.call({ type: 'home3d/image/set', image_id: 'deck', data: PNG });
    await boat.call({ type: 'home3d/plans/create', name: 'Unterdeck' });
    const file = await projects.exportFile(id);
    assert.match(file.name, /^home3d-project-boot-\d{4}-\d\d-\d\d\.json$/);
    const backup = readBackup(file.text);
    assert.equal(backup.name, 'Boot');
    assert.throws(() => readBackup('{"format":"home3d","building":{}}'), { code: 'not_backup' });
    assert.throws(() => readBackup('nope'), { code: 'not_json' });

    const res = await projects.importFile(file.text, 'Boot vom Hafen');
    assert.equal(res.id, 'boot-vom-hafen');
    assert.deepEqual(res.skipped, []);
    const copy = projects.store(res.id);
    await copy.load(false);
    assert.equal(copy.data.name, 'Boot vom Hafen');
    assert.deepEqual(copy.data.mappings, [lamp]);
    assert.equal(copy.data.health_stale_min, 30);
    assert.deepEqual(
        (await copy.call({ type: 'home3d/plans/list' })).plans.map((p: { name: string | null }) => p.name ?? '').sort(),
        ['', 'Unterdeck'],
    );
    assert.equal((await copy.call({ type: 'home3d/image/get', image_id: 'deck' })).data, PNG);
    // a file that is no project leaves nothing behind
    const before = [...storage.files.keys()].sort();
    await assert.rejects(projects.importFile('{"format":"home3d-backup","building":{"version":7}}', 'Kaputt'));
    assert.deepEqual([...storage.files.keys()].sort(), before);
});

test("the editor's restore of a backup keeps the project's own settings", async () => {
    const storage = memoryStorage();
    const store = new Store(io, storage);
    await store.load();
    await store.call({ type: 'home3d/iobroker/position/set', id: 'gps.0.position' });
    const backup = await store.call({ type: 'home3d/backup/export' });
    await store.call({ type: 'home3d/iobroker/position/set', id: null });
    // as restoreBackup of the 3D frontend sends it: without the settings
    const { settings: _settings, ...restored } = backup;
    await store.call({ type: 'home3d/backup/import', ...restored });
    assert.equal(store.data.position_id ?? null, null);
    await store.call({ type: 'home3d/backup/import', ...backup });
    assert.equal(store.data.position_id, 'gps.0.position');
});

test('the name of a project is saved, reported and read back', async () => {
    const storage = memoryStorage();
    const store = new Store(io, storage);
    await store.load();
    const events: [string, unknown][] = [];
    store.onEvent((type, payload) => events.push([type, payload]));
    assert.deepEqual(await store.call({ type: 'home3d/iobroker/project/name', name: ` ${'x'.repeat(90)} ` }), {
        name: 'x'.repeat(80),
    });
    assert.deepEqual(events, [['iobroker/project', { name: 'x'.repeat(80) }]]);
    await store.call({ type: 'home3d/iobroker/project/name', name: '' });
    assert.equal(json(storage, 'data.json').name, null);
    // a change of another browser is reported too
    const other = new Store(io, storage);
    await other.load();
    await other.call({ type: 'home3d/iobroker/project/name', name: 'Haus' });
    await store.sync();
    assert.deepEqual(events.at(-1), ['iobroker/project', { name: 'Haus' }]);
});

test('the files of the time before project folders become the default project, once', async () => {
    const storage = memoryStorage();
    const old = new Store(io, storage);
    await old.load();
    await old.call({ type: 'home3d/iobroker/mappings/set', mappings: [lamp] });
    await old.call({ type: 'home3d/image/set', image_id: 'deck', data: PNG });
    await old.call({ type: 'home3d/history/snapshot' });
    storage.files.set('projects/home3d-projekt-haus-2026-11-20.json', new TextEncoder().encode('{}'));
    const projects = new Projects(storage, io);
    assert.equal(await projects.adoptRoot(), true);
    assert.deepEqual([...storage.files.keys()].sort(), [
        'default/data.json',
        'default/history/main.json',
        'default/images/deck.png',
        'exports/home3d-projekt-haus-2026-11-20.json',
    ]);
    const store = projects.store(DEFAULT_PROJECT);
    await store.load(false);
    assert.deepEqual(store.data.mappings, [lamp]);
    assert.equal((await store.call({ type: 'home3d/image/get', image_id: 'deck' })).data, PNG);
    assert.equal(await projects.adoptRoot(), false);
    // a project named "Projects" is not taken for exports, a data.json at the root no longer for the default project
    await projects.create('Projects');
    storage.files.set('data.json', new TextEncoder().encode('{"plans":{"main":{}}}'));
    assert.equal(await projects.adoptRoot(), false);
    assert.ok(storage.files.has('projects/data.json'));
    assert.ok(storage.files.has('data.json'));
    await store.sync();
    assert.deepEqual(store.data.mappings, [lamp]);
});

test('home3d.0.places: the default project at the top, every other one below projects', () => {
    const house = JSON.stringify({ floors: { EG: ['Küche'] }, devices: [{ name: 'Licht', room: 'Küche' }] });
    const boat = JSON.stringify({ floors: { Deck: [] }, devices: [{ name: 'Diesel' }] });
    // the default project alone writes what it always wrote
    assert.equal(mergePlaces('', DEFAULT_PROJECT, null, house), house);
    const both = mergePlaces(house, 'boot', 'Boot', boat);
    assert.deepEqual(JSON.parse(both), {
        ...JSON.parse(house),
        projects: { boot: { name: 'Boot', ...JSON.parse(boat) } },
    });
    // the default project's next write keeps the boat
    const changed = JSON.stringify({ floors: { EG: ['Küche', 'Bad'] }, devices: [] });
    assert.deepEqual(JSON.parse(mergePlaces(both, DEFAULT_PROJECT, null, changed)).projects, JSON.parse(both).projects);
    // the same content gives the same text, so nothing is written again
    assert.equal(mergePlaces(both, 'boot', 'Boot', boat), both);
    assert.equal(mergePlaces('{broken', 'boot', 'Boot', boat), JSON.stringify({ floors: {}, devices: [], projects: { boot: { name: 'Boot', ...JSON.parse(boat) } } }));
    assert.equal(withoutProject(both, 'boot'), house);
    assert.equal(withoutProject(house, 'boot'), null);
});

test('what the 3D view keeps in this browser is kept per project', () => {
    assert.equal(projectKey('home3d.unsaved', 'default'), 'home3d.unsaved');
    assert.equal(projectKey('home3d.unsaved', 'boot'), 'home3d.unsaved@boot');
    // without a page (tests): the default project
    assert.equal(projectKey('plan'), 'plan');
    // the editor's "Kiosk ↗" stays in the project
    assert.equal(projectParam('default'), '');
    assert.equal(projectParam('boot'), '&project=boot');
});
