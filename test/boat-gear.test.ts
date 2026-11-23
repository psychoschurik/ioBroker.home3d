import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLightY, hatchOpen, hatchPose, isGear, lightOn, tankFill, tankWarn } from '../frontend/vendor-ext/boat-kinds';
import { Box3 } from 'three';
import { BOTTLE, bottleLevel, bottleProfile, buildGear } from '../frontend/vendor-ext/boat-gear';
import { boatPicture, disposeBoatPicture } from '../frontend/vendor-ext/boat-picture';
import { wakeStrength } from '../frontend/vendor-ext/sea';

test('a tank reads its fill in % or as a fraction and warns when a supply runs out or a holding tank fills up', () => {
    assert.equal(tankFill(45, '%'), 0.45);
    assert.equal(tankFill(0.3, ''), 0.3);
    assert.equal(tankFill(80, ''), 0.8);
    assert.equal(tankFill(120, '%'), 1);
    assert.equal(tankWarn('water', 0.15), true);
    assert.equal(tankWarn('fuel', 0.45), false);
    assert.equal(tankWarn('black', 0.9), true);
    assert.equal(tankWarn('grey', 0.1), false);
});

test('a gas bottle: a round body with shoulder and neck, its valve and collar, the gas up to its fill', () => {
    const r = 0.15;
    const h = 0.59;
    const profile = bottleProfile(r, h);
    // from the axis at the foot out to the body and back in to the axis at the neck
    assert.equal(profile[0].x, 0);
    assert.equal(profile.at(-1)!.x, 0);
    assert.ok(Math.abs(Math.max(...profile.map(p => p.x)) - r) < 1e-9);
    assert.ok(Math.abs(profile.at(-1)!.y - BOTTLE.neck * h) < 1e-9);
    assert.ok(bottleLevel(h, 0) < bottleLevel(h, 0.5) && bottleLevel(h, 0.5) < bottleLevel(h, 1));
    assert.ok(Math.abs(bottleLevel(h, 1) - BOTTLE.shoulder * h) < 1e-9);
    assert.equal(bottleLevel(h, 2), bottleLevel(h, 1));
    const scene = { floorY: 0, waterY: null, light: false, night: 0 };
    const base = { id: 'g', floor: 'f', type: 'tank' as const, x: 0, z: 0, rotation: 0, w: 0.3, d: 0.3, h, base: 0, label: '', warn: false, mast: false };
    const full = buildGear({ ...base, variant: 'gas', value: 0.7 }, scene);
    const empty = buildGear({ ...base, variant: 'gas', value: 0 }, scene);
    const meshes = (g: ReturnType<typeof buildGear>): number => {
        let n = 0;
        g.traverse(o => {
            n += (o as unknown as { isMesh?: boolean }).isMesh ? 1 : 0;
        });
        return n;
    };
    // glass, foot ring, collar, valve, hand wheel; with gas the liquid too
    assert.equal(meshes(empty), 5);
    assert.equal(meshes(full), 6);
    const box = new Box3().setFromObject(full);
    // the collar guards the valve up to the bottle's height
    assert.ok(Math.abs(box.max.y - h) < 0.001, `top ${box.max.y}`);
    assert.ok(box.max.x <= 0.15 + 1e-6);
});

test('navigation lights: on from a switch, the anchor light at the masthead unless set', () => {
    assert.equal(lightOn('on'), 1);
    assert.equal(lightOn('true'), 1);
    assert.equal(lightOn('off'), 0);
    assert.equal(lightOn(undefined), 0);
    assert.ok(defaultLightY('anchor') > defaultLightY('steaming'));
    assert.ok(defaultLightY('stern') < 2);
    assert.equal(isGear('rudder'), true);
    assert.equal(isGear('sofa'), false);
});

