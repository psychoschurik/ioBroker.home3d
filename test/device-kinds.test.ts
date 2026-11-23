import test from 'node:test';
import assert from 'node:assert/strict';
import { entities, execute, validateMappings } from '../frontend/entities';
import {
    buildDevice,
    findLights,
    guessParts,
    keepParts,
    lightCandidates,
    partsOf,
    rebuilt,
} from '../frontend/device-kinds';
import { devicesOf } from '../frontend/device-add';
import { mediaPlayerMapping } from '../frontend/media';
import { mappedIds } from '../frontend/store';
import type { IoAccess, Mapping, StateObject, StateValue } from '../frontend/model';

const st = (role: string, type: string, write = false, extra: Record<string, unknown> = {}): StateObject =>
    ({ type: 'state', common: { name: role, role, type, read: true, write, ...extra } }) as StateObject;

/** An IoAccess on `objects`, recording every write; `now` gives the current values. */
function access(
    objects: Record<string, StateObject>,
    now: Record<string, unknown> = {},
): { io: IoAccess; written: [string, unknown][] } {
    const written: [string, unknown][] = [];
    const io = {
        getObjects: async (ids: string[]) => Object.fromEntries(ids.filter(id => objects[id]).map(id => [id, objects[id]])),
        getState: async (id: string) => (id in now ? { val: now[id] } : null),
        setState: async (id: string, value: unknown) => void written.push([id, value]),
    } as unknown as IoAccess;
    return { io, written };
}

const states = (vals: Record<string, unknown>): Record<string, StateValue> =>
    Object.fromEntries(Object.entries(vals).map(([id, val]) => [id, { val, ts: 1, lc: 1 } as StateValue]));

// a zigbee LED strip: its switch, dimmer (0 … 100), colour as text and white tone in mired; a sensor beside it
const strip: Record<string, StateObject> = {
    'zigbee.0.led.state': st('switch', 'boolean', true),
    'zigbee.0.led.brightness': st('level.dimmer', 'number', true, { min: 0, max: 100 }),
    'zigbee.0.led.color': st('level.color.rgb', 'string', true),
    'zigbee.0.led.colortemp': st('level.color.temperature', 'number', true, { min: 153, max: 500 }),
    'zigbee.0.led.link_quality': st('value', 'number'),
};

test('a switch, a dimmer, a colour and a white tone make one light with all of them', async () => {
    const parts = guessParts('light', strip);
    assert.deepEqual(parts, {
        switch: 'zigbee.0.led.state',
        brightness: 'zigbee.0.led.brightness',
        rgb: 'zigbee.0.led.color',
        color_temp: 'zigbee.0.led.colortemp',
    });
    const m = buildDevice('light', 'light.led', 'LED-Streifen', parts, strip);
    validateMappings([m], strip);
    assert.deepEqual(m.parts, parts);
    const out = entities(
        [m],
        states({
            'zigbee.0.led.state': true,
            'zigbee.0.led.brightness': 57,
            'zigbee.0.led.color': '#ff8000',
            'zigbee.0.led.colortemp': 370,
        }),
        strip,
    )['light.led'];
    assert.equal(out.state, 'on');
    assert.equal(out.attributes.brightness, 145);
    assert.deepEqual(out.attributes.rgb_color, [255, 128, 0]);
    // 370 mired is 2703 K; its range 153 … 500 mired is 2000 … 6536 K
    assert.equal(out.attributes.color_temp_kelvin, 2703);
    assert.equal(out.attributes.min_color_temp_kelvin, 2000);
    assert.equal(out.attributes.max_color_temp_kelvin, 6536);
    assert.deepEqual(out.attributes.supported_color_modes, ['rgb', 'color_temp']);
    // the editor's device form lists every part of a light, the missing ones as null
    assert.deepEqual((out.attributes.iobroker_parts as [string, string | null][]).slice(0, 4), [
        ['switch', 'zigbee.0.led.state'],
        ['brightness', 'zigbee.0.led.brightness'],
        ['rgb', 'zigbee.0.led.color'],
        ['red', null],
    ]);

    // the 3D view's slider (brightness_pct), colour swatch and white tone
    const { io, written } = access(strip);
    await execute([m], 'light', 'turn_on', { entity_id: 'light.led', brightness_pct: 40 }, io);
    await execute([m], 'light', 'turn_on', { entity_id: 'light.led', rgb_color: [0, 0, 255] }, io);
    await execute([m], 'light', 'turn_on', { entity_id: 'light.led', color_temp_kelvin: 4000 }, io);
    // a call in 0 … 255 too
    await execute([m], 'light', 'turn_on', { entity_id: 'light.led', brightness: 255 }, io);
    await execute([m], 'light', 'turn_off', { entity_id: 'light.led' }, io);
    assert.deepEqual(written, [
        ['zigbee.0.led.state', true],
        ['zigbee.0.led.brightness', 40],
        ['zigbee.0.led.state', true],
        ['zigbee.0.led.color', '#0000ff'],
        ['zigbee.0.led.state', true],
        ['zigbee.0.led.colortemp', 250],
        ['zigbee.0.led.state', true],
        ['zigbee.0.led.brightness', 100],
        ['zigbee.0.led.state', false],
    ]);
});

