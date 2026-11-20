// A floor's outline from its outer walls: a wall left open in part (a passage of height 0 to a stair room) leaves a
// gap in their loop, and without a closed loop the floor had no outline at all – no earth around it, no roof from
// it. The open ends are joined straight, nearest first. Pure (no three.js).

type P = [number, number];

const key = (p: P): string => `${Math.round(p[0] * 1000)}:${Math.round(p[1] * 1000)}`;

/**
 * The pieces that close the gaps of a loop of wall segments: between the ends that only one segment reaches, the
 * nearest pairs first, none longer than `maxGap` (m). Empty for a closed loop.
 */
export function gapSegments(segs: readonly (readonly [P, P])[], maxGap = 8): [P, P][] {
    const ends = new Map<string, { p: P; n: number }>();
    for (const [a, b] of segs) {
        for (const p of [a, b]) {
            const e = ends.get(key(p));
            if (e) {
                e.n++;
            } else {
                ends.set(key(p), { p, n: 1 });
            }
        }
    }
    const open = [...ends.values()].filter(e => e.n % 2 === 1).map(e => e.p);
    if (open.length < 2) {
        return [];
    }
    const pairs: { i: number; j: number; d: number }[] = [];
    for (let i = 0; i < open.length; i++) {
        for (let j = i + 1; j < open.length; j++) {
            const d = Math.hypot(open[i][0] - open[j][0], open[i][1] - open[j][1]);
            if (d <= maxGap) {
                pairs.push({ i, j, d });
            }
        }
    }
    pairs.sort((x, y) => x.d - y.d);
    const used = new Set<number>();
    const out: [P, P][] = [];
    for (const { i, j } of pairs) {
        if (used.has(i) || used.has(j)) {
            continue;
        }
        used.add(i);
        used.add(j);
        out.push([open[i], open[j]]);
    }
    return out;
}
