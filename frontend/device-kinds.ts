// Devices of several datapoints, by kind: a light of its switch, dimmer, colour and white tone; a cover of its position,
// tilt and buttons; a heating of its set point, temperature, mode and power; a fan, a lock, a media player (media.ts).
// "Geräte verbinden" and "+ Datenpunkt aus ioBroker" make one light of a light's datapoints (as media.ts one player of a
// player's), the editor's device form shows the parts of a device and lets each be chosen by hand, and its kind be
// changed (frontend/datapoint.ts); `buildDevice` makes the mapping from the parts.
import type { ActionRule, Binding, Mapping, RoomObject, StateObject } from './model.js';
import { MEDIA_PARTS, mediaPlayerMapping, type MediaPart } from './media.js';
import { stateTexts } from './state-texts.js';

export type Kind =
    'light' | 'switch' | 'cover' | 'climate' | 'fan' | 'lock' | 'media_player' | 'sensor' | 'binary_sensor';

/** The kinds a device can be made of by hand, in the order the editor offers them. */
export const KINDS: Kind[] = [
    'light',
    'switch',
    'cover',
    'climate',
    'fan',
    'lock',
    'media_player',
    'sensor',
    'binary_sensor',
];

/** The kinds of one datapoint: their part is the mapping's state. */
const SINGLE = new Set<Kind>(['switch', 'sensor', 'binary_sensor']);

/** The datapoints of a device by part. */
export type Parts = Record<string, string>;

interface PartDef {
    key: string;
    /** The roles it is found by (as the type-detector names them). */
    role: RegExp;
    /** Found by the last part of its ID too, when no role says it (zigbee's "brightness", hue's "ct"). */
    name?: RegExp;
    type?: string;
    write?: boolean;
}

const LIGHT: PartDef[] = [
    {
        key: 'switch',
        role: /^switch(\.light|\.power)?$/,
        name: /^(on|state|switch|power)$/i,
        type: 'boolean',
        write: true,
    },
    {
        key: 'brightness',
        role: /^level\.(dimmer|brightness)$/,
        name: /^(bri|brightness|dimmer|level)$/i,
        type: 'number',
        write: true,
    },
    { key: 'rgb', role: /^level\.color\.rgbw?$/, name: /^(colou?r|rgbw?|hex)$/i, type: 'string', write: true },
    { key: 'red', role: /^level\.color\.red$/, name: /^(r|red)$/i, type: 'number', write: true },
    { key: 'green', role: /^level\.color\.green$/, name: /^(g|green)$/i, type: 'number', write: true },
    { key: 'blue', role: /^level\.color\.blue$/, name: /^(b|blue)$/i, type: 'number', write: true },
    { key: 'hue', role: /^level\.color\.hue$/, name: /^hue$/i, type: 'number', write: true },
    { key: 'saturation', role: /^level\.color\.saturation$/, name: /^(sat|saturation)$/i, type: 'number', write: true },
    {
        key: 'color_temp',
        role: /^level\.color\.temperature$/,
        name: /^(ct|colou?r_?temp(erature)?|white_?temp)$/i,
        type: 'number',
        write: true,
    },
];

const COVER: PartDef[] = [
    {
        key: 'position',
        role: /^level\.(blind|curtain|shutter)$/,
        name: /^(position|set_?position)$/i,
        type: 'number',
        write: true,
    },
    { key: 'position_actual', role: /^value\.(blind|curtain|shutter)$/, type: 'number' },
    { key: 'open', role: /^(button|action)\.open(\.blind)?$/, type: 'boolean', write: true },
    { key: 'close', role: /^(button|action)\.close(\.blind)?$/, type: 'boolean', write: true },
    { key: 'stop', role: /^(button|action)\.stop(\.blind)?$/, type: 'boolean', write: true },
    { key: 'tilt', role: /^level\.tilt$/, type: 'number', write: true },
    { key: 'tilt_actual', role: /^value\.tilt$/, type: 'number' },
];

