import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FRAME_TILT_MAX,
    framePlan,
    framePosts,
    frameTilt,
    moduleNormal,
    PLAN_DEPTH_MIN,
    POSTS_BEHIND,
    rayOnModules,
    type FrameFace,
    type V3,
} from '../frontend/vendor-ext/steep-frames';

const near = (a: number, b: number, eps = 1e-9): void => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const DEG = Math.PI / 180;
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// the garden: up is the normal, +z up the "slope" (towards the north in the plan: a frame looks south, -z)
const ground: FrameFace & { eu: V3 } = { n: [0, 1, 0], es: [0, 0, 1], eu: [1, 0, 0], flat: true };
const wall: FrameFace & { eu: V3 } = { n: [1, 0, 0], es: [0, 1, 0], eu: [0, 0, 1], flat: false, wall: { floorId: 'eg' } };
const at =
    (face: { n: readonly number[]; es: readonly number[]; eu: readonly number[] }) =>
    (u: number, s: number, up: number): V3 => [
        face.eu[0] * u + face.es[0] * s + face.n[0] * up,
        face.eu[1] * u + face.es[1] * s + face.n[1] * up,
        face.eu[2] * u + face.es[2] * s + face.n[2] * up,
    ];

/** One module of a frame on a flat face as solar.ts lays it (lower edge first), 1 × 1.72 m. */
function frameModule(tilt: number, flip: boolean): V3[] {
    const t = frameTilt(ground, tilt);
    const mh = 1.72;
    const depth = mh * Math.cos(t);
    const lo = 0.15;
    const hi = lo + mh * Math.sin(t);
    const [sl, sh] = flip ? [depth, 0] : [0, depth];
    const p = at(ground);
    return [p(0, sl, lo), p(1, sl, lo), p(1, sh, hi), p(0, sh, hi)];
}

test('frames on flat faces go up to upright, walls stay at 90°, sloped roofs at 0', () => {
    assert.equal(FRAME_TILT_MAX, 90);
    near(frameTilt(ground, 70), 70 * DEG);
    near(frameTilt(ground, 90), 90 * DEG);
    near(frameTilt(ground, 120), 90 * DEG);
    near(frameTilt(ground, -5), 0);
    near(frameTilt(ground, null), 15 * DEG);
    near(frameTilt(wall, null), 0);
    near(frameTilt({ n: [0, 1, 0], es: [0, 0.5, 0.86], flat: false }, 40), 0);
});

test("a module's normal stands on its glass and looks towards its lower edge", () => {
    for (const tilt of [0, 25, 45, 70, 90]) {
        for (const flip of [false, true]) {
            const [a, c, , e] = frameModule(tilt, flip);
            const n = moduleNormal(ground, { tilt, flip });
            near(Math.hypot(...n), 1);
            // in no direction of the glass
            near(dot(n, sub(c, a)), 0);
            near(dot(n, sub(e, a)), 0);
            // up as far as it tilts, and towards the lower edge (-s, flipped +s)
            near(n[1], Math.cos(tilt * DEG));
            near(n[2], (flip ? 1 : -1) * Math.sin(tilt * DEG));
        }
    }
    // upright: no longer up at all, where the face's normal would lie in the glass
    const upright = moduleNormal(ground, { tilt: 90 });
    near(upright[1], 0);
    near(upright[2], -1);
    // a sloped roof: the face's normal
    assert.deepEqual(moduleNormal({ n: [0, 0.8, 0.6], es: [0, 0.6, -0.8], flat: false }, { tilt: 30 }), [0, 0.8, 0.6]);
});

