import assert from 'node:assert/strict';
import test from 'node:test';
import { CELL, cloudField, cloudKind, cloudLook, cloudNoise } from '../frontend/vendor-ext/clouds';
import { cloudThreshold } from '../frontend/vendor-ext/sky-shade';

const field = (cover: number, kind: 'fair' | 'deck' | 'tower' = 'fair', cx = 0, cz = 0) =>
    cloudField({ cx, cz, r: 100, cover, kind, base: 30 });

test('no clouds in a clear sky, more the more it is covered', () => {
    assert.equal(field(0).length, 0);
    const few = field(0.2).length;
    const half = field(0.5).length;
    const most = field(0.9, 'deck').length;
    assert.ok(few < half, `${few} < ${half}`);
    assert.ok(half < most, `${half} < ${most}`);
    // overcast: (nearly) every cell has its cloud
    const cells = Math.PI * (100 / CELL) ** 2;
    assert.ok(most / 3 > cells * 0.85, `${most / 3} of ${cells.toFixed(0)} cells`);
});

test('a cloud lies where its shadow falls: only where the shadow noise passes the threshold', () => {
    const th = cloudThreshold(0.4);
    for (const p of field(0.4)) {
        // the puff is within half a cell of its cell's middle
        const i = Math.floor(p.x / CELL);
        const j = Math.floor(p.z / CELL);
        const near = [-1, 0, 1].some(a => [-1, 0, 1].some(b => cloudNoise((i + a + 0.5) * CELL, (j + b + 0.5) * CELL) >= th - 0.01));
        assert.ok(near, `puff at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
});

test('the same cells give the same clouds when the field moves on', () => {
    const a = field(0.5, 'fair', 0, 0);
    const b = field(0.5, 'fair', 30, 0);
    const key = (p: { x: number; y: number; z: number }) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    const inB = new Set(b.map(key));
    // the clouds of the overlap (well inside both fields) are the same
    const shared = a.filter(p => Math.hypot(p.x, p.z) < 60 && Math.hypot(p.x - 30, p.z) < 60);
    assert.ok(shared.length > 10);
    for (const p of shared) assert.ok(inB.has(key(p)));
});

test('sorted from low to high, above the base, towers taller than fair clouds', () => {
    const fair = field(0.5);
    for (let i = 1; i < fair.length; i++) assert.ok(fair[i].y >= fair[i - 1].y);
    assert.ok(fair.every(p => p.y >= 30 && p.size > 0 && p.shade >= 0 && p.shade <= 1));
    const top = (ps: { y: number }[]) => Math.max(...ps.map(p => p.y));
    assert.ok(top(field(0.5, 'tower')) > top(fair) + 3);
    const deck = field(0.9, 'deck');
    assert.ok(top(deck) - 30 < 8, 'a deck is flat');
});

test('what kind of clouds the weather brings', () => {
    assert.equal(cloudKind({ cover: 0.4, rain: 0, storm: 0 }), 'fair');
    assert.equal(cloudKind({ cover: 0.9, rain: 0, storm: 0 }), 'deck');
    assert.equal(cloudKind({ cover: 0.6, rain: 0.5, storm: 0 }), 'deck');
    assert.equal(cloudKind({ cover: 0.9, rain: 0.8, storm: 1 }), 'tower');
});

test('white by day, pink at sunset, dark at night, grey in the rain', () => {
    const fair = { cover: 0.4, rain: 0, storm: 0 };
    const day = cloudLook(40, fair);
    assert.ok(day.lit.every(c => c > 0.95));
    const dusk = cloudLook(2, fair);
    assert.ok(dusk.lit[0] > 0.95 && dusk.lit[1] < 0.85 && dusk.lit[2] < 0.85, `pink ${dusk.lit.map(c => c.toFixed(2)).join(',')}`);
    const night = cloudLook(-20, fair);
    assert.ok(night.lit.every(c => c < 0.65) && night.alpha < day.alpha);
    const rain = cloudLook(40, { cover: 0.95, rain: 0.8, storm: 0 });
    assert.ok(rain.lit[0] < 0.7 && Math.abs(rain.lit[0] - rain.lit[1]) < 0.06, 'grey');
    // unknown sun: as by day
    assert.deepEqual(cloudLook(null, fair), cloudLook(45, fair));
});