const CLIMATE: PartDef[] = [
    { key: 'target', role: /^level\.temperature(\..*)?$/, type: 'number', write: true },
    { key: 'current', role: /^value\.temperature(\..*)?$/, type: 'number' },
    { key: 'humidity', role: /^value\.humidity(\..*)?$/, type: 'number' },
    { key: 'mode', role: /^level(\.mode)?\.(thermostat|airconditioner)$/, write: true },
    { key: 'power', role: /^switch(\.power)?$/, type: 'boolean', write: true },
    { key: 'boost', role: /^switch(\.mode)?\.boost(\..*)?$/, type: 'boolean', write: true },
];

const FAN: PartDef[] = [
    { key: 'power', role: /^switch(\.power)?$/, type: 'boolean', write: true },
    { key: 'speed', role: /^(level\.)?(speed|mode)\.fan$|^level\.speed$/, type: 'number', write: true },
];

const LOCK: PartDef[] = [
    { key: 'lock', role: /^switch\.lock$/, type: 'boolean', write: true },
    { key: 'state', role: /^(value|state|indicator)\.lock$/, type: 'boolean' },
    { key: 'open', role: /^(button|switch)\.(open|lock\.(door|open))$/, type: 'boolean', write: true },
];

const MEDIA: PartDef[] = MEDIA_PARTS.map(([name, role, write, type]) => ({
    key: name.toLowerCase(),
    role,
    write,
    type,
}));

const PARTS: Record<Kind, PartDef[]> = {
    light: LIGHT,
    switch: [{ key: 'state', role: /^switch/, type: 'boolean', write: true }],
    cover: COVER,
    climate: CLIMATE,
    fan: FAN,
    lock: LOCK,
    media_player: MEDIA,
    sensor: [{ key: 'state', role: /(?:)/ }],
    binary_sensor: [{ key: 'state', role: /(?:)/, type: 'boolean' }],
};

/** The parts of a kind, in the order the editor shows them. */
export function partKeys(kind: Kind): string[] {
    return PARTS[kind].map(d => d.key);
}

/** The kind of a device by its entity ID; null: none of the kinds above (a camera, a scene …). */
export function kindOf(entityId: string): Kind | null {
    const domain = entityId.slice(0, entityId.indexOf('.')) as Kind;
    return KINDS.includes(domain) ? domain : null;
}

/** Whether a kind is made of several datapoints (the editor lists its parts). */
export const severalParts = (kind: Kind | null): boolean => !!kind && !SINGLE.has(kind);

const parentOf = (id: string): string => id.slice(0, id.lastIndexOf('.'));

function fits(def: PartDef, id: string, o: StateObject | undefined, byName: boolean): boolean {
    const c = o?.common;
    if (!c || o.type !== 'state' || (def.type && c.type !== def.type) || (def.write && c.write !== true)) {
        return false;
    }
    return byName ? !!def.name?.test(id.slice(id.lastIndexOf('.') + 1)) : def.role.test(c.role ?? '');
}

/**
 * The parts of a device of this kind among `ids` (the datapoints beside its own): by their roles first, then by the
 * last part of their IDs (`byName`); each datapoint fills one part.
 */
export function guessParts(
    kind: Kind,
    objects: Record<string, StateObject>,
    ids: string[] = Object.keys(objects),
    byName = true,
): Parts {
    const list = ids.filter(id => objects[id]?.type === 'state').sort();
    const out: Parts = {};
    const used = new Set<string>();
    for (const names of byName ? [false, true] : [false]) {
        for (const def of PARTS[kind]) {
            if (out[def.key]) {
                continue;
            }
            const id = list.find(x => !used.has(x) && fits(def, x, objects[x], names));
            if (id) {
                out[def.key] = id;
                used.add(id);
            }
        }
    }
    return out;
}

