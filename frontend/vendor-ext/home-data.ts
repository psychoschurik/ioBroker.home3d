// What the 3D view shows of a home beyond its devices' own looks, as pure functions without three.js (tasks.ts patches
// view3d.ts to use them, home-fx.ts draws the result):
// - device health: low batteries and devices that cannot be reached;
// - mould: how damp the coldest corner of a room gets (dew point), airing through open windows, heat lost through them;
// - the electricity price: cheap or dear today, the cheapest hour ahead;
// - official weather warnings (levels 1 … 4);
// - motion over the day per room;
// - the lawn: a robot mower's phase and its lanes, sprinklers, dry soil;
// - sound (music playing, noise) and water (flowing at a tap, running for too long).

export type Vec2 = [number, number];
export type Rgb = [number, number, number];

export interface StateLike {
    state: string;
    attributes: Record<string, unknown>;
    last_changed?: string;
    last_updated?: string;
}

const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
    return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const truthy = (v: unknown): boolean => v === true || v === 'on' || v === 'true' || v === 1 || v === '1';

export const isUnavailable = (st: StateLike | undefined): boolean =>
    !st || st.state === 'unavailable' || st.state === 'unknown';

// ---------------------------------------------------------------- device health

/** A battery at or below this many percent is low. */
export const BATTERY_LOW = 20;

export interface Health {
    /** Charge in % (null: the device reports none). */
    battery: number | null;
    /** The battery is low (reported so, or at most BATTERY_LOW %). */
    low: boolean;
    /** The device cannot be reached (or its adapter is stopped or disconnected). */
    unreach: boolean;
    /** The ioBroker adapter behind it is stopped or has lost its connection. */
    adapter: 'stopped' | 'disconnected' | null;
}

/**
 * The health of a device from its entity: `battery_level` (or `battery`) in %, `battery_low`, `unreachable` and
 * `iobroker_adapter` (set by the ioBroker page from the device's own datapoints), and an unavailable state.
 */
export function healthOf(st: StateLike | undefined): Health {
    const a = st?.attributes ?? {};
    const raw = num(a.battery_level ?? a.battery);
    const battery = raw === null ? null : Math.min(100, Math.max(0, raw));
    const adapter =
        a.iobroker_adapter === 'stopped' || a.iobroker_adapter === 'disconnected' ? a.iobroker_adapter : null;
    // a datapoint without a value says the device is gone only when the device tells nothing else about itself; one
    // with its own health datapoints is judged by them (a Victron system without a charger has no charger power)
    const judged = typeof a.health_device === 'string' && a.health_device !== '';
    return {
        battery,
        low: truthy(a.battery_low) || (battery !== null && battery <= BATTERY_LOW),
        unreach: truthy(a.unreachable) || !!adapter || (!!st && !judged && isUnavailable(st)),
        adapter,
    };
}

/** What is wrong with a device: not reachable (worse), a low battery, or nothing. */
export function healthProblem(h: Health): 'unreach' | 'battery' | null {
    return h.unreach ? 'unreach' : h.low ? 'battery' : null;
}

/** One physical device for several entities (temperature and humidity of one sensor count once). */
export function healthKey(id: string, st: StateLike | undefined): string {
    const d = st?.attributes.health_device;
    return typeof d === 'string' && d ? d : id;
}

// ---------------------------------------------------------------- mould and airing

/** Saturation vapour pressure of water (hPa) at `t` °C (Magnus formula). */
export function saturation(t: number): number {
    return 6.112 * Math.exp((17.62 * t) / (243.12 + t));
}

/** Temperature factor of the coldest spot of an outer wall (a corner), as the German minimum for buildings. */
export const F_RSI = 0.7;

export interface Mould {
    /** Dew point of the room air (°C). */
    dewPoint: number;
    /** Temperature of the coldest corner (°C). */
    surface: number;
    /** Relative humidity right at that corner (%). */
    surfaceRh: number;
    /** 0 fine, 1 damp (70 % at the corner: air soon), 2 mould grows (80 %) or water condenses. */
    level: 0 | 1 | 2;
}

