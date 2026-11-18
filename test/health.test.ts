import assert from 'node:assert/strict';
import test from 'node:test';
import {
    aliasTarget,
    belongs,
    deviceOf,
    findHealth,
    healthAttributes,
    healthStateIds,
    pickHealth,
    scanPrefix,
} from '../frontend/health';
import type { StateObject, StateValue } from '../frontend/model';

const obj = (id: string, common: Record<string, unknown>): StateObject =>
    ({ _id: id, type: 'state', common, native: {} }) as unknown as StateObject;
const val = (v: unknown): StateValue => ({ val: v, ack: true, ts: 0, lc: 0, from: '' }) as unknown as StateValue;

test('health: device, prefix and what belongs to a datapoint', () => {
    assert.equal(deviceOf('hm-rpc.0.ABC123.1.TEMPERATURE'), 'hm-rpc.0.ABC123');
    assert.equal(deviceOf('javascript.0.x.y'), null);
    assert.equal(deviceOf('zigbee.0.state'), null);
    // a small device is read whole, a deep tree only around the datapoint
    assert.equal(scanPrefix('hm-rpc.0.ABC123.1.TEMPERATURE', 'hm-rpc.0.ABC123'), 'hm-rpc.0.ABC123');
    assert.equal(scanPrefix('open-meteo.0.home.current.hourly.temp', 'open-meteo.0.home'), 'open-meteo.0.home.current.hourly');
    assert.equal(belongs('hm-rpc.0.ABC123.0.LOW_BAT', 'hm-rpc.0.ABC123.1.TEMPERATURE', 'hm-rpc.0.ABC123'), true);
    assert.equal(belongs('zigbee.0.aa.battery', 'zigbee.0.aa.temperature', 'zigbee.0.aa'), true);
    assert.equal(belongs('hm-rpc.0.ABC123.2.LOWBAT', 'hm-rpc.0.ABC123.1.TEMPERATURE', 'hm-rpc.0.ABC123'), false);
    assert.equal(aliasTarget(obj('alias.0.t', { alias: { id: 'zigbee.0.aa.temperature' } })), 'zigbee.0.aa.temperature');
    assert.equal(aliasTarget(obj('alias.0.t', { alias: { id: { read: 'zigbee.0.aa.temperature', write: 'x' } } })), 'zigbee.0.aa.temperature');
    assert.equal(aliasTarget(obj('alias.0.t', {})), null);
});

test('health: picks battery, low battery and reachability by role and name', () => {
    const objects: Record<string, StateObject> = {
        'hm-rpc.0.ABC.0.LOW_BAT': obj('hm-rpc.0.ABC.0.LOW_BAT', { role: 'indicator.maintenance.lowbat', type: 'boolean' }),
        'hm-rpc.0.ABC.0.UNREACH': obj('hm-rpc.0.ABC.0.UNREACH', { role: 'indicator.maintenance.unreach', type: 'boolean' }),
        'hm-rpc.0.ABC.1.TEMPERATURE': obj('hm-rpc.0.ABC.1.TEMPERATURE', { role: 'value.temperature', type: 'number' }),
        'zigbee.0.aa.battery': obj('zigbee.0.aa.battery', { role: 'value', type: 'number', unit: '%' }),
        'zigbee.0.aa.available': obj('zigbee.0.aa.available', { role: 'state', type: 'boolean' }),
        'zigbee.0.aa.voltage': obj('zigbee.0.aa.voltage', { role: 'value', type: 'number', unit: 'mV' }),
    };
    const hm = pickHealth('hm-rpc.0.ABC.1.TEMPERATURE', 'hm-rpc.0.ABC', objects);
    assert.equal(hm.lowbat, 'hm-rpc.0.ABC.0.LOW_BAT');
    assert.equal(hm.unreach, 'hm-rpc.0.ABC.0.UNREACH');
    assert.equal(hm.battery, undefined);
    const zb = pickHealth('zigbee.0.aa.temperature', 'zigbee.0.aa', objects);
    assert.equal(zb.battery, 'zigbee.0.aa.battery');
    assert.equal(zb.reach, 'zigbee.0.aa.available');
});