test('a dimmer without a switch switches the light: on above 0, at full when only switched on, toggled', async () => {
    const objects = { 'knx.0.dim': st('level.dimmer', 'number', true, { min: 0, max: 255 }) };
    const m = buildDevice('light', 'light.dim', 'Dimmer', { brightness: 'knx.0.dim' }, objects);
    validateMappings([m], objects);
    assert.equal(entities([m], states({ 'knx.0.dim': 0 }), objects)['light.dim'].state, 'off');
    const on = entities([m], states({ 'knx.0.dim': 128 }), objects)['light.dim'];
    assert.equal(on.state, 'on');
    assert.equal(on.attributes.brightness, 128);
    assert.deepEqual(on.attributes.supported_color_modes, ['brightness']);
    const { io, written } = access(objects, { 'knx.0.dim': 128 });
    await execute([m], 'light', 'turn_on', { entity_id: 'light.dim' }, io);
    await execute([m], 'light', 'turn_on', { entity_id: 'light.dim', brightness_pct: 50 }, io);
    await execute([m], 'light', 'turn_off', { entity_id: 'light.dim' }, io);
    await execute([m], 'light', 'toggle', { entity_id: 'light.dim' }, io);
    assert.deepEqual(written, [
        ['knx.0.dim', 255],
        ['knx.0.dim', 127.5],
        ['knx.0.dim', 0],
        ['knx.0.dim', 0],
    ]);
});

test('red, green and blue in datapoints of their own make one colour; hue and saturation too', async () => {
    const rgb = {
        'dmx.0.r': st('level.color.red', 'number', true, { max: 255 }),
        'dmx.0.g': st('level.color.green', 'number', true, { max: 255 }),
        'dmx.0.b': st('level.color.blue', 'number', true, { max: 255 }),
    };
    const m = buildDevice('light', 'light.dmx', 'DMX', guessParts('light', rgb), rgb);
    validateMappings([m], rgb);
    assert.deepEqual(mappedIds([m]).sort(), ['dmx.0.b', 'dmx.0.g', 'dmx.0.r']);
    const out = entities([m], states({ 'dmx.0.r': 10, 'dmx.0.g': 20, 'dmx.0.b': 0 }), rgb)['light.dmx'];
    assert.deepEqual(out.attributes.rgb_color, [10, 20, 0]);
    assert.equal(out.state, 'on');
    const { io, written } = access(rgb);
    await execute([m], 'light', 'turn_on', { entity_id: 'light.dmx', rgb_color: [1, 2, 3] }, io);
    // switched by its colour: on is white
    await execute([m], 'light', 'turn_on', { entity_id: 'light.dmx' }, io);
    assert.deepEqual(written, [
        ['dmx.0.r', 1],
        ['dmx.0.g', 2],
        ['dmx.0.b', 3],
        ['dmx.0.r', 255],
        ['dmx.0.g', 255],
        ['dmx.0.b', 255],
    ]);

    const hs = {
        'hue.0.lamp.on': st('switch.light', 'boolean', true),
        'hue.0.lamp.hue': st('level.color.hue', 'number', true, { max: 65535 }),
        'hue.0.lamp.sat': st('level.color.saturation', 'number', true, { max: 254 }),
    };
    const h = buildDevice('light', 'light.hue', 'Hue', guessParts('light', hs), hs);
    const shown = entities([h], states({ 'hue.0.lamp.on': true, 'hue.0.lamp.hue': 0, 'hue.0.lamp.sat': 254 }), hs)[
        'light.hue'
    ];
    // read as hue and saturation, shown as RGB too
    assert.deepEqual(shown.attributes.hs_color, [0, 100]);
    assert.deepEqual(shown.attributes.rgb_color, [255, 0, 0]);
    const w = access(hs);
    // the 3D view sends RGB: written as hue and saturation
    await execute([h], 'light', 'turn_on', { entity_id: 'light.hue', rgb_color: [0, 255, 0] }, w.io);
    assert.deepEqual(w.written, [
        ['hue.0.lamp.on', true],
        ['hue.0.lamp.hue', 21845],
        ['hue.0.lamp.sat', 254],
    ]);
});