/**
 * How damp the coldest corner of a room gets: the corner is colder than the room by the outdoor temperature
 * (`tOut`; without one, 3 °C colder); mould grows where the air right at the wall reaches 80 % humidity.
 */
export function mouldRisk(tIn: number, rh: number, tOut: number | null): Mould {
    const surface = tOut === null ? tIn - 3 : Math.min(tIn, tOut + F_RSI * (tIn - tOut));
    const e = (Math.min(100, Math.max(0, rh)) / 100) * saturation(tIn);
    const surfaceRh = Math.min(100, (100 * e) / saturation(surface));
    const g = Math.log(Math.max(1e-6, e / 6.112));
    const dewPoint = (243.12 * g) / (17.62 - g);
    const level = surfaceRh >= 80 ? 2 : surfaceRh >= 70 || rh >= 70 ? 1 : 0;
    return { dewPoint, surface, surfaceRh, level };
}

/** Outward unit normal of a room edge (points[edge] → points[edge + 1]). */
export function edgeNormalOut(points: readonly Vec2[], edge: number): Vec2 {
    const a = points[edge];
    const b = points[(edge + 1) % points.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let n: Vec2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
    const mid: Vec2 = [(a[0] + b[0]) / 2 + n[0] * 0.02, (a[1] + b[1]) / 2 + n[1] * 0.02];
    if (pointIn(mid, points)) {
        n = [-n[0], -n[1]];
    }
    return n;
}

/** Whether a point lies in a polygon (x, z). */
export function pointIn(p: Vec2, points: readonly Vec2[]): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, zi] = points[i];
        const [xj, zj] = points[j];
        if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/** The convex hull of points (counter-clockwise in x, z), e.g. the outline round all rooms of a floor. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
    const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) {
        return pts;
    }
    const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: Vec2[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }
    const upper: Vec2[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Whether a room edge is an outer wall: no other room lies behind it. */
export function isOuterEdge(points: readonly Vec2[], edge: number, others: readonly (readonly Vec2[])[]): boolean {
    const a = points[edge];
    const b = points[(edge + 1) % points.length];
    const n = edgeNormalOut(points, edge);
    const behind: Vec2 = [(a[0] + b[0]) / 2 + n[0] * 0.35, (a[1] + b[1]) / 2 + n[1] * 0.35];
    return !others.some(o => o !== points && o.length >= 3 && pointIn(behind, o));
}

/** A corner of a room where two outer walls meet (the coldest spots): the corner and the walls' directions from it. */
export interface Corner {
    x: number;
    z: number;
    /** Unit directions along the two walls, away from the corner. */
    a: Vec2;
    b: Vec2;
}

/** The corners of a room between outer walls; with none, those at one outer wall. */
export function coldCorners(points: readonly Vec2[], others: readonly (readonly Vec2[])[]): Corner[] {
    const n = points.length;
    if (n < 3) {
        return [];
    }
    const outer = points.map((_, i) => isOuterEdge(points, i, others));
    const make = (i: number): Corner => {
        const p = points[i];
        const next = points[(i + 1) % n];
        const prev = points[(i - 1 + n) % n];
        const dir = (q: Vec2): Vec2 => {
            const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
            return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
        };
        return { x: p[0], z: p[1], a: dir(next), b: dir(prev) };
    };
    // corner i joins edge i - 1 (into it) and edge i (out of it)
    const both = points.map((_, i) => i).filter(i => outer[i] && outer[(i - 1 + n) % n]);
    if (both.length) {
        return both.map(make);
    }
    return points
        .map((_, i) => i)
        .filter(i => outer[i] || outer[(i - 1 + n) % n])
        .slice(0, 2)
        .map(make);
}

/**
 * Air through an open window or door (m/s, positive: into the room): the wind presses on the side it comes from and
 * draws out on the other. `nOut`: the wall's outward normal, `windTo`: where the wind blows (unit, plan), `speed` m/s.
 */
