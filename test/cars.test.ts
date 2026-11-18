import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, type Mesh } from 'three';
import { buildCar, CAR_KINDS, plateText, WHEEL } from '../frontend/vendor-ext/cars';

const SIZES = {
    car_sedan: [1.85, 4.75, 1.45],
    car_hatchback: [1.8, 4.1, 1.5],
    car_van: [2.05, 5.3, 2.3],
} as const;

for (const kind of CAR_KINDS) {
    test(`${kind}: fits its size, stands on the ground, four wheels`, () => {
        const [w, d, h] = SIZES[kind];
        const car = buildCar(kind, w, d, h, null);
        car.updateMatrixWorld(true);
        const b = new Box3().setFromObject(car);
        // mirrors and plates may stand out a little
        const tol = 0.15;
        assert.ok(b.min.x >= -w / 2 - tol && b.max.x <= w / 2 + tol, `width ${b.min.x} … ${b.max.x}`);
        assert.ok(b.min.z >= -d / 2 - 0.05 && b.max.z <= d / 2 + 0.05, `length ${b.min.z} … ${b.max.z}`);
        assert.ok(b.max.y <= h + 0.03 && b.max.y >= h - 0.15, `height ${b.max.y}`);
        assert.ok(Math.abs(b.min.y) < 0.01, `on the ground: ${b.min.y}`);
        const wheels = car.children.filter(o => o.name === WHEEL) as Mesh[];
        assert.equal(wheels.length, 4);
        for (const m of wheels) {
            assert.ok((m.userData.fp3dR as number) > 0.2);
        }
        car.traverse(o => {
            const geo = (o as Mesh).geometry;
            if (geo) {
                assert.ok(!Array.from(geo.getAttribute('position').array).some(Number.isNaN), 'no NaN');
                assert.ok(geo.getAttribute('color'), 'coloured per vertex');
            }
        });
    });
}

test('a colour that is no colour falls back to the kind’s', () => {
    assert.doesNotThrow(() => buildCar('car_sedan', 1.85, 4.75, 1.45, 'no colour'));
});

test('a number plate shows letters, digits, spaces and hyphens, in capitals, at most 12', () => {
    assert.equal(plateText(' m-ab 1234 '), 'M-AB 1234');
    assert.equal(plateText('ö-xy  7e<b>'), 'Ö-XY 7EB');
    assert.equal(plateText('HH-AB 12345678'), 'HH-AB 123456');
    assert.equal(plateText(null), '');
    // without a page (no canvas) the car is built with blank plates
    assert.doesNotThrow(() => buildCar('car_van', 2.05, 5.3, 2.3, null, 'B-XY 99'));
});