test('a white tone of 0 … 100 % runs from warm to cold, one in Kelvin stays as it is', () => {
    const pct = { 'x.0.l.ct': st('level.color.temperature', 'number', true, { min: 0, max: 100 }) };
    const a = buildDevice('light', 'light.a', 'A', { color_temp: 'x.0.l.ct' }, pct);
    assert.equal(entities([a], states({ 'x.0.l.ct': 50 }), pct)['light.a'].attributes.color_temp_kelvin, 4350);
    const k = { 'x.0.l.ct': st('level.color.temperature', 'number', true, { min: 2700, max: 6500 }) };
    const b = buildDevice('light', 'light.b', 'B', { color_temp: 'x.0.l.ct' }, k);
    const out = entities([b], states({ 'x.0.l.ct': 3000 }), k)['light.b'];
    assert.equal(out.attributes.color_temp_kelvin, 3000);
    assert.equal(out.attributes.min_color_temp_kelvin, 2700);
});

test('"Geräte verbinden" offers a light of a channel with a dimmer or colour, not of a switch alone', () => {
    const objects = {
        ...strip,
        'shelly.0.relay.Relay0.Switch': st('switch', 'boolean', true),
        'shelly.0.relay.Relay0.Power': st('value.power', 'number'),
    };
    assert.deepEqual(
        findLights(objects).map(l => l.base),
        ['zigbee.0.led'],
    );
    const [c] = lightCandidates(
        objects,
        { 'enum.rooms.living': { _id: 'enum.rooms.living', common: { members: ['zigbee.0.led'] } } as never },
        { 'zigbee.0.led': { type: 'device', common: { name: 'LED-Streifen' } } as never },
        base => `light.${base.replace(/\W/g, '_')}`,
        o => String(o?.common?.name ?? ''),
    );
    assert.equal(c.name, 'LED-Streifen');
    assert.equal(c.area_id, 'enum.rooms.living');
    assert.equal(c._meta?.path, 'zigbee.0.led.light');
    assert.equal(c._meta?.value, '⏻ ◐ 🎨 🌡');
});

