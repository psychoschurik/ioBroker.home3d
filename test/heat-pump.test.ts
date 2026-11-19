import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHeatPump, heatPumpDefrost, heatPumpRun } from '../frontend/vendor-ext/heat-pump';

const st = (state: string, attributes: Record<string, unknown> = {}): { state: string; attributes: Record<string, unknown> } => ({ state, attributes });

test('a heat pump turns its fan by its power, stands in standby, steams while it defrosts', () => {
    assert.deepEqual(heatPumpRun(null), { on: false, rate: 0, unknown: false });
    assert.equal(heatPumpRun(st('30', { unit_of_measurement: 'W' })).on, false);
    assert.equal(heatPumpRun(st('1500', { unit_of_measurement: 'W' })).rate, 1.65);
    assert.equal(heatPumpRun(st('4,2', { unit_of_measurement: 'kW' })).rate, 2.5);
    assert.equal(heatPumpRun(st('on')).rate, 1.6);
    assert.equal(heatPumpRun(st('unavailable')).unknown, true);
    assert.equal(heatPumpDefrost(st('Abtauen')), true);
    assert.equal(heatPumpDefrost(st('defrosting')), true);
    assert.equal(heatPumpDefrost(st('true')), true);
    assert.equal(heatPumpDefrost(st('Heizen')), false);
    assert.equal(heatPumpDefrost(st('off')), false);
    assert.equal((buildHeatPump(1, 0.4, 0.85).userData.fans as unknown[]).length, 1);
    assert.equal((buildHeatPump(1.4, 0.45, 1.3).userData.fans as unknown[]).length, 2);
});
