// The past of the devices from the history adapters of ioBroker (history, influxdb, sql): `history/history_during_period`
// (the detail dialog) and `home3d/timetravel/history` (the time travel). The instance is the one that logs the datapoint
// (its `common.custom`), else the default history of the system; one instance may be preferred (the one chosen for the
// time travel, else a recorder: it selects its datapoints itself) for the datapoints it records. From a recorder the time
// travel reads all its datapoints at once (`getSnapshot` at the start, `getEvents` of the window) instead of two
// `getHistory` per datapoint. Values become device states like the live ones.
import { transformed } from './entities.js';
import type { Mapping, StateObject } from './model.js';
import { moonAttributes } from './moon.js';
import { sunAt } from './sun.js';

/** One row as the 3D frontend expects it (minimal response): state and time of the last update in seconds. */
export interface HistoryRow {
    s: string;
    lu: number;
}

/** What the page needs of ioBroker for the history. */
export interface HistoryAccess {
    getObjects(ids: string[]): Promise<Record<string, StateObject>>;
    defaultHistory(): Promise<string | null>;
    getHistory(id: string, options: ioBroker.GetHistoryOptions): Promise<ioBroker.GetHistoryResult>;
    /** The datapoints an instance records (its `getEnabledDPs`); null if it does not answer. */
    recordedIds?(instance: string): Promise<Set<string> | null>;
    /** Asks a recorder instance (`getSnapshot`, `getEvents`); null without an answer. */
    recorderWalk?<T>(
        instance: string,
        command: 'getSnapshot' | 'getEvents',
        message: Record<string, unknown>,
    ): Promise<T | null>;
}

/** An instance of the recorder: it answers `getSnapshot` and `getEvents` for many datapoints at once. */
export function isRecorder(instance: string | null | undefined): boolean {
    return !!instance && /^recorder\.\d+$/.test(instance);
}

/** At most this many points per device and period; longer periods are reduced by the adapter (min/max per step). */
const MAX_POINTS = 500;
/** Periods up to this length are read value by value. */
const RAW_UP_TO = 36 * 3600 * 1000;

function stateOf(value: unknown, m: Mapping, type: string | undefined): string {
    let v: unknown = transformed(value, m);
    if (type === 'boolean' && typeof v !== 'boolean') {
        v = v === 'true' || v === 1 || v === '1';
    }
    if (typeof v === 'boolean') {
        return v ? 'on' : 'off';
    }
    if (typeof v === 'number') {
        return String(Math.round(v * 1000) / 1000);
    }
    return typeof v === 'string' ? v : 'unavailable';
}

/** The history instance that logs a datapoint. */
export function loggedBy(o: StateObject | undefined, fallback: string | null): string | null {
    const custom = (o?.common as { custom?: Record<string, { enabled?: boolean } | null> } | undefined)?.custom;
    const own = Object.entries(custom ?? {}).find(
        ([key, c]) => c?.enabled && /^(history|influxdb|sql)\.\d+$/.test(key),
    );
    return own?.[0] ?? fallback;
}

function time(value: unknown, fallback: number): number {
    const t = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : NaN;
    return Number.isFinite(t) ? t : fallback;
}

interface Source {
    m: Mapping;
    instance: string;
    type: string | undefined;
}

const idList = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === 'string');

/** The devices whose datapoint a history adapter logs (its own `common.custom`, not only the default history). */
export async function historyEnabled(
    io: HistoryAccess,
    mappings: Mapping[],
    msg: { entity_ids?: unknown },
    preferred: string | null = null,
): Promise<string[]> {
    const wanted = idList(msg.entity_ids)
        .map(id => mappings.find(m => m.entity_id === id))
        .filter((m): m is Mapping => !!m);
    if (!wanted.length) {
        return [];
    }
    const [objects, recorded] = await Promise.all([
        io.getObjects(wanted.map(m => m.state)),
        preferred && io.recordedIds ? io.recordedIds(preferred) : null,
    ]);
    return wanted.filter(m => loggedBy(objects[m.state], null) || recorded?.has(m.state)).map(m => m.entity_id);
}

/** The mappings of the wanted devices with the history instance that logs them (devices without one are left out). */
/**
 * Where the past of each device comes from: the instance that logs its datapoint, else the default history; with
 * `preferred` that instance for every datapoint it records.
 */
