// What the 3D view shows of the home beyond its devices: worked out from the plan and the states each time the
// devices are synced (tasks.ts patches view3d.ts to call it) and drawn by home-fx.ts. No three.js here; the plan's
// types are described by their shape, so this file needs nothing of the 3D frontend.
import { isCarKind } from './cars';
import type {
    AirState,
    CarState,
    BadgeState,
    FloodState,
    HomeScene,
    LawnState,
    MouldState,
    MowerState,
    SoundState,
    StreamState,
} from './home-fx';
import {
    type MeterFlow,
    airFlow,
    carPresent,
    cheapestWindow,
    climateHeats,
    coldCorners,
    convexHull,
    dryness,
    edgeNormalOut,
    flowLpm,
    healthKey,
    healthOf,
    healthProblem,
    isNoiseSensor,
    isOn,
    isOuterEdge,
    LONG_FLOW_MS,
    mediaLevel,
    meterLitres,
    mouldRisk,
    mowerPhase,
    noiseLevel,
    OPEN_HEAT_MS,
    parseForecast,
    priceColor,
    priceLevel,
    pointIn,
    type Health,
    type Rgb,
    type StateLike,
    type Vec2,
    WARNING_COLORS,
    warningLevel,
    warningText,
} from './home-data';

export interface HassLike {
    states: Record<string, StateLike | undefined>;
    entities?: Record<string, { area_id?: string | null } | undefined>;
}

export interface RoomLike {
    id: string;
    name: string;
    area_id: string | null;
    points: Vec2[];
    ceiling_height?: number | null;
}

export interface OpeningLike {
    id: string;
    room_id: string;
    edge: number;
    offset: number;
    wall?: string | null;
    width: number;
    type: string;
    sill: number;
    height: number;
}

export interface FurnitureLike {
    id: string;
    type: string;
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    rotation: number;
    entity?: string | null;
    heat_sensor?: string | null;
    moisture?: string | null;
    moisture_min?: number | null;
    mount_y?: number | null;
    water?: string | null;
    water_house?: boolean;
    car_color?: string | null;
    /** A boat's gear: the sensor of a hatch, a tank … */
    gear_entity?: string | null;
}

export interface OutdoorLike {
    id: string;
    type: string;
    points: Vec2[];
    offset?: number | null;
}

export interface FloorLike {
    id: string;
    elevation: number;
    height: number;
    rooms: RoomLike[];
    openings: OpeningLike[];
    furniture: FurnitureLike[];
    outdoor?: OutdoorLike[];
}

export interface HomeSettings {
    warning_entity?: string | null;
    price_entity?: string | null;
    price_forecast?: string | null;
    water_flow?: string | null;
    /** false: no air at open windows (and no mould, unless `mould` says otherwise). */
    home_air?: boolean;
    /** false: no mould in cold corners; missing: as `home_air`. */
    mould?: boolean;
    /** false: no price glow round the house. */
    price_glow?: boolean;
}

export interface BuildingLike {
    floors: FloorLike[];
    settings: HomeSettings;
    energy?: { tariff?: string | null; water?: string | null } | null;
}

/** A device's spot in the plan (a placed device, a linked piece of furniture). */
export interface MarkerLike {
    id: string;
    floorId: string;
    roomId: string | null;
    x: number;
    y: number;
    z: number;
}

/** A warning for the banner (the 3D view's own alert format). */
export interface HomeAlert {
    kind: string;
    entity: string;
    roomId: string | null;
    floorId: string | null;
    text: string;
    color: Rgb;
    quiet?: boolean;
}

/** Translation of the page: a key and values for `{name}` parts. */
export type Translate = (key: string, vars?: Record<string, string>) => string;

/** Types that show running water (with a sensor of their own, or the house's water meter). */
export const WATER_TYPES = new Set(['shower', 'bathtub', 'washbasin', 'sink']);

/** The furniture types this adds. */
export const HOME_TYPES = ['robot_mower', 'sprinkler'] as const;

const unitOf = (st: StateLike, fallback: string): string => {
    const u = st.attributes.unit_of_measurement;
    return typeof u === 'string' && u ? u : fallback;
};
const rad = (deg: number): number => (deg * Math.PI) / 180;
const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
};