/** The datapoints a mapping uses (its state, attributes and actions; not its condition). */
export function idsOf(m: Mapping): string[] {
    const ids = new Set<string>([m.state]);
    const add = (b: unknown): void => {
        if (Array.isArray(b)) {
            b.forEach(add);
        } else if (b && typeof b === 'object' && typeof (b as Binding).id === 'string') {
            ids.add((b as Binding).id!);
        }
    };
    Object.values(m.attributes ?? {}).forEach(add);
    for (const rules of Object.values(m.actions ?? {})) {
        (Array.isArray(rules) ? rules : []).forEach(add);
    }
    Object.values(m.parts ?? {}).forEach(id => ids.add(id));
    return [...ids].filter(id => typeof id === 'string' && id);
}

/**
 * The parts of a device: as stored with it, else found among its datapoints by their roles (a mapping made by hand or
 * before there were parts); its state is always one of them.
 */
export function partsOf(m: Mapping, objects: Record<string, StateObject>): Parts {
    const kind = kindOf(m.entity_id);
    if (!kind) {
        return {};
    }
    if (SINGLE.has(kind)) {
        return { state: m.state };
    }
    const keys = new Set(partKeys(kind));
    if (m.parts && typeof m.parts === 'object') {
        return Object.fromEntries(
            Object.entries(m.parts).filter(([k, v]) => keys.has(k) && typeof v === 'string' && v),
        );
    }
    const ids = idsOf(m).filter(id => id !== m.when?.id);
    const out = guessParts(kind, objects, ids, false);
    if (!Object.values(out).includes(m.state)) {
        const main = PARTS[kind].find(d => !out[d.key] && fits(d, m.state, objects[m.state], false))?.key;
        const key = main ?? PARTS[kind][0].key;
        if (!out[key]) {
            out[key] = m.state;
        }
    }
    return out;
}

/** The parts of a device with the ones it had under the same names (a light made of a switch keeps its switch). */
export function keepParts(from: Parts, to: Kind): Parts {
    const keys = new Set(partKeys(to));
    return Object.fromEntries(Object.entries(from).filter(([k]) => keys.has(k)));
}

// --- the mapping of a device from its parts ---

const top = (o: StateObject | undefined, fallback: number): number => {
    const max = o?.common?.max;
    return typeof max === 'number' && max > 0 ? max : fallback;
};
const bottom = (o: StateObject | undefined): number => (typeof o?.common?.min === 'number' ? o.common.min : 0);

/** A datapoint of 0 … its max read as 0 … `full`. */
function reading(objects: Record<string, StateObject>, id: string, full: number, fallback: number): Binding {
    const t = top(objects[id], fallback);
    return t === full ? { id } : { id, scale: full / t };
}

/** The call's `field` (0 … `full`) written as 0 … the datapoint's max. */
function writing(
    objects: Record<string, StateObject>,
    id: string,
    field: string,
    full: number,
    fallback: number,
    extra: Partial<ActionRule> = {},
): ActionRule {
    const t = top(objects[id], fallback);
    return { id, field, ...(t === full ? {} : { scale: t / full }), ...extra };
}

/** On, off and toggle of a datapoint that switches: a boolean, or a number between its min and max. */
function switching(o: StateObject | undefined, id: string): Record<string, ActionRule[]> {
    if (o?.common?.write !== true) {
        return {};
    }
    const number = o.common.type === 'number';
    return {
        turn_on: [{ id, value: number ? top(o, 1) : true }],
        turn_off: [{ id, value: number ? bottom(o) : false }],
        toggle: [{ id, toggle: true }],
    };
}

/** The colour temperature of a light: Kelvin, mired (153 … 500) or 0 … max from warm to cold. */
function whiteTone(
    o: StateObject | undefined,
    id: string,
): { read: Binding; write: ActionRule; min: number; max: number } {
    const lo = typeof o?.common?.min === 'number' ? o.common.min : undefined;
    const hi = typeof o?.common?.max === 'number' && o.common.max > 0 ? o.common.max : undefined;
    if (lo !== undefined && lo >= 100 && hi !== undefined && hi <= 1000) {
        return {
            read: { id, convert: 'mired' },
            write: { id, field: 'color_temp_kelvin', convert: 'mired', optional: true },
            min: Math.round(1e6 / hi),
            max: Math.round(1e6 / lo),
        };
    }
    if (hi !== undefined && hi <= 1000 && (lo ?? 0) < 100) {
        // relative: 0 warm (2200 K) … max cold (6500 K)
        const k = 4300 / hi;
        return {
            read: { id, scale: k, offset: 2200 },
            write: { id, field: 'color_temp_kelvin', scale: 1 / k, offset: -2200 / k, optional: true },
            min: 2200,
            max: 6500,
        };
    }
    return {
        read: { id },
        write: { id, field: 'color_temp_kelvin', optional: true },
        min: lo !== undefined && lo >= 1000 ? lo : 2200,
        max: hi !== undefined && hi >= 1000 ? hi : 6500,
    };
}

