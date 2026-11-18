// The health of the mapped devices from their own datapoints in ioBroker: a low battery, a device that cannot be
// reached, the adapter behind it stopped or without connection. The datapoints are found once per device by reading
// the state objects below that device (never all objects); their values are subscribed like the mapped ones and
// become attributes of the device's entities (battery_level, battery_low, unreachable, iobroker_adapter).
import type { StateObject, StateValue } from './model.js';

export interface HealthIds {
    /** The device (adapter.instance.device): several datapoints of one device count once. */
    device: string;
    /** true while the battery is low. */
    lowbat?: string;
    /** Charge in %. */
    battery?: string;
    /** true while the device cannot be reached. */
    unreach?: string;
    /** true while it can be reached (available, online, reachable …). */
    reach?: string;
    /** The adapter instance: its connection indicator and whether it runs. */
    connection?: string;
    alive?: string;
    /** Where the battery came from: the type-detector, a guess by name and role, or chosen at the device. */
    detected?: 'detector' | 'guess' | 'own';
}

const LOWBAT = /^(lowbat|low_bat|lowbattery|low_battery|battery_low|batterylow|bat_low|batlow|lowbatt)$/i;
const BATTERY =
    /^(battery|battery_level|batterylevel|battery_percent|batterypercent|battery_percentage|batterie|battery_state_of_charge)$/i;
const UNREACH = /^(unreach|unreachable|not_reachable)$/i;
const REACH = /^(available|reachable|online|alive|connected|isonline|is_online|reachability)$/i;

/** Adapters whose datapoints are no devices of their own. */
const NO_DEVICE =
    /^(system|0_userdata|alias|javascript|admin|web|vis|vis-2|home3d|3d-home|history|influxdb|sql|recorder|scenes|mqtt-client)$/;

/** The datapoint an alias reads. */
export function aliasTarget(o: StateObject | undefined): string | null {
    const a = (o?.common as { alias?: { id?: unknown } } | undefined)?.alias?.id;
    if (typeof a === 'string') {
        return a;
    }
    if (a && typeof a === 'object' && typeof (a as { read?: unknown }).read === 'string') {
        return (a as { read: string }).read;
    }
    return null;
}

/** The device of a datapoint (its first three parts), null for datapoints that belong to no device. */
export function deviceOf(id: string): string | null {
    const parts = id.split('.');
    if (parts.length < 4 || NO_DEVICE.test(parts[0])) {
        return null;
    }
    return parts.slice(0, 3).join('.');
}

/**
 * The device one level deeper when `device` (an object of `type`) is only a folder of devices and datapoint `id` lies
 * below one more level: `shelly.0.ble` holds the Bluetooth sensors `shelly.0.ble.<mac>`.
 */
export function folderDevice(id: string, device: string, type: string | undefined): string {
    if (type !== 'folder') {
        return device;
    }
    const n = device.split('.').length + 1;
    const parts = id.split('.');
    return parts.length > n ? parts.slice(0, n).join('.') : device;
}

const parentOf = (id: string): string => id.slice(0, id.lastIndexOf('.'));

/**
 * What is read for a datapoint: its whole device when the device is small (adapter.instance.device.channel.state at
 * most: a Homematic or Shelly device with its channels), else only the channel it lies in (a weather adapter keeps
 * thousands of forecast values below one place).
 */
export function scanPrefix(id: string, device: string): string {
    return id.split('.').length <= 5 ? device : parentOf(id);
}

/**
 * Whether a health datapoint `h` belongs to datapoint `id` of `device`: it lies beside it or in one of its parents,
 * or in the device's channel 0 (Homematic's maintenance channel) or its info channel.
 */
export function belongs(h: string, id: string, device: string): boolean {
    const hp = parentOf(h);
    if (hp === device || hp === `${device}.0` || hp === `${device}.info`) {
        return true;
    }
    return hp.length > device.length && id.startsWith(`${hp}.`);
}

/**
 * Picks the health datapoints of `id` among the state objects of its device (the nearest of each kind). A battery
 * elsewhere in the device counts too when it is the device's only one (a Shelly keeps it in its channel DevicePower0).
 */