test('health: a Shelly keeps its battery in a channel of its own, a device with two batteries keeps neither', () => {
    const d = 'shelly.0.shellyhtg3#innertemp#1';
    const objects: Record<string, StateObject> = {
        [`${d}.online`]: obj(`${d}.online`, { role: 'indicator.reachable', type: 'boolean' }),
        [`${d}.DevicePower0.BatteryPercent`]: obj(`${d}.DevicePower0.BatteryPercent`, { role: 'value.battery', type: 'number', unit: '%' }),
        [`${d}.Temperature0.Celsius`]: obj(`${d}.Temperature0.Celsius`, { role: 'value.temperature', type: 'number' }),
    };
    const h = pickHealth(`${d}.Temperature0.Celsius`, d, objects);
    assert.equal(h.battery, `${d}.DevicePower0.BatteryPercent`);
    assert.equal(h.reach, `${d}.online`);
    // asleep: offline, but it reported an hour ago
    const now = 1_800_000_000_000;
    const states = {
        [`${d}.online`]: { val: false, ts: now - 3600_000 },
        [`${d}.DevicePower0.BatteryPercent`]: { val: 91, ts: now - 3600_000 },
    } as unknown as Record<string, StateValue>;
    assert.equal(healthAttributes(h, states, now).unreachable, undefined);
    assert.equal(healthAttributes(h, states, now).battery_level, 91);
    const two = {
        ...objects,
        [`${d}.DevicePower1.BatteryPercent`]: obj(`${d}.DevicePower1.BatteryPercent`, { role: 'value.battery', type: 'number', unit: '%' }),
    };
    assert.equal(pickHealth(`${d}.Temperature0.Celsius`, d, two).battery, undefined);
});

test('health: attributes from the values', () => {
    const h = {
        device: 'zigbee.0.aa',
        battery: 'zigbee.0.aa.battery',
        reach: 'zigbee.0.aa.available',
        alive: 'system.adapter.zigbee.0.alive',
    };
    assert.deepEqual(
        healthAttributes(h, {
            'zigbee.0.aa.battery': val(140),
            'zigbee.0.aa.available': val(false),
            'system.adapter.zigbee.0.alive': val(true),
        }),
        { health_device: 'zigbee.0.aa', battery_level: 100, unreachable: true },
    );
    // a battery device that sleeps: offline since an hour is fine, since three days it is out of reach
    const now = 10 * 86400_000;
    const at = (v: unknown, ts: number): StateValue => ({ ...val(v), ts }) as StateValue;
    assert.equal(
        healthAttributes(h, { 'zigbee.0.aa.battery': at(90, now - 3600_000), 'zigbee.0.aa.available': at(false, now - 3600_000) }, now)
            .unreachable,
        undefined,
    );
    assert.equal(
        healthAttributes(h, { 'zigbee.0.aa.battery': at(90, now - 3 * 86400_000), 'zigbee.0.aa.available': at(false, now - 3 * 86400_000) }, now)
            .unreachable,
        true,
    );
    // chosen in the house settings: only the last update counts, of any datapoint of the device
    const stale = { staleMs: 15 * 60_000, own: ['zigbee.0.aa.temperature'] };
    const fresh = { 'zigbee.0.aa.available': at(false, now - 3600_000), 'zigbee.0.aa.temperature': at(21, now - 5 * 60_000) };
    assert.equal(healthAttributes(h, fresh, now, stale).unreachable, undefined);
    const old = { 'zigbee.0.aa.available': at(true, now - 3600_000), 'zigbee.0.aa.temperature': at(21, now - 20 * 60_000) };
    assert.equal(healthAttributes(h, old, now, stale).unreachable, true);
    // nothing known yet: no verdict
    assert.equal(healthAttributes(h, {}, now, stale).unreachable, undefined);
    // without a battery offline is offline
    const mains = { device: 'shelly.0.x', reach: 'shelly.0.x.online' };
    assert.equal(healthAttributes(mains, { 'shelly.0.x.online': at(false, now - 60_000) }, now).unreachable, true);
    assert.deepEqual(healthAttributes(h, { 'system.adapter.zigbee.0.alive': val(false) }), {
        health_device: 'zigbee.0.aa',
        iobroker_adapter: 'stopped',
    });
    assert.deepEqual(healthStateIds(new Map([['x', h]])).sort(), [
        'system.adapter.zigbee.0.alive',
        'zigbee.0.aa.available',
        'zigbee.0.aa.battery',
    ]);
});

