import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEbike, ebikeCharging, ebikeColor, ebikeLevel, ebikeLit, EBIKE_LEDS } from '../frontend/vendor-ext/ebike';

const st = (state: string, attributes: Record<string, unknown> = {}): { state: string; attributes: Record<string, unknown> } => ({
    state,
    attributes,
});

test('an e-bike shows its charge on five LEDs and charges by its charger', () => {
    assert.equal(ebikeLevel(st('72')), 72);
    assert.equal(ebikeLevel(st('55 %')), 55);
    assert.equal(ebikeLevel(st('unavailable')), null);
    assert.equal(ebikeLit(null), 0);
    assert.equal(ebikeLit(0), 0);
    assert.equal(ebikeLit(3), 1);
    assert.equal(ebikeLit(50), 3);
    assert.equal(ebikeLit(89), 4);
    assert.equal(ebikeLit(95), 5);
    assert.equal(ebikeColor(15), 0xff3b30);
    assert.equal(ebikeColor(40), 0xffb020);
    assert.equal(ebikeColor(80), 0x34d058);
    assert.equal(ebikeCharging(st('3', { unit_of_measurement: 'W' })), false);
    assert.equal(ebikeCharging(st('85', { unit_of_measurement: 'W' })), true);
    assert.equal(ebikeCharging(st('on')), true);
    assert.equal(ebikeCharging(st('off')), false);
    const g = buildEbike(1.8, 0.62, 1.1);
    assert.equal((g.userData.leds as unknown[]).length, EBIKE_LEDS);
    assert.equal((g.userData.charger as { visible: boolean }).visible, false);
});
