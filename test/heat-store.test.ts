import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHeatStore, storeColor, storeHeating, storeLayers, storeTemp, STORE_LAYERS, STORE_UNKNOWN } from '../frontend/vendor-ext/heat-store';

const st = (state: string, attributes: Record<string, unknown> = {}): { state: string; attributes: Record<string, unknown> } => ({
    state,
    attributes,
});

test('a store shows the layers of its water by temperature and a flame while it is heated', () => {
    assert.equal(storeTemp(st('61,5')), 61.5);
    assert.equal(storeTemp(st('140', { unit_of_measurement: '°F' })), 60);
    assert.equal(storeTemp(st('unknown')), null);
    // top and bottom: a straight line between them
    assert.deepEqual(storeLayers(60, null, 30, 4), [30, 40, 50, 60]);
    // top, middle, bottom: two pieces
    assert.deepEqual(storeLayers(60, 50, 20, 5), [20, 35, 50, 55, 60]);
    // only the top: all as it
    assert.deepEqual(storeLayers(55, null, null, 3), [55, 55, 55]);
    assert.deepEqual(storeLayers(null, null, null, 2), [null, null]);
    assert.equal(storeColor(null), STORE_UNKNOWN);
    assert.notEqual(storeColor(20), storeColor(70));
    // hot is red, cold is blue
    assert.ok((storeColor(70) >> 16) > (storeColor(70) & 0xff));
    assert.ok((storeColor(15) & 0xff) > (storeColor(15) >> 16));
    assert.equal(storeHeating(st('on')), true);
    assert.equal(storeHeating(st('Brenner an')), true);
    assert.equal(storeHeating(st('heating')), true);
    assert.equal(storeHeating(st('off')), false);
    assert.equal(storeHeating(st('5', { unit_of_measurement: 'W' })), false);
    assert.equal(storeHeating(st('2,1', { unit_of_measurement: 'kW' })), true);
    const g = buildHeatStore(0.75, 0.75, 1.9);
    assert.equal((g.userData.layers as unknown[]).length, STORE_LAYERS);
    assert.equal((g.userData.flame as { visible: boolean }).visible, false);
});