test('on a wall the normal follows the tilt off the wall the same way', () => {
    // solar.ts: tilted, the upper edge stands off the wall (flipped: the lower one)
    for (const flip of [false, true]) {
        const t = 30 * DEG;
        const mh = 1.0;
        const away = 0.05 + mh * Math.sin(t);
        const [lo, hi] = flip ? [away, 0.05] : [0.05, away];
        const p = at(wall);
        const a = p(0, 1, lo);
        const c = p(1, 1, lo);
        const e = p(0, 1 + mh * Math.cos(t), hi);
        const n = moduleNormal(wall, { tilt: 30, flip });
        near(dot(n, sub(c, a)), 0);
        near(dot(n, sub(e, a)), 0);
        // still out of the wall
        assert.ok(dot(n, wall.n) > 0);
    }
});

test('the back posts step behind an upright module, low frames keep theirs', () => {
    const p = at(ground);
    const low = framePosts(p, [0.05, 0.95], 0, 1.56, 0.15, 0.88, 25 * DEG, false);
    assert.equal(low.length, 4);
    // the back posts right under the upper edge, up to it
    assert.deepEqual(low[1], [p(0.05, 1.56, 0), p(0.05, 1.56, 0.88)]);
    const upright = framePosts(p, [0.05, 0.95], 0, 0, 0.15, 1.87, 90 * DEG, false);
    // each post pair gets an arm to the upper edge
    assert.equal(upright.length, 6);
    const [front, back, arm] = upright;
    assert.deepEqual(front, [p(0.05, 0, 0), p(0.05, 0, 0.15)]);
    near(back[0][2], POSTS_BEHIND);
    near(back[1][1], 1.87);
    assert.deepEqual(arm, [p(0.05, POSTS_BEHIND, 1.87), p(0.05, 0, 1.87)]);
    // flipped, behind is the other way
    near(framePosts(p, [0.05], 0, 0, 0.15, 1.87, 90 * DEG, true)[1][0][2], -POSTS_BEHIND);
    // up to 80° nothing moves
    assert.equal(framePosts(p, [0.05], 0, 0.3, 0.15, 1.84, 80 * DEG, false).length, 2);
});

test('in the plan an upright module keeps a strip of 30 cm behind its lower edge', () => {
    const plan = (tilt: number, flip: boolean) => framePlan(frameModule(tilt, flip), ground.es, flip);
    // a low frame: its outline seen from above
    assert.deepEqual(
        plan(25, false),
        frameModule(25, false).map(p => [p[0], p[2]]),
    );
    const upright = plan(90, false);
    const depth = Math.max(...upright.map(p => p[1])) - Math.min(...upright.map(p => p[1]));
    near(depth, PLAN_DEPTH_MIN);
    // the lower edge stays where the module stands, the strip reaches backwards (+z)
    near(upright[0][1], 0);
    near(upright[3][1], PLAN_DEPTH_MIN);
    // flipped: backwards is -z
    const flipped = plan(90, true);
    near(Math.min(...flipped.map(p => p[1])), -PLAN_DEPTH_MIN, 1e-6);
    // 75° is deep enough already
    const steep = plan(75, false);
    assert.deepEqual(
        steep,
        frameModule(75, false).map(p => [p[0], p[2]]),
    );
});

test('a ray meets an upright module on its glass, from both sides', () => {
    const modules = [{ corners: frameModule(90, false) }];
    // from the south (-z) at the height of its middle, 5 m away
    near(rayOnModules(modules, [0.5, 1, -5], [0, 0, 1])!, 5);
    // from behind
    near(rayOnModules(modules, [0.5, 1, 4], [0, 0, -1])!, 4);
    // over it, beside it, away from it
    assert.equal(rayOnModules(modules, [0.5, 2.5, -5], [0, 0, 1]), null);
    assert.equal(rayOnModules(modules, [1.5, 1, -5], [0, 0, 1]), null);
    assert.equal(rayOnModules(modules, [0.5, 1, -5], [0, 0, -1]), null);
    // the nearer of two
    const two = [...modules, { corners: frameModule(90, false).map(p => [p[0], p[1], p[2] - 2] as V3) }];
    near(rayOnModules(two, [0.5, 1, -5], [0, 0, 1])!, 3);
});