export function pickHealth(id: string, device: string, objects: Record<string, StateObject>): HealthIds {
    const out: HealthIds = { device };
    const depth: Partial<Record<keyof HealthIds, number>> = {};
    const take = (kind: 'lowbat' | 'battery' | 'unreach' | 'reach', h: string): void => {
        const d = parentOf(h).length;
        if (depth[kind] === undefined || d > depth[kind]) {
            depth[kind] = d;
            out[kind] = h;
        }
    };
    const spare: { lowbat: string[]; battery: string[] } = { lowbat: [], battery: [] };
    for (const [h, o] of Object.entries(objects)) {
        if (o?.type !== 'state' || h === id) {
            continue;
        }
        const near = belongs(h, id, device);
        if (!near && !h.startsWith(`${device}.`)) {
            continue;
        }
        const name = h.slice(h.lastIndexOf('.') + 1);
        const role = o.common?.role ?? '';
        const type = o.common?.type;
        if (
            role === 'indicator.maintenance.lowbat' ||
            role === 'indicator.lowbat' ||
            (LOWBAT.test(name) && type === 'boolean')
        ) {
            if (near) {
                take('lowbat', h);
            } else {
                spare.lowbat.push(h);
            }
        } else if (!near) {
            if (
                role === 'value.battery' ||
                (BATTERY.test(name) && type === 'number' && (!o.common.unit || o.common.unit === '%'))
            ) {
                spare.battery.push(h);
            }
        } else if (
            role === 'value.battery' ||
            (BATTERY.test(name) && type === 'number' && (!o.common.unit || o.common.unit === '%'))
        ) {
            take('battery', h);
        } else if (role === 'indicator.maintenance.unreach' || (UNREACH.test(name) && type === 'boolean')) {
            take('unreach', h);
        } else if (role === 'indicator.reachable' || (REACH.test(name) && type === 'boolean')) {
            take('reach', h);
        }
    }
    for (const kind of ['lowbat', 'battery'] as const) {
        if (!out[kind] && spare[kind].length === 1) {
            out[kind] = spare[kind][0];
        }
    }
    return out;
}

const bool = (v: unknown): boolean | null =>
    v === true || v === 'true' || v === 1 ? true : v === false || v === 'false' || v === 0 ? false : null;

/**
 * A device with a battery may sleep between its reports (a Shelly H&T, smoke or flood sensor is offline most of the
 * time): its "online"/"available" counts only after this long without a sign of life. An explicit UNREACH counts at
 * once.
 */
export const SLEEP_MS = 48 * 3600_000;

/** How unreachable is decided: by the device's own datapoints, or after `staleMs` without an update of `own`. */
export interface HealthOptions {
    /** Unreachable after this long without an update of the device's datapoints (null: as the device reports). */
    staleMs?: number | null;
    /** The mapped datapoints of the device: their updates count as signs of life. */
    own?: readonly string[];
}

/** The attributes of the health datapoints' values. */
export function healthAttributes(
    h: HealthIds,
    states: Record<string, StateValue>,
    now = Date.now(),
    opts: HealthOptions = {},
): Record<string, unknown> {
    const val = (id: string | undefined): unknown => (id ? states[id]?.val : undefined);
    const out: Record<string, unknown> = { health_device: h.device };
    const battery = Number(val(h.battery));
    if (h.battery && val(h.battery) !== null && val(h.battery) !== undefined && Number.isFinite(battery)) {
        out.battery_level = Math.min(100, Math.max(0, battery));
    }
    if (bool(val(h.lowbat)) === true) {
        out.battery_low = true;
    }
    const lastTs = (ids: readonly (string | undefined)[]): number =>
        Math.max(0, ...ids.map(id => (id ? Number(states[id]?.ts) || 0 : 0)));
    if (opts.staleMs) {
        // chosen in the house settings: only the time since the last update counts (none known yet: no verdict)
        const seen = lastTs([...(opts.own ?? []), h.reach, h.unreach, h.battery, h.lowbat]);
        if (seen && now - seen > opts.staleMs) {
            out.unreachable = true;
        }
    } else {
        // the last sign of life of a sleeping device: its reachability or battery written
        const asleep = !!(h.battery || h.lowbat) && now - lastTs([h.reach, h.battery, h.lowbat]) < SLEEP_MS;
        if (bool(val(h.unreach)) === true || (bool(val(h.reach)) === false && !asleep)) {
            out.unreachable = true;
        }
    }
    if (bool(val(h.alive)) === false) {
        out.iobroker_adapter = 'stopped';
    } else if (bool(val(h.connection)) === false) {
        out.iobroker_adapter = 'disconnected';
    }
    return out;
}

