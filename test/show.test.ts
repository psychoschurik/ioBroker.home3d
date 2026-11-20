import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isCommand, PLACES_ID, SHOW_ID } from '../frontend/show';

test('home3d.0.show: only a new, unconfirmed text is a command', () => {
    assert.equal(isCommand({ val: 'Unterdeck', ack: false, ts: 2000 }, 1000), true);
    // the 3D view's own confirmation
    assert.equal(isCommand({ val: 'Unterdeck', ack: true, ts: 2000 }, 1000), false);
    // the value present before the page subscribed, or one seen already
    assert.equal(isCommand({ val: 'Unterdeck', ack: false, ts: 1000 }, 1000), false);
    assert.equal(isCommand({ val: '  ', ack: false, ts: 2000 }, 1000), false);
    assert.equal(isCommand({ val: 3, ack: false, ts: 2000 }, 1000), false);
    assert.equal(isCommand(null, 0), false);
});

test('home3d.0.show and places are instance objects with a description for agents', () => {
    const pkg = JSON.parse(readFileSync('io-package.json', 'utf8')) as {
        instanceObjects: { _id: string; type: string; common: { write?: boolean; desc?: Record<string, string> } }[];
    };
    for (const id of [SHOW_ID, PLACES_ID]) {
        const obj = pkg.instanceObjects.find(o => `home3d.0.${o._id}` === id);
        assert.ok(obj, id);
        assert.equal(obj.type, 'state');
        assert.ok(obj.common.desc?.en && obj.common.desc.de && obj.common.desc.ru, `${id}: desc`);
    }
    assert.equal(pkg.instanceObjects.find(o => o._id === 'show')?.common.write, true);
});
