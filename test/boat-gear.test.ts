import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLightY, hatchOpen, isGear, lightOn, tankFill, tankWarn } from '../frontend/vendor-ext/boat-kinds';
import { Box3 } from 'three';
import { buildGear } from '../frontend/vendor-ext/boat-gear';
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
