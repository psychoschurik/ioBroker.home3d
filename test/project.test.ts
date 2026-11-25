import test from 'node:test';
import assert from 'node:assert/strict';
import { freeEntityId, projectFileName, readProject, renamed, strings } from '../frontend/project';

test('strings finds values and keys, renamed replaces both', () => {
    const v = { a: ['light.x', { 'light.x': 1 }], b: 'light.xy' };
    assert.ok(strings(v).has('light.x'));
    assert.deepEqual(renamed(v, new Map([['light.x', 'light.x_2']])), {
        a: ['light.x_2', { 'light.x_2': 1 }],
        b: 'light.xy',
    });
});
test('readProject takes project files, export files of the 3D frontend and bare buildings', () => {
    const building = { version: 1, floors: [], settings: {}, presence: [] };
    assert.equal(readProject({ format: 'home3d', version: 1, building }).mappings.length, 0);
    assert.equal(readProject(JSON.stringify(building)).name, null);
    assert.throws(() => readProject('{'), /kein JSON/);
    assert.throws(() => readProject({ format: 'home3d', building: { floors: [] } }), /Grundriss/);
    const p = readProject({
        format: 'home3d',
        version: 1,
        building,
        iobroker: {
            project: 1,
            plan: { name: ' Haus 2 ', icon: '🏠', site: null },
            // as from a file: JSON.parse makes "__proto__" an own key (an object literal would set the prototype)
            images: JSON.parse('{"__proto__": "x"}'),
            mappings: [],
        },
    });
    assert.equal(p.name, 'Haus 2');
    assert.deepEqual(Object.keys(p.images), []);
});
test('free entity IDs and file names', () => {
    assert.equal(freeEntityId('light.a', new Set(['light.a', 'light.a_2'])), 'light.a_3');
    assert.equal(projectFileName('Haus 2 Süd', new Date('2026-11-16T10:00:00Z')), 'home3d-plan-haus-2-sued-2026-11-16.json');
});