function light(entityId: string, name: string, p: Parts, objects: Record<string, StateObject>): Mapping {
    const attributes: Record<string, unknown> = {};
    const on: ActionRule[] = [];
    const off: ActionRule[] = [];
    const toggle: ActionRule[] = [];
    const modes: string[] = [];
    const sw = p.switch;
    if (sw) {
        on.push({ id: sw, value: true });
        off.push({ id: sw, value: false });
        toggle.push({ id: sw, toggle: true });
    }
    if (p.brightness) {
        attributes.brightness = reading(objects, p.brightness, 255, 100);
        // without a switch the dimmer switches: on at full (or the level asked for), off at its min
        on.push(writing(objects, p.brightness, 'brightness_pct', 100, 100, sw ? { optional: true } : { value: 100 }));
        if (!sw) {
            off.push({ id: p.brightness, value: bottom(objects[p.brightness]) });
            toggle.push({ id: p.brightness, toggle: true });
        }
    }
    // neither a switch nor a dimmer: the colour switches it (white on, black off)
    const byColour = !sw && !p.brightness;
    if (p.rgb) {
        const convert = /rgbw$/.test(objects[p.rgb]?.common?.role ?? '') ? 'rgbw_hex' : 'rgb_hex';
        attributes.rgb_color = { id: p.rgb, convert };
        on.push({
            id: p.rgb,
            field: 'rgb_color',
            convert,
            ...(byColour ? { value: [255, 255, 255] } : { optional: true }),
        });
        if (byColour) {
            off.push({ id: p.rgb, value: [0, 0, 0], convert });
            toggle.push({ id: p.rgb, toggle: true, convert });
        }
        modes.push('rgb');
    } else if (p.red && p.green && p.blue) {
        const rgb = [p.red, p.green, p.blue];
        attributes.rgb_color = rgb.map(id => reading(objects, id, 255, 255));
        rgb.forEach((id, index) => {
            on.push(
                writing(objects, id, 'rgb_color', 255, 255, {
                    index,
                    ...(byColour ? { value: [255, 255, 255] } : { optional: true }),
                }),
            );
            if (byColour) {
                off.push({ id, value: bottom(objects[id]) });
            }
        });
        modes.push('rgb');
    } else if (p.hue) {
        attributes.hs_color = [
            reading(objects, p.hue, 360, 360),
            p.saturation ? reading(objects, p.saturation, 100, 100) : 100,
        ];
        on.push(writing(objects, p.hue, 'hs_color', 360, 360, { index: 0, optional: true }));
        if (p.saturation) {
            on.push(writing(objects, p.saturation, 'hs_color', 100, 100, { index: 1, optional: true }));
        }
        modes.push('hs');
    }
    if (p.color_temp) {
        const tone = whiteTone(objects[p.color_temp], p.color_temp);
        attributes.color_temp_kelvin = tone.read;
        attributes.min_color_temp_kelvin = tone.min;
        attributes.max_color_temp_kelvin = tone.max;
        on.push(tone.write);
        modes.push('color_temp');
    }
    if (!modes.length) {
        modes.push(p.brightness ? 'brightness' : 'onoff');
    }
    attributes.supported_color_modes = modes;
    attributes.color_mode = modes[0];
    const state = sw ?? p.brightness ?? p.rgb ?? p.red ?? p.hue ?? p.color_temp ?? Object.values(p)[0];
    const m: Mapping = { entity_id: entityId, name, state, attributes, actions: {} };
    if (objects[state]?.common?.type !== 'boolean') {
        m.convert = 'on_off';
    }
    for (const [service, rules] of [
        ['turn_on', on],
        ['turn_off', off],
        ['toggle', toggle],
    ] as const) {
        if (rules.length) {
            m.actions![service] = rules;
        }
    }
    return m;
}