async function sources(
    io: HistoryAccess,
    mappings: Mapping[],
    ids: string[],
    preferred: string | null = null,
): Promise<Source[]> {
    const wanted = ids.map(id => mappings.find(m => m.entity_id === id)).filter((m): m is Mapping => !!m);
    if (!wanted.length) {
        return [];
    }
    const objects = await io.getObjects(wanted.map(m => m.state));
    const [fallback, recorded] = await Promise.all([
        io.defaultHistory(),
        preferred && io.recordedIds ? io.recordedIds(preferred) : null,
    ]);
    const out: Source[] = [];
    for (const m of wanted) {
        const instance = preferred && recorded?.has(m.state) ? preferred : loggedBy(objects[m.state], fallback);
        if (instance) {
            out.push({ m, instance, type: objects[m.state]?.common?.type });
        }
    }
    return out;
}

const BASE = { from: false, ack: false, q: false, addId: false, ignoreNull: true } as const;
/**
 * The adapters read at most `limit` raw values before they aggregate (default 2000): a value that changes often (the
 * charge of a battery) has more in a day, and the means would end where the limit cut.
 */
const RAW_LIMIT = 200_000;

/** The rows of one device from start to end (ms), beginning with the value it had at the start. */
async function rowsOf(io: HistoryAccess, src: Source, start: number, end: number, raw: boolean): Promise<HistoryRow[]> {
    const { m, instance, type } = src;
    const numeric = type === 'number';
    const [before, values] = await Promise.all([
        io.getHistory(m.state, {
            ...BASE,
            instance,
            start: start - 30 * 24 * 3600 * 1000,
            end: start,
            count: 1,
            aggregate: 'none',
            returnNewestEntries: true,
        }),
        io.getHistory(m.state, {
            ...BASE,
            instance,
            start,
            end,
            ...(numeric && !raw && end - start > RAW_UP_TO
                ? { aggregate: 'minmax', count: MAX_POINTS, limit: RAW_LIMIT }
                : { aggregate: 'none', count: numeric ? MAX_POINTS * 4 : 5000, returnNewestEntries: true }),
        }),
    ]);
    const rows: HistoryRow[] = [];
    const first = (before ?? []).filter(v => v && v.val !== null && v.val !== undefined).at(-1);
    if (first) {
        rows.push({ s: stateOf(first.val, m, type), lu: start / 1000 });
    }
    for (const v of (values ?? []).filter(v => v && v.val !== null && v.val !== undefined)) {
        const ts = Math.max(start, Math.min(end, Number(v.ts)));
        rows.push({ s: stateOf(v.val, m, type), lu: ts / 1000 });
    }
    return rows.sort((a, b) => a.lu - b.lu);
}

/** Answers `history/history_during_period` for the mapped devices; devices without history get no rows. */
export async function historyDuringPeriod(
    io: HistoryAccess,
    mappings: Mapping[],
    msg: { start_time?: unknown; end_time?: unknown; entity_ids?: unknown; type?: string },
    preferred: string | null = null,
): Promise<Record<string, HistoryRow[]>> {
    const end = time(msg.end_time, Date.now());
    const start = Math.min(time(msg.start_time, end - 24 * 3600 * 1000), end);
    const out: Record<string, HistoryRow[]> = {};
    await Promise.all(
        (await sources(io, mappings, idList(msg.entity_ids), preferred)).map(async src => {
            try {
                out[src.m.entity_id] = await rowsOf(io, src, start, end, false);
            } catch (e) {
                console.warn(`[home3d] history of ${src.m.state} (${src.instance})`, e);
            }
        }),
    );
    return out;
}

/** At most this many changes per `getEvents` of a recorder, and this many pages per window. */
const EVENT_PAGE = 10_000;
const EVENT_PAGES = 20;

interface WalkSnapshot {
    states?: { id: string; val: ioBroker.StateValue; aggregated?: true }[];
    error?: string;
}
interface WalkEvents {
    events?: { ts: number; id: string; val: ioBroker.StateValue }[];
    more?: boolean;
    error?: string;
}

/**
 * The rows of the devices a recorder records, from start to end (ms), with a snapshot at the start and the changes of
 * the window (pages of 10000) instead of two `getHistory` per device. Left to `getHistory` (`rest`): high-frequency
 * datapoints (the recorder keeps only their five-minute aggregates) and all, if the instance does not answer.
 */