/** All datapoints to subscribe for the health. */
export function healthStateIds(health: ReadonlyMap<string, HealthIds>): string[] {
    const out = new Set<string>();
    for (const h of health.values()) {
        for (const id of [h.lowbat, h.battery, h.unreach, h.reach, h.connection, h.alive]) {
            if (id) {
                out.add(id);
            }
        }
    }
    return [...out];
}

/** At most this many devices are read (a plan with very many devices stays quick to open). */
const MAX_DEVICES = 400;

/** The part of the type-detector this file needs (loaded on demand). */
export interface Detector {
    detect(options: {
        objects: Record<string, never>;
        id: string;
        ignoreEnums?: boolean;
        ignoreCache?: boolean;
    }): { states: { name: string; id: string }[] }[] | null;
}

const DETECTED: Record<string, 'lowbat' | 'battery' | 'unreach' | 'reach'> = {
    LOWBAT: 'lowbat',
    BATTERY: 'battery',
    UNREACH: 'unreach',
    CONNECTED: 'reach',
};

type Indicators = Partial<Pick<HealthIds, 'lowbat' | 'battery' | 'unreach' | 'reach'>>;

/**
 * The health datapoints the type-detector of ioBroker finds for datapoint `id` among `objects` (the states of its
 * device with the device and its channels): the indicators LOWBAT, BATTERY, UNREACH and CONNECTED of the control the
 * datapoint belongs to.
 */
export function detectHealth(detector: Detector, id: string, objects: Record<string, StateObject>): Indicators {
    let controls: { states: { name: string; id: string }[] }[] | null = null;
    try {
        controls = detector.detect({
            objects: objects as unknown as Record<string, never>,
            id,
            ignoreEnums: true,
            ignoreCache: true,
        });
    } catch {
        return {};
    }
    const control = controls?.find(c => c.states.some(s => s.id === id)) ?? controls?.[0];
    const out: Indicators = {};
    for (const s of control?.states ?? []) {
        const kind = DETECTED[s.name];
        if (kind && s.id && objects[s.id] && !out[kind]) {
            out[kind] = s.id;
        }
    }
    return out;
}

/** The type-detector of ioBroker, loaded once when it is first needed. */
let detectorLoad: Promise<Detector | null> | null = null;
function loadDetector(): Promise<Detector | null> {
    detectorLoad ??= import('@iobroker/type-detector')
        .then(m => new m.ChannelDetector() as unknown as Detector)
        .catch(() => null);
    return detectorLoad;
}

/** The parents of datapoint `id` from the three-part device on (the device, its channels). */
function parents(id: string): string[] {
    const parts = id.split('.');
    const out: string[] = [];
    for (let n = 3; n < parts.length; n++) {
        out.push(parts.slice(0, n).join('.'));
    }
    return out;
}

/**
 * Finds the health datapoints of the mapped datapoints. `list(prefix)` gives the state objects below a device,
 * `get(ids)` the objects of some IDs (the device and its channels, the adapter's indicators, a chosen battery); both
 * are asked once per device or instance (`cache` keeps them between calls).
 *
 * The battery and reachability come from the type-detector first, then from the names and roles of the device's
 * states (`pickHealth`). `own` (mapped datapoint → its `battery` setting) wins: the chosen datapoint (a number: the
 * charge, true/false: low battery) or `none`; it counts for the whole device. `detected` says where the battery came
 * from. `detector`: the type-detector to use (undefined: the one of ioBroker, loaded on demand; null: none).
 */