test('health: found once per device, also through an alias', async () => {
    const lists: string[] = [];
    const gets: string[][] = [];
    const tree: Record<string, StateObject> = {
        'zigbee.0.aa.temperature': obj('zigbee.0.aa.temperature', { role: 'value.temperature', type: 'number' }),
        'zigbee.0.aa.humidity': obj('zigbee.0.aa.humidity', { role: 'value.humidity', type: 'number' }),
        'zigbee.0.aa.battery': obj('zigbee.0.aa.battery', { role: 'value.battery', type: 'number', unit: '%' }),
    };
    const objects: Record<string, StateObject> = {
        'alias.0.living.temp': obj('alias.0.living.temp', { alias: { id: 'zigbee.0.aa.temperature' } }),
    };
    const cache = new Map<string, Record<string, StateObject>>();
    const list = (prefix: string): Promise<Record<string, StateObject>> => {
        lists.push(prefix);
        return Promise.resolve(Object.fromEntries(Object.entries(tree).filter(([id]) => id.startsWith(`${prefix}.`))));
    };
    const get = (ids: string[]): Promise<Record<string, StateObject>> => {
        gets.push(ids);
        return Promise.resolve({ 'system.adapter.zigbee.0.alive': obj('system.adapter.zigbee.0.alive', { type: 'boolean' }) });
    };
    const ids = ['alias.0.living.temp', 'zigbee.0.aa.humidity', '0_userdata.0.x.y'];
    const found = await findHealth(ids, objects, list, get, cache);
    assert.deepEqual(lists, ['zigbee.0.aa']);
    assert.equal(found.get('alias.0.living.temp')?.battery, 'zigbee.0.aa.battery');
    assert.equal(found.get('zigbee.0.aa.humidity')?.alive, 'system.adapter.zigbee.0.alive');
    assert.equal(found.get('zigbee.0.aa.humidity')?.connection, undefined);
    assert.equal(found.has('0_userdata.0.x.y'), false);
    // the second time everything comes from the cache
    await findHealth(ids, objects, list, get, cache);
    assert.equal(lists.length, 1);
    assert.equal(gets.length, 1);
});

test('health: Bluetooth sensors in a folder are devices of their own', async () => {
    const folder = { _id: 'shelly.0.ble', type: 'folder', common: { name: 'Bluetooth' }, native: {} } as unknown as StateObject;
    const dev = (id: string): StateObject => ({ _id: id, type: 'device', common: { name: id }, native: {} }) as unknown as StateObject;
    const tree: Record<string, StateObject> = {};
    for (const mac of ['7c:aa', '7c:bb']) {
        tree[`shelly.0.ble.${mac}.window`] = obj(`shelly.0.ble.${mac}.window`, { role: 'sensor.window', type: 'number' });
        tree[`shelly.0.ble.${mac}.battery`] = obj(`shelly.0.ble.${mac}.battery`, { role: 'value.battery', type: 'number', unit: '%' });
    }
    const all: Record<string, StateObject> = { 'shelly.0.ble': folder, 'shelly.0.ble.7c:aa': dev('shelly.0.ble.7c:aa'), 'shelly.0.ble.7c:bb': dev('shelly.0.ble.7c:bb') };
    const lists: string[] = [];
    const gets: string[][] = [];
    const list = (prefix: string): Promise<Record<string, StateObject>> => {
        lists.push(prefix);
        return Promise.resolve(Object.fromEntries(Object.entries(tree).filter(([id]) => id.startsWith(`${prefix}.`))));
    };
    const get = (ids: string[]): Promise<Record<string, StateObject>> => {
        gets.push(ids);
        return Promise.resolve(Object.fromEntries(ids.filter(i => all[i]).map(i => [i, all[i]])));
    };
    const cache = new Map<string, Record<string, StateObject>>();
    const ids = ['shelly.0.ble.7c:aa.window', 'shelly.0.ble.7c:bb.window'];
    const found = await findHealth(ids, {}, list, get, cache);
    assert.deepEqual(
        ids.map(i => [found.get(i)?.device, found.get(i)?.battery]),
        [
            ['shelly.0.ble.7c:aa', 'shelly.0.ble.7c:aa.battery'],
            ['shelly.0.ble.7c:bb', 'shelly.0.ble.7c:bb.battery'],
        ],
    );
    // each sensor is read on its own, not the whole folder
    assert.deepEqual(lists.sort(), ['shelly.0.ble.7c:aa', 'shelly.0.ble.7c:bb']);
    // the device, its channels and the adapter in one request
    assert.equal(gets.length, 1);
    await findHealth(ids, {}, list, get, cache);
    assert.equal(gets.length, 1);
    assert.equal(lists.length, 2);
});

