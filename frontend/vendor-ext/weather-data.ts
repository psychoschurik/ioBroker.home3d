// The weather of the 3D view beyond the condition of the weather entity: wind (speed, direction, gusts) from sensors or
// the weather entity, fog from the visibility or from how near the air is to its dew point, and the trend of the air
// pressure (a fast fall warns of a storm). Pure functions without three.js (tasks.ts patches view3d.ts to use them).

export interface StateLike {
    state: string;
    attributes: Record<string, unknown>;
    last_updated?: string;
}
export type States = Record<string, StateLike | undefined>;

/** The wind: speed and gusts in m/s, the direction it comes from (° clockwise from north; null: unknown). */
export interface Wind {
    speed: number;
    from: number | null;
    gust: number | null;
}

/** A sensor that has not reported for this long (instruments switched off) gives way to the weather entity. */
export const STALE_MS = 3600 * 1000;

/** A text attribute (a unit), empty when it is none. */
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
};

/** A speed in m/s; `unit` as the sensor gives it (kn, km/h, m/s, mph, Bft), `fallback` when it gives none. */
export function speedMs(value: number, unit: string, fallback: 'km/h' | 'm/s' = 'm/s'): number {
    const u = (unit || fallback).trim().toLowerCase();
    if (u === 'kn' || u === 'kt' || u === 'kts' || u.startsWith('knot')) {
        return value * 0.514444;
    }
    if (u === 'km/h' || u === 'kmh' || u === 'kph') {
        return value / 3.6;
    }
    if (u === 'mph') {
        return value * 0.44704;
    }
    if (u === 'bft' || u === 'beaufort') {
        return 0.836 * Math.pow(Math.max(0, value), 1.5);
    }
    if (u === 'ft/s') {
        return value * 0.3048;
    }
    return value;
}

/** Whether a sensor reports and has reported lately. */
export function fresh(st: StateLike | undefined, now: number): st is StateLike {
    if (!st || st.state === 'unavailable' || st.state === 'unknown' || st.state === '') {
        return false;
    }
    const t = st.last_updated ? new Date(st.last_updated).getTime() : NaN;
    return !Number.isFinite(t) || t <= 0 || now - t < STALE_MS;
}

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** A direction as a number (°) or as a compass point (N, SW, NNE …; O for east as in German). */
export function bearing(v: unknown): number | null {
    const n = num(v);
    if (n !== null) {
        return ((n % 360) + 360) % 360;
    }
    if (typeof v !== 'string') {
        return null;
    }
    const i = COMPASS16.indexOf(v.trim().toUpperCase().replace(/O/g, 'E'));
    return i < 0 ? null : i * 22.5;
}

/**
 * The wind: the own sensors (speed, direction, gusts) while they report, else the attributes of the weather entity
 * (`wind_speed` in `wind_speed_unit`, `wind_bearing`, `wind_gust_speed`). Null: nothing tells the wind.
 */
export function windOf(
    states: States,
    src: { speed?: string | null; dir?: string | null; gust?: string | null; weather?: string | null },
    now: number,
): Wind | null {
    const sensor = (id: string | null | undefined): { n: number; unit: string } | null => {
        const st = id ? states[id] : undefined;
        if (!fresh(st, now)) {
            return null;
        }
        const n = num(st.state);
        return n === null ? null : { n, unit: text(st.attributes.unit_of_measurement) };
    };
    const w = src.weather ? states[src.weather] : undefined;
    const wa = w && w.state !== 'unavailable' && w.state !== 'unknown' ? w.attributes : null;
    const wUnit = text(wa?.wind_speed_unit) || 'km/h';
    const own = sensor(src.speed);
    let speed: number | null = own ? speedMs(own.n, own.unit) : null;
    const ownDir = src.dir && fresh(states[src.dir], now) ? bearing(states[src.dir]!.state) : null;
    const ownGust = sensor(src.gust);
    let gust: number | null = ownGust ? speedMs(ownGust.n, ownGust.unit) : null;
    let from = ownDir;
    if (speed === null && wa) {
        const s = num(wa.wind_speed);
        speed = s === null ? null : speedMs(s, wUnit, 'km/h');
    }
    if (from === null && wa) {
        from = bearing(wa.wind_bearing);
    }
    if (gust === null && wa) {
        const g = num(wa.wind_gust_speed);
        gust = g === null ? null : speedMs(g, wUnit, 'km/h');
    }
    if (speed === null) {
        return null;
    }
    speed = Math.min(80, Math.max(0, speed));
    return { speed, from, gust: gust === null ? null : Math.min(100, Math.max(speed, gust)) };
}

/** Beaufort force of a speed in m/s (0 … 12). */
export function beaufort(ms: number): number {
    const limits = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
    const i = limits.findIndex(l => ms < l);
    return i < 0 ? 12 : i;
}

/** The compass point (of 8) a direction lies in, with the letters of the language (N, NE, E, SE, S, SW, W, NW). */
export function compassPoint(deg: number, points: readonly string[]): string {
    const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
    return points[i] ?? '';
}

/** How hard the wind gusts: 0 steady … 1 gusts twice as strong as the mean wind (or more). */
export function gustiness(w: Wind | null): number {
    if (!w || w.gust === null) {
        return 0;
    }
    return Math.min(1, Math.max(0, (w.gust - w.speed) / Math.max(w.speed, 3)));
}