export function airFlow(nOut: Vec2, windTo: Vec2 | null, speed: number): number {
    if (!windTo || speed <= 0) {
        return 0;
    }
    // a wall facing the wind (its outward normal against the wind) gets air in; about a third of the wind goes through
    return -(nOut[0] * windTo[0] + nOut[1] * windTo[1]) * Math.min(speed, 15) * 0.35;
}

/** A window open this long while the room heats is a warning. */
export const OPEN_HEAT_MS = 10 * 60 * 1000;

/** Whether a thermostat (climate entity) heats now: it says so, or it is set to heat and the room is below its target. */
export function climateHeats(st: StateLike | undefined): boolean {
    if (!st || isUnavailable(st)) {
        return false;
    }
    const action = text(st.attributes.hvac_action).toLowerCase();
    if (action) {
        return action === 'heating' || action === 'preheating';
    }
    const mode = st.state.toLowerCase();
    if (mode !== 'heat' && mode !== 'auto' && mode !== 'heat_cool' && mode !== 'on') {
        return false;
    }
    const cur = num(st.attributes.current_temperature);
    const target = num(st.attributes.temperature);
    return cur !== null && target !== null ? cur < target - 0.2 : mode === 'heat';
}

// ---------------------------------------------------------------- electricity price

export interface PriceSlot {
    /** Start and end (ms). */
    start: number;
    end: number;
    price: number;
}

const TIME_KEYS = [
    'startsAt',
    'start',
    'startTime',
    'start_time',
    'from',
    'begin',
    'time',
    'date',
    'timestamp',
    'start_timestamp',
];
const END_KEYS = ['endsAt', 'end', 'endTime', 'end_time', 'to', 'end_timestamp'];
const PRICE_KEYS = ['total', 'price', 'value', 'marketprice', 'price_ct_kwh', 'cost', 'preis', 'energy'];

const timeOf = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) {
        // seconds or milliseconds
        return v < 1e11 ? v * 1000 : v;
    }
    if (typeof v === 'string' && v.trim()) {
        const n = Number(v);
        if (Number.isFinite(n)) {
            return timeOf(n);
        }
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : null;
    }
    return null;
};

/**
 * Prices ahead from a forecast datapoint: a JSON list (or an object with lists, e.g. today and tomorrow) of entries
 * with a start time and a price – Tibber's `PricesToday.json`, aWATTar, EPEX spot and the like. Sorted, each slot ends
 * where the next begins (the last after an hour, unless it says when).
 */