test('health: the type-detector finds the battery first, a chosen one wins for the whole device', async () => {
    const device = { _id: 'zigbee.0.bb', type: 'device', common: { name: 'Contact' }, native: {} } as unknown as StateObject;
    const tree: Record<string, StateObject> = {
        'zigbee.0.bb.opened': obj('zigbee.0.bb.opened', { role: 'sensor.window', type: 'boolean', read: true }),
        'zigbee.0.bb.temp': obj('zigbee.0.bb.temp', { role: 'value.temperature', type: 'number', read: true }),
        // a name no guess knows, a role the type-detector knows
        'zigbee.0.bb.power_level': obj('zigbee.0.bb.power_level', { role: 'value.battery', type: 'number', unit: '%', read: true }),
        'zigbee.0.bb.voltage_low': obj('zigbee.0.bb.voltage_low', { role: 'indicator.lowbat', type: 'boolean', read: true }),
        'zigbee.0.bb.supply': obj('zigbee.0.bb.supply', { role: 'state', type: 'boolean', read: true }),
    };
    const all: Record<string, StateObject> = { 'zigbee.0.bb': device, ...tree };
    const list = (prefix: string): Promise<Record<string, StateObject>> =>
        Promise.resolve(Object.fromEntries(Object.entries(tree).filter(([id]) => id.startsWith(`${prefix}.`))));
    const get = (ids: string[]): Promise<Record<string, StateObject>> =>
        Promise.resolve(Object.fromEntries(ids.filter(i => all[i]).map(i => [i, all[i]])));
    const ids = ['zigbee.0.bb.opened', 'zigbee.0.bb.temp'];
    const auto = await findHealth(ids, {}, list, get);
    const h = auto.get('zigbee.0.bb.opened');
    assert.equal(h?.detected, 'detector');
    assert.equal(h?.lowbat, 'zigbee.0.bb.voltage_low');
    // chosen at one datapoint: counts for the other one of the device too
    const own = await findHealth(ids, {}, list, get, new Map(), new Map([['zigbee.0.bb.temp', 'zigbee.0.bb.supply']]));
    for (const id of ids) {
        assert.deepEqual([own.get(id)?.detected, own.get(id)?.lowbat, own.get(id)?.battery], ['own', 'zigbee.0.bb.supply', undefined]);
    }
    // no battery at all (on the on-board supply)
    const none = await findHealth(ids, {}, list, get, new Map(), new Map([['zigbee.0.bb.opened', 'none']]));
    assert.deepEqual([none.get('zigbee.0.bb.temp')?.detected, none.get('zigbee.0.bb.temp')?.lowbat, none.get('zigbee.0.bb.temp')?.battery], ['own', undefined, undefined]);
    // without the type-detector the guess by name and role
    const guess = await findHealth(ids, {}, list, get, new Map(), new Map(), null);
    assert.equal(guess.get('zigbee.0.bb.opened')?.detected, 'guess');
});
