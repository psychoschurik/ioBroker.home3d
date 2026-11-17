import test from 'node:test';
import assert from 'node:assert/strict';
import { withDatapoint } from '../frontend/entities';
import { parsePosition } from '../frontend/sun';
import type { Mapping, StateObject } from '../frontend/model';

const soc = (unit?: string): StateObject =>
    ({ type: 'state', common: { name: 'SoC', type: 'number', role: 'value.battery', read: true, write: false, unit } }) as StateObject;

test('another datapoint keeps the device and moves every reference', () => {
    const m: Mapping = {
        entity_id: 'sensor.abc',
        name: 'Batterie Ladestand',
        state: 'victron.0.soc',
        attributes: { unit_of_measurement: 'V', device_class: 'battery', other: { id: 'victron.0.soc' } },
        actions: { reset: [{ id: 'victron.0.soc', value: 0 }] },
        when: { id: 'victron.0.on', values: [true] },
    };
    const next = withDatapoint(m, 'wattcycle.0.total.soc_min', soc('%'));
    assert.equal(next.entity_id, 'sensor.abc');
    assert.equal(next.name, 'Batterie Ladestand');
    assert.equal(next.state, 'wattcycle.0.total.soc_min');
    assert.deepEqual(next.attributes, {
        unit_of_measurement: '%',
        device_class: 'battery',
        other: { id: 'wattcycle.0.total.soc_min' },
    });
    assert.deepEqual(next.actions, { reset: [{ id: 'wattcycle.0.total.soc_min', value: 0 }] });
    // another datapoint (the condition) stays as it is
    assert.deepEqual(next.when, { id: 'victron.0.on', values: [true] });
    // the old mapping is untouched
    assert.equal(m.state, 'victron.0.soc');
});

test('a datapoint without a unit leaves none', () => {
    const m: Mapping = { entity_id: 'sensor.x', name: 'x', state: 'a.0.x', attributes: { unit_of_measurement: 'W' } };
    assert.equal(withDatapoint(m, 'a.0.y', soc()).attributes?.unit_of_measurement, undefined);
});

test('a position from a datapoint', () => {
    assert.deepEqual(parsePosition('20.575776666666666;38.4608'), { lat: 38.4608, lon: 20.575776666666666 });
    assert.deepEqual(parsePosition('38.46, 20.57'), { lat: 38.46, lon: 20.57 });
    assert.deepEqual(parsePosition({ latitude: 38.46, longitude: 20.57 }), { lat: 38.46, lon: 20.57 });
    assert.deepEqual(parsePosition('{"lat":38.46,"lon":20.57}'), { lat: 38.46, lon: 20.57 });
    // no fix, nonsense, out of range
    assert.equal(parsePosition('0;0'), null);
    assert.equal(parsePosition(''), null);
    assert.equal(parsePosition('abc'), null);
    assert.equal(parsePosition('200;95'), null);
    assert.equal(parsePosition(null), null);
});