export function parseForecast(raw: unknown): PriceSlot[] {
    let data: unknown = raw;
    if (typeof raw === 'string') {
        try {
            data = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    const entries: unknown[] = [];
    const collect = (d: unknown, depth: number): void => {
        if (Array.isArray(d)) {
            entries.push(...d);
        } else if (d && typeof d === 'object' && depth < 3) {
            for (const v of Object.values(d as Record<string, unknown>)) {
                if (Array.isArray(v) || (v && typeof v === 'object')) {
                    collect(v, depth + 1);
                }
            }
        }
    };
    collect(data, 0);
    const slots: { start: number; end: number | null; price: number }[] = [];
    for (const e of entries) {
        if (!e || typeof e !== 'object') {
            continue;
        }
        const o = e as Record<string, unknown>;
        const key = (keys: string[]): unknown => {
            const k = keys.find(x => o[x] !== undefined && o[x] !== null);
            return k ? o[k] : undefined;
        };
        const start = timeOf(key(TIME_KEYS));
        const price = num(key(PRICE_KEYS));
        if (start === null || price === null) {
            continue;
        }
        slots.push({ start, end: timeOf(key(END_KEYS)), price });
    }
    slots.sort((a, b) => a.start - b.start);
    const out: PriceSlot[] = [];
    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (out.length && out[out.length - 1].start === s.start) {
            continue;
        }
        const next = slots[i + 1]?.start;
        const end =
            s.end ??
            (next !== undefined && next > s.start && next - s.start <= 3 * 3600_000 ? next : s.start + 3600_000);
        out.push({ start: s.start, end, price: s.price });
    }
    return out;
}

/** Prices from the history of the price entity (rows with the time in seconds): one slot per value. */
export function slotsFromHistory(rows: readonly { s: string; lu: number }[], now: number): PriceSlot[] {
    const vals = rows
        .map(r => ({ t: r.lu * 1000, v: num(r.s) }))
        .filter((r): r is { t: number; v: number } => r.v !== null)
        .sort((a, b) => a.t - b.t);
    return vals.map((r, i) => ({ start: r.t, end: vals[i + 1]?.t ?? now, price: r.v }));
}

/** Where a price lies between the lowest and highest of the day around it: 0 cheapest … 1 dearest; null: no range. */
export function priceLevel(current: number, slots: readonly PriceSlot[], now: number): number | null {
    const day = slots.filter(s => s.end > now - 12 * 3600_000 && s.start < now + 12 * 3600_000).map(s => s.price);
    if (day.length < 3) {
        return null;
    }
    const lo = Math.min(...day, current);
    const hi = Math.max(...day, current);
    if (hi - lo < 1e-6 || (hi - lo) / Math.max(Math.abs(hi), 1e-6) < 0.03) {
        return 0.5;
    }
    return clamp01((current - lo) / (hi - lo));
}

/** Cheap, normal or dear by the level. */
export function priceTone(level: number): 'cheap' | 'normal' | 'dear' {
    return level <= 0.33 ? 'cheap' : level >= 0.67 ? 'dear' : 'normal';
}

/** Colour of a price level: green cheap, yellow normal, red dear. */
export function priceColor(level: number): Rgb {
    const l = clamp01(level);
    return l < 0.5 ? [0.2 + 1.5 * l, 0.85, 0.35 - 0.3 * l] : [0.95, 0.85 - 1.2 * (l - 0.5), 0.2 - 0.1 * (l - 0.5)];
}

/** The cheapest `hours` in a row ahead (within `horizon` ms): its start, end and mean price; null when unknown. */
export function cheapestWindow(
    slots: readonly PriceSlot[],
    now: number,
    hours = 1,
    horizon = 24 * 3600_000,
): { start: number; end: number; price: number } | null {
    const ahead = slots.filter(s => s.end > now && s.start < now + horizon);
    const want = hours * 3600_000;
    let best: { start: number; end: number; price: number } | null = null;
    for (let i = 0; i < ahead.length; i++) {
        let covered = 0;
        let sum = 0;
        let j = i;
        let prevEnd = ahead[i].start;
        while (j < ahead.length && covered < want - 1 && ahead[j].start <= prevEnd + 60_000) {
            const s = ahead[j];
            const from = Math.max(s.start, now);
            const take = Math.min(s.end - from, want - covered);
            if (take > 0) {
                covered += take;
                sum += s.price * take;
            }
            prevEnd = s.end;
            j++;
        }
        if (covered < want - 1) {
            continue;
        }
        const start = Math.max(ahead[i].start, now);
        const mean = sum / covered;
        if (!best || mean < best.price - 1e-9) {
            best = { start, end: start + want, price: mean };
        }
    }
    return best;
}

// ---------------------------------------------------------------- weather warnings

/** Colours of the warning levels 1 … 4 (yellow, orange, red, violet; as the weather services use them). */
export const WARNING_COLORS: Rgb[] = [
    [0.6, 0.6, 0.6],
    [1, 0.84, 0.2],
    [1, 0.55, 0.1],
    [0.92, 0.15, 0.15],
    [0.62, 0.22, 0.85],
];

/**
 * The level of an official weather warning, 0 none … 4 extreme: a number (DWD level or severity), a severity word
 * (minor, moderate, severe, extreme) or a colour (gelb, orange, rot, violett).
 */
export function warningLevel(value: unknown): number {
    const n = num(value);
    if (n !== null) {
        return Math.round(Math.min(4, Math.max(0, n)));
    }
    const t = text(value).toLowerCase();
    if (!t || /^(none|keine?|kein[e]? warnung|no warning|off|false|unknown|unavailable)$/.test(t)) {
        return 0;
    }
    if (/extrem|extreme|violet|violett|lila|purple/.test(t)) {
        return 4;
    }
    if (/unwetter|severe|\brot\b|\bred\b/.test(t)) {
        return 3;
    }
    if (/markant|moderate|orange/.test(t)) {
        return 2;
    }
    if (/minor|gelb|yellow|wetterwarnung|warn/.test(t)) {
        return 1;
    }
    return 0;
}

/** The headline of a warning from its entity: an attribute (headline, event, title, text, description) or a text state. */
export function warningText(st: StateLike): string {
    const a = st.attributes;
    for (const k of ['headline', 'event', 'title', 'text', 'description']) {
        const v = text(a[k]).trim();
        if (v) {
            return v.length > 90 ? `${v.slice(0, 88)}…` : v;
        }
    }
    return num(st.state) === null && warningLevel(st.state) > 0 ? st.state : '';
}

// ---------------------------------------------------------------- motion over the day

/** Midnight of the day of `now` (local time). */
export function startOfDay(now: number): number {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** Motion per room: how often a sensor turned on and when last. */
export function roomActivity(
    events: readonly { entity: string; time: number }[],
    roomOf: ReadonlyMap<string, string>,
): Map<string, { count: number; last: number }> {
    const out = new Map<string, { count: number; last: number }>();
    for (const e of events) {
        const room = roomOf.get(e.entity);
        if (!room) {
            continue;
        }
        const r = out.get(room) ?? { count: 0, last: 0 };
        r.count++;
        r.last = Math.max(r.last, e.time);
        out.set(room, r);
    }
    return out;
}

/** Colour of a room's activity, the busiest room red: pale yellow a little, orange more, red the most. */
export function activityColor(count: number, max: number): Rgb {
    const l = max > 0 ? Math.sqrt(clamp01(count / max)) : 0;
    return l < 0.5
        ? [1, 0.92 - 0.5 * l, 0.5 - 0.5 * l]
        : [1 - 0.1 * (l - 0.5), 0.67 - 0.9 * (l - 0.5), 0.25 - 0.2 * (l - 0.5)];
}

// ---------------------------------------------------------------- lawn: mower and sprinklers

export type MowerPhase = 'mowing' | 'returning' | 'docked' | 'paused' | 'error' | 'unknown';

/** Worx Landroid status codes. */
const WORX: Record<number, MowerPhase> = {
    0: 'docked',
    1: 'docked',
    2: 'mowing',
    3: 'mowing',
    4: 'returning',
    5: 'returning',
    6: 'returning',
    7: 'mowing',
    8: 'error',
    9: 'error',
    10: 'error',
    12: 'mowing',
    30: 'returning',
    31: 'mowing',
    32: 'mowing',
    33: 'mowing',
    34: 'paused',
};

/**
 * A robot mower's phase from its status: the codes of Worx Landroid, Husqvarna's activities (MOWING, GOING_HOME,
 * CHARGING, PARKED_IN_CS …), the states of a lawn mower entity (mowing, docked, returning, paused, error) and German
 * words.
 */
export function mowerPhase(value: unknown): MowerPhase {
    const n = num(value);
    if (n !== null) {
        return WORX[Math.round(n)] ?? 'unknown';
    }
    if (value === true) {
        return 'mowing';
    }
    if (value === false) {
        return 'docked';
    }
    const t = text(value).toLowerCase();
    if (!t || t === 'unavailable' || t === 'unknown') {
        return 'unknown';
    }
    if (/error|fehler|stuck|trapped|lifted|blocked|stopped_in_garden|fatal|alarm/.test(t)) {
        return 'error';
    }
    if (/going_home|return|zurück|heimweg|search|suche/.test(t)) {
        return 'returning';
    }
    if (/pause/.test(t)) {
        return 'paused';
    }
    if (/mow|mäh|cutting|leaving|working|edge|border|start|^on$/.test(t)) {
        return 'mowing';
    }
    if (/dock|charg|lad|park|home|idle|sleep|off|ready|cs$|station/.test(t)) {
        return 'docked';
    }
    return 'unknown';
}

/**
 * Lanes over a lawn as a mower drives them: parallel lines `spacing` apart at `angle` (rad), each cut to the lawn,
 * driven back and forth. Returns the points of the path.
 */
export function lanes(poly: readonly Vec2[], spacing: number, angle: number): Vec2[] {
    if (poly.length < 3 || spacing <= 0) {
        return [];
    }
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // into the lanes' frame: u along the lane, v across
    const rot = poly.map(([x, z]): Vec2 => [x * c + z * s, -x * s + z * c]);
    const vs = rot.map(p => p[1]);
    const vMin = Math.min(...vs);
    const vMax = Math.max(...vs);
    const path: Vec2[] = [];
    let flip = false;
    for (let v = vMin + spacing / 2; v < vMax; v += spacing) {
        const xs: number[] = [];
        for (let i = 0, j = rot.length - 1; i < rot.length; j = i++) {
            const [ui, vi] = rot[i];
            const [uj, vj] = rot[j];
            if (vi > v !== vj > v) {
                xs.push(ui + ((v - vi) * (uj - ui)) / (vj - vi));
            }
        }
        xs.sort((a, b) => a - b);
        const segs: [number, number][] = [];
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const a = xs[k] + spacing * 0.4;
            const b = xs[k + 1] - spacing * 0.4;
            if (b > a) {
                segs.push([a, b]);
            }
        }
        if (!segs.length) {
            continue;
        }
        const ordered = flip ? segs.reverse().map(([a, b]): [number, number] => [b, a]) : segs;
        for (const [a, b] of ordered) {
            path.push([a, v], [b, v]);
        }
        flip = !flip;
    }
    return path.map(([u, v]): Vec2 => [u * c - v * s, u * s + v * c]);
}

/** Length of a path. */
export function pathLength(path: readonly Vec2[]): number {
    let l = 0;
    for (let i = 1; i < path.length; i++) {
        l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    }
    return l;
}

/** The point at distance `d` along a path and the direction there (wrapping round). */
export function pointAt(path: readonly Vec2[], d: number): { p: Vec2; dir: Vec2; lane: number } {
    const total = pathLength(path);
    if (path.length < 2 || total <= 0) {
        return { p: path[0] ?? [0, 0], dir: [0, 1], lane: 0 };
    }
    let rest = ((d % total) + total) % total;
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (rest <= l || i === path.length - 1) {
            const k = l > 0 ? Math.min(1, rest / l) : 0;
            const dir: Vec2 = l > 0 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [0, 1];
            return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], dir, lane: Math.floor((i - 1) / 2) };
        }
        rest -= l;
    }
    return { p: path[path.length - 1], dir: [0, 1], lane: 0 };
}

