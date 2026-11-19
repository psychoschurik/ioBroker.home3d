import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer, ledLit, serverKind, serverLoad, type ServerLed, type ServerLoad } from '../frontend/vendor-ext/server';

const st = (state: string, attributes: Record<string, unknown> = {}): { state: string; attributes: Record<string, unknown> } => ({
    state,
    attributes,
});

test('a server runs by its socket: on, off, unknown, and flickers faster with more power', () => {
    assert.equal(serverKind('nas'), 'nas');
    assert.equal(serverKind(undefined), 'rack');
    // without a socket it runs as a picture
    assert.deepEqual(serverLoad(null, false), { on: true, rate: 1.5, unknown: false });
    assert.deepEqual(serverLoad(st('on'), true), { on: true, rate: 2, unknown: false });
    assert.deepEqual(serverLoad(st('off'), true), { on: false, rate: 0, unknown: false });
    assert.equal(serverLoad(st('unavailable'), true).unknown, true);
    assert.equal(serverLoad(undefined, true).unknown, true);
    // standby is off, more power flickers faster, up to 8 per second
    assert.equal(serverLoad(st('0.8', { unit_of_measurement: 'W' }), true).on, false);
    const idle = serverLoad(st('25', { unit_of_measurement: 'W' }), true);
    const busy = serverLoad(st('0,1', { unit_of_measurement: 'kW' }), true);
    assert.equal(idle.rate, 2);
    assert.equal(busy.rate, 5);
    assert.equal(serverLoad(st('900', { device_class: 'power' }), true).rate, 8);
});

test('the LEDs: dark while off, the power LED steady while on, the activity flickering, amber blinking when unknown', () => {
    const on: ServerLoad = { on: true, rate: 4, unknown: false };
    const off: ServerLoad = { on: false, rate: 0, unknown: false };
    const unknown: ServerLoad = { on: false, rate: 0, unknown: true };
    const times = Array.from({ length: 200 }, (_, k) => k * 0.05);
    assert.ok(times.every(t => ledLit('power', 1, on, t)));
    assert.ok(times.every(t => !ledLit('act', 2, off, t) && !ledLit('power', 1, off, t)));
    const act = times.map(t => ledLit('act', 3, on, t));
    assert.ok(act.includes(true) && act.includes(false), 'an activity LED flickers');
    const blink = times.map(t => ledLit('power', 1, unknown, t));
    assert.ok(blink.includes(true) && blink.includes(false), 'the power LED blinks when unknown');
    assert.ok(times.every(t => !ledLit('act', 3, unknown, t)));
});

test('a rack has a switch with ports and servers with LEDs, a NAS its bays', () => {
    const rack = buildServer('rack', 0.6, 0.8, 1.2).userData.leds as ServerLed[];
    assert.equal(rack.filter(l => l.role === 'net').length, 12);
    assert.ok(rack.filter(l => l.role === 'power').length >= 5);
    const nas = buildServer('nas', 0.2, 0.25, 0.2).userData.leds as ServerLed[];
    assert.equal(nas.filter(l => l.role === 'act').length, 4);
    assert.equal(nas.filter(l => l.role === 'power').length, 1);
});