function cover(entityId: string, name: string, p: Parts, objects: Record<string, StateObject>): Mapping {
    const attributes: Record<string, unknown> = {};
    const actions: Record<string, ActionRule[]> = {};
    let features = 0;
    const pos = p.position;
    const shown = p.position_actual ?? pos;
    if (shown) {
        attributes.current_position = reading(objects, shown, 100, 100);
    }
    const tiltShown = p.tilt_actual ?? p.tilt;
    if (tiltShown) {
        attributes.current_tilt_position = reading(objects, tiltShown, 100, 100);
    }
    if (p.open || pos) {
        actions.open_cover = [
            p.open ? { id: p.open, value: true } : writing(objects, pos, 'position', 100, 100, { value: 100 }),
        ];
        features |= 1;
    }
    if (p.close || pos) {
        actions.close_cover = [
            p.close ? { id: p.close, value: true } : writing(objects, pos, 'position', 100, 100, { value: 0 }),
        ];
        features |= 2;
    }
    if (pos) {
        actions.set_cover_position = [writing(objects, pos, 'position', 100, 100)];
        features |= 4;
    }
    if (p.stop) {
        actions.stop_cover = [{ id: p.stop, value: true }];
        features |= 8;
    }
    if (p.tilt) {
        actions.open_cover_tilt = [writing(objects, p.tilt, 'tilt_position', 100, 100, { value: 100 })];
        actions.close_cover_tilt = [writing(objects, p.tilt, 'tilt_position', 100, 100, { value: 0 })];
        actions.set_cover_tilt_position = [writing(objects, p.tilt, 'tilt_position', 100, 100)];
        features |= 16 | 32 | 128;
    }
    attributes.supported_features = features;
    const state = shown ?? tiltShown ?? Object.values(p)[0];
    const m: Mapping = { entity_id: entityId, name, state, attributes, actions };
    if (objects[state]?.common?.type !== 'boolean') {
        // a position: open above 0
        m.convert = 'on_off';
    }
    return m;
}

/** The mode of a heating or an air conditioner a text of its mode datapoint names. */
function hvacOf(label: string): string | null {
    const l = label.toLowerCase();
    if (/\b(off|aus|standby)\b/.test(l)) {
        return 'off';
    }
    if (/auto/.test(l)) {
        return 'auto';
    }
    if (/cool|kühl/.test(l)) {
        return 'cool';
    }
    if (/dry|trock/.test(l)) {
        return 'dry';
    }
    if (/fan|lüft|vent/.test(l)) {
        return 'fan_only';
    }
    if (/heat|heiz|manu|comfort|komfort/.test(l)) {
        return 'heat';
    }
    return null;
}

const typed = (value: string, type: string | undefined): unknown =>
    type === 'number' ? Number(value) : type === 'boolean' ? value === 'true' : value;