test('a light chosen in a room by its switch and dimmer becomes one device with its colour', async () => {
    const objects: Record<string, StateObject> = {
        ...strip,
        'zigbee.0.led': { type: 'device', common: { name: 'LED-Streifen' } } as StateObject,
        'zigbee.0.window': st('sensor.window', 'boolean'),
    };
    const io = {
        getObjects: async (ids: string[]) =>
            Object.fromEntries(ids.filter(id => objects[id]).map(id => [id, objects[id]])),
        statesUnder: async (prefix: string) =>
            Object.fromEntries(
                Object.entries(objects).filter(([id, o]) => id.startsWith(`${prefix}.`) && o.type === 'state'),
            ),
        rooms: async () => ({}),
    };
    const { added, byId } = await devicesOf(
        io,
        ['zigbee.0.led.state', 'zigbee.0.led.brightness', 'zigbee.0.window'],
        new Map(),
    );
    assert.equal(added.length, 2);
    const lamp = added.find(m => m.entity_id.startsWith('light.'))!;
    assert.equal(lamp.name, 'LED-Streifen');
    assert.equal(lamp.parts?.rgb, 'zigbee.0.led.color');
    assert.equal(byId.get('zigbee.0.led.state'), lamp.entity_id);
    assert.equal(byId.get('zigbee.0.led.brightness'), lamp.entity_id);
    assert.ok(byId.get('zigbee.0.window')?.startsWith('binary_sensor.'));
});

test('a cover of its position, tilt and buttons; open or closed by its position', async () => {
    const objects = {
        'shelly.0.roller.Position': st('level.blind', 'number', true, { min: 0, max: 100 }),
        'shelly.0.roller.Stop': st('button.stop', 'boolean', true),
        'shelly.0.roller.Tilt': st('level.tilt', 'number', true, { min: 0, max: 255 }),
    };
    const m = buildDevice('cover', 'cover.roller', 'Rollladen', guessParts('cover', objects), objects);
    validateMappings([m], objects);
    const out = entities(
        [m],
        states({ 'shelly.0.roller.Position': 0, 'shelly.0.roller.Tilt': 128 }),
        objects,
    )['cover.roller'];
    assert.equal(out.state, 'closed');
    assert.equal(out.attributes.current_tilt_position, 50);
    assert.equal(out.attributes.supported_features, 1 | 2 | 4 | 8 | 16 | 32 | 128);
    const { io, written } = access(objects);
    await execute([m], 'cover', 'open_cover', { entity_id: 'cover.roller' }, io);
    await execute([m], 'cover', 'set_cover_position', { entity_id: 'cover.roller', position: 30 }, io);
    await execute([m], 'cover', 'set_cover_tilt_position', { entity_id: 'cover.roller', tilt_position: 50 }, io);
    await execute([m], 'cover', 'stop_cover', { entity_id: 'cover.roller' }, io);
    assert.deepEqual(written, [
        ['shelly.0.roller.Position', 100],
        ['shelly.0.roller.Position', 30],
        ['shelly.0.roller.Tilt', 127.5],
        ['shelly.0.roller.Stop', true],
    ]);
});

test('a heating of its set point, temperature, mode texts and power', async () => {
    const objects = {
        'hm.0.t.SET': st('level.temperature', 'number', true, { min: 4.5, max: 30.5 }),
        'hm.0.t.ACTUAL': st('value.temperature', 'number'),
        'hm.0.t.MODE': st('level.mode.thermostat', 'number', true, { states: { 0: 'AUTO', 1: 'MANUAL', 2: 'PARTY' } }),
        'hm.0.t.POWER': st('switch.power', 'boolean', true),
    };
    const m = buildDevice('climate', 'climate.t', 'Heizung', guessParts('climate', objects), objects);
    validateMappings([m], objects);
    assert.deepEqual(m.attributes?.hvac_modes, ['auto', 'heat', 'off']);
    const out = entities(
        [m],
        states({ 'hm.0.t.SET': 21, 'hm.0.t.ACTUAL': 19.5, 'hm.0.t.MODE': 1, 'hm.0.t.POWER': true }),
        objects,
    )['climate.t'];
    assert.equal(out.state, 'heat');
    assert.equal(out.attributes.temperature, 21);
    assert.equal(out.attributes.current_temperature, 19.5);
    assert.equal(out.attributes.min_temp, 4.5);
    // off by its power, whatever the mode says
    const off = entities([m], states({ 'hm.0.t.MODE': 1, 'hm.0.t.POWER': false }), objects)['climate.t'];
    assert.equal(off.state, 'off');
    const { io, written } = access(objects);
    await execute([m], 'climate', 'set_hvac_mode', { entity_id: 'climate.t', hvac_mode: 'auto' }, io);
    await execute([m], 'climate', 'set_hvac_mode', { entity_id: 'climate.t', hvac_mode: 'off' }, io);
    await execute([m], 'climate', 'set_temperature', { entity_id: 'climate.t', temperature: 22 }, io);
    assert.deepEqual(written, [
        ['hm.0.t.POWER', true],
        ['hm.0.t.MODE', 0],
        ['hm.0.t.POWER', false],
        ['hm.0.t.SET', 22],
    ]);
});

