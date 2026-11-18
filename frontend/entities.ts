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
        fail('Zuordnungen müssen eine Liste sein (max. 10000).');
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
            fail('Ungültige oder doppelte entity_id.');
        }
        seen.add(m.entity_id);
        if (!objects[m.state]?.common || objects[m.state].type !== 'state') {
            fail(`Datenpunkt fehlt: ${m.state}`);
        }
        if (m.when !== undefined) {
            if (typeof m.when?.id !== 'string' || !objects[m.when.id] || !Array.isArray(m.when.values)) {
                fail(`Bedingung braucht einen vorhandenen Datenpunkt und eine Liste von Werten: ${m.entity_id}`);
            }
            if (m.when.else !== undefined && typeof m.when.else !== 'string') {
                fail('else der Bedingung muss Text sein.');
            }
        }
        if (
            m.reach !== undefined &&
            m.reach !== 'report' &&
            m.reach !== 'never' &&
            !(Number.isInteger(m.reach) && m.reach >= 1 && m.reach <= 10080)
        ) {
            fail(`„Nicht erreichbar“: report, never oder 1 bis 10080 Minuten: ${m.entity_id}`);
        }
        if (m.reach_connected !== undefined && typeof m.reach_connected !== 'boolean') {
            fail(`reach_connected muss true oder false sein: ${m.entity_id}`);
        }
        if (m.battery !== undefined && (typeof m.battery !== 'string' || !/^[^\s*?"'`]{1,300}$/.test(m.battery))) {
            fail(`„Batterie“ muss ein Datenpunkt oder none sein: ${m.entity_id}`);
        }
        for (const binding of Object.values(m.attributes || {})) {
            if (typeof binding === 'object' && binding?.id && !objects[binding.id]) {
                fail(`Attribut-Datenpunkt fehlt: ${binding.id}`);
            }
        }
        for (const rules of Object.values(m.actions || {})) {
            if (!Array.isArray(rules)) {
                fail('Aktionen müssen Listen sein.');
            }
            for (const r of rules) {
                const o = objects[r.id];
                if (!o || o.type !== 'state' || o.common?.write !== true) {
                    fail(`Datenpunkt nicht schreibbar: ${r.id}`);
                }
                if (r.field === undefined && !Object.hasOwn(r, 'value') && !r.toggle) {
                    fail('Aktion braucht field, value oder toggle.');
                }
                if (r.convert !== undefined && r.convert !== 'rgb_hex' && r.convert !== 'rgbw_hex') {
                    fail('convert einer Aktion muss rgb_hex oder rgbw_hex sein.');
                }
                for (const key of ['scale', 'offset'] as const) {
                    if (r[key] !== undefined && !Number.isFinite(r[key])) {
                        fail(`${key} muss eine Zahl sein.`);
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
        fail('Farbe muss [r, g, b] sein.');
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
/** A value of ioBroker as the device shows it (`write`: a value of the device as ioBroker takes it). */
export function transformed(value: unknown, binding: Binding, write = false): any {
    if (binding?.convert === 'wmo') {
        if (write) {
            fail('Ein Wettercode kann nicht geschrieben werden.');
        }
        return wmoCondition(value);
    }
    if (binding?.convert) {
        return write ? rgbToHex(value, binding.convert === 'rgbw_hex') : hexToRgb(value);
    }
    if (binding?.map && Object.hasOwn(binding.map, String(value))) {
        return binding.map[String(value)];
    }
    if (binding?.scale !== undefined || binding?.offset !== undefined) {
        return Number(value) * (binding.scale ?? 1) + (binding.offset ?? 0);
    }
    return value;
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
            ...(m.reach !== undefined ? { iobroker_reach: m.reach } : {}),
            ...(m.reach_connected ? { iobroker_reach_connected: true } : {}),
            ...(m.battery ? { iobroker_battery_own: m.battery } : {}),
        };
        for (const [key, binding] of Object.entries(m.attributes || {})) {
            attributes[key] =
                binding && typeof binding === 'object' && binding.id
                    ? transformed(states[binding.id]?.val, binding)
                    : binding;
        }
        let value = transformed(s?.val, m);
        if (typeof value === 'boolean') {
            value = value ? 'on' : 'off';
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
            const classes = {
                temperature: 'temperature',
                humidity: 'humidity',
                power: 'power',
                energy: 'energy',
                motion: 'motion',
                window: 'window',
                door: 'door',
                smoke: 'smoke',
            };
            for (const [part, value] of Object.entries(classes)) {
                if (role.split('.').includes(part)) {
                    m.attributes.device_class = value;
                }
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
        fail('entity_id erforderlich.');
    }
    const writes: [string, any][] = [];
    for (const id of ids) {
        const m = mappings.find(item => item.entity_id === id);
        if (!m || (domain !== 'homeassistant' && id.split('.')[0] !== domain)) {
            fail(`Unbekanntes Gerät: ${id}`);
        }
        const rules = m.actions?.[service];
        if (!rules?.length) {
            fail(`Aktion ${service} für ${m.name || id} nicht zugeordnet.`);
        }
        for (const r of rules) {
            if (r.field && !Object.hasOwn(data, r.field)) {
                if (r.optional) {
                    continue;
                }
                fail(`Parameter ${r.field} fehlt.`);
            }
            const o = (await io.getObjects([r.id]))[r.id];
            if (o?.type !== 'state' || o.common?.write !== true) {
                fail(`Nicht schreibbar: ${r.id}`);
            }
            let value = r.toggle ? !(await io.getState(r.id))?.val : r.field ? data[r.field] : r.value;
            value = transformed(value, r, true);
            if (typeof value !== o.common.type) {
                fail(`Falscher Werttyp für ${r.id}: erwartet ${o.common.type}.`);
            }
            if (
                typeof value === 'number' &&
                (!Number.isFinite(value) ||
                    (o.common.min !== undefined && value < o.common.min) ||
                    (o.common.max !== undefined && value > o.common.max))
            ) {
                fail(`Wert außerhalb des Bereichs: ${r.id}`);
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

export { validateMappings, entities, discover, execute, nameOf };