export async function findHealth(
    ids: readonly string[],
    objects: Record<string, StateObject>,
    list: (prefix: string) => Promise<Record<string, StateObject>>,
    get: (ids: string[]) => Promise<Record<string, StateObject>>,
    cache: Map<string, Record<string, StateObject>> = new Map(),
    own: ReadonlyMap<string, string> = new Map(),
    detector?: Detector | null,
): Promise<Map<string, HealthIds>> {
    const out = new Map<string, HealthIds>();
    const found = new Map<string, { target: string; device: string; solo: boolean }>();
    for (const id of ids) {
        const target = aliasTarget(objects[id]) ?? id;
        const device = deviceOf(target);
        if (device) {
            found.set(id, { target, device, solo: false });
        } else if (own.has(id)) {
            // no device of an adapter (a script's datapoint): only the battery chosen for it
            found.set(id, { target, device: target, solo: true });
        }
    }
    const objectOf = (id: string): StateObject | undefined => cache.get(`#${id}`)?.[id];
    // The objects of the devices and their channels (is it a folder? the type-detector needs them), of the adapters'
    // indicators and of the chosen batteries, asked together; a folder of devices (Shelly's "ble" with its Bluetooth
    // sensors) puts the device one level deeper, asked again then.
    const real = [...found.values()].filter(t => !t.solo);
    const instances = [...new Set(real.map(t => t.device.split('.').slice(0, 2).join('.')))];
    let ask = [
        ...new Set([
            ...real.flatMap(t => parents(t.target)),
            ...instances.flatMap(i => [`${i}.info.connection`, `system.adapter.${i}.alive`]),
            ...[...own.values()].filter(b => b !== 'none'),
        ]),
    ];
    for (let round = 0; round < 4; round++) {
        const missing = ask.filter(i => !cache.has(`#${i}`));
        if (missing.length) {
            let got: Record<string, StateObject> = {};
            try {
                got = await get(missing);
            } catch {
                // without the objects: the first three parts are the device, the adapter is not watched
            }
            for (const i of missing) {
                cache.set(`#${i}`, got[i] ? { [i]: got[i] } : {});
            }
        }
        ask = [];
        for (const t of real) {
            const deeper = folderDevice(t.target, t.device, objectOf(t.device)?.type);
            if (deeper !== t.device) {
                t.device = deeper;
                ask.push(deeper);
            }
        }
        if (!ask.length) {
            break;
        }
    }
    // a battery chosen at one datapoint counts for its whole device
    const chosen = new Map<string, string>();
    for (const [id, t] of found) {
        const b = own.get(id);
        if (b && !chosen.has(t.device)) {
            chosen.set(t.device, b);
        }
    }
    const targets = new Map<string, { target: string; device: string; prefix: string | null }>();
    for (const [id, { target, device, solo }] of found) {
        targets.set(id, { target, device, prefix: solo ? null : scanPrefix(target, device) });
    }
    const prefixes = [
        ...new Set([...targets.values()].map(t => t.prefix).filter((p): p is string => p !== null)),
    ].slice(0, MAX_DEVICES);
    await Promise.all(
        prefixes
            .filter(d => !cache.has(d))
            .map(async d => {
                try {
                    cache.set(d, (await list(d)) ?? {});
                } catch {
                    cache.set(d, {});
                }
            }),
    );
    const det = detector === undefined ? (prefixes.length ? await loadDetector() : null) : detector;
    for (const [id, { target, device, prefix }] of targets) {
        const objs = prefix === null ? {} : cache.get(prefix);
        if (!objs) {
            continue;
        }
        const h = pickHealth(target, device, objs);
        if (h.battery || h.lowbat) {
            h.detected = 'guess';
        }
        if (det && prefix !== null) {
            // the type-detector sees the states with their device and channels
            const withParents: Record<string, StateObject> = { ...objs };
            for (const p of parents(target)) {
                const o = objectOf(p);
                if (o) {
                    withParents[p] = o;
                }
            }
            const d = detectHealth(det, target, withParents);
            if (d.battery || d.lowbat) {
                delete h.battery;
                delete h.lowbat;
                h.detected = 'detector';
            }
            Object.assign(h, d);
        }
        const choice = chosen.get(device);
        if (choice) {
            delete h.battery;
            delete h.lowbat;
            h.detected = 'own';
            const o = choice === 'none' ? undefined : objectOf(choice);
            if (o?.common.type === 'boolean') {
                h.lowbat = choice;
            } else if (o) {
                h.battery = choice;
            }
        }
        if (prefix !== null) {
            const inst = device.split('.').slice(0, 2).join('.');
            if (Object.keys(cache.get(`#${inst}.info.connection`) ?? {}).length) {
                h.connection = `${inst}.info.connection`;
            }
            if (Object.keys(cache.get(`#system.adapter.${inst}.alive`) ?? {}).length) {
                h.alive = `system.adapter.${inst}.alive`;
            }
        }
        if (h.lowbat || h.battery || h.unreach || h.reach || h.connection || h.alive || h.detected === 'own') {
            out.set(id, h);
        }
    }
    return out;
}