function climate(entityId: string, name: string, p: Parts, objects: Record<string, StateObject>): Mapping {
    const attributes: Record<string, unknown> = {};
    const actions: Record<string, ActionRule[]> = {};
    let features = 0;
    if (p.target) {
        const c = objects[p.target]?.common;
        attributes.temperature = { id: p.target };
        attributes.min_temp = typeof c?.min === 'number' ? c.min : 5;
        attributes.max_temp = typeof c?.max === 'number' ? c.max : 30;
        attributes.target_temp_step = typeof c?.step === 'number' && c.step > 0 ? c.step : 0.5;
        actions.set_temperature = [{ id: p.target, field: 'temperature' }];
        features |= 1;
    }
    if (p.current) {
        attributes.current_temperature = { id: p.current };
    }
    if (p.humidity) {
        attributes.current_humidity = { id: p.humidity };
    }
    // the modes its mode datapoint names (auto, heat, cool …), off with its power switch
    const mc = p.mode ? objects[p.mode]?.common : undefined;
    const shown: Record<string, string> = {};
    const toValue: Record<string, unknown> = {};
    for (const [value, label] of Object.entries((mc && stateTexts(mc.states, 60)) ?? {})) {
        const h = hvacOf(label);
        if (h) {
            shown[value] = h;
            if (!(h in toValue)) {
                toValue[h] = typed(value, mc?.type);
            }
        }
    }
    const hvac = [...new Set([...Object.keys(toValue), ...(p.power ? ['off'] : [])])];
    if (!hvac.some(h => h !== 'off')) {
        hvac.unshift('heat');
    }
    const set: ActionRule[] = [];
    if (p.power) {
        actions.turn_on = [{ id: p.power, value: true }];
        actions.turn_off = [{ id: p.power, value: false }];
        set.push({ id: p.power, field: 'hvac_mode', map: Object.fromEntries(hvac.map(h => [h, h !== 'off'])) });
        features |= 128 | 256;
    }
    if (p.mode && mc?.write === true && Object.keys(toValue).length) {
        set.push({ id: p.mode, field: 'hvac_mode', map: toValue, optional: true });
    }
    if (set.length) {
        actions.set_hvac_mode = set;
    }
    if (p.boost) {
        attributes.preset_modes = ['none', 'boost'];
        attributes.preset_mode = { id: p.boost, map: { true: 'boost', false: 'none' } };
        actions.set_preset_mode = [{ id: p.boost, field: 'preset_mode', map: { boost: true, none: false } }];
        features |= 16;
    }
    attributes.hvac_modes = hvac;
    attributes.supported_features = features;
    const m: Mapping = { entity_id: entityId, name, state: '', attributes, actions };
    if (p.mode && Object.keys(shown).length) {
        m.state = p.mode;
        m.map = shown;
        if (p.power) {
            m.when = { id: p.power, values: [true], else: 'off' };
        }
    } else if (p.power) {
        m.state = p.power;
        m.map = { true: hvac.find(h => h !== 'off') ?? 'heat', false: 'off' };
    } else {
        // a set point alone: it heats
        m.state = p.target ?? p.current ?? Object.values(p)[0];
        m.convert = 'on_off';
    }
    return m;
}

function fan(entityId: string, name: string, p: Parts, objects: Record<string, StateObject>): Mapping {
    const attributes: Record<string, unknown> = {};
    let actions: Record<string, ActionRule[]> = {};
    let features = 0;
    if (p.power) {
        actions = switching(objects[p.power], p.power);
    }
    if (p.speed) {
        attributes.percentage = reading(objects, p.speed, 100, 100);
        actions.set_percentage = [writing(objects, p.speed, 'percentage', 100, 100)];
        features |= 1;
        if (!p.power) {
            actions.turn_on = [writing(objects, p.speed, 'percentage', 100, 100, { value: 100 })];
            actions.turn_off = [{ id: p.speed, value: bottom(objects[p.speed]) }];
            actions.toggle = [{ id: p.speed, toggle: true }];
        }
    }
    if (actions.turn_on) {
        features |= 16 | 32;
    }
    attributes.supported_features = features;
    const state = p.power ?? p.speed ?? Object.values(p)[0];
    const m: Mapping = { entity_id: entityId, name, state, attributes, actions };
    if (objects[state]?.common?.type !== 'boolean') {
        m.convert = 'on_off';
    }
    return m;
}

function lock(entityId: string, name: string, p: Parts): Mapping {
    const actions: Record<string, ActionRule[]> = {};
    let features = 0;
    // switch.lock: true opens the lock (unlocked), false locks it
    if (p.lock) {
        actions.lock = [{ id: p.lock, value: false }];
        actions.unlock = [{ id: p.lock, value: true }];
    }
    if (p.open) {
        actions.open = [{ id: p.open, value: true }];
        features |= 1;
    }
    return {
        entity_id: entityId,
        name,
        state: p.state ?? p.lock ?? Object.values(p)[0],
        map: { true: 'unlocked', false: 'locked' },
        attributes: { supported_features: features },
        actions,
    };
}

