// Where the sun stands (NOAA's approximation, good to a fraction of a degree): the 3D view lights the rooms with it
// (`sun.sun`), the time travel replays it. ioBroker has no sun entity; the position is that of the system settings.

const RAD = Math.PI / 180;

/** Elevation (degrees above the horizon, with refraction) and azimuth (degrees from north, clockwise) at time t (ms). */
export function sunAt(lat: number, lon: number, t: number): { elevation: number; azimuth: number } {
    const jc = (t / 86400000 + 2440587.5 - 2451545) / 36525;
    const l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
    const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
    const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
    const c =
        Math.sin(m * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
        Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * jc) +
        Math.sin(3 * m * RAD) * 0.000289;
    const omega = 125.04 - 1934.136 * jc;
    const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
    const y = Math.tan((eps / 2) * RAD) ** 2;
    // equation of time in minutes
    const eqt =
        (4 / RAD) *
        (y * Math.sin(2 * l0 * RAD) -
            2 * e * Math.sin(m * RAD) +
            4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
            0.5 * y * y * Math.sin(4 * l0 * RAD) -
            1.25 * e * e * Math.sin(2 * m * RAD));
    const minutes = (((t / 60000) % 1440) + 1440) % 1440;
    const solar = (((minutes + eqt + 4 * lon) % 1440) + 1440) % 1440;
    const ha = (solar / 4 < 0 ? solar / 4 + 180 : solar / 4 - 180) * RAD;
    const phi = lat * RAD;
    const cosZ = Math.min(
        1,
        Math.max(-1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha)),
    );
    const zenith = Math.acos(cosZ);
    let elevation = 90 - zenith / RAD;
    // refraction near the horizon
    if (elevation <= 85) {
        const te = Math.tan(elevation * RAD);
        const sec =
            elevation > 5
                ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
                : elevation > -0.575
                  ? 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))
                  : -20.772 / te;
        elevation += sec / 3600;
    }
    const den = Math.cos(phi) * Math.sin(zenith);
    let azimuth = 180;
    if (Math.abs(den) > 1e-9) {
        const a = Math.acos(Math.min(1, Math.max(-1, (Math.sin(phi) * Math.cos(zenith) - Math.sin(decl)) / den))) / RAD;
        azimuth = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
    }
    return { elevation, azimuth };
}

/** The entity `sun.sun` as the 3D frontend reads it (state and the attributes elevation and azimuth). */
export function sunState(
    lat: number,
    lon: number,
    t = Date.now(),
): {
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
    last_changed: string;
    last_updated: string;
} {
    const { elevation, azimuth } = sunAt(lat, lon, t);
    const now = new Date(t).toISOString();
    return {
        entity_id: 'sun.sun',
        state: elevation < -0.833 ? 'below_horizon' : 'above_horizon',
        attributes: {
            friendly_name: 'Sonne',
            elevation: Math.round(elevation * 100) / 100,
            azimuth: Math.round(azimuth * 100) / 100,
        },
        last_changed: now,
        last_updated: now,
    };
}

/**
 * A position from a datapoint: "lon;lat" (serial-gps, role value.gps), "lat,lon", or {lat, lon} / {latitude, longitude}
 * (also as JSON); null when there is none.
 */
export function parsePosition(v: unknown): { lat: number; lon: number } | null {
    let lat: unknown, lon: unknown;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t.startsWith('{')) {
            try {
                return parsePosition(JSON.parse(t));
            } catch {
                return null;
            }
        }
        if (t.includes(';')) {
            [lon, lat] = t.split(';');
        } else if (t.includes(',')) {
            [lat, lon] = t.split(',');
        }
    } else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        lat = o.lat ?? o.latitude;
        lon = o.lon ?? o.lng ?? o.longitude;
    }
    const la = typeof lat === 'string' || typeof lat === 'number' ? Number(lat) : NaN;
    const lo = typeof lon === 'string' || typeof lon === 'number' ? Number(lon) : NaN;
    const valid = Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
    // 0;0 is what a GPS without a fix reports
    return valid && (la !== 0 || lo !== 0) ? { lat: la, lon: lo } : null;
}