/** Whether a switch, valve or sensor says on (open, running, a flow above zero). */
export function isOn(st: StateLike | undefined): boolean {
    if (!st || isUnavailable(st)) {
        return false;
    }
    const n = num(st.state);
    if (n !== null) {
        return n > 0;
    }
    return /^(on|open|opening|true|running|watering|active|an|offen|läuft|flowing)$/i.test(st.state.trim());
}

/**
 * Whether a car is home by its presence datapoint: on, home, present, parked … (a device tracker at home, a sensor in
 * the garage), a number above 0; unavailable counts as away.
 */
export function carPresent(st: StateLike | undefined): boolean {
    if (!st || isUnavailable(st)) {
        return false;
    }
    const n = num(st.state);
    if (n !== null) {
        return n > 0;
    }
    return /^(on|home|true|present|occupied|detected|parked|yes|anwesend|zuhause|zu hause|da|geparkt|ja)$/i.test(
        st.state.trim(),
    );
}

/** How dry the soil is, 0 moist … 1 dry: from moisture `m` % against the level a sprinkler should start at (`min`). */
export function dryness(m: number, min = 30): number {
    const lim = Math.max(5, min);
    return clamp01((lim + 10 - m) / (lim + 10));
}

// ---------------------------------------------------------------- sound and water

