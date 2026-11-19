import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mesh } from 'three';
import { buildPvSnow, writePvSnow } from '../frontend/vendor-ext/pv-snow';

type V3 = [number, number, number];
const module = (x: number): V3[] => [
    [x, 3, 0],
    [x + 1, 3, 0],
    [x + 1, 4, -1],
    [x, 4, -1],
];

test('snow lies on the modules of each field and goes from a field that produces', () => {
    const g = buildPvSnow(
        [
            { id: 'south', corners: [module(0), module(1.1)], n: [0, 1, 1] },
            { id: 'west', corners: [module(5)], n: [0, 1, 1] },
        ],
        2,
        0.5,
    );
    assert.ok(g);
    assert.equal(g.children.length, 2);
    const south = g.children[0] as Mesh;
    // two modules, two triangles each, lifted over the glass and lowered into the group
    assert.equal(south.geometry.getAttribute('position').count, 12);
    const y0 = south.geometry.getAttribute('position').getY(0);
    assert.ok(y0 > 1 && y0 < 1.05);
    writePvSnow(g, new Map([['south', 450]]));
    assert.deepEqual(
        g.children.map(m => m.visible),
        [false, true],
    );
    assert.equal(buildPvSnow([{ id: 'x', corners: [], n: [0, 1, 0] }], 0, 1), null);
});