/** Whitecaps on the sea: none below 4 Bft (5.5 m/s), the sea full of them from 7 Bft (13.9 m/s). */
export function whitecaps(ms: number): number {
    return Math.min(1, Math.max(0, (ms - 5.5) / 8.4));
}

/** How far a windsock lifts: 0 hanging down, 1 straight out from 15 kn (7.7 m/s), as at an airfield. */
export function sockLift(ms: number): number {
    return Math.min(1, Math.max(0, ms / 7.7));
}

/** The dew point (°C) of air at `t` °C with `rh` % relative humidity (Magnus formula). */
export function dewPoint(t: number, rh: number): number {
    const a = 17.62;
    const b = 243.12;
    const g = (a * t) / (b + t) + Math.log(Math.min(100, Math.max(1, rh)) / 100);
    return (b * g) / (a - g);
}

/**
 * Fog from the weather entity's attributes, 0 … 1: by the visibility (`visibility` in `visibility_unit`, km by default;
 * from 4 km on it gets hazy), else by how close the temperature is to the dew point (`dew_point`, or from `humidity`):
 * mist from 1.5 °C apart, thick at 0. Null: the attributes tell nothing.
 */
export function fogOf(attrs: Record<string, unknown> | null | undefined): number | null {
    if (!attrs) {
        return null;
    }
    const vis = num(attrs.visibility);
    if (vis !== null) {
        const unit = (text(attrs.visibility_unit) || 'km').toLowerCase();
        const km = unit === 'm' ? vis / 1000 : unit === 'mi' ? vis * 1.609 : vis;
        return Math.min(1, Math.max(0, (4 - km) / 3.6));
    }
    const t = num(attrs.temperature);
    if (t === null) {
        return null;
    }
    let td = num(attrs.dew_point);
    const rh = num(attrs.humidity);
    if (td === null && rh !== null) {
        td = dewPoint(t, rh);
    }
    if (td === null) {
        return null;
    }
    // a little less than full: the condition "fog" of the weather service is the thick one
    return 0.85 * Math.min(1, Math.max(0, (1.5 - (t - td)) / 1.5));
}

/** An air pressure in hPa (from hPa, mbar, Pa, kPa, inHg or mmHg). */
export function pressureHpa(value: number, unit: string): number {
    const u = unit.trim().toLowerCase();
    if (u === 'pa') {
        return value / 100;
    }
    if (u === 'kpa') {
        return value * 10;
    }
    if (u === 'inhg') {
        return value * 33.8639;
    }
    if (u === 'mmhg' || u === 'torr') {
        return value * 1.33322;
    }
    return value;
}

export interface Sample {
    /** Time (ms). */
    t: number;
    /** Pressure (hPa). */
    v: number;
}

/** The trend is taken over this period. */
export const TREND_MS = 3 * 3600 * 1000;

/**
 * How much the pressure fell over the last three hours (hPa, negative: it rose), scaled to three hours when the
 * samples reach back at least 1.5 hours; null with less.
 */
export function pressureFall(samples: readonly Sample[], now: number): number | null {
    const recent = samples.filter(s => s.t <= now && now - s.t <= TREND_MS + 15 * 60 * 1000).sort((a, b) => a.t - b.t);
    if (recent.length < 2) {
        return null;
    }
    const first = recent[0];
    const last = recent[recent.length - 1];
    const span = last.t - first.t;
    if (span < TREND_MS / 2) {
        return null;
    }
    // the mean of the first and of the last quarter hour: one noisy value does not make a storm
    const mean = (from: number, to: number): number => {
        const part = recent.filter(s => s.t >= from && s.t <= to);
        return part.reduce((sum, s) => sum + s.v, 0) / Math.max(1, part.length);
    };
    const q = 15 * 60 * 1000;
    const fall = mean(first.t, first.t + q) - mean(last.t - q, last.t);
    return (fall * TREND_MS) / span;
}

/** 0 calm, 1 the pressure falls fast (3 hPa in 3 h: wind is coming), 2 very fast (6 hPa: a storm). */
export function stormLevel(fall: number | null): 0 | 1 | 2 {
    if (fall === null || fall < 3) {
        return 0;
    }
    return fall < 6 ? 1 : 2;
}

/** Keeps pressure samples of the last hours (one per minute at most): the trend while the page is open. */
export class PressureLog {
    private samples: Sample[] = [];

    add(t: number, v: number): void {
        const last = this.samples[this.samples.length - 1];
        if (last && t - last.t < 60 * 1000) {
            return;
        }
        this.samples.push({ t, v });
        this.samples = this.samples.filter(s => t - s.t <= TREND_MS + 30 * 60 * 1000);
    }

    /** The own samples and the ones from the history (those older than the own first one). */
    merged(history: readonly Sample[]): Sample[] {
        const first = this.samples[0]?.t ?? Infinity;
        return [...history.filter(s => s.t < first), ...this.samples];
    }
}

/** The wind indicators (furniture type "wind_vane"): the arrow at a masthead, a windsock, a flag. */
export const VANE_KINDS = ['windex', 'sock', 'flag'] as const;
export type VaneKind = (typeof VANE_KINDS)[number];

/** Height of a wind indicator above its floor when none is set (m): a masthead, a windsock pole, a flagpole. */
export function defaultVaneY(kind: string | null | undefined): number {
    return kind === 'windex' ? 18.3 : kind === 'flag' ? 6 : 4;
}