/** How loud a playing media player is, 0 … 1 (its volume, 0 … 1 or in %); 0 when it does not play. */
export function mediaLevel(st: StateLike | undefined): number {
    if (!st || st.state !== 'playing' || truthy(st.attributes.is_volume_muted)) {
        return 0;
    }
    const v = num(st.attributes.volume_level);
    if (v === null) {
        return 0.5;
    }
    return clamp01(v > 1 ? v / 100 : v);
}

/** Noise in dB as 0 … 1: quiet below 35 dB, loud at 85 dB. */
export function noiseLevel(db: number): number {
    return clamp01((db - 35) / 50);
}

/** Whether a sensor measures sound (dB). */
export function isNoiseSensor(st: StateLike | undefined): boolean {
    if (!st) {
        return false;
    }
    const unit = text(st.attributes.unit_of_measurement).toLowerCase();
    return st.attributes.device_class === 'sound_pressure' || unit === 'db' || unit === 'dba' || unit === 'db(a)';
}

/** A flow in l/min from a sensor's value and unit (l/min, l/h, l/s, m³/h, gal/min). */
export function flowLpm(value: number, unit: string): number {
    const u = unit.trim().toLowerCase().replace('³', '3');
    if (u === 'l/h') {
        return value / 60;
    }
    if (u === 'l/s') {
        return value * 60;
    }
    if (u === 'm3/h') {
        return (value * 1000) / 60;
    }
    if (u === 'gal/min' || u === 'gpm') {
        return value * 3.785;
    }
    return value;
}

