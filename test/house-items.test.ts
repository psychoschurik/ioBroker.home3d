import assert from 'node:assert/strict';
import test from 'node:test';
import {
    HOUSE_NATURAL,
    houseSymbol,
    lightWell,
    outdoorSteps,
    railing,
    spiralLayout,
    wellHoles,
    type ItemDraw,
} from '../frontend/vendor-ext/house-items';

type P = [number, number];

/** A builder that only records the boxes (x0, x1, y0, y1, z0, z1). */
function recorder(): { b: ItemDraw; boxes: number[][] } {
    const boxes: number[][] = [];
    const b: ItemDraw = {
        box: (x0, x1, y0, y1, z0, z1) => {
            boxes.push([x0, x1, y0, y1, z0, z1]);
        },
        cyl: () => undefined,
        seg: () => undefined,
        prism: () => undefined,
    };
    return { b, boxes };
}

const C = { wood: 1, woodTop: 2, metal: 3, dark: 4, glass: 5 };
const E = { furn: null, faint: null, glow: null } as never;

// an item's footprint turned by its rotation (as furnitureFootprint of the 3D frontend)
function footprint(f: { x: number; z: number; w: number; d: number; rotation: number }): P[] {
    const a = (f.rotation * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return (
        [
            [-f.w / 2, -f.d / 2],
            [f.w / 2, -f.d / 2],
            [f.w / 2, f.d / 2],
            [-f.w / 2, f.d / 2],
        ] as P[]
    ).map(([x, z]) => [f.x + x * c - z * s, f.z + x * s + z * c] as P);
}

test('house items: a light well cuts its hole into the lawn around it, pulled inside where it meets the house', () => {
    // the lawn north of the house ends at the house wall (z = 0); the well lies against it
    const lawn: P[] = [
        [-10, -8],
        [24, -8],
        [24, 0],
        [-10, 0],
    ];
    const well = { type: 'light_well', x: 7.3, z: -0.32, w: 2.6, d: 0.64, rotation: 180 };
    const holes = wellHoles([well, { type: 'sofa', x: 7.3, z: -0.32, w: 2, d: 1, rotation: 0 }], lawn, footprint);
    assert.equal(holes.length, 1);
    for (const [x, z] of holes[0]) {
        assert.ok(z < 0 && z > -0.66, `inside the lawn, at most the well's depth out: ${z}`);
        assert.ok(x > 5.9 && x < 8.7, `along the wall: ${x}`);
    }
    // the corners at the wall are pulled just inside it
    assert.ok(Math.max(...holes[0].map(([, z]) => z)) > -0.05);
    // a well outside the lawn cuts nothing
    assert.deepEqual(wellHoles([{ ...well, z: 3 }], lawn, footprint), []);
});

test('house items: railing, outdoor steps and light well are drawn within their box', () => {
    const r = recorder();
    railing(r.b, C, E, 3, 0.05, 1);
    // posts every 1.5 m (3), the handrail, the bottom rail and the bars between
    assert.ok(r.boxes.length > 20);
    for (const [x0, x1, y0, y1] of r.boxes) {
        assert.ok(x0 >= -1.5 - 1e-9 && x1 <= 1.5 + 1e-9 && y0 >= 0 && y1 <= 1 + 1e-9);
    }

    const s = recorder();
    outdoorSteps(s.b, HOUSE_NATURAL, E, 2, 3.9, 1);
    // 6 solid steps of about 16 cm, the last one at the top
    assert.equal(s.boxes.length, 6);
    assert.ok(s.boxes.every(([, , y0]) => y0 === 0));
    assert.ok(Math.abs(Math.max(...s.boxes.map(([, , , y1]) => y1)) - 1) < 1e-9);

    const w = recorder();
    lightWell(w.b, C, HOUSE_NATURAL, E, 1.2, 0.6, 2.85);
    // the grate lies at the top, nothing reaches beyond the box
    assert.ok(w.boxes.some(([, , y0, y1]) => y1 === 2.85 && y0 > 2.8));
    for (const [x0, x1, , y1, z0, z1] of w.boxes) {
        assert.ok(x0 >= -0.6 - 1e-9 && x1 <= 0.6 + 1e-9 && z0 >= -0.3 - 1e-9 && z1 <= 0.3 + 1e-9 && y1 <= 2.85 + 1e-9);
    }
});

test('house items: the plan symbols draw within the item, the outdoor steps one nosing per step', () => {
    const draw = {
        rect: (x0: number, z0: number, x1: number, z1: number) => [x0, z0, x1, z1],
        line: (x0: number, z0: number, x1: number, z1: number) => [x0, z0, x1, z1],
    };
    for (const [type, w, d, h] of [
        ['railing', 3, 0.05, 1],
        ['stairs_outdoor', 2.36, 3.9, 1],
        ['stairs_outdoor', 1.4, 1.6, 0],
        ['light_well', 2.62, 0.63, 2.85],
    ] as const) {
        const parts = houseSymbol(type, w, d, h, draw);
        assert.ok(parts && parts.length > 3, type);
        for (const [x0, z0, x1, z1] of parts) {
            for (const [x, z] of [
                [x0, z0],
                [x1, z1],
            ]) {
                assert.ok(Math.abs(x) <= w / 2 + 0.03 && Math.abs(z) <= d / 2 + 0.03, `${type}: ${x} ${z}`);
            }
        }
    }
    // 1 m high: 6 steps, 5 nosings between them, the outline and the arrow (3 lines)
    assert.equal(houseSymbol('stairs_outdoor', 2.36, 3.9, 1, draw)?.length, 1 + 5 + 3);
    assert.equal(houseSymbol('sofa', 2, 1, 1, draw), null);
});

test('house items: a spiral stair takes one turn per storey', () => {
    const l = spiralLayout(1.7, 1.7, 2.83);
    assert.equal(l.r, 0.85);
    assert.equal(l.n, 15);
    assert.ok(Math.abs(l.step * (l.n + 1) - 2 * Math.PI) < 1e-9);
});