export async function recorderRows(
    io: HistoryAccess,
    instance: string,
    srcs: Source[],
    start: number,
    end: number,
): Promise<{ rows: Map<Source, HistoryRow[]>; rest: Source[] }> {
    const none = { rows: new Map<Source, HistoryRow[]>(), rest: srcs };
    if (!io.recorderWalk || !srcs.length) {
        return none;
    }
    const ids = [...new Set(srcs.map(s => s.m.state))];
    const snap = await io.recorderWalk<WalkSnapshot>(instance, 'getSnapshot', { ts: start, ids });
    if (!snap || snap.error || !Array.isArray(snap.states)) {
        return none;
    }
    const at = new Map(snap.states.map(s => [s.id, s]));
    const changes = new Map<string, { ts: number; val: ioBroker.StateValue }[]>();
    let from = start;
    // the changes at the last time of a page come again at the start of the next one
    let edge = new Set<string>();
    for (let page = 0; page < EVENT_PAGES; page++) {
        const ev = await io.recorderWalk<WalkEvents>(instance, 'getEvents', {
            start: from,
            end,
            ids,
            limit: EVENT_PAGE,
        });
        if (!ev || ev.error || !Array.isArray(ev.events)) {
            return none;
        }
        const last = ev.events.at(-1)?.ts ?? from;
        const next = new Set<string>();
        for (const e of ev.events) {
            const key = `${e.ts}|${e.id}|${JSON.stringify(e.val)}`;
            if (e.ts === from && edge.has(key)) {
                continue;
            }
            if (e.ts === last) {
                next.add(key);
            }
            const list = changes.get(e.id) ?? [];
            list.push({ ts: e.ts, val: e.val });
            changes.set(e.id, list);
        }
        if (!ev.more || last <= from) {
            break;
        }
        from = last;
        edge = next;
    }
    const rows = new Map<Source, HistoryRow[]>();
    const rest: Source[] = [];
    for (const src of srcs) {
        const first = at.get(src.m.state);
        if (first?.aggregated) {
            rest.push(src);
            continue;
        }
        const list: HistoryRow[] = [];
        if (first && first.val !== null && first.val !== undefined) {
            list.push({ s: stateOf(first.val, src.m, src.type), lu: start / 1000 });
        }
        for (const c of changes.get(src.m.state) ?? []) {
            if (c.val !== null && c.val !== undefined) {
                list.push({
                    s: stateOf(c.val, src.m, src.type),
                    lu: Math.max(start, Math.min(end, Number(c.ts))) / 1000,
                });
            }
        }
        rows.set(src, list);
    }
    return { rows, rest };
}

/** A value of the time travel: a state, or a state with the attributes kept for it. */
type WireValue = string | [string, Record<string, unknown>];
interface WireEntity {
    t: number[];
    v: number[];
    tab: WireValue[];
}
interface WireStat {
    start: number;
    step: number;
    mean: (number | null)[];
}
/** The answer of `home3d/timetravel/history` (times in seconds). */
export interface WireDay {
    day_start: number;
    end: number;
    /** Where the data begins inside the window (null: before it). */
    oldest: number | null;
    keep_days: number | null;
    entities: Record<string, WireEntity>;
    stats: Record<string, WireStat>;
    /** Devices without any history in the window. */
    missing: string[];
}

/** Five minutes (s): the slot of the measured values in the time travel. */
const STAT_STEP = 300;

/** Rows → the compact form of the time travel (times relative to the start, each value once in a table). */
function wire(rows: { t: number; value: WireValue }[], start: number): WireEntity {
    const out: WireEntity = { t: [], v: [], tab: [] };
    const index = new Map<string, number>();
    for (const r of rows) {
        const key = JSON.stringify(r.value);
        let k = index.get(key);
        if (k === undefined) {
            k = out.tab.length;
            index.set(key, k);
            out.tab.push(r.value);
        }
        out.t.push(Math.round((r.t - start) * 1000) / 1000);
        out.v.push(k);
    }
    return out;
}

/** The sun of the time travel: above or below the horizon, with its height and direction every ten minutes. */
function sunRows(lat: number, lon: number, start: number, end: number): { t: number; value: WireValue }[] {
    const rows: { t: number; value: WireValue }[] = [];
    for (let t = start; t <= end; t += 600) {
        const { elevation, azimuth } = sunAt(lat, lon, t * 1000);
        const attrs = {
            elevation: Math.round(elevation * 10) / 10,
            azimuth: Math.round(azimuth * 10) / 10,
            ...moonAttributes(lat, lon, t * 1000),
        };
        rows.push({ t, value: [elevation < -0.833 ? 'below_horizon' : 'above_horizon', attrs] });
    }
    return rows;
}

