import assert from 'node:assert/strict';
import test from 'node:test';
import type { Object3D } from 'three';
import { buildMailFlag, FLAG_DOWN, flagPivot, mailBase, mailShape } from '../frontend/vendor-ext/mail-flag';

test('a mailbox flag turns at the right side and starts folded down', () => {
    assert.equal(mailShape('pole'), 'pole');
    assert.equal(mailShape('xyz'), 'wall');
    assert.equal(mailBase('wall'), 1);
    assert.equal(mailBase('bank'), 0.75);
    assert.equal(mailBase('pole'), 0);
    const g = buildMailFlag('pole', 0.24, 0.5, 1.15);
    const arm = g.userData.arm as Object3D;
    assert.equal(arm.rotation.x, FLAG_DOWN);
    const p = flagPivot('pole', 0.24, 0.5, 1.15);
    assert.ok(Math.abs(arm.position.x - 0.128) < 1e-9);
    assert.ok(p.y > 1 && p.y < 1.15);
});
