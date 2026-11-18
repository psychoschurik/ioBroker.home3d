// Where the moon stands and how much of it is lit (low precision, about a degree: enough to draw it), and the local
// sidereal time that turns the stars. Like the sun (sun.ts) from the position of the system or of a datapoint.

const RAD = Math.PI / 180;
/** Obliquity of the ecliptic. */
const E = 23.4397 * RAD;

/** Days since J2000.0 (2000-01-01 12:00 TT, near enough UTC). */
function days(t: number): number {
    return t / 86400000 + 2440587.5 - 2451545;
}

function equatorial(lon: number, lat: number): { ra: number; dec: number } {
    return {
        ra: Math.atan2(Math.sin(lon) * Math.cos(E) - Math.tan(lat) * Math.sin(E), Math.cos(lon)),
        dec: Math.asin(Math.sin(lat) * Math.cos(E) + Math.cos(lat) * Math.sin(E) * Math.sin(lon)),
    };
}

function moonCoords(d: number): { ra: number; dec: number; dist: number } {
    const L = (218.316 + 13.176396 * d) * RAD;
    const M = (134.963 + 13.064993 * d) * RAD;
    const F = (93.272 + 13.22935 * d) * RAD;
    const lon = L + 6.289 * RAD * Math.sin(M);
    const lat = 5.128 * RAD * Math.sin(F);
    return { ...equatorial(lon, lat), dist: 385001 - 20905 * Math.cos(M) };
}

function sunCoords(d: number): { ra: number; dec: number } {
    const M = (357.5291 + 0.98560028 * d) * RAD;
    const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
    const lon = M + C + 102.9372 * RAD + Math.PI;
    return equatorial(lon, 0);
}

/** Local sidereal time (°, 0 … 360) at longitude lon (°, east positive). */
export function siderealTime(lon: number, t: number): number {
    return (((280.16 + 360.9856235 * days(t) + lon) % 360) + 360) % 360;
}

export interface MoonState {
    /** Degrees above the horizon. */
    elevation: number;
    /** Degrees from north, clockwise. */
    azimuth: number;
    /** 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
    phase: number;
    /** The lit share of the disc, 0 … 1. */
    fraction: number;
}

export function moonAt(lat: number, lon: number, t: number): MoonState {
    const d = days(t);
    const m = moonCoords(d);
    const s = sunCoords(d);
    const phi = lat * RAD;
    const h = siderealTime(lon, t) * RAD - m.ra;
    const elevation = Math.asin(Math.sin(phi) * Math.sin(m.dec) + Math.cos(phi) * Math.cos(m.dec) * Math.cos(h)) / RAD;
    // from the south, westwards: turned to north, clockwise
    const south = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(m.dec) * Math.cos(phi)) / RAD;
    const azimuth = (south + 180 + 360) % 360;
    // the angle sun – earth – moon, and from it the angle sun – moon – earth
    const elong = Math.acos(
        Math.min(
            1,
            Math.max(-1, Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)),
        ),
    );
    const sdist = 149598000;
    const inc = Math.atan2(sdist * Math.sin(elong), m.dist - sdist * Math.cos(elong));
    const angle = Math.atan2(
        Math.cos(s.dec) * Math.sin(s.ra - m.ra),
        Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
    );
    return {
        elevation,
        azimuth,
        phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
        fraction: (1 + Math.cos(inc)) / 2,
    };
}

/** The moon and the sidereal time as attributes of `sun.sun` (rounded: no new state for nothing). */
export function moonAttributes(lat: number, lon: number, t: number): Record<string, number> {
    const m = moonAt(lat, lon, t);
    return {
        moon_elevation: Math.round(m.elevation * 10) / 10,
        moon_azimuth: Math.round(m.azimuth * 10) / 10,
        moon_phase: Math.round(m.phase * 1000) / 1000,
        moon_fraction: Math.round(m.fraction * 1000) / 1000,
        sidereal: Math.round(siderealTime(lon, t) * 10) / 10,
        latitude: Math.round(lat * 10) / 10,
    };
}