/** The entities to watch for this (a change syncs the devices again). */
export function homeWatched(
    hass: HassLike,
    b: BuildingLike,
    areaEntities: (area: string | null) => string[],
    all: boolean,
): string[] {
    const out = new Set<string>();
    const add = (id: string | null | undefined): void => {
        if (id && id !== 'none' && hass.states[id]) {
            out.add(id);
        }
    };
    const s = b.settings;
    add(s.warning_entity);
    add(s.price_entity ?? b.energy?.tariff);
    add(s.price_forecast);
    add(s.water_flow);
    add(b.energy?.water);
    for (const f of b.floors) {
        for (const x of f.furniture) {
            if (x.type === 'robot_mower' || x.type === 'sprinkler') {
                add(x.entity);
                add(x.moisture);
            }
            if (isCarKind(x.type)) {
                add(x.entity);
            }
            if (x.type === 'radiator') {
                add(x.entity);
                add(x.heat_sensor);
            }
            if (WATER_TYPES.has(x.type)) {
                add(x.water);
            }
        }
        for (const r of f.rooms) {
            for (const id of areaEntities(r.area_id)) {
                if (id.startsWith('climate.') || id.startsWith('media_player.') || isNoiseSensor(hass.states[id])) {
                    add(id);
                }
            }
        }
    }
    if (all) {
        for (const id of Object.keys(hass.states)) {
            if (!id.startsWith('sun.')) {
                out.add(id);
            }
        }
    }
    return [...out];
}

/** Whether a room heats: a thermostat of its area, or a radiator standing in it, heats. */
function roomHeats(
    hass: HassLike,
    floor: FloorLike,
    room: RoomLike,
    areaEntities: (area: string | null) => string[],
): boolean {
    if (areaEntities(room.area_id).some(id => id.startsWith('climate.') && climateHeats(hass.states[id]))) {
        return true;
    }
    return floor.furniture.some(
        f =>
            f.type === 'radiator' &&
            pointIn([f.x, f.z], room.points) &&
            ((!!f.entity && climateHeats(hass.states[f.entity])) ||
                (!!f.heat_sensor && isOn(hass.states[f.heat_sensor]))),
    );
}

export interface HomeInput {
    hass: HassLike;
    building: BuildingLike;
    now: number;
    t: Translate;
    areaEntities: (area: string | null) => string[];
    /** Room temperature and humidity (°C, %), null when unknown. */
    climate: (floor: FloorLike, room: RoomLike) => { t: number | null; rh: number | null };
    /** The ground's height at a point outside the rooms (a lawn's top, the terrain); without it 0, the floor. */
    ground?: (floor: FloorLike, x: number, z: number) => number;
    /** How far each opening stands open (0 … 1) and the sensor that says so (for since when). */
    openings: ReadonlyMap<string, { open: number; tilt: number; open2: number; tilt2: number; sensed?: boolean }>;
    contacts: ReadonlyMap<string, string | null>;
    markers: readonly MarkerLike[];
    /** The wind: where it blows to in the plan (unit) and its speed (m/s); null: unknown. */
    wind: { to: Vec2 | null; speed: number } | null;
    /** Outdoor temperature (°C), null: unknown. */
    tOut: number | null;
    /** Water sensors that report a leak, by room. */
    leaks: readonly { entity: string; roomId: string; floorId: string }[];
    /** Price slots from the history of the price entity (when there is no forecast). */
    priceHistory: readonly { start: number; end: number; price: number }[];
    /** Badges of devices with a low battery or out of reach (the "Technik" view). */
    health: boolean;
    meter: MeterFlow;
    /** Format a number for the page. */
    fmt: (n: number, digits: number) => string;
    /** Format a time of day (ms). */
    time: (ms: number) => string;
}

export interface PriceInfo {
    value: number;
    level: number | null;
    /** The cheapest hour ahead (ms), null: unknown. */
    cheapest: { start: number; end: number } | null;
}

export interface HomeOutput {
    scene: HomeScene;
    alerts: HomeAlert[];
    price: PriceInfo | null;
    /** The level of an official weather warning (0 none … 4). */
    warning: number;
}

/**
 * The electricity price: the price entity (else the energy settings' tariff), its place between the day's lowest and
 * highest price (from the forecast datapoint, else from the price's own history) and the cheapest hour ahead.
 */