test('a TV shows its app and offers its apps and inputs as sources; a choice writes the right datapoint', async () => {
    const objects = {
        'tv.0.power': st('switch.power', 'boolean', true),
        'tv.0.app': st('media.app', 'string', true, { states: { YOUTUBE: 'YouTube', NETFLIX: 'Netflix' } }),
        'tv.0.input': st('media.input', 'string', true, { states: { HDMI1: 'HDMI 1', HDMI2: 'HDMI 2' } }),
    };
    const m = mediaPlayerMapping('media_player.tv', 'TV', { POWER: 'tv.0.power', APP: 'tv.0.app', INPUT: 'tv.0.input' }, objects);
    validateMappings([m], objects);
    const out = entities([m], states({ 'tv.0.power': true, 'tv.0.app': 'YOUTUBE', 'tv.0.input': 'HDMI1' }), objects)[
        'media_player.tv'
    ];
    assert.equal(out.attributes.app_name, 'YouTube');
    assert.equal(out.attributes.source, 'HDMI 1');
    assert.deepEqual(out.attributes.source_list, ['YouTube', 'Netflix', 'HDMI 1', 'HDMI 2']);
    assert.ok(((out.attributes.supported_features as number) & 2048) !== 0);
    const { io, written } = access(objects);
    await execute([m], 'media_player', 'select_source', { entity_id: 'media_player.tv', source: 'YouTube' }, io);
    await execute([m], 'media_player', 'select_source', { entity_id: 'media_player.tv', source: 'HDMI 2' }, io);
    assert.deepEqual(written, [
        ['tv.0.app', 'YOUTUBE'],
        ['tv.0.input', 'HDMI2'],
    ]);
});

test('the parts of a mapping made before there were parts are found by their roles', () => {
    const old: Mapping = {
        entity_id: 'light.old',
        state: 'zigbee.0.led.state',
        attributes: { brightness: { id: 'zigbee.0.led.brightness', scale: 2.55 } },
        actions: { turn_on: [{ id: 'zigbee.0.led.state', value: true }] },
    };
    assert.deepEqual(partsOf(old, strip), { switch: 'zigbee.0.led.state', brightness: 'zigbee.0.led.brightness' });
    // a switch made a light keeps its datapoint as the light's switch only by its role, not by its name "state"
    assert.deepEqual(keepParts({ state: 'a' }, 'light'), {});
    assert.deepEqual(keepParts({ switch: 'a', rgb: 'b' }, 'light'), { switch: 'a', rgb: 'b' });
});

test('built anew, a device keeps its name, room, battery and own attributes, not those of a dropped part', () => {
    const old: Mapping = {
        entity_id: 'cover.a',
        name: 'Markise',
        area_id: 'enum.rooms.garden',
        battery: 'none',
        state: 'x.0.pos',
        attributes: { device_class: 'awning', extra: { id: 'x.0.gone' }, current_position: { id: 'x.0.pos' } },
        actions: {},
    };
    const objects = { 'x.0.pos': st('level.blind', 'number', true, { max: 100 }) };
    const next = rebuilt(old, buildDevice('cover', 'cover.a', 'x', { position: 'x.0.pos' }, objects));
    assert.equal(next.name, 'Markise');
    assert.equal(next.area_id, 'enum.rooms.garden');
    assert.equal(next.battery, 'none');
    assert.equal(next.attributes?.device_class, 'awning');
    assert.equal(next.attributes?.extra, undefined);
});
