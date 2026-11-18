import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaneGeometry } from 'three';
import { FLAG_HANG, flagCloth, flagLift } from '../frontend/vendor-ext/wind-vane';

// a flag 1 m long and 0.62 m high, as buildVane makes it: the edge at the pole on x = z = 0, the top edge on y = 0
const L = 1;
const H = 0.62;
const rest = Float32Array.from(
    new PlaneGeometry(L, H, 14, 5)
        .rotateY(Math.PI / 2)
        .translate(0, -H / 2, -L / 2)
        .getAttribute('position').array,
);

function pose(droop: number, floor?: number): Float32Array {
    const out = new Float32Array(rest.length);
    flagCloth(rest, out, { droop, t: 1.3, seed: 0.4, speed: 3, gust: 0.5, floor });
    return out;
}

test('the edge at the pole stays fastened to the pole, whatever the wind', () => {
    for (const droop of [0, 0.6, FLAG_HANG]) {
        const out = pose(droop);
        for (let i = 0; i < rest.length; i += 3) {
            if (Math.abs(rest[i + 2]) < 1e-6) {
                assert.ok(Math.abs(out[i]) < 1e-6, 'on the pole (x)');
                assert.ok(Math.abs(out[i + 2]) < 1e-6, 'on the pole (z)');
                assert.ok(Math.abs(out[i + 1] - rest[i + 1]) < 1e-6, 'at its height');
            }
        }
    }
});

test('a flag flies straight out in a strong wind and hangs along the pole without one', () => {
    const free = (out: Float32Array): [number, number] => {
        // the top corner of the free end
        let best = 0;
        for (let i = 0; i < rest.length; i += 3) {
            if (rest[i + 2] < rest[best + 2] - 1e-6 || (rest[i + 2] <= rest[best + 2] + 1e-6 && rest[i + 1] > rest[best + 1])) {
                best = i;
            }
        }
        return [out[best + 1], -out[best + 2]];
    };
    const [yOut, zOut] = free(pose(0));
    assert.ok(Math.abs(yOut) < 1e-6 && Math.abs(zOut - L) < 1e-6, 'straight out');
    const [yHang, zHang] = free(pose(FLAG_HANG));
    assert.ok(yHang < -0.85 * L && zHang < 0.5 * L, 'hanging down');
});

test('the cloth never reaches into the floor under a short pole', () => {
    const out = pose(FLAG_HANG, 0.8);
    for (let i = 1; i < out.length; i += 3) {
        assert.ok(out[i] >= -0.75 - 1e-6);
    }
});

test('how far a flag flies out', () => {
    assert.equal(flagLift(0), 0);
    assert.equal(flagLift(0.3), 0);
    // 2 Bft (8 km/h): half out
    assert.ok(flagLift(2.2) > 0.35 && flagLift(2.2) < 0.55);
    assert.equal(flagLift(6), 1);
    assert.equal(flagLift(20), 1);
});