export function priceInfo(input: HomeInput): PriceInfo | null {
    const b = input.building;
    const id = b.settings.price_entity || b.energy?.tariff;
    const st = id ? input.hass.states[id] : undefined;
    const value = num(st?.state);
    if (value === null) {
        return null;
    }
    const fid = b.settings.price_forecast;
    const fst = fid ? input.hass.states[fid] : undefined;
    let slots = fst ? parseForecast(fst.state) : [];
    if (fst && !slots.length) {
        slots = parseForecast(fst.attributes);
    }
    const forecast = slots.length > 0;
    if (!forecast) {
        slots = [...input.priceHistory];
    }
    return {
        value,
        level: priceLevel(value, slots, input.now),
        cheapest: forecast ? cheapestWindow(slots, input.now, 1) : null,
    };
}

/** Everything of the home looks at this moment. */
export function homeScene(input: HomeInput): HomeOutput {
    const { hass, building: b, now, t } = input;
    const airs: AirState[] = [];
    const moulds: MouldState[] = [];
    const floods: FloodState[] = [];
    const sounds: SoundState[] = [];
    const streams: StreamState[] = [];
    const sprinklers: HomeScene['sprinklers'] = [];
    const lawns: LawnState[] = [];
    const mowers: MowerState[] = [];
    const badges: BadgeState[] = [];
    const cars: CarState[] = [];
    const alerts: HomeAlert[] = [];
    const air = b.settings.home_air !== false;
    const mould = (b.settings.mould ?? b.settings.home_air) !== false;
    // the water at the house's meter: a flow sensor, else how fast the meter counts
    let houseFlow = 0;
    const flowId = b.settings.water_flow;
    const flowSt = flowId ? hass.states[flowId] : undefined;
    if (flowSt && num(flowSt.state) !== null) {
        houseFlow = flowLpm(num(flowSt.state)!, unitOf(flowSt, 'l/min'));
    } else if (b.energy?.water) {
        const st = hass.states[b.energy.water];
        const v = num(st?.state);
        if (st && v !== null) {
            input.meter.add(now, meterLitres(v, unitOf(st, 'm³')));
            houseFlow = input.meter.flow(now);
        }
    }
    const since = input.meter.running(now, houseFlow);
    if (since !== null && now - since >= LONG_FLOW_MS) {
        alerts.push({
            kind: 'fp3d_water_run',
            entity: flowId || b.energy?.water || 'water',
            roomId: null,
            floorId: null,
            text: t('home_water_run', {
                min: String(Math.round((now - since) / 60_000)),
                flow: input.fmt(houseFlow, 1),
            }),
            color: [0.3, 0.65, 1],
            quiet: true,
        });
    }
    for (const floor of b.floors) {
        const others = floor.rooms.map(r => r.points);
        for (const room of floor.rooms) {
            if (room.points.length < 3) {
                continue;
            }
            const heats = air && roomHeats(hass, floor, room, input.areaEntities);
            let warned = false;
            // air through the room's open windows and outer doors
            for (const o of floor.openings) {
                if (!air || o.room_id !== room.id || o.wall || o.type === 'garage' || o.edge >= room.points.length) {
                    continue;
                }
                const st = input.openings.get(o.id);
                // only what a sensor reports open (a door without one only stands open in the picture)
                if (!st || st.sensed === false) {
                    continue;
                }
                const open = Math.max(st.open, st.open2);
                const tilt = Math.max(st.tilt, st.tilt2);
                if (open < 0.15 && tilt < 0.3) {
                    continue;
                }
                if (!isOuterEdge(room.points, o.edge, others)) {
                    continue;
                }
                const a = room.points[o.edge];
                const c = room.points[(o.edge + 1) % room.points.length];
                const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
                const x = a[0] + ((c[0] - a[0]) / len) * o.offset;
                const z = a[1] + ((c[1] - a[1]) / len) * o.offset;
                const n = edgeNormalOut(room.points, o.edge);
                const wide = open >= 0.15 ? 1 : 0.35;
                const flow = input.wind ? airFlow(n, input.wind.to, input.wind.speed) * wide : 0;
                airs.push({
                    id: o.id,
                    floor: floor.id,
                    x,
                    z,
                    nx: n[0],
                    nz: n[1],
                    w: o.width * (open >= 0.15 ? 0.9 : 0.5),
                    y0: o.sill,
                    h: o.height,
                    flow,
                    heat: heats,
                });
                // open while the room heats: a warning once it stood open a while
                const contact = input.contacts.get(o.id);
                const changed = contact ? Date.parse(hass.states[contact]?.last_changed ?? '') : NaN;
                if (heats && !warned && Number.isFinite(changed) && now - changed >= OPEN_HEAT_MS) {
                    warned = true;
                    alerts.push({
                        kind: 'fp3d_window_heat',
                        entity: contact!,
                        roomId: room.id,
                        floorId: floor.id,
                        text: t('home_window_heat', { min: String(Math.round((now - changed) / 60_000)) }),
                        color: [1, 0.48, 0.15],
                    });
                }
            }
            // mould: how damp the coldest corner gets
            const cl = mould ? input.climate(floor, room) : { t: null, rh: null };
            if (cl.t !== null && cl.rh !== null) {
                const m = mouldRisk(cl.t, cl.rh, input.tOut);
                if (m.level > 0) {
                    const corners = coldCorners(room.points, others);
                    const centre = room.points.reduce<Vec2>(
                        (s, p) => [s[0] + p[0] / room.points.length, s[1] + p[1] / room.points.length],
                        [0, 0],
                    );
                    if (corners.length) {
                        moulds.push({
                            id: room.id,
                            floor: floor.id,
                            corners,
                            height: room.ceiling_height ?? floor.height,
                            level: m.level,
                            label: m.level >= 2 ? `💧 ${t('home_air_out')} · ${input.fmt(m.surfaceRh, 0)} %` : '',
                            cx: centre[0],
                            cz: centre[1],
                        });
                    }
                }
            }
        }
        // water standing in a room with a leak: it rises over the first quarter of an hour
        for (const l of input.leaks) {
            if (l.floorId !== floor.id) {
                continue;
            }
            const room = floor.rooms.find(r => r.id === l.roomId);
            if (!room || room.points.length < 3 || floods.some(f => f.id === room.id)) {
                continue;
            }
            const from = Date.parse(hass.states[l.entity]?.last_changed ?? '');
            const k = Number.isFinite(from) ? Math.min(1, Math.max(0, (now - from) / (15 * 60_000))) : 1;
            floods.push({ id: room.id, floor: floor.id, points: room.points, level: 0.012 + 0.06 * k });
        }
        // water at taps and showers
        for (const f of floor.furniture) {
            if (!WATER_TYPES.has(f.type) || (!f.water && !f.water_house)) {
                continue;
            }
            const on = f.water_house ? houseFlow > 0.3 : isOn(f.water ? hass.states[f.water] : undefined);
            if (!on) {
                continue;
            }
            const r = rad(f.rotation ?? 0);
            // the tap at one end of a bathtub, at the back of a basin (local -z); turned with the item (clockwise)
            const lx = f.type === 'bathtub' ? -f.w * 0.4 : 0;
            const lz = f.type === 'bathtub' ? 0 : -f.d * 0.28;
            const wx = f.x + lx * Math.cos(r) - lz * Math.sin(r);
            const wz = f.z + lx * Math.sin(r) + lz * Math.cos(r);
            const base = f.mount_y ?? 0;
            if (f.type === 'shower') {
                streams.push({
                    id: f.id,
                    floor: floor.id,
                    x: f.x,
                    y: 2.05,
                    z: f.z,
                    drop: 1.95,
                    spread: Math.min(f.w, f.d) * 0.22,
                });
            } else {
                streams.push({
                    id: f.id,
                    floor: floor.id,
                    x: wx,
                    y: base + f.h + 0.14,
                    z: wz,
                    drop: f.type === 'bathtub' ? 0.45 : 0.3,
                    spread: 0.015,
                });
            }
        }
        // the lawns: dry by the sprinklers' soil sensors, striped where a mower drives
        const floorLawns = (floor.outdoor ?? []).filter(o => o.type === 'lawn' && o.points.length >= 3);
        const lawnOf = (p: Vec2): OutdoorLike | null => {
            const inside = floorLawns.find(l => pointIn(p, l.points));
            if (inside) {
                return inside;
            }
            let best: OutdoorLike | null = null;
            let dist = 6;
            for (const l of floorLawns) {
                for (const q of l.points) {
                    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
                    if (d < dist) {
                        dist = d;
                        best = l;
                    }
                }
            }
            return best;
        };
        const groundAt = (x: number, z: number): number => input.ground?.(floor, x, z) ?? 0;
        // a lawn's top: the ground at a point inside it (its corners' middle, else its first corner)
        const lawnY = (l: OutdoorLike): number => {
            const c = l.points.reduce<Vec2>(
                (s, p) => [s[0] + p[0] / l.points.length, s[1] + p[1] / l.points.length],
                [0, 0],
            );
            return pointIn(c, l.points) ? groundAt(c[0], c[1]) : groundAt(l.points[0][0], l.points[0][1]);
        };
        const dry = new Map<string, number>();
        const mown = new Set<string>();
        for (const f of floor.furniture) {
            if (f.type === 'sprinkler') {
                const lawn = lawnOf([f.x, f.z]);
                sprinklers.push({
                    id: f.id,
                    floor: floor.id,
                    x: f.x,
                    z: f.z,
                    y: groundAt(f.x, f.z),
                    r: Math.max(0.5, Math.max(f.w, f.d) / 2),
                    on: isOn(f.entity ? hass.states[f.entity] : undefined),
                });
                const m = num(f.moisture ? hass.states[f.moisture]?.state : null);
                if (lawn && m !== null) {
                    dry.set(lawn.id, Math.max(dry.get(lawn.id) ?? 0, dryness(m, f.moisture_min ?? 30)));
                }
            } else if (isCarKind(f.type)) {
                // on the room's floor in a garage, else on the ground outside
                const inRoom = floor.rooms.some(r => r.points.length >= 3 && pointIn([f.x, f.z], r.points));
                const entity = f.entity && f.entity !== 'none' ? f.entity : null;
                cars.push({
                    id: f.id,
                    floor: floor.id,
                    kind: f.type,
                    x: f.x,
                    z: f.z,
                    y: inRoom ? (f.mount_y ?? 0) : groundAt(f.x, f.z),
                    angle: rad(f.rotation ?? 0),
                    w: f.w,
                    d: f.d,
                    h: f.h,
                    color: f.car_color ?? null,
                    present: !entity || carPresent(hass.states[entity]),
                    sensed: !!entity,
                });
            } else if (f.type === 'robot_mower') {
                const lawn = lawnOf([f.x, f.z]);
                if (lawn) {
                    mown.add(lawn.id);
                }
                const st = f.entity ? hass.states[f.entity] : undefined;
                const phase = st ? mowerPhase(st.state) : 'docked';
                mowers.push({
                    id: f.id,
                    floor: floor.id,
                    dock: [f.x, f.z],
                    dockAngle: rad(f.rotation ?? 0),
                    lawn: lawn?.id ?? null,
                    phase,
                    size: Math.max(0.3, f.d),
                    y: groundAt(f.x, f.z),
                    label: phase === 'error' ? `⚠ ${t('home_mower_error')}` : '',
                });
            }
        }
        for (const l of floorLawns) {
            if (dry.has(l.id) || mown.has(l.id)) {
                lawns.push({
                    id: l.id,
                    floor: floor.id,
                    points: l.points,
                    y: lawnY(l),
                    dry: dry.get(l.id) ?? 0,
                    mown: mown.has(l.id),
                });
            }
        }
    }
    // rings of sound round a playing speaker or TV, and round a loud noise sensor
    const seen = new Set<string>();
    for (const m of input.markers) {
        if (seen.has(`${m.id}@${m.floorId}`)) {
            continue;
        }
        seen.add(`${m.id}@${m.floorId}`);
        const st = hass.states[m.id];
        if (m.id.startsWith('media_player.')) {
            const level = mediaLevel(st);
            if (level > 0) {
                sounds.push({
                    id: `${m.id}@${m.x},${m.z}`,
                    floor: m.floorId,
                    x: m.x,
                    y: m.y + 0.15,
                    z: m.z,
                    level,
                    kind: 'music',
                });
            }
        } else if (isNoiseSensor(st)) {
            const db = num(st?.state);
            if (db !== null && db >= 50) {
                sounds.push({
                    id: `${m.id}@${m.x},${m.z}`,
                    floor: m.floorId,
                    x: m.x,
                    y: m.y + 0.15,
                    z: m.z,
                    level: noiseLevel(db),
                    kind: 'noise',
                });
            }
        }
    }
    // the "Technik" view: a badge at every placed device with a low battery or out of reach
    if (input.health) {
        for (const m of input.markers) {
            const h = healthOf(hass.states[m.id]);
            const p = healthProblem(h);
            if (!p || badges.some(x => x.id === m.id)) {
                continue;
            }
            const st = hass.states[m.id];
            const why =
                p === 'unreach'
                    ? t(h.adapter ? `home_adapter_${h.adapter}` : 'home_offline')
                    : `${t('home_battery_low')}${h.battery !== null ? ` (${Math.round(h.battery)} %)` : ''}`;
            const last = Date.parse(String(st?.last_updated ?? ''));
            const device = st?.attributes.health_device;
            badges.push({
                id: m.id,
                floor: m.floorId,
                x: m.x,
                y: m.y,
                z: m.z,
                text:
                    p === 'unreach'
                        ? `⚠ ${t(h.adapter ? `home_adapter_${h.adapter}` : 'home_offline')}`
                        : `🔋 ${h.battery !== null ? `${Math.round(h.battery)} %` : t('home_battery_low')}`,
                tone: p === 'unreach' ? 'alarm' : 'warn',
                tip: [
                    typeof st?.attributes.friendly_name === 'string' ? st.attributes.friendly_name : m.id,
                    why,
                    Number.isFinite(last)
                        ? t('home_last_update', {
                              // older than today: with the date
                              time:
                                  input.now - last > 20 * 3600_000
                                      ? `${new Date(last).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${input.time(last)}`
                                      : input.time(last),
                          })
                        : '',
                    typeof device === 'string' ? device : '',
                ]
                    .filter(Boolean)
                    .join('\n'),
            });
        }
    }
    // an official weather warning: a banner in its colour
    let warning = 0;
    const wid = b.settings.warning_entity;
    const wst = wid ? hass.states[wid] : undefined;
    if (wid && wst) {
        warning = Math.max(
            warningLevel(wst.state),
            warningLevel(wst.attributes.level),
            warningLevel(wst.attributes.severity),
        );
        if (warning > 0) {
            alerts.push({
                kind: `fp3d_wx${warning}`,
                entity: wid,
                roomId: null,
                floorId: null,
                text: warningText(wst) || t(`home_warning_${warning}`),
                color: WARNING_COLORS[warning],
                quiet: true,
            });
        }
    }
    // the price glow round the house
    const price = priceInfo(input);
    let glow: HomeScene['glow'] = null;
    if (price && price.level !== null && b.settings.price_glow !== false) {
        const ground = [...b.floors].sort((p, q) => p.elevation - q.elevation)[0];
        const pts = ground ? convexHull(ground.rooms.flatMap(r => r.points)) : [];
        if (ground && pts.length >= 3) {
            // the ground just outside the house
            const c = pts.reduce<Vec2>((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
            const d = Math.hypot(pts[0][0] - c[0], pts[0][1] - c[1]) || 1;
            const out: Vec2 = [pts[0][0] + ((pts[0][0] - c[0]) / d) * 0.5, pts[0][1] + ((pts[0][1] - c[1]) / d) * 0.5];
            const y = input.ground?.(ground, out[0], out[1]) ?? 0;
            glow = { floor: ground.id, points: pts, y, color: priceColor(price.level) };
        }
    }
    return {
        scene: { airs, moulds, floods, sounds, streams, sprinklers, lawns, mowers, badges, cars, glow },
        alerts,
        price,
        warning,
    };
}

/**
 * Furniture with a sensor of its own (the contact of a hatch, the level of a tank): its spot, so that its battery and
 * reachability show at the item and count in its room. Ids in `taken` (placed devices) are left out.
 */
export function gearMarkers(b: BuildingLike, taken: ReadonlySet<string>): MarkerLike[] {
    const out: MarkerLike[] = [];
    const seen = new Set(taken);
    for (const floor of b.floors) {
        for (const f of floor.furniture) {
            const id = f.gear_entity;
            if (!id || id === 'none' || seen.has(id)) {
                continue;
            }
            seen.add(id);
            const room = floor.rooms.find(r => r.points.length >= 3 && pointIn([f.x, f.z], r.points));
            out.push({
                id,
                floorId: floor.id,
                roomId: room?.id ?? null,
                x: f.x,
                y: (f.mount_y ?? 0) + f.h + 0.2,
                z: f.z,
            });
        }
    }
    return out;
}

/** The devices of a room in the "Technik" view. */
export interface HealthRoom {
    unreach: number;
    low: number;
    ok: number;
    devices: { name: string; problem: 'unreach' | 'battery' | null; battery: number | null }[];
}

export interface HealthReport {
    /** Per room: devices out of reach, with a low battery and fine, and which they are. */
    rooms: Map<string, HealthRoom>;
    /** The devices with a problem (unreachable first). */
    items: { id: string; name: string; room: string; problem: 'unreach' | 'battery'; health: Health }[];
    /** Devices that report a battery or their reachability. */
    known: number;
}

/**
 * The health of all devices: grouped per physical device (several datapoints of one sensor count once), each in the
 * room of its area or of its place in the plan.
 */
export function healthReport(
    hass: HassLike,
    b: BuildingLike,
    markers: readonly MarkerLike[],
    name: (id: string) => string,
): HealthReport {
    const roomOfArea = new Map<string, { id: string; name: string }>();
    const roomById = new Map<string, string>();
    for (const f of b.floors) {
        for (const r of f.rooms) {
            roomById.set(r.id, r.name);
            if (r.area_id && !roomOfArea.has(r.area_id)) {
                roomOfArea.set(r.area_id, { id: r.id, name: r.name });
            }
        }
    }
    const placed = new Map<string, string>();
    for (const m of markers) {
        if (m.roomId && !placed.has(m.id)) {
            placed.set(m.id, m.roomId);
        }
    }
    const groups = new Map<string, { ids: string[]; health: Health; reports: boolean }>();
    for (const [id, st] of Object.entries(hass.states)) {
        if (!st || id.startsWith('sun.') || id.startsWith('weather.')) {
            continue;
        }
        const h = healthOf(st);
        const a = st.attributes;
        const reports =
            a.battery_level !== undefined ||
            a.battery !== undefined ||
            a.battery_low !== undefined ||
            a.unreachable !== undefined ||
            a.health_device !== undefined;
        const key = healthKey(id, st);
        const g = groups.get(key);
        if (!g) {
            groups.set(key, { ids: [id], health: h, reports });
            continue;
        }
        g.ids.push(id);
        g.reports ||= reports;
        g.health = {
            battery:
                g.health.battery === null
                    ? h.battery
                    : h.battery === null
                      ? g.health.battery
                      : Math.min(g.health.battery, h.battery),
            low: g.health.low || h.low,
            unreach: g.health.unreach || h.unreach,
            adapter: g.health.adapter ?? h.adapter,
        };
    }
    const rooms = new Map<string, HealthRoom>();
    const items: HealthReport['items'] = [];
    let known = 0;
    for (const g of groups.values()) {
        // a device that tells nothing about itself (no battery, no reachability) is only counted when unavailable
        const p = healthProblem(g.health);
        if (!g.reports && p !== 'unreach') {
            continue;
        }
        known++;
        const id = g.ids[0];
        const area = hass.entities?.[id]?.area_id ?? null;
        const roomId =
            g.ids.map(x => placed.get(x)).find(Boolean) ?? (area ? roomOfArea.get(area)?.id : undefined) ?? null;
        if (roomId) {
            const r = rooms.get(roomId) ?? { unreach: 0, low: 0, ok: 0, devices: [] };
            r.devices.push({ name: name(id), problem: p, battery: g.health.battery });
            if (p === 'unreach') {
                r.unreach++;
            } else if (p === 'battery') {
                r.low++;
            } else {
                r.ok++;
            }
            rooms.set(roomId, r);
        }
        if (p) {
            items.push({
                id,
                name: name(id),
                room: roomId ? (roomById.get(roomId) ?? '') : '',
                problem: p,
                health: g.health,
            });
        }
    }
    items.sort((x, y) =>
        x.problem === y.problem
            ? (x.health.battery ?? 100) - (y.health.battery ?? 100)
            : x.problem === 'unreach'
              ? -1
              : 1,
    );
    return { rooms, items, known };
}

/** Colour of a room in the "Technik" view: red with a device out of reach, amber with a low battery, else grey-green. */
export function healthColor(r: { unreach: number; low: number }): Rgb {
    return r.unreach ? [1, 0.25, 0.25] : r.low ? [1, 0.68, 0.15] : [0.45, 0.72, 0.55];
}
