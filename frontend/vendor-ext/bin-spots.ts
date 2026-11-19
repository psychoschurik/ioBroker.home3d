// Waste bins at the street (tasks.ts patches viewer3d.ts and view3d.ts): a bin that is out (its "put out" entity is
// on, else from the evening before its pickup until the pickup's morning, as its tag glows) stands on the nearest
// "bin spot" of its floor, in a row along the spot, turned like it; the viewer builds the floor with the bins moved.

type Vec2 = [number, number];

/** A bin spot: a paved pad at the street, wide enough for three or four bins. */
export const BIN_SPOT_SIZE: [number, number, number] = [2.4, 0.9, 0.02];

/** The gap between two bins in a row (m). */
const GAP = 0.08;

export interface BinItem {
    id: string;
    type: string;
    x: number;
    z: number;
    w: number;
    d: number;
    rotation: number;
}

export interface BinFloor<F extends BinItem = BinItem> {
    furniture: F[];
}

/** Where a bin stands while it is out. */
export interface BinPlace {
    x: number;
    z: number;
    rotation: number;
}

/** The bins that are out, placed on the nearest spot of their floor (none without a spot). */
export function binsOut<F extends BinItem>(
    floors: readonly BinFloor<F>[],
    isOut: (f: F) => boolean,
): Map<string, BinPlace> {
    const out = new Map<string, BinPlace>();
    for (const floor of floors) {
        const spots = floor.furniture.filter(f => f.type === 'bin_spot');
        if (!spots.length) {
            continue;
        }
        const rows = new Map<string, F[]>();
        for (const f of floor.furniture) {
            if (f.type !== 'waste_bin' || !isOut(f)) {
                continue;
            }
            const spot = spots.reduce((a, s) =>
                Math.hypot(s.x - f.x, s.z - f.z) < Math.hypot(a.x - f.x, a.z - f.z) ? s : a,
            );
            rows.set(spot.id, [...(rows.get(spot.id) ?? []), f]);
        }
        for (const spot of spots) {
            const bins = rows.get(spot.id);
            if (!bins) {
                continue;
            }
            const a = (spot.rotation * Math.PI) / 180;
            const u: Vec2 = [Math.cos(a), Math.sin(a)];
            // in the order they stand at home along the spot, the row centred on it
            bins.sort((p, q) => p.x * u[0] + p.z * u[1] - (q.x * u[0] + q.z * u[1]) || p.id.localeCompare(q.id));
            const total = bins.reduce((s, b) => s + b.w, 0) + GAP * (bins.length - 1);
            let at = -total / 2;
            for (const b of bins) {
                const c = at + b.w / 2;
                out.set(b.id, { x: spot.x + u[0] * c, z: spot.z + u[1] * c, rotation: spot.rotation });
                at += b.w + GAP;
            }
        }
    }
    return out;
}

/** A floor with its bins that are out moved to the street (the same floor when none is). */
export function withBinsOut<T extends BinFloor>(floor: T, places: ReadonlyMap<string, BinPlace>): T {
    if (!places.size || !floor.furniture.some(f => places.has(f.id))) {
        return floor;
    }
    return { ...floor, furniture: floor.furniture.map(f => (places.has(f.id) ? { ...f, ...places.get(f.id) } : f)) };
}

/** A short signature of the places, to rebuild only when a bin goes out or comes back. */
export function binsSig(places: ReadonlyMap<string, BinPlace>): string {
    return [...places]
        .map(([id, p]) => `${id}@${p.x.toFixed(2)},${p.z.toFixed(2)},${p.rotation}`)
        .sort()
        .join('|');
}
