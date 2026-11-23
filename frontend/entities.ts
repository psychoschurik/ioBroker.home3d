import type {
    Mapping,
    Binding,
    Condition,
    StateObject,
    StateValue,
    RoomObject,
    IoAccess,
    ProtocolRecord,
} from './model.js';
import { t } from './lang.js';
import { stateTexts } from './state-texts.js';
import { deviceClass, kindOf, partKeys, partsOf, severalParts } from './device-kinds.js';

export { stateTexts };
/** Stable, short hash for entity IDs (FNV-1a, 96 bit). Works without a secure context, unlike crypto.subtle. */
function hash(text: string): string {
    let out = '';
    for (const seed of [0x811c9dc5, 0x01000193, 0x5bd1e995]) {
        let h = seed >>> 0;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        out += h.toString(16).padStart(8, '0');
    }
    return out;
}
const nameOf = (o: { _id?: string; common?: { name?: string | Record<string, string> } } | undefined): string =>
    typeof o?.common?.name === 'object'
        ? o.common.name.de || o.common.name.en || o._id || ''
        : o?.common?.name || o?._id || '';
/** A device as the 3D frontend expects it */
export interface EntityState {
    entity_id: string;
    state: string;
    attributes: ProtocolRecord;
    last_changed: string;
    last_updated: string;
}
function fail(message: string): never {
    throw Object.assign(new Error(message), { code: 'invalid_mapping' });
}
function validateMappings(mappings: Mapping[], objects: Record<string, StateObject>): Mapping[] {
    if (!Array.isArray(mappings) || mappings.length > 10000) {
        fail(t('mappings_list'));
    }
    const seen = new Set();
    for (const m of mappings) {
        if (
            !m ||
            !/^(light|switch|sensor|binary_sensor|cover|climate|media_player|camera|scene|button|number|select|fan|vacuum|lock|person|weather)\.[a-z0-9_]+$/.test(
                m.entity_id,
            ) ||
            seen.has(m.entity_id)
        ) {
            fail(t('bad_entity_id'));
        }
        seen.add(m.entity_id);
        if (!objects[m.state]?.common || objects[m.state].type !== 'state') {
            fail(t('datapoint_missing', { id: m.state }));
        }
        if (m.when !== undefined) {
            if (typeof m.when?.id !== 'string' || !objects[m.when.id] || !Array.isArray(m.when.values)) {
                fail(t('bad_when', { id: m.entity_id }));
            }
            if (m.when.else !== undefined && typeof m.when.else !== 'string') {
                fail(t('bad_else'));
            }
        }
        if (
            m.reach !== undefined &&
            m.reach !== 'report' &&
            m.reach !== 'never' &&
            !(Number.isInteger(m.reach) && m.reach >= 1 && m.reach <= 10080)
        ) {
            fail(t('bad_reach', { id: m.entity_id }));
        }
        if (m.reach_connected !== undefined && typeof m.reach_connected !== 'boolean') {
            fail(t('bad_reach_connected', { id: m.entity_id }));
        }
        if (m.battery !== undefined && (typeof m.battery !== 'string' || !/^[^\s*?"'`]{1,300}$/.test(m.battery))) {
            fail(t('bad_battery', { id: m.entity_id }));
        }
        for (const value of Object.values(m.attributes || {})) {
            // a list of bindings: one value of several datapoints (the red, green and blue of a light)
            for (const binding of Array.isArray(value) ? value : [value]) {
                if (typeof binding === 'object' && binding?.id && !objects[binding.id]) {
                    fail(t('attribute_missing', { id: binding.id }));
                }
            }
        }
        if (m.parts !== undefined) {
            if (!m.parts || typeof m.parts !== 'object' || Object.values(m.parts).some(id => typeof id !== 'string')) {
                fail(t('bad_parts', { id: m.entity_id }));
            }
        }
        for (const rules of Object.values(m.actions || {})) {
            if (!Array.isArray(rules)) {
                fail(t('actions_list'));
            }
            for (const r of rules) {
                const o = objects[r.id];
                if (!o || o.type !== 'state' || o.common?.write !== true) {
                    fail(t('not_writable', { id: r.id }));
                }
                if (r.field === undefined && !Object.hasOwn(r, 'value') && !r.toggle) {
                    fail(t('bad_action'));
                }
                if (
                    r.convert !== undefined &&
                    r.convert !== 'rgb_hex' &&
                    r.convert !== 'rgbw_hex' &&
                    r.convert !== 'mired'
                ) {
                    fail(t('bad_convert'));
                }
                if (r.index !== undefined && !(Number.isInteger(r.index) && r.index >= 0 && r.index < 8)) {
                    fail(t('bad_action'));
                }
                for (const key of ['scale', 'offset'] as const) {
                    if (r[key] !== undefined && !Number.isFinite(r[key])) {
                        fail(t('not_number', { key }));
                    }
                }
            }
        }
    }
    return mappings;
}
/** "#rrggbb" or "#rrggbbww" → [r, g, b] (null if it is no colour). */
function hexToRgb(value: unknown): [number, number, number] | null {
    const m = typeof value === 'string' ? /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim()) : null;
    if (!m) {
        return null;
    }
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** [r, g, b] → "#rrggbb" (with "00" for the white channel of `rgbw_hex`). */
function rgbToHex(value: unknown, white: boolean): string {
    if (!Array.isArray(value) || value.length < 3 || value.slice(0, 3).some(v => !Number.isFinite(Number(v)))) {
        fail(t('bad_color'));
    }
    const hex = value
        .slice(0, 3)
        .map(v =>
            Math.max(0, Math.min(255, Math.round(Number(v))))
                .toString(16)
                .padStart(2, '0'),
        )
        .join('');
    return `#${hex}${white ? '00' : ''}`;
}
/** WMO weather code (0 clear … 99 thunderstorm with hail) → weather condition. */
export function wmoCondition(value: unknown): string {
    const code = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(code)) {
        return 'unknown';
    }
    if (code <= 1) {
        return 'sunny';
    }
    if (code === 2) {
        return 'partlycloudy';
    }
    if (code === 3) {
        return 'cloudy';
    }
    if (code === 45 || code === 48) {
        return 'fog';
    }
    if (code === 65 || code === 82) {
        return 'pouring';
    }
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
        return 'snowy';
    }
    if (code === 56 || code === 57 || code === 66 || code === 67) {
        return 'snowy-rainy';
    }
    if (code >= 95) {
        return 'lightning-rainy';
    }
    if ((code >= 51 && code <= 64) || (code >= 80 && code <= 81)) {
        return 'rainy';
    }
    return 'exceptional';
}
/** Whether a value says on: a number above 0, a colour that is not black, a text that is not "off" (null: none). */
function onOff(value: unknown): boolean | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value > 0;
    }
    if (typeof value !== 'string') {
        return null;
    }
    const text = value.trim();
    const rgb = hexToRgb(text);
    if (rgb) {
        return rgb.some(c => c > 0);
    }
    return !!text && !/^(off|false|0|aus|closed|none)$/i.test(text) && !(Number(text) <= 0);
}
/** The words of on and off for a kind of device (a cover is open or closed, a heating heats or is off). */
const ON_OFF: Record<string, [string, string]> = {
    cover: ['open', 'closed'],
    climate: ['heat', 'off'],
};
/** [h (0 … 360), s (0 … 100)] → [r, g, b] (full brightness). */
function hsToRgb(hs: unknown): [number, number, number] | null {
    if (!Array.isArray(hs) || !Number.isFinite(Number(hs[0]))) {
        return null;
    }
    const h = (((Number(hs[0]) % 360) + 360) % 360) / 60;
    const s = Math.max(0, Math.min(1, Number(hs[1] ?? 100) / 100));
    const f = (n: number): number => {
        const k = (n + h) % 6;
        return Math.round(255 * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return [f(5), f(3), f(1)];
}
/** [r, g, b] → [h (0 … 360), s (0 … 100)]. */
function rgbToHs(rgb: unknown): [number, number] | null {
    if (!Array.isArray(rgb) || rgb.length < 3 || rgb.slice(0, 3).some(v => !Number.isFinite(Number(v)))) {
        return null;
    }
    const [r, g, b] = rgb.slice(0, 3).map(v => Math.max(0, Math.min(255, Number(v))) / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
        h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    }
    return [Math.round((((h * 60) % 360) + 360) % 360), Math.round(max ? (d / max) * 100 : 0)];
}
/** A value of ioBroker as the device shows it (`write`: a value of the device as ioBroker takes it). */
export function transformed(value: unknown, binding: Binding, write = false): any {
    if (binding?.convert === 'wmo') {
        if (write) {
            fail(t('weather_write'));
        }
        return wmoCondition(value);
    }
    if (binding?.convert === 'mired') {
        // mired and Kelvin: the same in both directions
        const n = Number(value);
        return n > 0 ? Math.round(1e6 / n) : null;
    }
    if (binding?.convert === 'on_off') {
        if (write) {
            fail(t('bad_convert'));
        }
        return onOff(value);
    }
    if (binding?.convert) {
        return write ? rgbToHex(value, binding.convert === 'rgbw_hex') : hexToRgb(value);
    }
    if (binding?.map && Object.hasOwn(binding.map, String(value))) {
        return binding.map[String(value)];
    }
    if (binding?.scale !== undefined || binding?.offset !== undefined) {
        // without the noise of the arithmetic (57 × 0.01 is 0.5700000000000001)
        return Number((Number(value) * (binding.scale ?? 1) + (binding.offset ?? 0)).toPrecision(12));
    }
    return value;
}
/**
 * Attributes the 3D view takes as whole numbers, as its platform gives them, and shows as they come: a blind's
 * position of 56.888… % (a datapoint with decimals, or one scaled from 0…255) read "56.888888888 %".
 */
const WHOLE = new Set([
    'current_position',
    'current_tilt_position',
    'brightness',
    'percentage',
    'battery_level',
    'color_temp',
    'color_temp_kelvin',
    'min_mireds',
    'max_mireds',
    'min_color_temp_kelvin',
    'max_color_temp_kelvin',
]);
/** The value of an attribute, rounded if the 3D view takes it as a whole number. */
export function whole(key: string, value: unknown): unknown {
    return WHOLE.has(key) && typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : value;
}
/** Whether the condition of a mapping holds (the other datapoint has one of the values). */
function holds(when: Condition, states: Record<string, StateValue>): boolean {
    const v = states[when.id]?.val;
    return when.values.some(w => w === v || String(w) === String(v));
}
function entities(
    mappings: Mapping[],
    states: Record<string, StateValue>,
    objects: Record<string, StateObject>,
): Record<string, EntityState> {
    const out: Record<string, EntityState> = {};
    for (const m of mappings) {
        const s = states[m.state];
        const attributes: ProtocolRecord = {
            friendly_name: m.name || nameOf(objects[m.state]),
            iobroker_id: m.state,
            iobroker_role: objects[m.state]?.common?.role || '',
            iobroker_type: objects[m.state]?.common?.type || '',
            // writable: a card may set it (set_value through execute(), see there)
            ...(objects[m.state]?.common?.write === true ? { iobroker_write: true } : {}),
            // its range and the texts of its values: a card's +/− and its mode chips
            ...(typeof objects[m.state]?.common?.min === 'number' ? { iobroker_min: objects[m.state].common.min } : {}),
            ...(typeof objects[m.state]?.common?.max === 'number' ? { iobroker_max: objects[m.state].common.max } : {}),
            ...(stateTexts(objects[m.state]?.common?.states)
                ? { iobroker_states: stateTexts(objects[m.state]?.common?.states) }
                : {}),
            ...(m.reach !== undefined ? { iobroker_reach: m.reach } : {}),
            ...(m.reach_connected ? { iobroker_reach_connected: true } : {}),
            ...(m.battery ? { iobroker_battery_own: m.battery } : {}),
        };
        const read = (binding: unknown): unknown =>
            binding && typeof binding === 'object' && (binding as Binding).id
                ? transformed(states[(binding as Binding).id!]?.val, binding)
                : binding;
        for (const [key, binding] of Object.entries(m.attributes || {})) {
            // a list of bindings: one value of several datapoints (the red, green and blue of a light)
            const value =
                Array.isArray(binding) && binding.some(b => b && typeof b === 'object' && b.id)
                    ? binding.map(b => {
                          const v = read(b);
                          return typeof v === 'number' ? Math.round(v) : v;
                      })
                    : read(binding);
            attributes[key] = whole(key, value);
        }
        const domain = m.entity_id.slice(0, m.entity_id.indexOf('.'));
        // a light of hue and saturation shows its colour as RGB too
        if (domain === 'light' && attributes.rgb_color === undefined && attributes.hs_color !== undefined) {
            const rgb = hsToRgb(attributes.hs_color);
            if (rgb) {
                attributes.rgb_color = rgb;
            }
        }
        // the parts of a device of several datapoints, in the order the editor's device form lists them
        const kind = kindOf(m.entity_id);
        if (severalParts(kind)) {
            const parts = partsOf(m, objects);
            attributes.iobroker_parts = partKeys(kind!).map(k => [k, parts[k] ?? null]);
        }
        let value = transformed(s?.val, m);
        if (typeof value === 'boolean') {
            value = value ? (ON_OFF[domain]?.[0] ?? 'on') : (ON_OFF[domain]?.[1] ?? 'off');
        }
        if (m.when && !holds(m.when, states)) {
            value = m.when.else ?? 'off';
        }
        out[m.entity_id] = {
            entity_id: m.entity_id,
            state: !s || s.val === null || (s.q && s.q !== 0) ? 'unavailable' : String(value),
            attributes,
            last_changed: new Date(s?.lc || s?.ts || 0).toISOString(),
            last_updated: new Date(s?.ts || 0).toISOString(),
        };
    }
    return out;
}
function discover(
    objects: Record<string, StateObject>,
    rooms: Record<string, RoomObject> = {},
    states: Record<string, StateValue> = {},
): Mapping[] {
    return Object.values(objects)
        .filter(
            (o): o is StateObject & { _id: string } =>
                typeof o._id === 'string' &&
                o.type === 'state' &&
                o.common?.read !== false &&
                !o._id.startsWith('system.') &&
                // the large JSON state of 0.4.0 (then still called 3d-home) is no device
                !/^3d-home\.\d+\.storage$/.test(o._id),
        )
        .map(o => {
            const c = o.common,
                role = c.role || '';
            let domain = c.type === 'boolean' ? (c.write ? 'switch' : 'binary_sensor') : 'sensor';
            if (/^switch\.light/.test(role)) {
                domain = 'light';
            }
            const raw = states[o._id]?.val;
            const secret = c.type === 'string' && /password|token|secret|credential|apikey/i.test(`${o._id} ${role}`);
            const m: Mapping & { attributes: Record<string, any> } = {
                entity_id: `${domain}.${hash(o._id)}`,
                name: nameOf(o),
                state: o._id,
                attributes: {},
                actions: {},
                _meta: {
                    role,
                    type: c.type,
                    read: c.read !== false,
                    write: c.write === true,
                    secret,
                    value: secret ? '••••' : typeof raw === 'string' ? raw.slice(0, 120) : raw,
                },
            };
            if (c.unit) {
                m.attributes.unit_of_measurement = c.unit;
            }
            const cls = deviceClass(role);
            if (cls) {
                m.attributes.device_class = cls;
            }
            const room = Object.values(rooms).find(r =>
                r.common?.members?.some(id => o._id === id || o._id.startsWith(`${id}.`)),
            );
            if (room) {
                m.area_id = room._id;
            }
            if (c.type === 'boolean' && c.write === true) {
                m.actions = {
                    turn_on: [{ id: o._id, value: true }],
                    turn_off: [{ id: o._id, value: false }],
                    toggle: [{ id: o._id, toggle: true }],
                };
            }
            return m;
        });
}
async function execute(
    mappings: Mapping[],
    domain: string,
    service: string,
    data: ProtocolRecord,
    io: IoAccess,
): Promise<{ written: number }> {
    const ids = Array.isArray(data.entity_id) ? data.entity_id : [data.entity_id];
    if (!ids.length || ids.some(id => typeof id !== 'string')) {
        fail(t('entity_required'));
    }
    const writes: [string, any][] = [];
    for (const id of ids) {
        const m = mappings.find(item => item.entity_id === id);
        if (!m || (domain !== 'homeassistant' && id.split('.')[0] !== domain)) {
            fail(t('unknown_device', { id }));
        }
        // set_value needs no rule of its own: the mapping's own datapoint takes the value (type, min/max and
        // write are checked below like for every rule) – a wallbox's charging current, a mode
        const rules = m.actions?.[service] ?? (service === 'set_value' ? [{ id: m.state, field: 'value' }] : undefined);
        if (!rules?.length) {
            fail(t('no_action', { service, name: m.name || id }));
        }
        const given = domain === 'light' ? lightData(data) : data;
        for (const r of rules) {
            const has = !!r.field && Object.hasOwn(given, r.field);
            if (r.field && !has && !Object.hasOwn(r, 'value')) {
                if (r.optional) {
                    continue;
                }
                fail(t('param_missing', { field: String(r.field) }));
            }
            // a choice its map does not know is for another rule (a TV's app or its input)
            if (r.optional && r.map && has && !Object.hasOwn(r.map, String(given[r.field!]))) {
                continue;
            }
            const o = (await io.getObjects([r.id]))[r.id];
            if (o?.type !== 'state' || o.common?.write !== true) {
                fail(t('not_writable_short', { id: r.id }));
            }
            let value: unknown;
            if (r.toggle) {
                const now = (await io.getState(r.id))?.val;
                if (o.common.type === 'number') {
                    // a dimmer or a fan's speed: off at its min, on at its max
                    const lo = typeof o.common.min === 'number' ? o.common.min : 0;
                    value = Number(now) > lo ? lo : typeof o.common.max === 'number' ? o.common.max : 100;
                } else if (r.convert === 'rgb_hex' || r.convert === 'rgbw_hex') {
                    // a light switched by its colour: black is off
                    value = transformed(onOff(now) ? [0, 0, 0] : [255, 255, 255], r, true);
                } else {
                    value = transformed(!now, r, true);
                }
            } else {
                let v = has ? given[r.field!] : r.value;
                if (r.index !== undefined) {
                    v = Array.isArray(v) ? v[r.index] : undefined;
                    if (v === undefined) {
                        fail(t('param_missing', { field: `${r.field}[${r.index}]` }));
                    }
                }
                value = transformed(v, r, true);
            }
            if (typeof value !== o.common.type) {
                fail(t('bad_type', { id: r.id, type: String(o.common.type) }));
            }
            if (
                typeof value === 'number' &&
                (!Number.isFinite(value) ||
                    (o.common.min !== undefined && value < o.common.min) ||
                    (o.common.max !== undefined && value > o.common.max))
            ) {
                fail(t('out_of_range', { id: r.id }));
            }
            writes.push([r.id, value]);
        }
    }
    // Validate all commands before the first physical write. Adapter errors still propagate to the UI.
    for (const [id, value] of writes) {
        await io.setState(id, value);
    }
    return { written: writes.length };
}
/**
 * What a light is asked for, in every form its rules may read: the brightness in % and 0 … 255, the colour as RGB and
 * as hue and saturation, the white tone in Kelvin (from mired too).
 */
function lightData(data: ProtocolRecord): ProtocolRecord {
    const out: ProtocolRecord = { ...data };
    if (out.brightness_pct === undefined && typeof out.brightness === 'number') {
        out.brightness_pct = Math.round((out.brightness / 255) * 100);
    }
    if (out.brightness === undefined && typeof out.brightness_pct === 'number') {
        out.brightness = Math.round(out.brightness_pct * 2.55);
    }
    if (out.rgb_color === undefined && out.hs_color !== undefined) {
        const rgb = hsToRgb(out.hs_color);
        if (rgb) {
            out.rgb_color = rgb;
        }
    }
    if (out.hs_color === undefined && out.rgb_color !== undefined) {
        const hs = rgbToHs(out.rgb_color);
        if (hs) {
            out.hs_color = hs;
        }
    }
    if (out.color_temp_kelvin === undefined) {
        const k = Number(out.kelvin ?? (Number(out.color_temp) > 0 ? 1e6 / Number(out.color_temp) : NaN));
        if (Number.isFinite(k) && k > 0) {
            out.color_temp_kelvin = Math.round(k);
        }
    }
    return out;
}
/** The value with every reference to datapoint `from` (state, actions, bindings) pointing to `to`. */
function retarget<T>(value: T, from: string, to: string): T {
    if (value === from) {
        return to as T;
    }
    if (Array.isArray(value)) {
        return value.map(v => retarget(v, from, to)) as T;
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, retarget(v, from, to)])) as T;
    }
    return value;
}

/** The mapping on another datapoint; the unit follows the new object (a datapoint without one keeps none). */
export function withDatapoint(m: Mapping, to: string, obj: StateObject | undefined): Mapping {
    const next = retarget(m, m.state, to);
    const attributes = { ...(next.attributes ?? {}) } as Record<string, unknown>;
    const unit = obj?.common?.unit;
    if (typeof unit === 'string' && unit) {
        attributes.unit_of_measurement = unit;
    } else {
        delete attributes.unit_of_measurement;
    }
    return { ...next, attributes };
}

export { validateMappings, entities, discover, execute, nameOf, hash };