/** Five-minute means of a measured value; null if the window has none. */
async function means(io: HistoryAccess, src: Source, start: number, end: number): Promise<WireStat | null> {
    const slots = Math.max(1, Math.ceil((end - start) / STAT_STEP));
    const sum = new Array<number>(slots).fill(0);
    const count = new Array<number>(slots).fill(0);
    const values = await io.getHistory(src.m.state, {
        ...BASE,
        instance: src.instance,
        start: start * 1000,
        end: end * 1000,
        aggregate: 'average',
        limit: RAW_LIMIT,
        step: STAT_STEP * 1000,
    });
    for (const v of values ?? []) {
        if (v?.val === null || v?.val === undefined) {
            continue;
        }
        const n = Number(transformed(v.val, src.m));
        const k = Math.floor((Number(v.ts) / 1000 - start) / STAT_STEP);
        if (Number.isFinite(n) && k >= 0 && k < slots) {
            sum[k] += n;
            count[k]++;
        }
    }
    if (!count.some(c => c > 0)) {
        return null;
    }
    return {
        start,
        step: STAT_STEP,
        mean: sum.map((s, k) => (count[k] ? Math.round((s / count[k]) * 1000) / 1000 : null)),
    };
}

/**
 * Answers `home3d/timetravel/history`: the states of the devices (`entity_ids`) as rows and the five-minute means of
 * measured values (`statistic_ids`) of one window (times in seconds). `sun.sun` is calculated from the position.
 * `preferred`: the history instance chosen for the time travel (null: automatic).
 */
export async function timeTravelHistory(
    io: HistoryAccess,
    mappings: Mapping[],
    msg: { start_time?: unknown; end_time?: unknown; entity_ids?: unknown; statistic_ids?: unknown; type?: string },
    location: { lat: number; lon: number } | null,
    preferred: string | null = null,
): Promise<WireDay> {
    const now = Date.now() / 1000;
    const end = Math.min(Number(msg.end_time) || now, now);
    const start = Math.min(Number(msg.start_time) || end - 86400, end);
    const entityIds = idList(msg.entity_ids);
    const statIds = idList(msg.statistic_ids);
    const day: WireDay = { day_start: start, end, oldest: null, keep_days: null, entities: {}, stats: {}, missing: [] };
    if (entityIds.includes('sun.sun') && location) {
        day.entities['sun.sun'] = wire(sunRows(location.lat, location.lon, start, end), start);
    }
    const [states, stats] = await Promise.all([
        sources(io, mappings, entityIds, preferred),
        sources(io, mappings, statIds, preferred),
    ]);
    const put = (src: Source, rows: HistoryRow[]): void => {
        if (rows.length) {
            day.entities[src.m.entity_id] = wire(
                rows.map(r => ({ t: r.lu, value: r.s })),
                start,
            );
        }
    };
    const single = async (src: Source): Promise<void> => {
        try {
            put(src, await rowsOf(io, src, start * 1000, end * 1000, true));
        } catch (e) {
            console.warn(`[home3d] time travel of ${src.m.state} (${src.instance})`, e);
        }
    };
    // the datapoints of a recorder at once, per instance; the others one by one
    const byRecorder = new Map<string, Source[]>();
    const others: Source[] = [];
    for (const src of states) {
        if (isRecorder(src.instance) && io.recorderWalk) {
            byRecorder.set(src.instance, [...(byRecorder.get(src.instance) ?? []), src]);
        } else {
            others.push(src);
        }
    }
    await Promise.all([
        ...[...byRecorder].map(async ([instance, srcs]) => {
            let rest = srcs;
            try {
                const got = await recorderRows(io, instance, srcs, start * 1000, end * 1000);
                got.rows.forEach((rows, src) => put(src, rows));
                rest = got.rest;
            } catch (e) {
                console.warn(`[home3d] time travel from ${instance}`, e);
            }
            await Promise.all(rest.map(single));
        }),
        ...others.map(single),
        ...stats.map(async src => {
            try {
                const stat = await means(io, src, start, end);
                if (stat) {
                    day.stats[src.m.entity_id] = stat;
                }
            } catch (e) {
                console.warn(`[home3d] time travel of ${src.m.state} (${src.instance})`, e);
            }
        }),
    ]);
    day.missing = [...entityIds, ...statIds].filter(id => !day.entities[id] && !day.stats[id]);
    return day;
}