function media(entityId: string, name: string, p: Parts, objects: Record<string, StateObject>): Mapping {
    const parts: Partial<Record<MediaPart, string>> = {};
    for (const [key, id] of Object.entries(p)) {
        parts[key.toUpperCase() as MediaPart] = id;
    }
    const m = mediaPlayerMapping(entityId, name, parts, objects);
    if (!parts.STATE && !parts.POWER) {
        // neither a state nor a power switch: it is on while its first part says so
        m.state = Object.values(p)[0];
        delete m.map;
        if (objects[m.state]?.common?.type !== 'boolean') {
            m.convert = 'on_off';
        }
    }
    return m;
}

/** The class of a sensor by its role (temperature, motion, window …): the 3D view's symbol. */
export function deviceClass(role: string): string | undefined {
    const parts = role.split('.');
    return ['temperature', 'humidity', 'power', 'energy', 'motion', 'window', 'door', 'smoke']
        .filter(c => parts.includes(c))
        .pop();
}

function single(kind: Kind, entityId: string, name: string, id: string, objects: Record<string, StateObject>): Mapping {
    const c = objects[id]?.common;
    const m: Mapping = { entity_id: entityId, name, state: id, attributes: {}, actions: {} };
    if (c?.unit) {
        m.attributes!.unit_of_measurement = c.unit;
    }
    const cls = kind === 'switch' ? undefined : deviceClass(c?.role ?? '');
    if (cls) {
        m.attributes!.device_class = cls;
    }
    if (kind === 'switch') {
        m.actions = switching(objects[id], id);
    }
    if (kind !== 'sensor' && c?.type !== 'boolean') {
        m.convert = 'on_off';
    }
    return m;
}

/**
 * The mapping of a device of this kind from its parts (only datapoints known in `objects`). A device of several keeps
 * its parts (`parts`), so the editor shows them as chosen.
 */
export function buildDevice(
    kind: Kind,
    entityId: string,
    name: string,
    parts: Parts,
    objects: Record<string, StateObject>,
): Mapping {
    const keys = new Set(partKeys(kind));
    const p: Parts = Object.fromEntries(
        Object.entries(parts).filter(([k, id]) => keys.has(k) && objects[id]?.type === 'state'),
    );
    const first = Object.values(p)[0];
    if (!first) {
        throw Object.assign(new Error(`${entityId}: no datapoint`), { code: 'no_parts' });
    }
    if (SINGLE.has(kind)) {
        return single(kind, entityId, name, p.state ?? first, objects);
    }
    const m =
        kind === 'light'
            ? light(entityId, name, p, objects)
            : kind === 'cover'
              ? cover(entityId, name, p, objects)
              : kind === 'climate'
                ? climate(entityId, name, p, objects)
                : kind === 'fan'
                  ? fan(entityId, name, p, objects)
                  : kind === 'lock'
                    ? lock(entityId, name, p)
                    : media(entityId, name, p, objects);
    m.parts = p;
    return m;
}

/**
 * The device built anew, with what was set at the old one: its name, room, condition, reachability and battery, and its
 * attributes that the new one does not make (a cover's class, a text set by hand), unless they read a datapoint that is
 * no longer one of its parts.
 */
export function rebuilt(old: Mapping, next: Mapping): Mapping {
    const out: Mapping = { ...next };
    for (const key of ['name', 'area_id', 'reach', 'reach_connected', 'battery'] as const) {
        if (old[key] !== undefined) {
            (out as unknown as Record<string, unknown>)[key] = old[key];
        }
    }
    // a condition set by hand (another datapoint), not the one a heating's power switch makes
    if (old.when && !next.when && !idsOf(old).includes(old.when.id)) {
        out.when = old.when;
    }
    const used = new Set(idsOf(next));
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(old.attributes ?? {})) {
        if (key in (next.attributes ?? {})) {
            continue;
        }
        const reads = idsOf({ entity_id: '', state: '', attributes: { [key]: value } }).filter(Boolean);
        if (reads.every(id => used.has(id))) {
            kept[key] = value;
        }
    }
    out.attributes = { ...kept, ...(next.attributes ?? {}) };
    return out;
}

