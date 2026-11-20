// A room whose floor lies higher than the floor it belongs to (split level without a floor of its own: the dining
// area three steps above the living room). Pure (no three.js): the model, the editor and the 3D view use it alike.

type P = [number, number];

/** The most a room's floor may be raised (m). */
export const MAX_ROOM_LEVEL = 3;

interface Leveled {
    points: P[];
    floor_level?: number | null;
}

/** How far a room's floor lies above its floor's level (m, ≥ 0; 0 without a room). */
export function roomLevel(room: { floor_level?: number | null } | null | undefined): number {
    const v = room?.floor_level;
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_ROOM_LEVEL, Math.max(0, v)) : 0;
}

/** Point in polygon (even-odd). */
function inside(p: P, poly: readonly P[]): boolean {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
            c = !c;
        }
    }
    return c;
}

/** The level of the floor at a point: the raised room there, else 0 (the highest of overlapping rooms). */
export function levelAt(rooms: readonly Leveled[], x: number, z: number): number {
    let best = 0;
    for (const r of rooms) {
        const lv = roomLevel(r);
        if (lv > best && r.points.length >= 3 && inside([x, z], r.points)) {
            best = lv;
        }
    }
    return best;
}

/** The value stored for an entered level: null at 0, else within 0 … MAX_ROOM_LEVEL, to the centimetre. */
export function levelValue(v: number): number | null {
    if (!Number.isFinite(v) || v <= 0.004) {
        return null;
    }
    return Math.round(Math.min(MAX_ROOM_LEVEL, v) * 100) / 100;
}
