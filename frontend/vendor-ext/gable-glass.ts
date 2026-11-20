// A window or door glazed up under the roof (a gable window following the slope): above the opening a transom,
// over it fixed glass up to the roof, with a frame along the slope. Pure (no three.js).

/** Spacing of the points along the opening where the roof's height is taken (m). */
export const GLASS_STEP = 0.2;

/** The wall's top over an opening at evenly spaced points from its start (s = 0) to its end (s = width). */
export function roofTops(width: number, topAt: (s: number) => number, step = GLASS_STEP): number[] {
    const n = Math.max(2, Math.ceil(width / step));
    return Array.from({ length: n + 1 }, (_, i) => topAt((width * i) / n));
}

/** The tops when there is room for glass above the opening (its top `top`), more than 15 cm somewhere; else null. */
export function glazedTops(tops: readonly number[] | null | undefined, top: number): number[] | null {
    if (!tops || tops.length < 2 || !tops.every(Number.isFinite)) {
        return null;
    }
    return Math.max(...tops) > top + 0.15 ? [...tops] : null;
}

/** The roof's height over the point x (0 … width) of the opening, between the sampled tops. */
export function topAtX(tops: readonly number[], width: number, x: number): number {
    const n = tops.length - 1;
    const f = Math.min(n, Math.max(0, (x / (width || 1)) * n));
    const i = Math.min(n - 1, Math.floor(f));
    return tops[i] + (tops[i + 1] - tops[i]) * (f - i);
}

export interface GlassStrip {
    x0: number;
    x1: number;
    /** Its bottom (over the transom) and its top at x0 and at x1. */
    y0: number;
    ya: number;
    yb: number;
}

/**
 * The fixed glass above the transom (`bottom`): strips between the side posts and under the frame along the slope
 * (`frame` wide); where the roof comes down to the transom a strip ends in a point.
 */
export function glassStrips(tops: readonly number[], width: number, bottom: number, frame: number): GlassStrip[] {
    const n = tops.length - 1;
    const out: GlassStrip[] = [];
    for (let i = 0; i < n; i++) {
        const x0 = Math.max(frame, (width * i) / n);
        const x1 = Math.min(width - frame, (width * (i + 1)) / n);
        if (x1 - x0 < 1e-4) {
            continue;
        }
        const ya = Math.max(bottom, topAtX(tops, width, x0) - frame);
        const yb = Math.max(bottom, topAtX(tops, width, x1) - frame);
        if (ya - bottom < 1e-3 && yb - bottom < 1e-3) {
            continue;
        }
        out.push({ x0, x1, y0: bottom, ya, yb });
    }
    return out;
}