/** One row of `recorder/statistics_during_period`: start and end in ms, the mean or the change of the slot. */
export interface StatisticRow {
    start: number;
    end: number;
    mean?: number | null;
    change?: number | null;
}

const PERIODS: Record<string, number> = { '5minute': 300, hour: 3600, day: 86400 };

/**
 * Answers `recorder/statistics_during_period` (the energy view: day curve of the solar power, today's use of gas and
 * water): `mean` is the mean of a slot, `change` how much a counter went up in it. Read from the history adapters.
 */
export async function statisticsDuringPeriod(
    io: HistoryAccess,
    mappings: Mapping[],
    msg: {
        start_time?: unknown;
        end_time?: unknown;
        statistic_ids?: unknown;
        period?: unknown;
        types?: unknown;
        type?: string;
    },
    preferred: string | null = null,
): Promise<Record<string, StatisticRow[]>> {
    const now = Date.now();
    const end = Math.min(time(msg.end_time, now), now);
    const start = Math.min(time(msg.start_time, end - 86400000), end);
    const step = (PERIODS[String(msg.period)] ?? 3600) * 1000;
    const types = Array.isArray(msg.types) ? msg.types : ['mean'];
    const out: Record<string, StatisticRow[]> = {};
    await Promise.all(
        (await sources(io, mappings, idList(msg.statistic_ids), preferred)).map(async src => {
            try {
                out[src.m.entity_id] = await statisticRows(io, src, start, end, step, types.includes('change'));
            } catch (e) {
                console.warn(`[home3d] statistics of ${src.m.state} (${src.instance})`, e);
            }
        }),
    );
    return out;
}

async function statisticRows(
    io: HistoryAccess,
    src: Source,
    start: number,
    end: number,
    step: number,
    change: boolean,
): Promise<StatisticRow[]> {
    const first = Math.floor(start / step) * step;
    if (!change) {
        const values = await io.getHistory(src.m.state, {
            ...BASE,
            instance: src.instance,
            start: first,
            end,
            aggregate: 'average',
            limit: RAW_LIMIT,
            step,
        });
        const sum = new Map<number, { s: number; n: number }>();
        for (const v of values ?? []) {
            const n = v?.val === null || v?.val === undefined ? NaN : Number(transformed(v.val, src.m));
            if (!Number.isFinite(n)) {
                continue;
            }
            const k = Math.floor(Number(v.ts) / step) * step;
            const slot = sum.get(k) ?? { s: 0, n: 0 };
            slot.s += n;
            slot.n++;
            sum.set(k, slot);
        }
        return [...sum.entries()]
            .filter(([k]) => k >= first && k < end)
            .sort((a, b) => a[0] - b[0])
            .map(([k, { s, n }]) => ({ start: k, end: k + step, mean: Math.round((s / n) * 1000) / 1000 }));
    }
    // a counter: the last value of every slot against the one before (a reset counts from zero)
    const [before, values] = await Promise.all([
        io.getHistory(src.m.state, {
            ...BASE,
            instance: src.instance,
            start: first - 30 * 86400000,
            end: first,
            count: 1,
            aggregate: 'none',
            returnNewestEntries: true,
        }),
        io.getHistory(src.m.state, {
            ...BASE,
            instance: src.instance,
            start: first,
            end,
            count: 5000,
            aggregate: 'none',
            returnNewestEntries: true,
        }),
    ]);
    const num = (v: ioBroker.GetHistoryResult[number] | undefined): number =>
        v?.val === null || v?.val === undefined ? NaN : Number(transformed(v.val, src.m));
    let last = num((before ?? []).at(-1));
    const rows = new Map<number, number>();
    for (const v of [...(values ?? [])].sort((a, b) => Number(a.ts) - Number(b.ts))) {
        const n = num(v);
        if (!Number.isFinite(n)) {
            continue;
        }
        const k = Math.floor(Number(v.ts) / step) * step;
        const delta = Number.isFinite(last) ? (n >= last ? n - last : n) : 0;
        rows.set(k, (rows.get(k) ?? 0) + delta);
        last = n;
    }
    const out: StatisticRow[] = [];
    for (let k = first; k < end; k += step) {
        out.push({ start: k, end: k + step, change: Math.round((rows.get(k) ?? 0) * 1000) / 1000 });
    }
    return out;
}