/** The parts a device's datapoints in "Geräte verbinden" show in the value column (💡 ◐ 🎨 🌡). */
function lightSummary(p: Parts): string {
    return (
        [
            [p.switch, '⏻'],
            [p.brightness, '◐'],
            [p.rgb || p.red || p.hue, '🎨'],
            [p.color_temp, '🌡'],
        ] as const
    )
        .filter(([id]) => id)
        .map(([, s]) => s)
        .join(' ');
}

/** The parts that make a light more than a switch. */
const LIGHT_EXTRAS = ['brightness', 'rgb', 'red', 'hue', 'color_temp'];

/**
 * The lights among `objects`: a channel or device with a dimmer, a colour or a white tone (found by their roles, so a
 * datapoint called "level" alone makes none), each with the parts found there.
 */
export function findLights(objects: Record<string, StateObject>): { base: string; parts: Parts }[] {
    const byParent = new Map<string, string[]>();
    for (const id of Object.keys(objects)) {
        if (objects[id]?.type === 'state' && id.split('.').length >= 3) {
            const base = parentOf(id);
            byParent.set(base, [...(byParent.get(base) ?? []), id]);
        }
    }
    const out: { base: string; parts: Parts }[] = [];
    for (const [base, ids] of byParent) {
        const sure = guessParts('light', objects, ids, false);
        if (LIGHT_EXTRAS.some(k => sure[k])) {
            out.push({ base, parts: guessParts('light', objects, ids) });
        }
    }
    return out;
}

/** Whether a light's parts make it more than a switch (a dimmer, a colour or a white tone). */
export const isLight = (p: Parts): boolean => LIGHT_EXTRAS.some(k => p[k]);

/** The name of a light in a channel or device: its device's name for a channel ("lights" of a Shelly). */
export function baseName(
    base: string,
    devices: Record<string, StateObject | undefined>,
    nameOf: (o: StateObject | undefined) => string,
): string {
    const own = devices[base];
    const device = own?.type === 'channel' ? devices[parentOf(base)] : undefined;
    return (
        (device && nameOf(device)) || (own && nameOf(own)) || base.slice(base.lastIndexOf('.') + 1).replace(/_/g, ' ')
    );
}

/**
 * The lights among `objects` as candidates of "Geräte verbinden" (as mediaCandidates the media players): `devices` are
 * the objects of their channels and devices (for the name), `entityId(base)` gives each its id. The tree shows a light
 * as the entry "light" below its channel.
 */
export function lightCandidates(
    objects: Record<string, StateObject>,
    rooms: Record<string, RoomObject>,
    devices: Record<string, StateObject | undefined>,
    entityId: (base: string) => string,
    nameOf: (o: StateObject | undefined) => string,
    skip: Set<string> = new Set(),
): Mapping[] {
    return findLights(objects)
        .filter(l => !skip.has(l.base))
        .map(({ base, parts }) => {
            const m = buildDevice('light', entityId(base), baseName(base, devices, nameOf), parts, objects);
            const room = Object.values(rooms).find(r =>
                r.common?.members?.some(id => base === id || base.startsWith(`${id}.`)),
            );
            if (room) {
                m.area_id = room._id;
            }
            m._meta = {
                role: 'light',
                type: 'light',
                read: true,
                write: true,
                value: lightSummary(parts),
                path: `${base}.light`,
            };
            return m;
        });
}

/** The channels and devices of the lights and the devices above them (for their names). */
export function lightBases(objects: Record<string, StateObject>): string[] {
    return [...new Set(findLights(objects).flatMap(l => [l.base, parentOf(l.base)]))];
}