test('the wake starts at about half a knot and is full at about seven', () => {
    assert.equal(wakeStrength(undefined), 0);
    assert.equal(wakeStrength(0.1), 0);
    assert.ok(wakeStrength(1) > 0 && wakeStrength(1) < 0.5);
    assert.equal(wakeStrength(10), 1);
});

test('a hatch stands at the angle its datapoint reports, open by its contact or from 1 degree', () => {
    // nothing known
    assert.equal(hatchPose(null, null), null);
    // only the contact: the angle set
    assert.deepEqual(hatchPose('on', null, 60), { open: 1, angle: 60, measured: false });
    assert.deepEqual(hatchPose('off', null, 60), { open: 0, angle: 60, measured: false });
    // only the angle: open from 1 degree, at most 110
    assert.deepEqual(hatchPose(null, { n: 35, unit: '°' }), { open: 1, angle: 35, measured: true });
    assert.equal(hatchPose(null, { n: 0.4 })!.open, 0);
    assert.equal(hatchPose(null, { n: 170 })!.angle, 110);
    // in %: up to the angle set
    assert.deepEqual(hatchPose(null, { n: 50, unit: '%' }, 80), { open: 1, angle: 40, measured: true });
    // both: the contact says whether, the datapoint how far
    assert.deepEqual(hatchPose('off', { n: 30 }), { open: 0, angle: 30, measured: true });
    assert.deepEqual(hatchPose('open', { n: 30 }), { open: 1, angle: 30, measured: true });
    // an angle that is no number counts as none
    assert.deepEqual(hatchPose('on', { n: NaN }, 70), { open: 1, angle: 70, measured: false });
});

test('a deck hatch opens from its contact and is drawn shut, open with its struts, square or round', () => {
    assert.equal(hatchOpen('on'), 1);
    assert.equal(hatchOpen('Offen'), 1);
    assert.equal(hatchOpen('open'), 1);
    assert.equal(hatchOpen('off'), 0);
    assert.equal(hatchOpen('closed'), 0);
    assert.equal(hatchOpen(undefined), 0);
    assert.equal(isGear('hatch'), true);
    const scene = { floorY: 1, waterY: null, light: true, night: 0 };
    const base = { id: 'h', floor: 'f', type: 'hatch' as const, x: 2, z: 3, rotation: 0, w: 0.6, d: 0.6, h: 0.06, base: 0, label: '', warn: false, mast: false, angle: 70 };
    const parts = (g: ReturnType<typeof buildGear>): number => {
        let n = 0;
        g.traverse(o => {
            n += (o as unknown as { isMesh?: boolean }).isMesh ? 1 : 0;
        });
        return n;
    };
    const shut = buildGear({ ...base, variant: 'square', value: 0 }, scene);
    const open = buildGear({ ...base, variant: 'round', value: 1 }, scene);
    // frame, opening, lid rim and pane; open also the two struts
    assert.equal(parts(shut), 4);
    assert.equal(parts(open), 6);
    assert.deepEqual(open.position.toArray(), [2, 1, 3]);
    // the lid stands up by its angle about the front edge
    const lid = open.children.find((c: { type: string }) => c.type === 'Group')!;
    assert.ok(Math.abs(lid.rotation.x + (70 * Math.PI) / 180) < 1e-9);
});

test('the library pictures of a boat: anchor and gear are built as in the viewer, other furniture not', () => {
    for (const [type, w, d, h] of [
        ['anchor', 0.36, 0.8, 0.3],
        ['tank', 0.8, 0.5, 0.4],
        ['rudder', 0.12, 0.55, 1],
        ['propeller', 0.42, 0.35, 0.6],
        ['hatch', 0.6, 0.6, 0.06],
    ] as const) {
        const group = boatPicture(type, w, d, h, null);
        assert.ok(group, type);
        assert.ok(!new Box3().setFromObject(group).isEmpty(), type);
        disposeBoatPicture(group);
    }
    assert.equal(boatPicture('sofa', 2, 1, 0.8, null), null);
});