/** Litres of a meter reading (m³ or litres, by its unit). */
export function meterLitres(value: number, unit: string): number {
    const u = unit.trim().toLowerCase().replace('³', '3');
    return u === 'm3' || u === 'm^3' ? value * 1000 : u === 'gal' ? value * 3.785 : value;
}

/** Water running for this long without a break is a warning (a pipe burst, a tap left open). */
export const LONG_FLOW_MS = 30 * 60 * 1000;

/**
 * The flow at a water meter from its readings (litres): l/min over the last minutes, and since when water has run
 * without a pause of more than five minutes.
 */
export class MeterFlow {
    private readings: { t: number; v: number }[] = [];
    private runSince: number | null = null;
    private lastFlow = 0;

    /** A reading (litres) at time `t`; a reading that went down (a new meter) starts over. */
    add(t: number, litres: number): void {
        const last = this.readings[this.readings.length - 1];
        if (last && litres < last.v) {
            this.readings = [];
        }
        if (last && last.v === litres && t - last.t < 60_000) {
            return;
        }
        this.readings.push({ t, v: litres });
        this.readings = this.readings.filter(r => t - r.t <= 15 * 60_000);
    }

    /** The flow (l/min) over the last three minutes, as seen at `now`. */
    flow(now: number): number {
        const recent = this.readings.filter(r => now - r.t <= 3 * 60_000);
        const last = this.readings[this.readings.length - 1];
        if (!last || now - last.t > 3 * 60_000) {
            return 0;
        }
        const first = this.readings.find(r => now - r.t <= 3 * 60_000 + 60_000) ?? recent[0];
        if (!first || last.t - first.t < 20_000) {
            return 0;
        }
        return Math.max(0, ((last.v - first.v) / (last.t - first.t)) * 60_000);
    }

    /** Since when water runs (flow above 0.2 l/min with pauses of five minutes at most); null: it does not. */
    running(now: number, flow: number): number | null {
        if (flow > 0.2) {
            this.runSince ??= now;
            this.lastFlow = now;
        } else if (this.runSince !== null && now - this.lastFlow > 5 * 60_000) {
            this.runSince = null;
        }
        return this.runSince;
    }
}
