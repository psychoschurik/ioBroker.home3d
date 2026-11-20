// Where a balcony needs its railing: only where it would drop. No railing where the ground outside lies at about the
// level of the deck: a garden on a hill reaching up to a balcony upstairs (an area of a lower floor), a terrace or
// another balcony beside it, or a room of the same floor (its wall). The edges along the house wall are left out
// before (outdoor.ts, againstWall). Pure: the model's height function is passed in.

type P = [number, number];

/** What of a floor these checks read. */
export interface RailFloor {
    id: string;
    elevation: number;
    rooms: { points: P[] }[];
    outdoor?: RailArea[] | null;
}

export interface RailArea {
    id: string;
    type: string;
    points: P[];
}

/** The model's functions: the top of an area at a point (floor coordinates), and whether a type stands (hedge, fence). */
export interface RailModel {
    topAt: (floor: RailFloor, area: RailArea, x: number, z: number) => number;
    standing: (type: string) => boolean;
}

let floorsNow: readonly RailFloor[] = [];

/** The building's floors, set before its floors are built (the railings of one floor look at the floors below). */
export function setRailFloors(floors: readonly RailFloor[]): void {
    floorsNow = floors;
}

/** The ground outside may lie this far below the deck and still count as level (a step down onto the lawn). */
export const RAIL_LEVEL = 0.45;
/** How far outside the edge the ground is looked at (m), and the step between two looks along the edge. */
const OUT = 0.15;
const STEP = 0.25;

export function inside(p: P, poly: readonly P[]): boolean {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
            r = !r;
        }
    }
    return r;
}

/** Whether the deck needs a railing at a point just outside its edge (`top`: the deck's top, absolute). */
function needsRail(
    floor: RailFloor,
    area: RailArea,
    at: P,
    top: number,
    model: RailModel,
    floors: readonly RailFloor[],
): boolean {
    if (floor.rooms.some(r => r.points.length >= 3 && inside(at, r.points))) {
        return false;
    }
    for (const fl of floors.some(f => f.id === floor.id) ? floors : [...floors, floor]) {
        if (fl.elevation > floor.elevation + 0.01) {
            continue;
        }
        for (const o of fl.outdoor ?? []) {
            if (o.id === area.id || o.type === 'pool' || model.standing(o.type) || !inside(at, o.points)) {
                continue;
            }
            if (fl.elevation + model.topAt(fl, o, at[0], at[1]) >= top - RAIL_LEVEL) {
                return false;
            }
        }
    }
    return true;
}

/**
 * The parts of a balcony's edge p → q that need a railing, as fractions [from, to] of the edge (empty: none).
 * `deck` is the top of the deck in floor coordinates.
 */
export function railSpans(
    floor: RailFloor,
    area: RailArea,
    p: P,
    q: P,
    deck: number,
    model: RailModel,
    floors: readonly RailFloor[] = floorsNow,
): [number, number][] {
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
        return [];
    }
    // the side of the edge away from the deck
    let nx = dz / len;
    let nz = -dx / len;
    const mid: P = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (inside([mid[0] + nx * OUT, mid[1] + nz * OUT], area.points)) {
        nx = -nx;
        nz = -nz;
    }
    const top = floor.elevation + deck;
    const n = Math.max(3, Math.round(len / STEP));
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const at: P = [p[0] + dx * t + nx * OUT, p[1] + dz * t + nz * OUT];
        if (!needsRail(floor, area, at, top, model, floors)) {
            continue;
        }
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const last = out[out.length - 1];
        if (last && Math.abs(last[1] - t0) < 1e-9) {
            last[1] = t1;
        } else {
            out.push([t0, t1]);
        }
    }
    return out;
}
